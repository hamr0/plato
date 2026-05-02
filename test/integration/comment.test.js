import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  addComment, listCommentsForPost, buildCommentTree, COMMENT_SORTS, COMMENT_BODY_MAX,
} from '../../src/content/comment.js';
import { recordAction } from '../../src/content/mod.js';

const HANDLE = 'a'.repeat(64);
const HANDLE_B = 'b'.repeat(64);

function fixture() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('lobby', Date.now());
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(HANDLE, 'alpha-one', Date.now());
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(HANDLE_B, 'beta-one', Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('p1', 'lobby', HANDLE, 't', 'posts/p1.md', Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('p2', 'lobby', HANDLE, 't2', 'posts/p2.md', Date.now());
  return db;
}

test('addComment: top-level comment inserts with NULL parent', () => {
  const db = fixture();
  const { commentId } = addComment(db, { postId: 'p1', handle: HANDLE, body: 'hello' });
  assert.match(commentId, /^[0-9a-f]{16}$/);
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);
  assert.equal(row.body, 'hello');
  assert.equal(row.parent_comment_id, null);
  assert.equal(row.score, 0);
});

test('addComment: reply links via parent_comment_id', () => {
  const db = fixture();
  const { commentId: parentId } = addComment(db, { postId: 'p1', handle: HANDLE, body: 'parent' });
  const { commentId: replyId } = addComment(db, { postId: 'p1', parentId, handle: HANDLE_B, body: 'reply' });
  const reply = db.prepare('SELECT parent_comment_id FROM comments WHERE id = ?').get(replyId);
  assert.equal(reply.parent_comment_id, parentId);
});

test('addComment: nonexistent post throws', () => {
  const db = fixture();
  assert.throws(
    () => addComment(db, { postId: 'nope', handle: HANDLE, body: 'b' }),
    /post nope not found/
  );
});

test('addComment: nonexistent parent throws', () => {
  const db = fixture();
  assert.throws(
    () => addComment(db, { postId: 'p1', parentId: 'no-such-comment', handle: HANDLE, body: 'b' }),
    /parent comment .* not found/
  );
});

test('addComment: parent on different post is rejected', () => {
  const db = fixture();
  const { commentId } = addComment(db, { postId: 'p1', handle: HANDLE, body: 'on p1' });
  assert.throws(
    () => addComment(db, { postId: 'p2', parentId: commentId, handle: HANDLE, body: 'reply' }),
    /different post/
  );
});

test('addComment: empty body is rejected', () => {
  const db = fixture();
  assert.throws(
    () => addComment(db, { postId: 'p1', handle: HANDLE, body: '   ' }),
    /body is required/
  );
});

test('listCommentsForPost: returns chronological order, post-scoped', () => {
  const db = fixture();
  addComment(db, { postId: 'p1', handle: HANDLE, body: 'first', now: 1 });
  addComment(db, { postId: 'p2', handle: HANDLE, body: 'on p2', now: 2 });
  addComment(db, { postId: 'p1', handle: HANDLE_B, body: 'second', now: 3 });
  const list = listCommentsForPost(db, 'p1');
  assert.equal(list.length, 2);
  assert.equal(list[0].body, 'first');
  assert.equal(list[1].body, 'second');
});

test('buildCommentTree: roots + replies nested correctly', () => {
  const flat = [
    { id: 'a', parent_comment_id: null, body: 'root-a', created_at: 1 },
    { id: 'b', parent_comment_id: 'a',  body: 'reply-b', created_at: 2 },
    { id: 'c', parent_comment_id: null, body: 'root-c', created_at: 3 },
    { id: 'd', parent_comment_id: 'b',  body: 'deep-d',  created_at: 4 },
  ];
  const tree = buildCommentTree(flat);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].id, 'a');
  assert.equal(tree[0].replies.length, 1);
  assert.equal(tree[0].replies[0].id, 'b');
  assert.equal(tree[0].replies[0].replies[0].id, 'd');
  assert.equal(tree[1].id, 'c');
  assert.equal(tree[1].replies.length, 0);
});

test('listCommentsForPost: sort=best ranks by score, ties go to oldest', () => {
  const db = fixture();
  // Three top-level comments with varied scores + ages.
  const insert = (id, body, score, when) => {
    addComment(db, { postId: 'p1', handle: HANDLE, body, now: when });
    db.prepare('UPDATE comments SET id = ?, score = ? WHERE body = ?').run(id, score, body);
  };
  insert('low',  'low score',  0,  100);
  insert('high', 'high score', 5,  200);
  insert('mid',  'mid score',  3,  150);
  const list = listCommentsForPost(db, 'p1', { sort: 'best' });
  assert.deepEqual(list.map((c) => c.body), ['high score', 'mid score', 'low score']);
});

test('listCommentsForPost: sort=new returns newest first', () => {
  const db = fixture();
  addComment(db, { postId: 'p1', handle: HANDLE, body: 'first',  now: 100 });
  addComment(db, { postId: 'p1', handle: HANDLE, body: 'second', now: 200 });
  const list = listCommentsForPost(db, 'p1', { sort: 'new' });
  assert.deepEqual(list.map((c) => c.body), ['second', 'first']);
});

test('listCommentsForPost: unknown sort throws', () => {
  const db = fixture();
  assert.throws(() => listCommentsForPost(db, 'p1', { sort: 'whatever' }), /unknown sort/);
});

