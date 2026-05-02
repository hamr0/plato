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

export const COMMENT_BODY_MAX = 10000;

export function addComment(db, { postId, parentId = null, handle, body, now = Date.now() }) {
  if (!postId) throw new Error('addComment: postId is required');
  if (!handle) throw new Error('addComment: handle is required');
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new Error('addComment: body is required');
  }
  if (body.length > COMMENT_BODY_MAX) {
    throw new Error(`addComment: body exceeds ${COMMENT_BODY_MAX} characters`);
  }

  // FK on post_id covers post existence; we re-check explicitly so the
  // error message is friendlier than "FOREIGN KEY constraint failed".
  const post = db.prepare('SELECT id, sub_name, removed_at FROM posts WHERE id = ?').get(postId);
  if (!post) throw new Error(`addComment: post ${postId} not found`);
  if (post.removed_at != null) {
    throw new Error(`addComment: post ${postId} has been removed`);
  }
  if (isBanned(db, post.sub_name, handle)) {
    throw new Error(`addComment: ${handle} is banned from ${post.sub_name}`);
  }

  if (parentId) {
    const parent = db.prepare('SELECT post_id, removed_at FROM comments WHERE id = ?').get(parentId);
    if (!parent) throw new Error(`addComment: parent comment ${parentId} not found`);
    if (parent.post_id !== postId) {
      throw new Error('addComment: parent comment belongs to a different post');
    }
    if (parent.removed_at != null) {
      throw new Error(`addComment: parent comment ${parentId} has been removed`);
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
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function editComment(db, { commentId, handle, body, now = Date.now() }) {
  if (!commentId) throw new Error('editComment: commentId is required');
  if (!handle) throw new Error('editComment: handle is required');
  if (typeof body !== 'string' || body.trim().length === 0) throw new Error('editComment: body is required');
  if (body.length > COMMENT_BODY_MAX) throw new Error(`editComment: body exceeds ${COMMENT_BODY_MAX} characters`);

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  if (!comment) throw new Error(`editComment: comment ${commentId} not found`);
  if (comment.handle !== handle) throw new Error('editComment: not the author');
  if (now - comment.created_at > EDIT_WINDOW_MS) throw new Error('editComment: edit window has closed');

  db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body.trim(), now, commentId);
}

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
// Cross-sub recent comments for the home /comments tab. Returns each
// comment plus the parent post's id, title, and sub_name so the renderer
// can show "<comment body excerpt> · /sub/<x> · <post title>". Filters
// out removed comments. `sort` is 'new' | 'top'; date filter via sinceMs.
export function listRecentCommentsAcrossSubs(db, { sort = 'new', sinceMs, limit = 50 } = {}) {
  const where = sinceMs != null ? 'AND c.created_at >= ?' : '';
  const params = sinceMs != null ? [sinceMs] : [];
  const order = sort === 'top'
    ? 'ORDER BY c.score DESC, c.created_at DESC'
    : sort === 'old'
      ? 'ORDER BY c.created_at ASC'
      : 'ORDER BY c.created_at DESC';
  return db.prepare(
    `SELECT c.id, c.post_id, c.handle, c.body, c.score, c.created_at,
       c.collapsed_at, c.removed_at,
       p.title AS post_title, p.sub_name
     FROM comments c
     JOIN posts p ON p.id = c.post_id
     WHERE c.removed_at IS NULL ${where}
     ${order}
     LIMIT ?`
  ).all(...params, limit);
}

export function buildCommentTree(comments) {
  const byId = new Map();
  for (const c of comments) {
    byId.set(c.id, { ...c, replies: [] });
  }
  const roots = [];
  // Detect cycles: a comment's parent chain must eventually reach null
  // (root) without revisiting any node. If a cycle is found (shouldn't be
  // possible via addComment but a bad operator-script edit could land
  // one), surface the node as a root so the page doesn't infinite-loop.
  for (const c of comments) {
    const node = byId.get(c.id);
    let parentId = c.parent_comment_id;
    let cycle = false;
    if (parentId && byId.has(parentId)) {
      const seen = new Set([c.id]);
      let cur = parentId;
      while (cur != null) {
        if (seen.has(cur)) { cycle = true; break; }
        seen.add(cur);
        const parentNode = byId.get(cur);
        if (!parentNode) break;
        cur = parentNode.parent_comment_id;
      }
    }
    if (parentId && byId.has(parentId) && !cycle) {
      byId.get(parentId).replies.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
