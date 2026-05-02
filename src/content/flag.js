// Flag module — see PRD §Spam Defenses 7 and build-plan.md M4.
//
// Flags are user-submitted reports on a post or comment. One row per
// (target, flagger) pair; the schema UNIQUE prevents one user from
// flooding flags on a single target. Categories are a closed list:
// spam, harassment, illegal, off_topic, other.
//
// Auto-hide: when AUTO_HIDE_THRESHOLD distinct pending flags accumulate
// on a target, submitFlag flips collapsed_at on that target — making it
// invisible from default sort views — without writing to mod_actions.
// The flags table itself is the audit trail for system collapses (you
// can see who flagged what and why). Mods then review: upholding leaves
// the collapse in place; dismissing the flags un-counts them. Either
// way, mods can manually uncollapse via recordAction.

import { randomBytes } from 'node:crypto';
import { pseudonymFor } from '../identity/pseudonym.js';

const ID_BYTES = 8;
const newId = () => randomBytes(ID_BYTES).toString('hex');

export const FLAG_CATEGORIES = Object.freeze([
  'spam', 'harassment', 'illegal', 'off_topic', 'other',
]);

// PRD §Spam 7: "configurable per-sub, default 3 unique flaggers."
// Per-sub override lands when M5 needs it; for now the default is the
// only lever.
export const AUTO_HIDE_THRESHOLD = 3;

export const NOTE_MAX = 280;

export function submitFlag(db, {
  targetType, targetId, flaggerHandle, category, note = null, now = Date.now(),
}) {
  if (!['post', 'comment'].includes(targetType)) {
    throw new Error(`submitFlag: invalid targetType ${targetType}`);
  }
  if (!FLAG_CATEGORIES.includes(category)) {
    throw new Error(`submitFlag: invalid category ${category}`);
  }
  if (!flaggerHandle) throw new Error('submitFlag: flaggerHandle required');
  // Ensure handle row exists so the FK on flags.flagger_handle holds for a
  // user whose first action is a flag (no post or comment yet).
  pseudonymFor(db, flaggerHandle);
  if (typeof note === 'string' && note.length > NOTE_MAX) {
    throw new Error(`submitFlag: note exceeds ${NOTE_MAX} characters`);
  }

  // Existence check before the UNIQUE collision so the error message is
  // friendlier than "FOREIGN KEY constraint failed".
  const table = targetType === 'post' ? 'posts' : 'comments';
  const target = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(targetId);
  if (!target) throw new Error(`submitFlag: ${targetType} ${targetId} not found`);

  const id = newId();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO flags (id, target_type, target_id, flagger_handle, category, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, targetType, targetId, flaggerHandle, category, note, now);

    const pending = pendingFlagCount(db, targetType, targetId);
    let autoHidden = false;
    if (pending >= AUTO_HIDE_THRESHOLD) {
      // Only flip if not already hidden — manual mod collapses and prior
      // auto-hides shouldn't get their timestamp overwritten.
      const result = db
        .prepare(`UPDATE ${table} SET collapsed_at = ? WHERE id = ? AND collapsed_at IS NULL`)
        .run(now, targetId);
      autoHidden = result.changes > 0;
    }
    db.exec('COMMIT');
    return { id, pending, autoHidden };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function pendingFlagCount(db, targetType, targetId) {
  // PRD §Spam 7 talks in distinct flaggers. UNIQUE(target_type, target_id,
  // flagger_handle) makes count(*) and count(DISTINCT flagger_handle)
  // equivalent today, but spelling the intent prevents drift if the
  // UNIQUE ever changes.
  return db
    .prepare(
      `SELECT count(DISTINCT flagger_handle) AS n FROM flags
       WHERE target_type = ? AND target_id = ? AND resolution = 'pending'`
    )
    .get(targetType, targetId).n;
}

export function flagsForTarget(db, targetType, targetId) {
  return db
    .prepare(
      `SELECT id, flagger_handle, category, note, created_at, resolution, resolver_handle, resolved_at
       FROM flags WHERE target_type = ? AND target_id = ?
       ORDER BY created_at DESC`
    )
    .all(targetType, targetId);
}

export function resolveFlag(db, { flagId, resolverHandle, resolution, now = Date.now() }) {
  if (!['upheld', 'dismissed'].includes(resolution)) {
    throw new Error(`resolveFlag: resolution must be upheld|dismissed, got ${resolution}`);
  }
  const result = db
    .prepare(
      `UPDATE flags SET resolution = ?, resolver_handle = ?, resolved_at = ?
       WHERE id = ? AND resolution = 'pending'`
    )
    .run(resolution, resolverHandle, now, flagId);
  if (result.changes === 0) {
    throw new Error(`resolveFlag: flag ${flagId} not found or already resolved`);
  }
}

// Targets the given handle has already flagged among a candidate id list.
// Used by render to dim the flag button on visible posts/comments where
// the current user has already submitted a flag — avoids the silent
// double-submit-then-UNIQUE-collision flow. Returns a Set of target ids.
//
// Scoped to PENDING flags only: once a mod resolves (uphold or dismiss),
// the flagger's UI shouldn't keep showing "you flagged this" — the
// concern was registered and adjudicated. Re-flagging a still-visible
// dismissed-then-recurring item is allowed.
export function flaggedTargetsByHandle(db, targetType, targetIds, handle) {
  if (!handle || !targetIds || targetIds.length === 0) return new Set();
  const placeholders = targetIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT target_id FROM flags
     WHERE target_type = ? AND flagger_handle = ?
       AND resolution = 'pending'
       AND target_id IN (${placeholders})`
  ).all(targetType, handle, ...targetIds);
  return new Set(rows.map((r) => r.target_id));
}

// Mod queue: pending flags grouped by target, joined with target sub for
// per-sub scoping. Returns each target once with its pending flag count
// and the most-recent flag's timestamp for sorting.
export function pendingFlagsForSub(db, subName) {
  return db
    .prepare(
      `SELECT
         f.target_type,
         f.target_id,
         count(*) AS pending,
         max(f.created_at) AS last_flagged_at
       FROM flags f
       LEFT JOIN posts p
         ON f.target_type = 'post' AND f.target_id = p.id
       LEFT JOIN comments c
         ON f.target_type = 'comment' AND f.target_id = c.id
       LEFT JOIN posts cp
         ON f.target_type = 'comment' AND c.post_id = cp.id
       WHERE f.resolution = 'pending'
         AND COALESCE(p.sub_name, cp.sub_name) = ?
       GROUP BY f.target_type, f.target_id
       ORDER BY last_flagged_at DESC`
    )
    .all(subName);
}

// Cross-sub variant for the unified /modlog open mode. Each row carries
// the sub_name and the target's author handle so the renderer can fill
// the user column without a second pass. Scoped to the calling mod's
// sub set — a mod never sees pending flags from a sub they don't run.
export function pendingFlagsAcrossSubs(db, subNames) {
  if (!subNames || subNames.length === 0) return [];
  const placeholders = subNames.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT
         f.target_type,
         f.target_id,
         COALESCE(p.sub_name, cp.sub_name)            AS sub_name,
         COALESCE(p.handle,   c.handle)               AS author_handle,
         count(*)                                     AS pending,
         max(f.created_at)                            AS last_flagged_at
       FROM flags f
       LEFT JOIN posts    p  ON f.target_type = 'post'    AND f.target_id = p.id
       LEFT JOIN comments c  ON f.target_type = 'comment' AND f.target_id = c.id
       LEFT JOIN posts    cp ON f.target_type = 'comment' AND c.post_id    = cp.id
       WHERE f.resolution = 'pending'
         AND COALESCE(p.sub_name, cp.sub_name) IN (${placeholders})
       GROUP BY f.target_type, f.target_id
       ORDER BY last_flagged_at DESC`
    )
    .all(...subNames);
}

