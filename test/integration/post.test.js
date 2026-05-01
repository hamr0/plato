import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';
import { submitDraft, finalizeDraft, getPost, listRecentPosts } from '../../src/content/post.js';
import { applyAllMigrations } from '../_helpers/migrations.js';

function freshDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  return db;
}

function freshPostsDir() {
  return mkdtempSync(join(tmpdir(), 'plato-posts-'));
}

const HANDLE = 'a'.repeat(64); // 64-char hex; mimics knowless HMAC output

test('submitDraft: inserts a draft, returns id', () => {
  const db = freshDb();
  const { draftId } = submitDraft(db, { title: 'hello', body: 'world' });
  assert.match(draftId, /^[0-9a-f]{16}$/);

  const row = db.prepare('SELECT * FROM drafts WHERE id = ?').get(draftId);
  assert.equal(row.title, 'hello');
  assert.equal(row.body, 'world');
  assert.equal(row.sub_name, 'general');
  assert.equal(row.finalized_post_id, null);
});

test('submitDraft: rejects missing title', () => {
  const db = freshDb();
  assert.throws(() => submitDraft(db, { title: '', body: 'b' }), /title is required/);
  assert.throws(() => submitDraft(db, { title: '   ', body: 'b' }), /title is required/);
  assert.throws(() => submitDraft(db, { body: 'b' }), /title is required/);
});

test('submitDraft: rejects missing body', () => {
  const db = freshDb();
  assert.throws(() => submitDraft(db, { title: 't', body: '' }), /body is required/);
  assert.throws(() => submitDraft(db, { title: 't' }), /body is required/);
});

test('submitDraft: custom subName overrides default', () => {
  const db = freshDb();
  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)')
    .run('cooking', Date.now());
  const { draftId } = submitDraft(db, { title: 't', body: 'b', subName: 'cooking' });
  const row = db.prepare('SELECT sub_name FROM drafts WHERE id = ?').get(draftId);
  assert.equal(row.sub_name, 'cooking');
});

