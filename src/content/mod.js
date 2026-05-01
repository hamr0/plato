// Moderation module — see PRD §Moderation and build-plan.md M4.
//
// Two surfaces:
//   - canModerate(db, subName, handle) → role string ('owner' | 'co') or null.
//     Owner is sourced from subs.owner_handle; co-mods from sub_mods.
//   - recordAction(db, { ... }) — transactional: writes the audit row in
//     mod_actions AND flips the corresponding soft-state column (or
//     bans/sub_mods row), so list queries can filter visibility without
//     joining the audit log.
//
// Soft-state model: posts/comments have nullable collapsed_at and
// removed_at columns. NULL = visible. Non-null = unix-ms timestamp the
// action landed. The audit log carries the full history; the columns are
// the cache the read path checks.

import { randomBytes } from 'node:crypto';

const ID_BYTES = 8;
const newId = () => randomBytes(ID_BYTES).toString('hex');

export const MOD_ACTIONS = Object.freeze([
  'collapse', 'uncollapse',
  'remove', 'unremove',
  'ban', 'unban',
  'promote_mod', 'demote_mod', 'transfer_owner',
]);

// Co-mods can act on content and bans. Owner-only actions are the ones
// that change who holds the keys to the sub.
const OWNER_ONLY = new Set(['promote_mod', 'demote_mod', 'transfer_owner']);

const CONTENT_ACTIONS = new Set(['collapse', 'uncollapse', 'remove', 'unremove']);
const BAN_ACTIONS     = new Set(['ban', 'unban']);

export function canModerate(db, subName, handle) {
  if (!handle) return null;
  const sub = db.prepare('SELECT owner_handle FROM subs WHERE name = ?').get(subName);
  if (!sub) return null;
  if (sub.owner_handle === handle) return 'owner';
  const row = db
    .prepare('SELECT role FROM sub_mods WHERE sub_name = ? AND handle = ?')
    .get(subName, handle);
  if (!row) return null;
  return row.role === 'owner' ? 'owner' : 'co';
}

// Apply the state flip for an action. Returns nothing; throws on
// invariant violations. Caller must already be inside a transaction.
function applyState(db, { action, targetType, targetId, subName, modHandle, reason, now }) {
  if (CONTENT_ACTIONS.has(action)) {
    const table = targetType === 'post' ? 'posts' : 'comments';
    const column =
      action === 'collapse' || action === 'uncollapse' ? 'collapsed_at' : 'removed_at';
    const value = action === 'collapse' || action === 'remove' ? now : null;
    const result = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(value, targetId);
    if (result.changes === 0) {
      throw new Error(`recordAction: ${targetType} ${targetId} not found`);
    }
    return;
  }
  if (BAN_ACTIONS.has(action)) {
    if (action === 'ban') {
      db.prepare(
        `INSERT INTO bans (sub_name, handle, banned_by, reason, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(sub_name, handle) DO UPDATE SET
           banned_by = excluded.banned_by,
           reason    = excluded.reason,
           created_at = excluded.created_at`
      ).run(subName, targetId, modHandle, reason ?? null, now);
    } else {
      db.prepare('DELETE FROM bans WHERE sub_name = ? AND handle = ?').run(subName, targetId);
    }
    return;
  }
  if (action === 'promote_mod') {
    db.prepare(
      `INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, 'co')
       ON CONFLICT(sub_name, handle) DO UPDATE SET role = 'co'`
    ).run(subName, targetId);
    return;
  }
  if (action === 'demote_mod') {
    db.prepare(`DELETE FROM sub_mods WHERE sub_name = ? AND handle = ? AND role = 'co'`)
      .run(subName, targetId);
    return;
  }
  if (action === 'transfer_owner') {
    const sub = db.prepare('SELECT owner_handle FROM subs WHERE name = ?').get(subName);
    if (!sub) throw new Error(`recordAction: sub ${subName} not found`);
    db.prepare('UPDATE subs SET owner_handle = ? WHERE name = ?').run(targetId, subName);
    // Old owner becomes a co-mod so they retain participation tools.
    if (sub.owner_handle && sub.owner_handle !== targetId) {
      db.prepare(
        `INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, 'co')
         ON CONFLICT(sub_name, handle) DO UPDATE SET role = 'co'`
      ).run(subName, sub.owner_handle);
    }
    // New owner's row in sub_mods, if any, is removed — owner_handle is the source of truth.
    db.prepare('DELETE FROM sub_mods WHERE sub_name = ? AND handle = ?').run(subName, targetId);
  }
}

export function recordAction(db, {
  subName, modHandle, action, targetType, targetId, reason = null, now = Date.now(),
}) {
  if (!MOD_ACTIONS.includes(action)) throw new Error(`recordAction: unknown action ${action}`);
  if (!subName || !modHandle || !targetType || !targetId) {
    throw new Error('recordAction: subName, modHandle, targetType, targetId required');
  }
  if (CONTENT_ACTIONS.has(action) && !['post', 'comment'].includes(targetType)) {
    throw new Error(`recordAction: ${action} requires targetType post|comment`);
  }
  if ((BAN_ACTIONS.has(action) || OWNER_ONLY.has(action)) && targetType !== 'handle') {
    throw new Error(`recordAction: ${action} requires targetType handle`);
  }

  const role = canModerate(db, subName, modHandle);
  if (!role) throw new Error(`recordAction: ${modHandle} is not a mod of ${subName}`);
  if (OWNER_ONLY.has(action) && role !== 'owner') {
    throw new Error(`recordAction: ${action} is owner-only`);
  }

  const id = newId();
  db.exec('BEGIN');
  try {
    applyState(db, { action, targetType, targetId, subName, modHandle, reason, now });
    db.prepare(
      `INSERT INTO mod_actions
       (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, subName, modHandle, action, targetType, targetId, reason, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { id };
}

export function listModActions(db, subName, { limit = 100, offset = 0 } = {}) {
  return db.prepare(
    `SELECT id, mod_handle, action, target_type, target_id, reason, created_at
     FROM mod_actions
     WHERE sub_name = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(subName, limit, offset);
}

export function isBanned(db, subName, handle) {
  if (!handle) return false;
  const row = db
    .prepare('SELECT 1 FROM bans WHERE sub_name = ? AND handle = ?')
    .get(subName, handle);
  return !!row;
}
