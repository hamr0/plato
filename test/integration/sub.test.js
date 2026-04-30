import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { createSub, getSubByName, listActiveSubs } from '../../src/content/sub.js';

const HANDLE_A = 'a'.repeat(64);
const HANDLE_B = 'b'.repeat(64);

function freshDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(HANDLE_A, 'alpha-one', Date.now());
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(HANDLE_B, 'beta-two', Date.now());
  return db;
}

test('createSub: inserts sub + owner row in sub_mods', () => {
  const db = freshDb();
  createSub(db, { name: 'cooking', description: 'recipes', ownerHandle: HANDLE_A });

  const sub = getSubByName(db, 'cooking');
  assert.equal(sub.name, 'cooking');
  assert.equal(sub.description, 'recipes');
  assert.equal(sub.owner_handle, HANDLE_A);

  const mod = db.prepare('SELECT * FROM sub_mods WHERE sub_name = ? AND handle = ?')
    .get('cooking', HANDLE_A);
  assert.equal(mod.role, 'owner');
});

test('createSub: rejects invalid name (validator runs before insert)', () => {
  const db = freshDb();
  assert.throws(
    () => createSub(db, { name: 'BadName', ownerHandle: HANDLE_A }),
    /lowercase/
  );
  assert.throws(
    () => createSub(db, { name: 'admin', ownerHandle: HANDLE_A }),
    /reserved/
  );
});

test('createSub: rejects missing ownerHandle', () => {
  const db = freshDb();
  assert.throws(() => createSub(db, { name: 'cooking' }), /ownerHandle/);
});

test('createSub: duplicate name throws "already exists"', () => {
  const db = freshDb();
  createSub(db, { name: 'cooking', ownerHandle: HANDLE_A });
  assert.throws(
    () => createSub(db, { name: 'cooking', ownerHandle: HANDLE_B }),
    /already exists/
  );
});

test('createSub: nonexistent ownerHandle is rejected by FK', () => {
  const db = freshDb();
  assert.throws(
    () => createSub(db, { name: 'cooking', ownerHandle: 'nope' }),
    /FOREIGN KEY/
  );
});

test('getSubByName: returns null for unknown', () => {
  const db = freshDb();
  assert.equal(getSubByName(db, 'nothing'), null);
});

test('getSubByName: finds general (from migration)', () => {
  const db = freshDb();
  const sub = getSubByName(db, 'general');
  assert.equal(sub.name, 'general');
});

test('listActiveSubs: includes only subs with posts in window, ordered by post_count DESC', () => {
  const db = freshDb();
  createSub(db, { name: 'cooking', ownerHandle: HANDLE_A });
  createSub(db, { name: 'gardening', ownerHandle: HANDLE_B });

  const now = Date.now();
  // 3 cooking posts, 1 gardening post, 1 cooking post outside window
  const insertPost = db.prepare(
    `INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  insertPost.run('p1', 'cooking', HANDLE_A, 't1', 'posts/p1.md', now);
  insertPost.run('p2', 'cooking', HANDLE_A, 't2', 'posts/p2.md', now - 1000);
  insertPost.run('p3', 'cooking', HANDLE_A, 't3', 'posts/p3.md', now - 2000);
  insertPost.run('p4', 'gardening', HANDLE_B, 't4', 'posts/p4.md', now);
  insertPost.run('p5', 'cooking', HANDLE_A, 't5', 'posts/p5.md', now - 48 * 60 * 60 * 1000);

  const active = listActiveSubs(db, { sinceMs: now - 24 * 60 * 60 * 1000 });
  assert.equal(active.length, 2);
  assert.equal(active[0].name, 'cooking');
  assert.equal(active[0].post_count, 3);
  assert.equal(active[1].name, 'gardening');
  assert.equal(active[1].post_count, 1);
});

test('listActiveSubs: excludes subs with zero posts', () => {
  const db = freshDb();
  createSub(db, { name: 'cooking', ownerHandle: HANDLE_A });
  // No posts.
  const active = listActiveSubs(db);
  assert.equal(active.length, 0);
});
