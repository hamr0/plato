import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { renderMarkdown } from './markdown.js';
import { pseudonymFor } from '../identity/pseudonym.js';
import { isBanned, isDisabled } from './mod.js';
import { parseFlairs } from './flair.js';

// Post + draft IDs are 8 random bytes (16 hex chars). Birthday-collision
// floor at 2^32 IDs of the same kind, which is many orders of magnitude
// above realistic forum scale. Bump in a later milestone if scale demands.
const ID_BYTES = 8;

function newId() {
  return randomBytes(ID_BYTES).toString('hex');
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function frontmatterFor({ title, handle, subName, createdAt, body }) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `handle: ${handle}`,
    `sub_name: ${subName}`,
    `created_at: ${createdAt}`,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

// Strip ONLY the leading sentinel block we wrote in frontmatterFor: the
// file must start with `---\n`, contain key: value lines (no blank line),
// then a closing `---\n`. A user body containing its own `---\n…\n---\n`
// must not be re-stripped; a user body that begins with `---` is also
// safe because the lines that follow won't match `key: value`.
const FRONTMATTER_LINE_RE = /^[a-z_]+:\s/;
function parseFrontmatter(raw) {
  if (!raw.startsWith('---\n')) return raw;
  const rest = raw.slice(4);
  const close = rest.indexOf('\n---\n');
  if (close === -1) return raw;
  const inner = rest.slice(0, close);
  for (const line of inner.split('\n')) {
    if (line === '' || !FRONTMATTER_LINE_RE.test(line)) return raw;
  }
  return rest.slice(close + 5);
}

export const TITLE_MAX = 300;
export const BODY_MAX = 40000;
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function submitDraft(db, { title, body, subName, flairSlug = null, sensitive = false }) {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('submitDraft: title is required');
  }
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new Error('submitDraft: body is required');
  }
  if (typeof subName !== 'string' || subName.trim().length === 0) {
    throw new Error('submitDraft: subName is required');
  }
  if (title.length > TITLE_MAX) {
    throw new Error(`submitDraft: title exceeds ${TITLE_MAX} characters`);
  }
  // 0.10.4: normalize CRLF → LF before length-checking. Browsers send
  // textarea bodies with CRLF line breaks per the application/x-www-
  // form-urlencoded spec, but the client-side counter (charcount.js)
  // measures `ta.value.length` which uses LF (textareas internally hold
  // values with LF). A 39 961-char body in the textarea arrived as
  // 40 001 chars on the server when it had 40+ newlines, blocking
  // submission while the user's counter still read under cap.
  const normalizedBody = body.replace(/\r\n/g, '\n');
  if (normalizedBody.length > BODY_MAX) {
    throw new Error(`submitDraft: body exceeds ${BODY_MAX} characters`);
  }

  const draftId = newId();
  db.prepare(
    'INSERT INTO drafts (id, sub_name, title, body, flair_slug, sensitive, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(draftId, subName, title, normalizedBody, flairSlug, sensitive ? 1 : 0, Date.now());

  return { draftId };
}

export function finalizeDraft(db, { draftId, handle, postsDir }) {
  if (!draftId) throw new Error('finalizeDraft: draftId is required');
  if (!handle) throw new Error('finalizeDraft: handle is required');
  if (!postsDir) throw new Error('finalizeDraft: postsDir is required');

  const draft = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId);
  if (!draft) throw new Error(`finalizeDraft: draft ${draftId} not found`);

  // Idempotent: re-finalizing an already-finalized draft returns the existing post.
  if (draft.finalized_post_id) {
    return { postId: draft.finalized_post_id, subName: draft.sub_name, alreadyFinalized: true };
  }

  if (isBanned(db, draft.sub_name, handle)) {
    throw new Error(`finalizeDraft: ${handle} is banned from ${draft.sub_name}`);
  }
  if (isDisabled(db, draft.sub_name)) {
    throw new Error(`finalizeDraft: //${draft.sub_name} is read-only`);
  }

  // Validate flair against the sub's current list. Drafts can outlive flair
  // edits (a flair removed between draft and finalize); reject the post in
  // that case rather than landing it with an orphan slug.
  const subRow = db.prepare('SELECT flairs, flairs_required FROM subs WHERE name = ?').get(draft.sub_name);
  if (subRow) {
    const flairs = parseFlairs(subRow.flairs);
    if (subRow.flairs_required && !draft.flair_slug) {
      throw new Error(`finalizeDraft: //${draft.sub_name} requires a flair`);
    }
    if (draft.flair_slug && !flairs.find((f) => f.slug === draft.flair_slug)) {
      throw new Error(`finalizeDraft: flair "${draft.flair_slug}" is not available in //${draft.sub_name}`);
    }
  }

  // Ensure the handle row exists (pseudonymFor inserts on first sight). This
  // satisfies the posts.handle → handles.handle foreign key.
  pseudonymFor(db, handle);

  const postId = newId();
  const filename = `${dateStamp()}-${postId}.md`;
  const filePath = `posts/${filename}`; // stored relative; postsDir is the base
  const absPath = resolve(postsDir, filename);
  const createdAt = Date.now();

  // Write to a temp file first, then commit DB, then rename. If the DB
  // INSERT fails, we unlink the temp without ever exposing it under its
  // permanent name. If the rename succeeds and a later step throws, the
  // file is the canonical record and DB rollback restores consistency.
  mkdirSync(postsDir, { recursive: true });
  const tmpPath = `${absPath}.tmp-${randomBytes(4).toString('hex')}`;
  writeFileSync(
    tmpPath,
    frontmatterFor({
      title: draft.title,
      handle,
      subName: draft.sub_name,
      createdAt,
      body: draft.body,
    })
  );

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO posts (id, sub_name, handle, title, file_path, flair_slug, sensitive, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(postId, draft.sub_name, handle, draft.title, filePath, draft.flair_slug ?? null, draft.sensitive ? 1 : 0, createdAt);
    db.prepare('UPDATE drafts SET finalized_post_id = ? WHERE id = ?').run(postId, draftId);
    renameSync(tmpPath, absPath);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    try { unlinkSync(tmpPath); } catch { /* temp may not exist */ }
    throw err;
  }

  return { postId, subName: draft.sub_name, alreadyFinalized: false };
}

