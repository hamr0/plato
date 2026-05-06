// Ed25519 archive-signing tests (M7/B4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  generateInstanceKeypair, getOrCreateInstanceKeypair,
  signBytes, verifyBytes, fingerprintFromPublicKey,
} from '../../src/archive/signing.js';

function memDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  return db;
}

test('generateInstanceKeypair: returns 32-byte halves + sha256: fingerprint', () => {
  const kp = generateInstanceKeypair();
  assert.equal(kp.algorithm, 'ed25519');
  assert.equal(kp.privateKey.length, 32);
  assert.equal(kp.publicKey.length, 32);
  assert.match(kp.fingerprint, /^sha256:[0-9a-f]{64}$/);
});

test('fingerprintFromPublicKey: deterministic, distinct keys yield distinct prints', () => {
  const a = generateInstanceKeypair();
  const b = generateInstanceKeypair();
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.equal(fingerprintFromPublicKey(a.publicKey), a.fingerprint);
});

test('fingerprintFromPublicKey: rejects wrong-length input', () => {
  assert.throws(() => fingerprintFromPublicKey(Buffer.alloc(31)), /32 bytes/);
  assert.throws(() => fingerprintFromPublicKey(Buffer.alloc(33)), /32 bytes/);
});

test('signBytes / verifyBytes: round-trip works', () => {
  const kp = generateInstanceKeypair();
  const msg = Buffer.from('hello plato');
  const sig = signBytes(kp.privateKey, msg);
  assert.equal(sig.length, 64);
  assert.equal(verifyBytes(kp.publicKey, msg, sig), true);
});

test('verifyBytes: rejects tampered message', () => {
  const kp = generateInstanceKeypair();
  const msg = Buffer.from('hello plato');
  const sig = signBytes(kp.privateKey, msg);
  const tampered = Buffer.from('hello PLATO');
  assert.equal(verifyBytes(kp.publicKey, tampered, sig), false);
});

test('verifyBytes: rejects sig from a different key', () => {
  const a = generateInstanceKeypair();
  const b = generateInstanceKeypair();
  const msg = Buffer.from('hello plato');
  const sig = signBytes(a.privateKey, msg);
  assert.equal(verifyBytes(b.publicKey, msg, sig), false);
});

test('verifyBytes: bogus signature returns false (does not throw)', () => {
  const kp = generateInstanceKeypair();
  const msg = Buffer.from('hello plato');
  assert.equal(verifyBytes(kp.publicKey, msg, Buffer.alloc(64)), false);
  assert.equal(verifyBytes(kp.publicKey, msg, Buffer.alloc(7)), false);
});

test('getOrCreateInstanceKeypair: lazy-creates on first call, returns same row on second', () => {
  const db = memDb();
  const before = db.prepare('SELECT COUNT(*) AS n FROM instance_keypair').get().n;
  assert.equal(before, 0);

  const first = getOrCreateInstanceKeypair(db, { now: 1_700_000_000_000 });
  assert.equal(first.algorithm, 'ed25519');
  assert.equal(first.privateKey.length, 32);
  assert.equal(first.publicKey.length, 32);
  assert.equal(first.createdAt, 1_700_000_000_000);
  assert.match(first.fingerprint, /^sha256:[0-9a-f]{64}$/);

  const second = getOrCreateInstanceKeypair(db, { now: 1_800_000_000_000 });
  assert.equal(second.fingerprint, first.fingerprint);
  assert.equal(second.privateKey.toString('hex'), first.privateKey.toString('hex'));
  assert.equal(second.publicKey.toString('hex'), first.publicKey.toString('hex'));
  assert.equal(second.createdAt, first.createdAt); // not bumped
});

test('getOrCreateInstanceKeypair: keypair end-to-end signs + verifies', () => {
  const db = memDb();
  const kp = getOrCreateInstanceKeypair(db);
  const msg = Buffer.from('a plato archive payload');
  const sig = signBytes(kp.privateKey, msg);
  assert.equal(verifyBytes(kp.publicKey, msg, sig), true);
});

test('instance_keypair: CHECK constraints reject second row + bad algorithm', () => {
  const db = memDb();
  getOrCreateInstanceKeypair(db);
  assert.throws(
    () => db.prepare(
      'INSERT INTO instance_keypair (id, algorithm, private_key, public_key, fingerprint, created_at) VALUES (2, ?, ?, ?, ?, ?)'
    ).run('ed25519', Buffer.alloc(32), Buffer.alloc(32), 'sha256:x', 0),
    /CHECK/i,
  );
  // bad algorithm rejected on a fresh db
  const db2 = memDb();
  assert.throws(
    () => db2.prepare(
      'INSERT INTO instance_keypair (id, algorithm, private_key, public_key, fingerprint, created_at) VALUES (1, ?, ?, ?, ?, ?)'
    ).run('rsa', Buffer.alloc(32), Buffer.alloc(32), 'sha256:x', 0),
    /CHECK/i,
  );
});
