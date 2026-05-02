import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  createSub,
  getSubByName,
  setSubSensitive,
  listActiveSubs,
  listAllSubs,
} from '../../src/content/sub.js';

const OWNER = 'a'.repeat(64);

function fresh() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(OWNER, 'owner', Date.now());
  return db;
}

test('createSub: sensitive defaults to 0', () => {
  const db = fresh();
  createSub(db, { name: 'plain-sub', ownerHandle: OWNER });
  assert.equal(getSubByName(db, 'plain-sub').sensitive, 0);
});

test('createSub: sensitive=true persists as 1', () => {
  const db = fresh();
  createSub(db, { name: 'gritty-sub', ownerHandle: OWNER, sensitive: true });
  assert.equal(getSubByName(db, 'gritty-sub').sensitive, 1);
});

test('setSubSensitive: toggles the flag', () => {
  const db = fresh();
  createSub(db, { name: 'volatile-sub', ownerHandle: OWNER });
  setSubSensitive(db, 'volatile-sub', true);
  assert.equal(getSubByName(db, 'volatile-sub').sensitive, 1);
  setSubSensitive(db, 'volatile-sub', false);
  assert.equal(getSubByName(db, 'volatile-sub').sensitive, 0);
});

test('setSubSensitive: unknown sub throws', () => {
  const db = fresh();
  assert.throws(() => setSubSensitive(db, 'ghost-sub', true), /not found/);
});

test('listActiveSubs: returns sensitive flag', () => {
  const db = fresh();
  createSub(db, { name: 'topic-sens', ownerHandle: OWNER, sensitive: true });
  // Need a recent post to surface in active subs
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('a'.repeat(16), 'topic-sens', OWNER, 't', 'posts/x.md', Date.now());
  const rows = listActiveSubs(db);
  assert.equal(rows[0].sensitive, 1);
});

test('listAllSubs: returns sensitive flag', () => {
  const db = fresh();
  createSub(db, { name: 'topic-sens-2', ownerHandle: OWNER, sensitive: true });
  createSub(db, { name: 'topic-plain', ownerHandle: OWNER });
  const rows = listAllSubs(db, { sort: 'name' });
  const sens = rows.find((r) => r.name === 'topic-sens-2');
  const plain = rows.find((r) => r.name === 'topic-plain');
  assert.equal(sens.sensitive, 1);
  assert.equal(plain.sensitive, 0);
});