export function getPost(db, postId, postsDir) {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  if (!post) return null;

  const absPath = resolve(postsDir, basename(post.file_path));
  const raw = readFileSync(absPath, 'utf8');
  const body = parseFrontmatter(raw);
  const bodyHtml = renderMarkdown(body);

  return { post, body, bodyHtml };
}

// Title is intentionally NOT in the parameter list — titles are immutable
// once a post is submitted. See PRD §Permanently out → "Editing post titles"
// for the bait-and-switch reasoning. Future "fix the asymmetry" PRs should
// re-read that lock first.
export function editPost(db, { postId, handle, body, sensitive, postsDir, now = Date.now() }) {
  if (!postId) throw new Error('editPost: postId is required');
  if (!handle) throw new Error('editPost: handle is required');
  if (typeof body !== 'string' || body.trim().length === 0) throw new Error('editPost: body is required');
  // 0.10.4: normalize CRLF → LF before length-check + write. See submitDraft.
  const normalizedBody = body.replace(/\r\n/g, '\n');
  if (normalizedBody.length > BODY_MAX) throw new Error(`editPost: body exceeds ${BODY_MAX} characters`);

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  if (!post) throw new Error(`editPost: post ${postId} not found`);
  if (post.handle !== handle) throw new Error('editPost: not the author');
  if (now - post.created_at > EDIT_WINDOW_MS) throw new Error('editPost: edit window has closed');
  if (isDisabled(db, post.sub_name)) throw new Error(`editPost: //${post.sub_name} is read-only`);

  const absPath = resolve(postsDir, basename(post.file_path));
  const raw = readFileSync(absPath, 'utf8');
  // Preserve the frontmatter block exactly; replace only the body section.
  const rest = raw.slice(4);
  const closeIdx = rest.indexOf('\n---\n');
  const header = raw.slice(0, 4 + closeIdx + 5);
  writeFileSync(absPath, `${header}\n${normalizedBody.trim()}\n`);

  if (sensitive === undefined) {
    db.prepare('UPDATE posts SET edited_at = ? WHERE id = ?').run(now, postId);
  } else {
    db.prepare('UPDATE posts SET edited_at = ?, sensitive = ? WHERE id = ?')
      .run(now, sensitive ? 1 : 0, postId);
  }
}

// Body preview for list views (home, sub pages). Reads the file, takes the
// first paragraph (or maxChars, whichever is shorter), renders it. truncated
// signals to the caller whether to show a "read more" affordance. Markdown is
// re-rendered through the same allow-listed pipeline as full posts, so
// preview content is as XSS-safe as the post body itself.
export function getPostRawBody(post, postsDir) {
  try {
    const raw = readFileSync(resolve(postsDir, basename(post.file_path)), 'utf8');
    return parseFrontmatter(raw).trim();
  } catch {
    return '';
  }
}

export function getPostPreview(post, postsDir, { maxChars = 280 } = {}) {
  // Tolerate a missing file: the index row and the file tree can drift
  // (operator restored only the DB, partial backfill, etc.). A list view
  // should not 500 because one post's file vanished.
  let raw;
  try {
    raw = readFileSync(resolve(postsDir, basename(post.file_path)), 'utf8');
  } catch {
    return { html: '', truncated: false };
  }
  const body = parseFrontmatter(raw).trim();
  if (!body) return { html: '', truncated: false };
  const firstPara = body.split(/\n\s*\n/)[0].trim();
  const cut = firstPara.length > maxChars;
  const text = cut ? firstPara.slice(0, maxChars).trimEnd() + '…' : firstPara;
  const truncated = cut || firstPara.length < body.length;
  return { html: renderMarkdown(text), truncated };
}

