import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { pseudonymFor, defaultGenerate } from '../../src/identity/pseudonym.js';
import { applyAllMigrations } from '../_helpers/migrations.js';

function freshDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  return db;
}

test('pseudonymFor: first call generates and persists', () => {
  const db = freshDb();
  const name = pseudonymFor(db, 'handle-1');
  assert.match(name, /^[a-z]+-[a-z]+$/, 'two-word lowercase hyphenated');

  const row = db.prepare('SELECT * FROM handles WHERE handle = ?').get('handle-1');
  assert.equal(row.pseudonym, name);
  assert.equal(typeof row.first_seen_at, 'number');
});

test('pseudonymFor: returns cached value on subsequent calls (no regeneration)', () => {
  const db = freshDb();
  const first = pseudonymFor(db, 'handle-1');

  // Pass a generator that would explode if called — proves cache hit
  const second = pseudonymFor(db, 'handle-1', () => {
    throw new Error('generator should not be called when cached');
  });

  assert.equal(first, second);
});

test('pseudonymFor: deterministic for same handle on fresh DB', () => {
  const a = pseudonymFor(freshDb(), 'handle-x');
  const b = pseudonymFor(freshDb(), 'handle-x');
  assert.equal(a, b, 'default generator is deterministic from handle');
});

test('pseudonymFor: different handles produce different pseudonyms', () => {
  const db = freshDb();
  const names = new Set();
  for (let i = 0; i < 50; i++) {
    names.add(pseudonymFor(db, `handle-${i}`));
  }
  assert.equal(names.size, 50, 'no spurious collisions across 50 handles');
});

test('pseudonymFor: retries on UNIQUE collision with injected generator', () => {
  const db = freshDb();
  // Pre-claim "taken-name" for handle-A
  pseudonymFor(db, 'handle-A', () => 'taken-name');

  // handle-B's generator returns "taken-name" first, then "fallback-name"
  let attempts = 0;
  const generate = () => {
    attempts++;
    return attempts === 1 ? 'taken-name' : 'fallback-name';
  };

  const result = pseudonymFor(db, 'handle-B', generate);
  assert.equal(result, 'fallback-name');
  assert.equal(attempts, 2, 'generator called twice (collision + retry)');
});

test('pseudonymFor: throws after exhausting retries', () => {
  const db = freshDb();
  pseudonymFor(db, 'handle-A', () => 'always-taken');

  // handle-B's generator always returns the taken name
  assert.throws(
    () => pseudonymFor(db, 'handle-B', () => 'always-taken'),
    /collision retry exhausted/
  );
});

test('pseudonymFor: non-UNIQUE errors propagate (do not silently retry)', () => {
  const db = freshDb();
  // null pseudonym violates NOT NULL, not UNIQUE — should NOT be silently retried
  assert.throws(
    () => pseudonymFor(db, 'handle-A', () => null),
    /NOT NULL|null/i
  );
});

test('defaultGenerate: attempt 0 is deterministic from handle', () => {
  const a1 = defaultGenerate('handle-x', 0);
  const a2 = defaultGenerate('handle-x', 0);
  assert.equal(a1, a2, 'attempt 0 is reproducible per handle');
});

test('defaultGenerate: retries (attempt > 0) are non-deterministic', () => {
  // Crypto-random retries break out of the deterministic seed→combo mapping
  // that causes pathological collision chains. Two retry calls almost always
  // produce different outputs. (Probability of equality is ~1/426710.)
  const r1 = defaultGenerate('handle-x', 1);
  const r2 = defaultGenerate('handle-x', 1);
  assert.notEqual(r1, r2, 'retries draw fresh randomness each call');
});
