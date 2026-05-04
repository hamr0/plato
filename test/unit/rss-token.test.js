// M6/B6: per-user RSS token helpers (src/content/rss-token.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  getOrCreateRssToken, regenerateRssToken, handleByRssToken,
} from '../../src/content/rss-token.js';

const ALICE = 'a'.repeat(64);
const BOB   = 'b'.repeat(64);

function fixture() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  for (const h of [ALICE, BOB]) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, h.slice(0, 6), Date.now());
  }
  return db;
}

test('getOrCreateRssToken: issues a 64-char hex token on first call', () => {
  const db = fixture();
  const token = getOrCreateRssToken(db, ALICE);
  assert.match(token, /^[0-9a-f]{64}$/);
});

test('getOrCreateRssToken: idempotent — same token returned across calls', () => {
  const db = fixture();
  const t1 = getOrCreateRssToken(db, ALICE);
  const t2 = getOrCreateRssToken(db, ALICE);
  assert.equal(t1, t2);
});

test('getOrCreateRssToken: distinct users get distinct tokens', () => {
  const db = fixture();
  const t1 = getOrCreateRssToken(db, ALICE);
  const t2 = getOrCreateRssToken(db, BOB);
  assert.notEqual(t1, t2);
});

test('getOrCreateRssToken: throws on unknown handle (caller bug, fail loud)', () => {
  const db = fixture();
  assert.throws(() => getOrCreateRssToken(db, 'c'.repeat(64)), /unknown handle/);
});

test('regenerateRssToken: returns a new token, invalidates the previous one', () => {
  const db = fixture();
  const t1 = getOrCreateRssToken(db, ALICE);
  const t2 = regenerateRssToken(db, ALICE);
  assert.notEqual(t1, t2);
  // Old token no longer resolves; new one does.
  assert.equal(handleByRssToken(db, t1), null);
  assert.equal(handleByRssToken(db, t2), ALICE);
});

test('handleByRssToken: roundtrips through token → handle', () => {
  const db = fixture();
  const token = getOrCreateRssToken(db, ALICE);
  assert.equal(handleByRssToken(db, token), ALICE);
});

test('handleByRssToken: returns null for unknown / malformed / non-string', () => {
  const db = fixture();
  // Issue Alice a token so the table has a row.
  getOrCreateRssToken(db, ALICE);
  assert.equal(handleByRssToken(db, 'f'.repeat(64)), null);
  assert.equal(handleByRssToken(db, 'not-hex'), null);
  assert.equal(handleByRssToken(db, ''), null);
  assert.equal(handleByRssToken(db, null), null);
  assert.equal(handleByRssToken(db, undefined), null);
  // Hex of wrong length.
  assert.equal(handleByRssToken(db, 'a'.repeat(63)), null);
  assert.equal(handleByRssToken(db, 'a'.repeat(65)), null);
});