export function listRecentPosts(db, { limit = 50, offset = 0 } = {}) {
  return db.prepare(
    'SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

// Cross-sub home feed with sort + date filters. Used by the home page's
// top-nav (UX-E): no per-sub cap, just a global ordering with optional
// recency window. `sort` is one of 'new' | 'top' | 'hot'; `sinceMs` is
// the lower bound on created_at (or undefined for all-time).
export function listPostsAcrossSubs(db, { sort = 'new', sinceMs, limit = 50, offset = 0, now = Date.now(), subNames = null } = {}) {
  // subNames: null/undefined → no restriction; [] → empty result (the
  // user is subscribed to nothing — short-circuit instead of running a
  // `sub_name IN ()` which is a SQL syntax error). Non-empty → IN (?,?).
  if (Array.isArray(subNames) && subNames.length === 0) return [];
  const clauses = [];
  const params = [];
  if (sinceMs != null) { clauses.push('created_at >= ?'); params.push(sinceMs); }
  if (Array.isArray(subNames) && subNames.length > 0) {
    clauses.push(`sub_name IN (${subNames.map(() => '?').join(',')})`);
    params.push(...subNames);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.map((c) => `posts.${c}`).join(' AND ')}` : '';
  const baseSelect = `SELECT posts.*,
    s.sensitive AS sub_sensitive,
    (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS comment_count
    FROM posts LEFT JOIN subs s ON s.name = posts.sub_name ${where}`;
  if (sort === 'hot') {
    return db.prepare(
      `${baseSelect} ORDER BY score / POWER((? - posts.created_at) / 3600000.0 + 2, 1.5) DESC, posts.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, now, limit, offset);
  }
  const order = sort === 'top'
    ? 'ORDER BY posts.score DESC, posts.created_at DESC'
    : sort === 'old'
      ? 'ORDER BY posts.created_at ASC'
      : 'ORDER BY posts.created_at DESC';
  return db.prepare(`${baseSelect} ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
}

// Sub-page post listing with PRD §sort modes: new / old / top / hot.
// - new: newest first (ORDER BY created_at DESC)
// - old: oldest first
// - top: highest cached score, age tiebreaker
// - hot: HN-shaped formula `score / (age_hours + 2)^1.5`. The +2 floors very
//   new posts so a single upvote on a 0-min-old post doesn't catapult it
//   above an established post; the 1.5 exponent makes age decay faster than
//   linear without being so steep that 4-day-old gold gets buried under
//   10-min-old shrugs. Tunable in v1.1 if usage suggests it.
// Time inputs are injectable so tests can assert deterministic ordering
// against synthetic timestamps without real-clock manipulation.
// Columns are explicitly prefixed with `posts.` because the queries below
// LEFT JOIN subs (for sub_sensitive); unqualified column names would be
// ambiguous if a future migration adds a same-named column on subs.
const SORT_CLAUSES = {
  new: 'ORDER BY posts.created_at DESC',
  old: 'ORDER BY posts.created_at ASC',
  top: 'ORDER BY posts.score DESC, posts.created_at DESC',
};

export const SUB_SORTS = ['new', 'old', 'top', 'hot'];

export function listPostsInSub(db, subName, { limit = 50, offset = 0, sort = 'new', flairSlug = null, now = Date.now() } = {}) {
  if (!SUB_SORTS.includes(sort)) throw new Error(`listPostsInSub: unknown sort '${sort}'`);

  const flairClause = flairSlug ? 'AND posts.flair_slug = ?' : '';
  const flairArg = flairSlug ? [flairSlug] : [];

  if (sort === 'hot') {
    return db.prepare(`
      SELECT posts.*,
        s.sensitive AS sub_sensitive,
        (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS comment_count
      FROM posts LEFT JOIN subs s ON s.name = posts.sub_name
      WHERE posts.sub_name = ? ${flairClause}
      ORDER BY posts.score / POWER((? - posts.created_at) / 3600000.0 + 2, 1.5) DESC, posts.created_at DESC
      LIMIT ? OFFSET ?
    `).all(subName, ...flairArg, now, limit, offset);
  }

  return db.prepare(
    `SELECT posts.*,
       s.sensitive AS sub_sensitive,
       (SELECT COUNT(*) FROM comments WHERE post_id = posts.id) AS comment_count
     FROM posts LEFT JOIN subs s ON s.name = posts.sub_name
     WHERE posts.sub_name = ? ${flairClause} ${SORT_CLAUSES[sort]} LIMIT ? OFFSET ?`
  ).all(subName, ...flairArg, limit, offset);
}
