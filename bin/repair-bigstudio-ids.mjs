// One-off: repair smoke-fixture post/comment IDs.
//
// The bin/m7-seed-bigsub.sh seed produced post IDs like `bs00000000000077`
// and comment IDs like `bsc0000000000077`. The `s` is not a hex char,
// so plato's post/comment route regexes (/[0-9a-f]{16}/) reject these
// URLs as 404s. The DB rows + .md files are otherwise valid.
//
// Repair: bs → bb (post prefix) and bsc → bbc (comment prefix). All
// hex now; existing suffixes retain uniqueness; no collisions across
// the two ID namespaces.
//
// Run with the same env shape as the live server:
//   DB_PATH=... POSTS_DIR=... node /tmp/repair-bigstudio-ids.mjs <subName>
//
// Idempotent — re-running on already-repaired rows is a no-op.

import { openDb } from '../src/db/index.js';
import { renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const subName = process.argv[2];
if (!subName) { console.error('usage: node repair-bigstudio-ids.mjs <subName>'); process.exit(2); }
const DB_PATH = process.env.DB_PATH;
const POSTS_DIR = process.env.POSTS_DIR;
if (!DB_PATH || !POSTS_DIR) { console.error('DB_PATH + POSTS_DIR required'); process.exit(2); }

const db = openDb(DB_PATH);
const posts = db.prepare(`SELECT id, file_path FROM posts WHERE sub_name = ? AND id LIKE 'bs%'`).all(subName);
const comments = db.prepare(
  `SELECT c.id, c.post_id, c.parent_comment_id FROM comments c
   JOIN posts p ON p.id = c.post_id WHERE p.sub_name = ? AND (c.id LIKE 'bsc%' OR c.post_id LIKE 'bs%' OR c.parent_comment_id LIKE 'bsc%')`
).all(subName);

console.log(`[repair] ${subName}: ${posts.length} posts, ${comments.length} comments to repair`);

db.exec('BEGIN IMMEDIATE');
db.exec('PRAGMA defer_foreign_keys = ON');
try {
  // Posts: rename id (bs → bb) and file_path
  const updPost = db.prepare('UPDATE posts SET id = ?, file_path = ? WHERE id = ?');
  const updCommentPostRef = db.prepare('UPDATE comments SET post_id = ? WHERE post_id = ?');
  for (const p of posts) {
    const newId = 'bb' + p.id.slice(2);
    const newPath = p.file_path.replace(/-bs([0-9a-f]+)\.md$/, '-bb$1.md');
    const oldAbs = resolve(POSTS_DIR, p.file_path.replace(/^posts\//, ''));
    const newAbs = resolve(POSTS_DIR, newPath.replace(/^posts\//, ''));
    if (existsSync(oldAbs) && !existsSync(newAbs)) renameSync(oldAbs, newAbs);
    updPost.run(newId, newPath, p.id);
    updCommentPostRef.run(newId, p.id);
  }

  // Comments: rename own id (bsc → bbc) and parent_comment_id refs
  const updCommentId = db.prepare('UPDATE comments SET id = ? WHERE id = ?');
  const updCommentParent = db.prepare('UPDATE comments SET parent_comment_id = ? WHERE parent_comment_id = ?');
  const seenComments = comments.filter((c) => c.id.startsWith('bsc'));
  for (const c of seenComments) {
    const newId = 'bbc' + c.id.slice(3);
    updCommentParent.run(newId, c.id); // parent refs first, before the row id changes
    updCommentId.run(newId, c.id);
  }

  db.exec('COMMIT');
  console.log(`[repair] done — ${posts.length} post ids + ${seenComments.length} comment ids fixed`);
} catch (err) {
  db.exec('ROLLBACK');
  console.error('[repair] failed, rolled back:', err.message);
  process.exit(1);
}
db.close();