test('COMMENT_SORTS exports the two sort modes', () => {
  assert.deepEqual([...COMMENT_SORTS].sort(), ['best', 'new']);
});

test('buildCommentTree: orphans (missing parent) surface as roots', () => {
  const flat = [
    { id: 'a', parent_comment_id: 'gone', body: 'orphan', created_at: 1 },
    { id: 'b', parent_comment_id: null,   body: 'root',   created_at: 2 },
  ];
  const tree = buildCommentTree(flat);
  assert.equal(tree.length, 2);
  assert.equal(tree.find((n) => n.id === 'a').replies.length, 0);
});

// --- M4 ban checks ---

test('addComment: banned user rejected from sub', () => {
  const db = fixture();
  // HANDLE is the lobby owner-by-fiat below; bind it explicitly for the ban path.
  db.prepare(`UPDATE subs SET owner_handle = ? WHERE name = 'lobby'`).run(HANDLE);
  recordAction(db, {
    subName: 'lobby', modHandle: HANDLE, action: 'ban',
    targetType: 'handle', targetId: HANDLE_B,
  });
  assert.throws(
    () => addComment(db, { postId: 'p1', handle: HANDLE_B, body: 'sneaky' }),
    /banned from lobby/,
  );
});

test('addComment: rejects body over cap', () => {
  const db = fixture();
  assert.throws(
    () => addComment(db, { postId: 'p1', handle: HANDLE, body: 'x'.repeat(COMMENT_BODY_MAX + 1) }),
    /exceeds/,
  );
});

test('addComment: rejects when parent post has been hard-removed', () => {
  const db = fixture();
  db.prepare(`UPDATE posts SET removed_at = ? WHERE id = 'p1'`).run(Date.now());
  assert.throws(
    () => addComment(db, { postId: 'p1', handle: HANDLE, body: 'reply' }),
    /has been removed/,
  );
});

test('addComment: rejects reply to a removed parent comment', () => {
  const db = fixture();
  const { commentId } = addComment(db, { postId: 'p1', handle: HANDLE, body: 'parent' });
  db.prepare(`UPDATE comments SET removed_at = ? WHERE id = ?`).run(Date.now(), commentId);
  assert.throws(
    () => addComment(db, { postId: 'p1', parentId: commentId, handle: HANDLE, body: 'child' }),
    /has been removed/,
  );
});

test('buildCommentTree: surfaces a cycle node as root rather than infinite-looping', () => {
  // Construct a fake row set with a self-cycle (a → a). Returns within
  // bounded time and does not stack-overflow.
  const rows = [{ id: 'a', parent_comment_id: 'a', body: 'x', handle: HANDLE, post_id: 'p', created_at: 1, score: 0 }];
  const tree = buildCommentTree(rows);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, 'a');
  assert.equal(tree[0].replies.length, 0);
});

test('buildCommentTree: surfaces an a→b→a cycle as roots', () => {
  const rows = [
    { id: 'a', parent_comment_id: 'b', body: 'x', handle: HANDLE, post_id: 'p', created_at: 1, score: 0 },
    { id: 'b', parent_comment_id: 'a', body: 'y', handle: HANDLE, post_id: 'p', created_at: 2, score: 0 },
  ];
  const tree = buildCommentTree(rows);
  // Both surface as roots so neither node infinite-recurses.
  assert.equal(tree.length, 2);
});

// --- editComment ---

import { editComment, EDIT_WINDOW_MS } from '../../src/content/comment.js';

function commentFixture() {
  const db = fixture();
  const { commentId } = addComment(db, { postId: 'p1', handle: HANDLE, body: 'original' });
  return { db, commentId };
}

test('editComment: author within window can update body', () => {
  const { db, commentId } = commentFixture();
  editComment(db, { commentId, handle: HANDLE, body: 'updated' });
  const row = db.prepare('SELECT body, edited_at FROM comments WHERE id = ?').get(commentId);
  assert.equal(row.body, 'updated');
  assert.ok(row.edited_at != null, 'edited_at set after edit');
});

test('editComment: edited_at is null before any edit', () => {
  const { db, commentId } = commentFixture();
  const row = db.prepare('SELECT edited_at FROM comments WHERE id = ?').get(commentId);
  assert.equal(row.edited_at, null);
});

test('editComment: non-author throws', () => {
  const { db, commentId } = commentFixture();
  assert.throws(
    () => editComment(db, { commentId, handle: HANDLE_B, body: 'x' }),
    /not the author/,
  );
});

test('editComment: expired window throws', () => {
  const { db, commentId } = commentFixture();
  const future = Date.now() + EDIT_WINDOW_MS + 1000;
  assert.throws(
    () => editComment(db, { commentId, handle: HANDLE, body: 'x', now: future }),
    /edit window has closed/,
  );
});

test('editComment: blank body throws', () => {
  const { db, commentId } = commentFixture();
  assert.throws(
    () => editComment(db, { commentId, handle: HANDLE, body: '   ' }),
    /body is required/,
  );
});

test('editComment: body over COMMENT_BODY_MAX throws', () => {
  const { db, commentId } = commentFixture();
  assert.throws(
    () => editComment(db, { commentId, handle: HANDLE, body: 'x'.repeat(10001) }),
    /body exceeds/,
  );
});
