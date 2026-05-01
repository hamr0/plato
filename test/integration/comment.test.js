import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { addComment, listCommentsForPost, buildCommentTree, COMMENT_SORTS } from '../../src/content/comment.js';

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
