// Sub-export eligibility gate (M7/B2-b).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { subscribe, unsubscribe, SUB_EXPORT_TENURE_MS } from '../../src/content/subscription.js';
import { canExportSub, subExportEligibility } from '../../src/archive/gate.js';

const NOW = Date.UTC(2026, 4, 6);
const HANDLE_A = 'a'.repeat(64);
const HANDLE_B = 'b'.repeat(64);
const HANDLE_C = 'c'.repeat(64);

function memDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  // Seed a sub owned by handle_a, with handle_b as co-mod, handle_c as a non-mod subscriber.
  db.prepare(`INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)`).run(HANDLE_A, 'alice', NOW);
  db.prepare(`INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)`).run(HANDLE_B, 'bob', NOW);
  db.prepare(`INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)`).run(HANDLE_C, 'carol', NOW);
  db.prepare(`INSERT INTO subs (name, description, owner_handle, default_sort, created_at)
              VALUES ('lobby', '', ?, 'new', ?)`).run(HANDLE_A, NOW);
  db.prepare(`INSERT INTO sub_mods (sub_name, handle, role)
              VALUES ('lobby', ?, 'co-mod')`).run(HANDLE_B);
  return db;
}

test('canExportSub: anon → false', () => {
  const db = memDb();
  assert.equal(canExportSub(db, null, 'lobby', { now: NOW }), false);
  assert.equal(canExportSub(db, '', 'lobby', { now: NOW }), false);
});

test('canExportSub: owner → true regardless of tenure', () => {
  const db = memDb();
  assert.equal(canExportSub(db, HANDLE_A, 'lobby', { now: NOW }), true);
});

test('canExportSub: co-mod → true regardless of tenure', () => {
  const db = memDb();
  assert.equal(canExportSub(db, HANDLE_B, 'lobby', { now: NOW }), true);
});

test('canExportSub: logged-in non-subscriber → false', () => {
  const db = memDb();
  assert.equal(canExportSub(db, HANDLE_C, 'lobby', { now: NOW }), false);
});

test('canExportSub: 59-day subscriber → false', () => {
  const db = memDb();
  const subscribedAt = NOW - (SUB_EXPORT_TENURE_MS - 24 * 60 * 60 * 1000); // 59 days ago
  subscribe(db, { handle: HANDLE_C, subName: 'lobby', now: subscribedAt });
  assert.equal(canExportSub(db, HANDLE_C, 'lobby', { now: NOW }), false);
});

test('canExportSub: exactly-60-day subscriber → true', () => {
  const db = memDb();
  subscribe(db, { handle: HANDLE_C, subName: 'lobby', now: NOW - SUB_EXPORT_TENURE_MS });
  assert.equal(canExportSub(db, HANDLE_C, 'lobby', { now: NOW }), true);
});

test('canExportSub: 90-day subscriber → true', () => {
  const db = memDb();
  subscribe(db, { handle: HANDLE_C, subName: 'lobby', now: NOW - 90 * 24 * 60 * 60 * 1000 });
  assert.equal(canExportSub(db, HANDLE_C, 'lobby', { now: NOW }), true);
});

test('canExportSub: unsubscribe + resubscribe restarts the clock', () => {
  const db = memDb();
  // Subscribed long ago, then unsubscribed, then resubscribed yesterday.
  subscribe(db, { handle: HANDLE_C, subName: 'lobby', now: NOW - 365 * 24 * 60 * 60 * 1000 });
  unsubscribe(db, { handle: HANDLE_C, subName: 'lobby' });
  subscribe(db, { handle: HANDLE_C, subName: 'lobby', now: NOW - 24 * 60 * 60 * 1000 });
  assert.equal(canExportSub(db, HANDLE_C, 'lobby', { now: NOW }), false,
    '60-day clock restarts on resubscribe');
});

test('subExportEligibility: anon', () => {
  const db = memDb();
  assert.deepEqual(subExportEligibility(db, null, 'lobby', { now: NOW }), { state: 'anon' });
});

test('subExportEligibility: owner → mod', () => {
  const db = memDb();
  assert.deepEqual(subExportEligibility(db, HANDLE_A, 'lobby', { now: NOW }), { state: 'mod' });
});

test('subExportEligibility: not subscribed', () => {
  const db = memDb();
  assert.deepEqual(subExportEligibility(db, HANDLE_C, 'lobby', { now: NOW }), { state: 'not-subscribed' });
});

test('subExportEligibility: tenure-pending exposes eligibleAt', () => {
  const db = memDb();
  const subscribedAt = NOW - 30 * 24 * 60 * 60 * 1000; // 30 days ago
  subscribe(db, { handle: HANDLE_C, subName: 'lobby', now: subscribedAt });
  const result = subExportEligibility(db, HANDLE_C, 'lobby', { now: NOW });
  assert.equal(result.state, 'tenure-pending');
  assert.equal(result.eligibleAt, subscribedAt + SUB_EXPORT_TENURE_MS);
});

test('subExportEligibility: eligible after 60 days', () => {
  const db = memDb();
  subscribe(db, { handle: HANDLE_C, subName: 'lobby', now: NOW - SUB_EXPORT_TENURE_MS - 1000 });
  assert.deepEqual(subExportEligibility(db, HANDLE_C, 'lobby', { now: NOW }), { state: 'eligible' });
});
