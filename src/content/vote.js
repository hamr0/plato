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

import { randomBytes } from 'node:crypto';
import { isBanned, isDisabled } from './mod.js';
import { pseudonymFor } from '../identity/pseudonym.js';

const NEW_ACCOUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const YOUNG_POST_WINDOW_MS = 24 * 60 * 60 * 1000;

// PRD §Moderation: a soft-removal (collapse) auto-reverts when the
// community accumulates this many net upvotes since the collapse
// landed. Per-sub configurable, default 20 for both targets. Hard
// removals (remove) are NOT subject to auto-revert — see migration
// 005 for rationale. Migration 006 split posts vs comments since they
// accumulate votes at very different rates.
export const AUTO_UNCOLLAPSE_THRESHOLD_DEFAULT = 20;

const TARGET_TABLE = { post: 'posts', comment: 'comments' };

const newActionId = () => randomBytes(8).toString('hex');

export function isNewAccount(db, handle, now = Date.now()) {
  const row = db.prepare('SELECT first_seen_at FROM handles WHERE handle = ?').get(handle);
  if (!row) throw new Error(`isNewAccount: handle ${handle} not found`);
  return now - row.first_seen_at < NEW_ACCOUNT_WINDOW_MS;
}

// Batch variant for surfaces that render many handles and need to mark
// new accounts in-line (e.g. the mod queue's flagger and target-author
// cells). Returns a Set of handles whose tenure is < NEW_ACCOUNT_WINDOW_MS.
// Unknown handles are silently dropped — the modlog renders rows whose
// authors may have been wiped, so erroring would break the page.
export function newAccountHandles(db, handles, now = Date.now()) {
  const out = new Set();
  if (handles.length === 0) return out;
  const placeholders = handles.map(() => '?').join(',');
  const cutoff = now - NEW_ACCOUNT_WINDOW_MS;
  const rows = db.prepare(
    `SELECT handle FROM handles WHERE handle IN (${placeholders}) AND first_seen_at > ?`
  ).all(...handles, cutoff);
  for (const r of rows) out.add(r.handle);
  return out;
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

  // Ensure handle row exists. A user whose first action is a vote (no
  // post or comment yet) won't have a handles row yet — without this,
  // the FK on votes.handle and the isNewAccount lookup both blow up.
  pseudonymFor(db, voterHandle);

  const table = TARGET_TABLE[targetType];
  const target = db.prepare(`SELECT id, handle, created_at, score, collapsed_at, score_at_collapse FROM ${table} WHERE id = ?`).get(targetId);
  if (!target) throw new Error(`castVote: ${targetType} ${targetId} not found`);

  // Ban check: votes are participation per PRD §Moderation. Resolve the
  // target's sub via post (direct) or comment → post (one hop) and reject
  // banned voters in that sub.
  const subName = targetType === 'post'
    ? db.prepare('SELECT sub_name FROM posts WHERE id = ?').get(targetId)?.sub_name
    : db.prepare('SELECT p.sub_name AS sub_name FROM posts p JOIN comments c ON c.post_id = p.id WHERE c.id = ?').get(targetId)?.sub_name;
  if (subName && isBanned(db, subName, voterHandle)) {
    throw new Error(`castVote: ${voterHandle} is banned from ${subName}`);
  }
  if (subName && isDisabled(db, subName)) {
    throw new Error(`castVote: //${subName} is read-only`);
  }

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
    const newScore = target.score + delta;

    // Community auto-uncollapse: if the target is currently soft-removed
    // and accumulated +AUTO_UNCOLLAPSE_THRESHOLD net upvotes since the
    // collapse landed, lift the collapse and write a system audit row.
    // Hard removals (removed_at != null) are not eligible.
    let autoUncollapsed = false;
    if (target.collapsed_at != null && target.score_at_collapse != null && subName) {
      const sinceCollapse = newScore - target.score_at_collapse;
      // Per-sub threshold (one for posts, one for comments). Falls back
      // to the default if the row predates migration 006 somehow.
      const thresholdCol = targetType === 'post' ? 'auto_uncollapse_post' : 'auto_uncollapse_comment';
      const subRow = db.prepare(`SELECT ${thresholdCol} AS t FROM subs WHERE name = ?`).get(subName);
      const threshold = subRow?.t ?? AUTO_UNCOLLAPSE_THRESHOLD_DEFAULT;
      if (sinceCollapse >= threshold) {
        db.prepare(`UPDATE ${table} SET collapsed_at = NULL, score_at_collapse = NULL WHERE id = ?`).run(targetId);
        db.prepare(
          `INSERT INTO mod_actions
           (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
           VALUES (?, ?, NULL, 'auto_uncollapse_community', ?, ?, NULL, ?)`
        ).run(newActionId(), subName, targetType, targetId, now);
        autoUncollapsed = true;
      }
    }

    db.exec('COMMIT');
    return { vote: newState, score: newScore, autoUncollapsed };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
