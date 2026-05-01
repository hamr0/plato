import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { listPostsInSub, SUB_SORTS } from '../../src/content/post.js';

const HOUR_MS = 60 * 60 * 1000;
const HANDLE = 'a'.repeat(64);
const SUB = 'lobby';

function fixture() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run(SUB, 0);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(HANDLE, 'one', 0);
  return db;
}

function seedPost(db, { id, ageHours, score }) {
  const created = (1000 - ageHours) * HOUR_MS;
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id.padStart(16, '0'), SUB, HANDLE, id, `posts/${id}.md`, created, score);
}

const NOW = 1000 * HOUR_MS;

test('SUB_SORTS lists exactly the four PRD sort modes', () => {
  assert.deepEqual(SUB_SORTS.sort(), ['hot', 'new', 'old', 'top']);
});

test('sort=new returns newest first', () => {
  const db = fixture();
  seedPost(db, { id: 'old',  ageHours: 100, score: 0 });
  seedPost(db, { id: 'mid',  ageHours: 50,  score: 0 });
  seedPost(db, { id: 'fresh', ageHours: 1, score: 0 });
  const rows = listPostsInSub(db, SUB, { sort: 'new' });
  assert.deepEqual(rows.map((r) => r.title), ['fresh', 'mid', 'old']);
});

test('sort=old returns oldest first', () => {
  const db = fixture();
  seedPost(db, { id: 'old', ageHours: 100, score: 0 });
  seedPost(db, { id: 'fresh', ageHours: 1, score: 0 });
  const rows = listPostsInSub(db, SUB, { sort: 'old' });
  assert.deepEqual(rows.map((r) => r.title), ['old', 'fresh']);
});

test('sort=top returns highest score first', () => {
  const db = fixture();
  seedPost(db, { id: 'gold',   ageHours: 50, score: 100 });
  seedPost(db, { id: 'silver', ageHours: 1,  score: 10 });
  seedPost(db, { id: 'bronze', ageHours: 1,  score: 1 });
  const rows = listPostsInSub(db, SUB, { sort: 'top' });
  assert.deepEqual(rows.map((r) => r.title), ['gold', 'silver', 'bronze']);
});

test('sort=hot ranks recent high-score above old gold', () => {
  const db = fixture();
  // Old gold: score 100 at 100 hours → 100 / (102)^1.5 ≈ 0.097
  seedPost(db, { id: 'old-gold',   ageHours: 100, score: 100 });
  // Recent good: score 20 at 1 hour → 20 / (3)^1.5 ≈ 3.85 (much hotter)
  seedPost(db, { id: 'recent-good', ageHours: 1,   score: 20 });
  // Cold dud: score 0 at 1 hour → 0
  seedPost(db, { id: 'cold-dud',   ageHours: 1,   score: 0 });
  const rows = listPostsInSub(db, SUB, { sort: 'hot', now: NOW });
  assert.equal(rows[0].title, 'recent-good', 'recent high score wins');
  assert.equal(rows[1].title, 'old-gold');
  assert.equal(rows[2].title, 'cold-dud');
});

test('sort=hot: same score, newer wins', () => {
  const db = fixture();
  seedPost(db, { id: 'newer', ageHours: 1, score: 5 });
  seedPost(db, { id: 'older', ageHours: 5, score: 5 });
  const rows = listPostsInSub(db, SUB, { sort: 'hot', now: NOW });
  assert.equal(rows[0].title, 'newer');
});

test('sort=hot is deterministic for fixed `now`', () => {
  const db = fixture();
  seedPost(db, { id: 'a', ageHours: 3, score: 5 });
  seedPost(db, { id: 'b', ageHours: 7, score: 5 });
  const r1 = listPostsInSub(db, SUB, { sort: 'hot', now: NOW }).map((r) => r.title);
  const r2 = listPostsInSub(db, SUB, { sort: 'hot', now: NOW }).map((r) => r.title);
  assert.deepEqual(r1, r2);
});

test('unknown sort throws', () => {
  const db = fixture();
  assert.throws(() => listPostsInSub(db, SUB, { sort: 'nonsense' }), /unknown sort/);
});

test('default sort is "new" when omitted', () => {
  const db = fixture();
  seedPost(db, { id: 'old', ageHours: 100, score: 0 });
  seedPost(db, { id: 'fresh', ageHours: 1, score: 0 });
  const rows = listPostsInSub(db, SUB);
  assert.equal(rows[0].title, 'fresh');
});
