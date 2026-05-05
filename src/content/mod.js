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
import { isSubscribed } from './subscription.js';

const ID_BYTES = 8;
const newId = () => randomBytes(ID_BYTES).toString('hex');

export const MOD_ACTIONS = Object.freeze([
  'collapse', 'uncollapse',
  'remove', 'unremove',
  'ban', 'unban',
  'promote_mod', 'demote_mod', 'transfer_owner',
  'auto_disable_inactivity', 'manual_reactivate',
]);

// Owner-only actions change who holds the keys to the sub. Self-demote on
// 'demote_mod' is the one exception (a co-mod can step down without owner
// permission); recordAction handles that special case explicitly.
const OWNER_ONLY = new Set(['promote_mod', 'demote_mod', 'transfer_owner']);

const CONTENT_ACTIONS = new Set(['collapse', 'uncollapse', 'remove', 'unremove']);
const BAN_ACTIONS     = new Set(['ban', 'unban']);
const SUB_STATE_ACTIONS = new Set(['auto_disable_inactivity', 'manual_reactivate']);

// 30 days is the inactivity threshold for auto-disable. Floor-locked: this
// is a uniform property of plato, not an operator preference. PRD §Sub
// Lifecycle. Forks who change this are forks.
export const SUB_INACTIVITY_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
export const SUB_INACTIVITY_WARNING_MS = 28 * 24 * 60 * 60 * 1000;

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
    // Eligibility: target must be subscribed to the sub at promotion time.
    // Subscription is plato's only "intent to engage" primitive; it's
    // voluntary, public, reversible, and doesn't introduce a new
    // membership concept (no sub stays subscribed-only at the read/write
    // layer). After promotion, the mod role and the subscription are
    // independent — unsubscribing later does not auto-revoke mod status.
    if (!isSubscribed(db, targetId, subName)) {
      throw new Error(`recordAction: promote_mod target must be subscribed to ${subName}`);
    }
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
  if (action === 'auto_disable_inactivity' || action === 'manual_reactivate') {
    const value = action === 'auto_disable_inactivity' ? now : null;
    const result = db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(value, subName);
    if (result.changes === 0) throw new Error(`recordAction: sub ${subName} not found`);
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
    // Mod role implies subscribership: ensure the new owner is subscribed
    // so the sub stays in their subscribed feed. They were a co-mod (so
    // already subscribed at promotion time), but may have unsubscribed
    // since — re-establish the invariant.
    db.prepare(
      `INSERT OR IGNORE INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)`
    ).run(targetId, subName, now);
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
  if (SUB_STATE_ACTIONS.has(action) && targetType !== 'sub') {
    throw new Error(`recordAction: ${action} requires targetType sub`);
  }
  // Self-ban / self-unban is a footgun (locks the mod out of their own
  // sub) with no legitimate use. Reject defensively even if the UI hides
  // the affordance. Self-demote on demote_mod is the one self-target case
  // we explicitly allow — a co-mod stepping down. transfer_owner to self
  // is rejected (no-op); promote_mod to self is rejected (already a mod).
  if (
    targetType === 'handle' &&
    targetId === modHandle &&
    action !== 'demote_mod'
  ) {
    throw new Error(`recordAction: ${action} cannot target the acting mod`);
  }

  // Disabled subs reject all mod actions except the explicit reactivate
  // path. Auto-disable from cron is also allowed (the cron may need to
  // re-record on edge cases) but in practice a sub that's already
  // disabled isn't picked up by the inactivity check.
  if (
    action !== 'manual_reactivate' &&
    action !== 'auto_disable_inactivity' &&
    isDisabled(db, subName)
  ) {
    throw new Error(`recordAction: //${subName} is read-only`);
  }

  // System-driven action (cron). Skip the mod-role check.
  if (action === 'auto_disable_inactivity') {
    if (modHandle !== SYSTEM_HANDLE) {
      throw new Error('recordAction: auto_disable_inactivity must be system-driven');
    }
  } else {
    const role = canModerate(db, subName, modHandle);
    if (!role) throw new Error(`recordAction: ${modHandle} is not a mod of ${subName}`);
    // Owner-only enforcement, with one exception: a co-mod can demote
    // themselves (step down). Demoting *another* co-mod still requires
    // owner.
    if (OWNER_ONLY.has(action) && role !== 'owner') {
      const isSelfDemote = action === 'demote_mod' && targetId === modHandle;
      if (!isSelfDemote) {
        throw new Error(`recordAction: ${action} is owner-only`);
      }
    }
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
//
// Owner is sourced from subs.owner_handle (source of truth); co-mods from
// sub_mods. After transfer_owner the new owner is removed from sub_mods,
// so a UNION across both tables is required to keep their modlog link.
export function listSubsModeratedBy(db, handle) {
  if (!handle) return [];
  return db.prepare(
    `SELECT sub_name FROM (
       SELECT name AS sub_name FROM subs WHERE owner_handle = ?
       UNION
       SELECT sub_name        FROM sub_mods WHERE handle = ?
     )
     ORDER BY sub_name ASC`
  ).all(handle, handle).map((r) => r.sub_name);
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

// Sub-state helpers (M5/B12).

// True when the sub is in read-only state (entered via owner step-down
// with no co-mods, or via 30-day cron auto-disable). Reads stay open
// regardless; only write paths gate on this.
export function isDisabled(db, subName) {
  const row = db.prepare('SELECT disabled_at FROM subs WHERE name = ?').get(subName);
  return !!(row && row.disabled_at != null);
}

// List handles of every mod (owner + co-mods) for a sub.
export function modsOfSub(db, subName) {
  const handles = new Set();
  const sub = db.prepare('SELECT owner_handle FROM subs WHERE name = ?').get(subName);
  if (sub?.owner_handle) handles.add(sub.owner_handle);
  for (const r of db.prepare('SELECT handle FROM sub_mods WHERE sub_name = ?').all(subName)) {
    handles.add(r.handle);
  }
  return [...handles];
}

// Co-mods only (excludes the owner). Used by the edit form's "co-mods"
// section so the owner row doesn't appear under the Co-mods heading.
export function listCoMods(db, subName) {
  return db.prepare(
    `SELECT handle FROM sub_mods WHERE sub_name = ? AND role = 'co' ORDER BY handle`
  ).all(subName).map((r) => r.handle);
}

// Latest mod-presence timestamp across {posts, comments, mod_actions} for
// any current mod of the sub. Returns unix-ms or null. The cron uses
// (now - this) > SUB_INACTIVITY_THRESHOLD_MS to decide auto-disable.
//
// "Mod activity" deliberately includes participation (posts/comments by a
// mod in their own sub) AND moderation (mod_actions rows). A healthy sub
// where the mod is just chatting still counts; the timer doesn't punish
// quiet sub for having no incidents.
export function lastModActivity(db, subName) {
  const mods = modsOfSub(db, subName);
  if (mods.length === 0) return null;
  const placeholders = mods.map(() => '?').join(',');
  const row = db.prepare(`
    SELECT MAX(t) AS latest FROM (
      SELECT MAX(created_at) AS t FROM posts
        WHERE sub_name = ? AND handle IN (${placeholders})
      UNION ALL
      SELECT MAX(c.created_at) AS t FROM comments c
        JOIN posts p ON p.id = c.post_id
        WHERE p.sub_name = ? AND c.handle IN (${placeholders})
      UNION ALL
      SELECT MAX(created_at) AS t FROM mod_actions
        WHERE sub_name = ? AND mod_handle IN (${placeholders})
    )
  `).get(subName, ...mods, subName, ...mods, subName, ...mods);
  return row?.latest ?? null;
}

// Subs currently in read-only state, newest-first. Used by the /subs
// directory marker and other listings.
export function listDisabledSubs(db) {
  return db.prepare(
    'SELECT name, disabled_at FROM subs WHERE disabled_at IS NOT NULL ORDER BY disabled_at DESC'
  ).all();
}

// Walk every active sub and auto-disable any whose mods have been silent
// for SUB_INACTIVITY_THRESHOLD_MS. Returns the list of sub names that
// transitioned to read-only this pass. Idempotent — re-running on a sub
// that's already disabled is a no-op (the WHERE clause excludes them).
//
// Run by bin/check-sub-inactivity.js (system cron, daily). Pure-function
// shape so tests can drive it with a fake `now` and assert without
// touching a real cron daemon.
export function runInactivitySweep(db, { now = Date.now() } = {}) {
  const cutoff = now - SUB_INACTIVITY_THRESHOLD_MS;
  const candidates = db.prepare(
    'SELECT name FROM subs WHERE disabled_at IS NULL'
  ).all();
  const disabled = [];
  for (const { name } of candidates) {
    const last = lastModActivity(db, name);
    // No mods at all (zero owner, zero co-mods) → not eligible for the
    // inactivity timer; the sub is in a different failure mode (probably
    // operator-created with no owner) and the cron isn't the right
    // intervention. Leave it alone.
    if (last == null) continue;
    if (last >= cutoff) continue;
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ? AND disabled_at IS NULL').run(now, name);
      db.prepare(
        `INSERT INTO mod_actions
           (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
         VALUES (?, ?, ?, 'auto_disable_inactivity', 'sub', ?, ?, ?)`
      ).run(
        randomBytes(ID_BYTES).toString('hex'),
        name, SYSTEM_HANDLE, name,
        `30 days no mod activity (last seen ${new Date(last).toISOString()})`,
        now,
      );
      db.exec('COMMIT');
      disabled.push(name);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return disabled;
}
