// Sub model — see PRD §subs and build-plan.md M2.
//
// Naming rules are intentionally tight: lowercase + alphanumeric + hyphen,
// 3–30 chars, locked at creation. The reserved namespace blocks names that
// collide with current and future top-level routes (`/admin`, `/api`, ...)
// or that look administrative to a user landing on /sub/<name>.

import { parseFlairs, serializeFlairs } from './flair.js';
import { FLAG_THRESHOLD_FLOOR } from './flag.js';

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
  flairs = [],
  flairsRequired = false,
  sensitive = false,
  flagThreshold = FLAG_THRESHOLD_FLOOR,
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
  if (!Number.isInteger(flagThreshold) || flagThreshold < FLAG_THRESHOLD_FLOOR) {
    throw new Error(`flag threshold must be an integer ≥ ${FLAG_THRESHOLD_FLOOR}`);
  }
  const flairsJson = serializeFlairs(flairs);
  const requiredFlag = flairsRequired ? 1 : 0;
  if (requiredFlag && parseFlairs(flairsJson).length === 0) {
    throw new Error('flairs_required cannot be set when no flairs are defined');
  }

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO subs (name, description, owner_handle, created_at,
                         auto_uncollapse_post, auto_uncollapse_comment,
                         flairs, flairs_required, sensitive, flag_threshold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(name, description, ownerHandle, Date.now(), autoUncollapsePost, autoUncollapseComment, flairsJson, requiredFlag, sensitive ? 1 : 0, flagThreshold);
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

// Owner-only edits to flair list and flairs_required. Caller must verify
// the actor's role; this function trusts and just runs the update.
export function setSubFlairs(db, name, { flairs, flairsRequired }) {
  const sub = db.prepare('SELECT name FROM subs WHERE name = ?').get(name);
  if (!sub) throw new Error(`sub "${name}" not found`);
  const flairsJson = serializeFlairs(flairs);
  const requiredFlag = flairsRequired ? 1 : 0;
  if (requiredFlag && parseFlairs(flairsJson).length === 0) {
    throw new Error('flairs_required cannot be set when no flairs are defined');
  }
  db.prepare('UPDATE subs SET flairs = ?, flairs_required = ? WHERE name = ?')
    .run(flairsJson, requiredFlag, name);
}

export function setSubFlagThreshold(db, name, threshold) {
  const sub = db.prepare('SELECT name FROM subs WHERE name = ?').get(name);
  if (!sub) throw new Error(`sub "${name}" not found`);
  if (!Number.isInteger(threshold) || threshold < FLAG_THRESHOLD_FLOOR) {
    throw new Error(`flag threshold must be an integer ≥ ${FLAG_THRESHOLD_FLOOR}`);
  }
  db.prepare('UPDATE subs SET flag_threshold = ? WHERE name = ?').run(threshold, name);
}

export function setSubSensitive(db, name, sensitive) {
  const sub = db.prepare('SELECT name FROM subs WHERE name = ?').get(name);
  if (!sub) throw new Error(`sub "${name}" not found`);
  db.prepare('UPDATE subs SET sensitive = ? WHERE name = ?').run(sensitive ? 1 : 0, name);
}

export function getSubFlairs(db, name) {
  const row = db.prepare('SELECT flairs FROM subs WHERE name = ?').get(name);
  if (!row) return [];
  return parseFlairs(row.flairs);
}

export function getSubByName(db, name) {
  return db.prepare('SELECT * FROM subs WHERE name = ?').get(name) ?? null;
}

// Active subs: those with at least one post in the given window. Returns
// rows {name, description, post_count} ordered by post_count DESC then name.
// Used by the front page to show what's lively right now (PRD §Front Page).
export function listActiveSubs(db, { sinceMs = Date.now() - 24 * 60 * 60 * 1000 } = {}) {
  return db.prepare(
    `SELECT s.name, s.description, s.sensitive, COUNT(p.id) AS post_count
     FROM subs s
     JOIN posts p ON p.sub_name = s.name
     WHERE p.created_at >= ?
     GROUP BY s.name
     ORDER BY post_count DESC, s.name ASC`
  ).all(sinceMs);
}

// Full directory listing for /communities. Returns every sub with
// description, owner_handle, total post count, and last-post timestamp.
// Sort modes: 'name' (alpha), 'posts' (post_count DESC), 'active'
// (last_post_at DESC, NULLs last). The page does client-side search by
// prefix, so the query returns all rows.
export function listAllSubs(db, { sort = 'active' } = {}) {
  const order = {
    name:   'ORDER BY s.name ASC',
    posts:  'ORDER BY post_count DESC, s.name ASC',
    active: 'ORDER BY last_post_at IS NULL, last_post_at DESC, s.name ASC',
  }[sort] ?? 'ORDER BY last_post_at IS NULL, last_post_at DESC, s.name ASC';
  return db.prepare(
    `SELECT s.name, s.description, s.owner_handle, s.sensitive,
       COUNT(p.id) AS post_count,
       MAX(p.created_at) AS last_post_at
     FROM subs s
     LEFT JOIN posts p ON p.sub_name = s.name
     GROUP BY s.name
     ${order}`
  ).all();
}