test('finalizeDraft: creates post, writes file, marks draft finalized', (t) => {
  const db = freshDb();
  const postsDir = freshPostsDir();
  t.after(() => rmSync(postsDir, { recursive: true, force: true }));

  const { draftId } = submitDraft(db, { title: 'hello', body: '# hi\n\nworld' });
  const { postId, alreadyFinalized } = finalizeDraft(db, { draftId, handle: HANDLE, postsDir });

  assert.equal(alreadyFinalized, false);
  assert.match(postId, /^[0-9a-f]{16}$/);

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  assert.equal(post.title, 'hello');
  assert.equal(post.handle, HANDLE);
  assert.equal(post.sub_name, 'general');
  assert.match(post.file_path, /^posts\/\d{4}-\d{2}-\d{2}-[0-9a-f]{16}\.md$/);

  const draft = db.prepare('SELECT finalized_post_id FROM drafts WHERE id = ?').get(draftId);
  assert.equal(draft.finalized_post_id, postId);

  const fileContent = readFileSync(join(postsDir, post.file_path.replace(/^posts\//, '')), 'utf8');
  assert.match(fileContent, /^---\n/);
  assert.match(fileContent, /title: "hello"/);
  assert.match(fileContent, new RegExp(`handle: ${HANDLE}`));
  assert.match(fileContent, /# hi\n\nworld/);
});

test('finalizeDraft: idempotent — re-call returns same postId', (t) => {
  const db = freshDb();
  const postsDir = freshPostsDir();
  t.after(() => rmSync(postsDir, { recursive: true, force: true }));

  const { draftId } = submitDraft(db, { title: 't', body: 'b' });
  const a = finalizeDraft(db, { draftId, handle: HANDLE, postsDir });
  const b = finalizeDraft(db, { draftId, handle: HANDLE, postsDir });

  assert.equal(a.postId, b.postId);
  assert.equal(a.alreadyFinalized, false);
  assert.equal(b.alreadyFinalized, true);

  const count = db.prepare('SELECT COUNT(*) as n FROM posts').get().n;
  assert.equal(count, 1, 'no duplicate post row');
});

test('finalizeDraft: throws for non-existent draft', (t) => {
  const db = freshDb();
  const postsDir = freshPostsDir();
  t.after(() => rmSync(postsDir, { recursive: true, force: true }));

  assert.throws(
    () => finalizeDraft(db, { draftId: 'nonexistent', handle: HANDLE, postsDir }),
    /draft nonexistent not found/
  );
});

test('finalizeDraft: rejects missing args', () => {
  const db = freshDb();
  assert.throws(() => finalizeDraft(db, { handle: HANDLE, postsDir: '/tmp' }), /draftId is required/);
  assert.throws(() => finalizeDraft(db, { draftId: 'x', postsDir: '/tmp' }), /handle is required/);
  assert.throws(() => finalizeDraft(db, { draftId: 'x', handle: HANDLE }), /postsDir is required/);
});

test('finalizeDraft: auto-creates handle row + pseudonym', (t) => {
  const db = freshDb();
  const postsDir = freshPostsDir();
  t.after(() => rmSync(postsDir, { recursive: true, force: true }));

  // Migration 007 seeds a SYSTEM handle (32-zero hex) used by spam-
  // pattern auto-flagging — count user handles, not the seed row.
  const userHandles = `WHERE handle != '${'0'.repeat(64)}'`;
  const before = db.prepare(`SELECT COUNT(*) as n FROM handles ${userHandles}`).get().n;
  assert.equal(before, 0);

  const { draftId } = submitDraft(db, { title: 't', body: 'b' });
  finalizeDraft(db, { draftId, handle: HANDLE, postsDir });

  const after = db.prepare(`SELECT COUNT(*) as n FROM handles ${userHandles}`).get().n;
  assert.equal(after, 1);

  const row = db.prepare('SELECT * FROM handles WHERE handle = ?').get(HANDLE);
  assert.match(row.pseudonym, /^[a-z]+-[a-z]+$/);
  assert.equal(typeof row.first_seen_at, 'number');
});

test('getPost: returns post + parsed body + rendered html', (t) => {
  const db = freshDb();
  const postsDir = freshPostsDir();
  t.after(() => rmSync(postsDir, { recursive: true, force: true }));

  const { draftId } = submitDraft(db, {
    title: 'hello',
    body: '# heading\n\n**bold** text',
  });
  const { postId } = finalizeDraft(db, { draftId, handle: HANDLE, postsDir });

  const result = getPost(db, postId, postsDir);
  assert.equal(result.post.id, postId);
  assert.equal(result.post.title, 'hello');
  assert.match(result.body, /# heading/);
  assert.match(result.bodyHtml, /<h1>heading<\/h1>/);
  assert.match(result.bodyHtml, /<strong>bold<\/strong>/);
});

test('getPost: returns null for non-existent post', (t) => {
  const db = freshDb();
  const postsDir = freshPostsDir();
  t.after(() => rmSync(postsDir, { recursive: true, force: true }));

  assert.equal(getPost(db, 'nonexistent', postsDir), null);
});

test('SECURITY: getPost renders body with same XSS protections as renderMarkdown', (t) => {
  const db = freshDb();
  const postsDir = freshPostsDir();
  t.after(() => rmSync(postsDir, { recursive: true, force: true }));

  const { draftId } = submitDraft(db, {
    title: 'evil',
    body: '<script>alert(1)</script> [click](javascript:alert(1))',
  });
  const { postId } = finalizeDraft(db, { draftId, handle: HANDLE, postsDir });

  const { bodyHtml } = getPost(db, postId, postsDir);
  assert.doesNotMatch(bodyHtml, /<script>alert/, 'no live script tag');
  assert.doesNotMatch(bodyHtml, /href="javascript:/, 'no javascript: URL in href');
});

test('listRecentPosts: returns posts in created_at DESC order', (t) => {
  const db = freshDb();
  const postsDir = freshPostsDir();
  t.after(() => rmSync(postsDir, { recursive: true, force: true }));

  // Pre-seed handle to satisfy FK
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(HANDLE, 'test-handle', Date.now());

  // Three posts at different timestamps
  for (let i = 0; i < 3; i++) {
    db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
                VALUES (?, 'general', ?, ?, ?, ?)`)
      .run(`p${i}`, HANDLE, `post-${i}`, `posts/p${i}.md`, 1000 + i);
  }

  const rows = listRecentPosts(db, { limit: 10 });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, 'p2', 'newest first');
  assert.equal(rows[1].id, 'p1');
  assert.equal(rows[2].id, 'p0');
});

test('listRecentPosts: respects limit + offset', (t) => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(HANDLE, 'test-handle', Date.now());

  for (let i = 0; i < 5; i++) {
    db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
                VALUES (?, 'general', ?, ?, ?, ?)`)
      .run(`p${i}`, HANDLE, `post-${i}`, `posts/p${i}.md`, 1000 + i);
  }

  const page1 = listRecentPosts(db, { limit: 2 });
  const page2 = listRecentPosts(db, { limit: 2, offset: 2 });

  assert.equal(page1.length, 2);
  assert.equal(page2.length, 2);
  assert.notEqual(page1[0].id, page2[0].id, 'pages do not overlap');
});

test('listRecentPosts: empty DB returns empty array', () => {
  const db = freshDb();
  const rows = listRecentPosts(db);
  assert.deepEqual(rows, []);
});
