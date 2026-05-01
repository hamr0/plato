// Sub model — see PRD §subs and build-plan.md M2.
//
// Naming rules are intentionally tight: lowercase + alphanumeric + hyphen,
// 3–30 chars, locked at creation. The reserved namespace blocks names that
// collide with current and future top-level routes (`/admin`, `/api`, ...)
// or that look administrative to a user landing on /sub/<name>.

const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

// Floors on the per-sub auto-uncollapse thresholds (migration 006). Posts
// surface in feeds and rack up votes faster than comments, so the post
// floor is higher. Both defend against a small brigade overturning a mod
// soft-removal: 20 dedicated voters can flip a comment, 50 a post.
export const AUTO_UNCOLLAPSE_POST_FLOOR = 50;
export const AUTO_UNCOLLAPSE_COMMENT_FLOOR = 20;

export const RESERVED_SUB_NAMES = new Set([
  'admin',
  'mod',
  'system',
  'api',
  'auth',
  'assets',
  'static',
  'health',
]);

export function validateSubName(name) {
  if (typeof name !== 'string') {
    throw new Error('sub name must be a string');
  }
  if (name.length < 3 || name.length > 30) {
    throw new Error('sub name must be 3–30 characters');
  }
  if (!NAME_RE.test(name)) {
    throw new Error('sub name must be lowercase alphanumeric with hyphens (no leading/trailing hyphen)');
  }
  if (RESERVED_SUB_NAMES.has(name)) {
    throw new Error(`sub name "${name}" is reserved`);
  }
}

export function createSub(db, {
  name,
  description = '',
  ownerHandle,
  autoUncollapsePost = AUTO_UNCOLLAPSE_POST_FLOOR,
  autoUncollapseComment = AUTO_UNCOLLAPSE_COMMENT_FLOOR,
}) {
  validateSubName(name);
  if (!ownerHandle) {
    throw new Error('createSub: ownerHandle is required');
  }
  if (!Number.isInteger(autoUncollapsePost) || autoUncollapsePost < AUTO_UNCOLLAPSE_POST_FLOOR) {
    throw new Error(`auto-uncollapse threshold for posts must be an integer ≥ ${AUTO_UNCOLLAPSE_POST_FLOOR}`);
  }
  if (!Number.isInteger(autoUncollapseComment) || autoUncollapseComment < AUTO_UNCOLLAPSE_COMMENT_FLOOR) {
    throw new Error(`auto-uncollapse threshold for comments must be an integer ≥ ${AUTO_UNCOLLAPSE_COMMENT_FLOOR}`);
  }

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO subs (name, description, owner_handle, created_at,
                         auto_uncollapse_post, auto_uncollapse_comment)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(name, description, ownerHandle, Date.now(), autoUncollapsePost, autoUncollapseComment);
    db.prepare(
      `INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, ?)`
    ).run(name, ownerHandle, 'owner');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (/UNIQUE|PRIMARY/i.test(err.message)) {
      throw new Error(`sub "${name}" already exists`);
    }
    throw err;
  }

  return { name };
}

export function getSubByName(db, name) {
  return db.prepare('SELECT * FROM subs WHERE name = ?').get(name) ?? null;
}

// Active subs: those with at least one post in the given window. Returns
// rows {name, description, post_count} ordered by post_count DESC then name.
// Used by the front page to show what's lively right now (PRD §Front Page).
export function listActiveSubs(db, { sinceMs = Date.now() - 24 * 60 * 60 * 1000 } = {}) {
  return db.prepare(
    `SELECT s.name, s.description, COUNT(p.id) AS post_count
     FROM subs s
     JOIN posts p ON p.sub_name = s.name
     WHERE p.created_at >= ?
     GROUP BY s.name
     ORDER BY post_count DESC, s.name ASC`
  ).all(sinceMs);
}
