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

const ID_BYTES = 8;
const newId = () => randomBytes(ID_BYTES).toString('hex');

export const FLAG_CATEGORIES = Object.freeze([
  'spam', 'harassment', 'illegal', 'off_topic', 'other',
]);

// PRD §Spam 7: "configurable per-sub, default 3 unique flaggers."
// Per-sub override lands when M5 needs it; for now the default is the
// only lever.
export const AUTO_HIDE_THRESHOLD = 3;

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
  return db
    .prepare(
      `SELECT count(*) AS n FROM flags
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