// Per-target breakdown for the row-expansion view: flagger handles +
// categories, in submission order. Batched across all visible targets
// in one query — a busy /modlog page might render 50 pending targets,
// and a per-row query would be N round-trips.
export function flagBreakdownsForTargets(db, targets) {
  if (!targets || targets.length === 0) return new Map();
  // Build (target_type, target_id) tuple matcher via OR of pairs.
  const conds = targets.map(() => '(target_type = ? AND target_id = ?)').join(' OR ');
  const params = targets.flatMap((t) => [t.target_type, t.target_id]);
  const rows = db.prepare(
    `SELECT target_type, target_id, flagger_handle, category, note, created_at
     FROM flags
     WHERE resolution = 'pending' AND (${conds})
     ORDER BY created_at ASC`
  ).all(...params);
  const out = new Map();
  for (const r of rows) {
    const key = `${r.target_type}:${r.target_id}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return out;
}

// Resolve every pending flag on a target in one shot. Used when a mod
// decides on the row in /modlog open mode — the action button fires one
// resolution that closes out all flags for that target. Returns the
// number of flags resolved.
export function resolveFlagsForTarget(db, { targetType, targetId, resolverHandle, resolution, now = Date.now() }) {
  if (!['upheld', 'dismissed'].includes(resolution)) {
    throw new Error(`resolveFlagsForTarget: resolution must be upheld|dismissed, got ${resolution}`);
  }
  const result = db
    .prepare(
      `UPDATE flags SET resolution = ?, resolver_handle = ?, resolved_at = ?
       WHERE target_type = ? AND target_id = ? AND resolution = 'pending'`
    )
    .run(resolution, resolverHandle, now, targetType, targetId);
  return result.changes;
}
