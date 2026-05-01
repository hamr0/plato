// Vote module — see PRD §Voting and build-plan.md M3.
//
// PRD-locked rules:
// - One vote per handle per (target_type, target_id). Enforced by composite
//   PK on the votes table.
// - New accounts (forum tenure < 7 days from handles.first_seen_at):
//   * Vote weight 0.5 instead of 1.0.
//   * Can vote on posts only, not comments.
//   * Posts must be < 24h old.
//   The 7-day / 24h pair is a deliberate rate-limit on brigading by fresh
//   sockpuppets without permanently second-classing legitimate new users.
// - Re-voting in the same direction toggles the vote off. Voting in the
//   opposite direction switches sides. Score caches on posts/comments are
//   updated transactionally on every change so the cache never drifts.

const NEW_ACCOUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const YOUNG_POST_WINDOW_MS = 24 * 60 * 60 * 1000;

const TARGET_TABLE = { post: 'posts', comment: 'comments' };

export function isNewAccount(db, handle, now = Date.now()) {
  const row = db.prepare('SELECT first_seen_at FROM handles WHERE handle = ?').get(handle);
  if (!row) throw new Error(`isNewAccount: handle ${handle} not found`);
  return now - row.first_seen_at < NEW_ACCOUNT_WINDOW_MS;
}

export function getVote(db, { targetType, targetId, voterHandle }) {
  const row = db.prepare(
    'SELECT value FROM votes WHERE target_type = ? AND target_id = ? AND handle = ?'
  ).get(targetType, targetId, voterHandle);
  if (!row) return null;
  return row.value > 0 ? 'up' : 'down';
}

export function castVote(db, { targetType, targetId, voterHandle, direction, now = Date.now() }) {
  if (!TARGET_TABLE[targetType]) {
    throw new Error(`castVote: targetType must be 'post' or 'comment', got ${targetType}`);
  }
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`castVote: direction must be 'up' or 'down', got ${direction}`);
  }
  if (!voterHandle) throw new Error('castVote: voterHandle is required');

  const table = TARGET_TABLE[targetType];
  const target = db.prepare(`SELECT id, handle, created_at, score FROM ${table} WHERE id = ?`).get(targetId);
  if (!target) throw new Error(`castVote: ${targetType} ${targetId} not found`);

  const isNew = isNewAccount(db, voterHandle, now);
  if (isNew) {
    if (targetType === 'comment') {
      throw new Error('new accounts (< 7 days) cannot vote on comments');
    }
    if (now - target.created_at >= YOUNG_POST_WINDOW_MS) {
      throw new Error('new accounts (< 7 days) can only vote on posts < 24h old');
    }
  }

  const weight = isNew ? 0.5 : 1.0;
  const newValue = direction === 'up' ? weight : -weight;

  const existing = db.prepare(
    'SELECT value FROM votes WHERE target_type = ? AND target_id = ? AND handle = ?'
  ).get(targetType, targetId, voterHandle);

  db.exec('BEGIN');
  try {
    let delta;
    let newState;
    if (!existing) {
      db.prepare(
        'INSERT INTO votes (target_type, target_id, handle, value, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(targetType, targetId, voterHandle, newValue, now);
      delta = newValue;
      newState = direction;
    } else if (Math.sign(existing.value) === Math.sign(newValue)) {
      // Same direction → toggle off.
      db.prepare(
        'DELETE FROM votes WHERE target_type = ? AND target_id = ? AND handle = ?'
      ).run(targetType, targetId, voterHandle);
      delta = -existing.value;
      newState = null;
    } else {
      // Opposite direction → switch sides.
      db.prepare(
        'UPDATE votes SET value = ?, created_at = ? WHERE target_type = ? AND target_id = ? AND handle = ?'
      ).run(newValue, now, targetType, targetId, voterHandle);
      delta = newValue - existing.value;
      newState = direction;
    }

    db.prepare(`UPDATE ${table} SET score = score + ? WHERE id = ?`).run(delta, targetId);
    db.exec('COMMIT');
    return { vote: newState, score: target.score + delta };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
