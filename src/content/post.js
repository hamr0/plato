import { randomBytes } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { renderMarkdown } from './markdown.js';
import { pseudonymFor } from '../identity/pseudonym.js';

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

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

function parseFrontmatter(raw) {
  const match = raw.match(FRONTMATTER_RE);
  return match ? match[2] : raw;
}

export function submitDraft(db, { title, body, subName = 'general' }) {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('submitDraft: title is required');
  }
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new Error('submitDraft: body is required');
  }

  const draftId = newId();
  db.prepare(
    'INSERT INTO drafts (id, sub_name, title, body, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(draftId, subName, title, body, Date.now());

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

  // Ensure the handle row exists (pseudonymFor inserts on first sight). This
  // satisfies the posts.handle → handles.handle foreign key.
  pseudonymFor(db, handle);

  const postId = newId();
  const filename = `${dateStamp()}-${postId}.md`;
  const filePath = `posts/${filename}`; // stored relative; postsDir is the base
  const absPath = resolve(postsDir, filename);
  const createdAt = Date.now();

  mkdirSync(postsDir, { recursive: true });
  writeFileSync(
    absPath,
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
      `INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(postId, draft.sub_name, handle, draft.title, filePath, createdAt);
    db.prepare('UPDATE drafts SET finalized_post_id = ? WHERE id = ?').run(postId, draftId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
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

// Body preview for list views (home, sub pages). Reads the file, takes the
// first paragraph (or maxChars, whichever is shorter), renders it. truncated
// signals to the caller whether to show a "read more" affordance. Markdown is
// re-rendered through the same allow-listed pipeline as full posts, so
// preview content is as XSS-safe as the post body itself.
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

// Front-page recent feed with a per-sub cap (PRD §Front Page). Without the
// cap, one chatty sub can crowd out everything else. ROW_NUMBER() partitions
// by sub_name so each sub contributes at most `perSub` of its newest posts.
export function listRecentPostsCappedPerSub(db, { limit = 50, perSub = 2 } = {}) {
  return db.prepare(
    `WITH ranked AS (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY sub_name ORDER BY created_at DESC) AS rn
       FROM posts
     )
     SELECT id, sub_name, handle, title, file_path, created_at
     FROM ranked
     WHERE rn <= ?
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(perSub, limit);
}

export function listPostsInSub(db, subName, { limit = 50, offset = 0 } = {}) {
  return db.prepare(
    `SELECT * FROM posts
     WHERE sub_name = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(subName, limit, offset);
}
