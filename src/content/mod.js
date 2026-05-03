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
import { SYSTEM_HANDLE } from './spamPatterns.js';

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
    let result;
    if (action === 'collapse') {
      // Snapshot current score so the vote module can detect when the
      // community has overruled the collapse with +N upvotes since.
      result = db.prepare(`UPDATE ${table} SET collapsed_at = ?, score_at_collapse = score WHERE id = ?`).run(now, targetId);
    } else if (action === 'uncollapse') {
      result = db.prepare(`UPDATE ${table} SET collapsed_at = NULL, score_at_collapse = NULL WHERE id = ?`).run(targetId);
    } else {
      // remove / unremove: hard moderation, no score snapshot — auto-revert
      // does not apply to hard removals (PRD: hard removal is for content
      // that should not return regardless of vote consensus).
      const value = action === 'remove' ? now : null;
      result = db.prepare(`UPDATE ${table} SET removed_at = ? WHERE id = ?`).run(value, targetId);
    }
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
    const targetExists = db.prepare('SELECT 1 FROM handles WHERE handle = ?').get(targetId);
    if (!targetExists) {
      throw new Error(`recordAction: transfer_owner target ${targetId.slice(0, 8)} is not a known handle`);
    }
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
  // Self-ban / self-unban is a footgun (locks the mod out of their own
  // sub) with no legitimate use. Reject defensively even if the UI hides
  // the affordance. Other handle-targeted actions (promote/demote/transfer)
  // are owner-only and already gated below; rejecting self there too
  // since transferring ownership to yourself is a no-op.
  if (targetType === 'handle' && targetId === modHandle) {
    throw new Error(`recordAction: ${action} cannot target the acting mod`);
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
    `SELECT id, sub_name, mod_handle, action, target_type, target_id, reason, created_at
     FROM mod_actions
     WHERE sub_name = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(subName, limit, offset);
}

// Subs (by name) where this handle has any mod role (owner or co). Used to
// surface a "modlog" link in the header for active mods, and to gate the
// cross-sub /modlog view to actions in the user's own subs.
export function listSubsModeratedBy(db, handle) {
  if (!handle) return [];
  return db.prepare(
    `SELECT sub_name FROM sub_mods WHERE handle = ? ORDER BY sub_name ASC`
  ).all(handle).map((r) => r.sub_name);
}

// Cross-sub mod actions for a multi-sub mod. Includes sub_name in each row
// so the unified modlog view can render it as the first column. Pagination
// is required because a busy mod can rack up hundreds of actions.
//
// Filters (all optional, used by the unified /modlog audit view):
//   since         — unix-ms; rows with created_at > since
//   actions       — array of action enum values to include (e.g. ['ban','unban'])
//   modHandle     — exact mod_handle match; pass the literal string 'system'
//                   to match NULL rows (auto events)
//   targetHandle  — match rows where target_type='handle' AND target_id=<handle>;
//                   used by the user-click-to-filter on ban rows
function buildAuditClause(subNames, { since, actions, modHandle, targetHandle } = {}) {
  const placeholders = subNames.map(() => '?').join(',');
  const where = [`sub_name IN (${placeholders})`];
  const params = [...subNames];
  if (Number.isFinite(since)) {
    where.push('created_at > ?');
    params.push(since);
  }
  if (Array.isArray(actions) && actions.length > 0) {
    where.push(`action IN (${actions.map(() => '?').join(',')})`);
    params.push(...actions);
  }
  if (modHandle === 'system') {
    where.push('mod_handle = ?');
    params.push(SYSTEM_HANDLE);
  } else if (typeof modHandle === 'string' && modHandle.length > 0) {
    where.push('mod_handle = ?');
    params.push(modHandle);
  }
  if (typeof targetHandle === 'string' && targetHandle.length > 0) {
    // Match across all target types: ban rows (target_id IS the handle)
    // plus post/comment rows whose author is this handle. Subqueries over
    // posts.handle / comments.handle let the audit table's user column be
    // a real filter for content as well as bans.
    where.push(`(
      (target_type = 'handle' AND target_id = ?)
      OR (target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE handle = ?))
      OR (target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE handle = ?))
    )`);
    params.push(targetHandle, targetHandle, targetHandle);
  }
  return { where: where.join(' AND '), params };
}

export function listModActionsAcrossSubs(db, subNames, { limit = 25, offset = 0, ...filters } = {}) {
  if (!subNames || subNames.length === 0) return [];
  const { where, params } = buildAuditClause(subNames, filters);
  return db.prepare(
    `SELECT id, sub_name, mod_handle, action, target_type, target_id, reason, created_at
     FROM mod_actions
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
}

export function countModActionsAcrossSubs(db, subNames, filters = {}) {
  if (!subNames || subNames.length === 0) return 0;
  const { where, params } = buildAuditClause(subNames, filters);
  return db.prepare(
    `SELECT COUNT(*) AS n FROM mod_actions WHERE ${where}`
  ).get(...params).n;
}

// Inbox mode: deduped target view. One row per (target_type, target_id)
// after the same filters as audit. The row carries the latest event's
// fields plus event_count so the renderer can show a "[banned] · 4
// events" badge that surfaces mod ping-pong patterns at a glance.
//
// Dedup happens AFTER filtering — `?type=banned` collapses to "the
// latest ban-or-unban per user" rather than "the latest anything per
// user, then filter for bans" (which would lose users whose latest
// event was a remove). See M5 spec discussion.
export function listInboxAcrossSubs(db, subNames, { limit = 50, offset = 0, ...filters } = {}) {
  if (!subNames || subNames.length === 0) return [];
  const { where, params } = buildAuditClause(subNames, filters);
  return db.prepare(
    `SELECT id, sub_name, mod_handle, action, target_type, target_id, reason, created_at, event_count
     FROM (
       SELECT id, sub_name, mod_handle, action, target_type, target_id, reason, created_at,
              ROW_NUMBER() OVER (PARTITION BY target_type, target_id ORDER BY created_at DESC) AS rn,
              COUNT(*)     OVER (PARTITION BY target_type, target_id)                         AS event_count
       FROM mod_actions
       WHERE ${where}
     )
     WHERE rn = 1
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
}

export function countInboxAcrossSubs(db, subNames, filters = {}) {
  if (!subNames || subNames.length === 0) return 0;
  const { where, params } = buildAuditClause(subNames, filters);
  return db.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT 1 FROM mod_actions WHERE ${where}
       GROUP BY target_type, target_id
     )`
  ).get(...params).n;
}

export function isBanned(db, subName, handle) {
  if (!handle) return false;
  const row = db
    .prepare('SELECT 1 FROM bans WHERE sub_name = ? AND handle = ?')
    .get(subName, handle);
  return !!row;
}
