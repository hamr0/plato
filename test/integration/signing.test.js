// Ed25519 archive-signing tests (M7/B4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  generateInstanceKeypair, getOrCreateInstanceKeypair,
  signBytes, verifyBytes, fingerprintFromPublicKey,
  verifyArchiveSignature, signatureFetchDisposition,
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

// --- verifyArchiveSignature: the import-side authenticity gate (C1) ---

const GZ = Buffer.from('pretend-this-is-the-gzipped-archive-bytes');

test('verifyArchiveSignature: a correctly signed archive passes', () => {
  const kp = generateInstanceKeypair();
  const sig = signBytes(kp.privateKey, GZ);
  const v = verifyArchiveSignature({
    gzBytes: GZ, sigBytes: sig,
    pubkeyHex: kp.publicKey.toString('hex'),
    manifestFingerprint: kp.fingerprint,
  });
  assert.deepEqual(v, { ok: true });
});

test('verifyArchiveSignature: rejects tampered archive bytes', () => {
  const kp = generateInstanceKeypair();
  const sig = signBytes(kp.privateKey, GZ);
  const tampered = Buffer.concat([GZ, Buffer.from('!')]);
  const v = verifyArchiveSignature({
    gzBytes: tampered, sigBytes: sig,
    pubkeyHex: kp.publicKey.toString('hex'),
    manifestFingerprint: kp.fingerprint,
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /signature does not verify/);
});

test('verifyArchiveSignature: rejects a key whose fingerprint != the manifest claim', () => {
  // Attacker signs with their own key but the manifest claims a different
  // instance's fingerprint — the cross-check must catch it.
  const attacker = generateInstanceKeypair();
  const victim = generateInstanceKeypair();
  const sig = signBytes(attacker.privateKey, GZ);
  const v = verifyArchiveSignature({
    gzBytes: GZ, sigBytes: sig,
    pubkeyHex: attacker.publicKey.toString('hex'),
    manifestFingerprint: victim.fingerprint,
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /does not match/);
});

test('verifyArchiveSignature: unsigned archive refused by default, accepted only with allowUnsigned', () => {
  const refused = verifyArchiveSignature({
    gzBytes: GZ, sigBytes: null, pubkeyHex: null, manifestFingerprint: null,
  });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /unsigned/);
  const allowed = verifyArchiveSignature({
    gzBytes: GZ, sigBytes: null, pubkeyHex: null, manifestFingerprint: null,
    allowUnsigned: true,
  });
  assert.deepEqual(allowed, { ok: true, unsigned: true });
});

test('verifyArchiveSignature: a signed archive whose .sig/pubkey could not be fetched is refused', () => {
  const kp = generateInstanceKeypair();
  const v = verifyArchiveSignature({
    gzBytes: GZ, sigBytes: null, pubkeyHex: null,
    manifestFingerprint: kp.fingerprint,
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /did not serve/);
});

// signatureFetchDisposition decides whether a non-200 on the .sig / pubkey
// fetch means "genuinely unsigned" or "transient — retry". Getting this wrong
// is the difference between a stable source outage terminally killing a
// legitimately signed import (treating 5xx as unsigned) and a correct retry.
test('signatureFetchDisposition: 200 present; 404/410 absent; everything else retries', () => {
  assert.equal(signatureFetchDisposition(200), 'present');
  assert.equal(signatureFetchDisposition(404), 'absent');
  assert.equal(signatureFetchDisposition(410), 'absent');
  // Transient / ambiguous — the material may exist; don't mislabel as unsigned.
  for (const s of [500, 502, 503, 504, 429, 403, 401, 301, 0]) {
    assert.equal(signatureFetchDisposition(s), 'retry', `HTTP ${s} must retry, not collapse to unsigned`);
  }
});

test('verifyArchiveSignature: rejects a malformed published key', () => {
  const kp = generateInstanceKeypair();
  const sig = signBytes(kp.privateKey, GZ);
  const v = verifyArchiveSignature({
    gzBytes: GZ, sigBytes: sig, pubkeyHex: 'xyz', manifestFingerprint: kp.fingerprint,
  });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not a 32-byte hex/);
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
