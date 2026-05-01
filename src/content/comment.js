// Comment module — see PRD §Discussion and build-plan.md M3.
//
// Comments are stored in a flat table with a nullable parent_comment_id
// for threading. Tree structure is reconstructed at read time. This is
// simpler than nested-set / closure-table approaches and at forum scale
// (a popular post tops out at ~10K comments) the rebuild cost is trivial.
// Score caches per comment are updated by the vote module, not here.

import { randomBytes } from 'node:crypto';
import { isBanned } from './mod.js';

const ID_BYTES = 8;

function newId() {
  return randomBytes(ID_BYTES).toString('hex');
}

export function addComment(db, { postId, parentId = null, handle, body, now = Date.now() }) {
  if (!postId) throw new Error('addComment: postId is required');
  if (!handle) throw new Error('addComment: handle is required');
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new Error('addComment: body is required');
  }

  // FK on post_id covers post existence; we re-check explicitly so the
  // error message is friendlier than "FOREIGN KEY constraint failed".
  const post = db.prepare('SELECT id, sub_name FROM posts WHERE id = ?').get(postId);
  if (!post) throw new Error(`addComment: post ${postId} not found`);
  if (isBanned(db, post.sub_name, handle)) {
    throw new Error(`addComment: ${handle} is banned from ${post.sub_name}`);
  }

  if (parentId) {
    const parent = db.prepare('SELECT post_id FROM comments WHERE id = ?').get(parentId);
    if (!parent) throw new Error(`addComment: parent comment ${parentId} not found`);
    if (parent.post_id !== postId) {
      throw new Error('addComment: parent comment belongs to a different post');
    }
  }

  const commentId = newId();
  db.prepare(
    `INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(commentId, postId, parentId, handle, body, now);

  return { commentId };
}

export const COMMENT_SORTS = ['best', 'new'];

// 'best' is the Reddit-style default: score DESC with chronological tiebreak
// (the older of two tied comments wins, favoring substantive early replies
// over latecomers piling on). 'new' is plain newest-first.
const COMMENT_SORT_CLAUSES = {
  best: 'score DESC, created_at ASC',
  new: 'created_at DESC',
};

export function listCommentsForPost(db, postId, { sort = 'best' } = {}) {
  if (!COMMENT_SORT_CLAUSES[sort]) {
    throw new Error(`listCommentsForPost: unknown sort '${sort}'`);
  }
  return db.prepare(
    `SELECT * FROM comments WHERE post_id = ? ORDER BY ${COMMENT_SORT_CLAUSES[sort]}`
  ).all(postId);
}

// Reconstruct the comment tree from a flat list. Returns an array of root
// nodes; each node has a `replies` array. Comments whose parent is missing
// (e.g. parent removed by mod in M4) are surfaced as roots so they don't
// vanish from the page. Stable ordering by created_at within each level.
export function buildCommentTree(comments) {
  const byId = new Map();
  for (const c of comments) {
    byId.set(c.id, { ...c, replies: [] });
  }
  const roots = [];
  for (const c of comments) {
    const node = byId.get(c.id);
    if (c.parent_comment_id && byId.has(c.parent_comment_id)) {
      byId.get(c.parent_comment_id).replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
