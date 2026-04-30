import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../src/db/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_001 = readFileSync(
  resolve(HERE, '../../src/db/migrations/001_initial.sql'),
  'utf8'
);

function freshDb() {
  const db = openDb(':memory:');
  db.exec(MIGRATION_001);
  return db;
}

test('handles: insert + read works', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  const row = db.prepare('SELECT * FROM handles WHERE handle = ?').get('h1');
  assert.equal(row.pseudonym, 'usual-caribou');
});

test('handles: pseudonym is UNIQUE', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  assert.throws(() => {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run('h2', 'usual-caribou', Date.now());
  }, /UNIQUE/);
});

test('posts: requires existing handle (FK enforcement)', () => {
  const db = freshDb();
  assert.throws(() => {
    db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run('p1', 'nonexistent-handle', 'hi', 'posts/p1.md', Date.now());
  }, /FOREIGN KEY/);
});

test('posts: file_path is UNIQUE', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('p1', 'h1', 'first', 'posts/p1.md', Date.now());
  assert.throws(() => {
    db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run('p2', 'h1', 'second', 'posts/p1.md', Date.now());
  }, /UNIQUE/);
});

test('posts: sub_name defaults to general', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('p1', 'h1', 'hi', 'posts/p1.md', Date.now());
  const row = db.prepare('SELECT sub_name FROM posts WHERE id = ?').get('p1');
  assert.equal(row.sub_name, 'general');
});

test('drafts: insert + finalize round-trip works', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());

  db.prepare(`INSERT INTO drafts (id, title, body, created_at)
              VALUES (?, ?, ?, ?)`)
    .run('d1', 'hello', '# hi', Date.now());

  db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('p1', 'h1', 'hello', 'posts/p1.md', Date.now());

  db.prepare('UPDATE drafts SET finalized_post_id = ? WHERE id = ?').run('p1', 'd1');

  const row = db.prepare('SELECT * FROM drafts WHERE id = ?').get('d1');
  assert.equal(row.finalized_post_id, 'p1');
});

test('drafts: finalized_post_id is UNIQUE (one draft per post)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('p1', 'h1', 'hi', 'posts/p1.md', Date.now());

  db.prepare(`INSERT INTO drafts (id, title, body, created_at, finalized_post_id)
              VALUES (?, ?, ?, ?, ?)`)
    .run('d1', 't', 'b', Date.now(), 'p1');

  assert.throws(() => {
    db.prepare(`INSERT INTO drafts (id, title, body, created_at, finalized_post_id)
                VALUES (?, ?, ?, ?, ?)`)
      .run('d2', 't', 'b', Date.now(), 'p1');
  }, /UNIQUE/);
});

test('drafts: finalized_post_id FK rejects non-existent post', () => {
  const db = freshDb();
  assert.throws(() => {
    db.prepare(`INSERT INTO drafts (id, title, body, created_at, finalized_post_id)
                VALUES (?, ?, ?, ?, ?)`)
      .run('d1', 't', 'b', Date.now(), 'nonexistent-post');
  }, /FOREIGN KEY/);
});

test('drafts: NULL finalized_post_id is fine (unfinalized draft)', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO drafts (id, title, body, created_at)
              VALUES (?, ?, ?, ?)`)
    .run('d1', 't', 'b', Date.now());
  const row = db.prepare('SELECT finalized_post_id FROM drafts WHERE id = ?').get('d1');
  assert.equal(row.finalized_post_id, null);
});

test('STRICT enforcement: type mismatches reject', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());

  assert.throws(() => {
    db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run('p1', 'h1', 'hi', 'posts/p1.md', 'not-an-integer');
  }, /TYPE|cannot store|datatype/i);
});
