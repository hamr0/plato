// Ed25519 archive signing (M7/B4).
//
// One keypair per plato instance, generated lazily on first need and
// stored in the DB (migration 019). The privkey never leaves the
// database; the pubkey is published at /.well-known/plato-pubkey and its
// fingerprint travels in every signed archive's manifest.json.
//
// Detached-signature posture: the signature is over the gzipped tarball
// bytes (the .tar.gz file as written to disk), and ships as a sibling
// .tar.gz.sig file. An importer fetches the source instance's pubkey,
// confirms its fingerprint matches the manifest's claim, then verifies.
//
// Spec: docs/02-features/archive-format.md (Future layers → M7/B4).

import {
  generateKeyPairSync, createPrivateKey, createPublicKey,
  sign, verify, createHash,
} from 'node:crypto';

const ALGORITHM = 'ed25519';
const FINGERPRINT_PREFIX = 'sha256:';

// Compute a deterministic fingerprint from a 32-byte Ed25519 public key.
// Format: "sha256:<64-hex>". The prefix tags the hash algorithm so a
// future fingerprint scheme can be distinguished without ambiguity.
export function fingerprintFromPublicKey(publicKeyBytes) {
  const buf = toBuffer(publicKeyBytes);
  if (buf.length !== 32) {
    throw new Error(`fingerprintFromPublicKey: expected 32 bytes, got ${buf.length}`);
  }
  return FINGERPRINT_PREFIX + createHash('sha256').update(buf).digest('hex');
}

// Generate a fresh Ed25519 keypair and return the raw 32-byte halves +
// fingerprint. Pure function — does not touch the DB.
export function generateInstanceKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync(ALGORITHM);
  const privJwk = privateKey.export({ format: 'jwk' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const privateKeyBytes = Buffer.from(privJwk.d, 'base64url');
  const publicKeyBytes = Buffer.from(pubJwk.x, 'base64url');
  return {
    algorithm: ALGORITHM,
    privateKey: privateKeyBytes,
    publicKey: publicKeyBytes,
    fingerprint: fingerprintFromPublicKey(publicKeyBytes),
  };
}

// Read the singleton instance keypair, generating + persisting it on
// first call. Idempotent — every subsequent call returns the same row.
// Returns { algorithm, privateKey: Buffer, publicKey: Buffer,
// fingerprint, createdAt }. Never returns null.
export function getOrCreateInstanceKeypair(db, { now = Date.now() } = {}) {
  const existing = db.prepare(
    'SELECT algorithm, private_key, public_key, fingerprint, created_at FROM instance_keypair WHERE id = 1'
  ).get();
  if (existing) {
    return {
      algorithm: existing.algorithm,
      privateKey: toBuffer(existing.private_key),
      publicKey: toBuffer(existing.public_key),
      fingerprint: existing.fingerprint,
      createdAt: existing.created_at,
    };
  }
  const fresh = generateInstanceKeypair();
  db.prepare(
    `INSERT INTO instance_keypair (id, algorithm, private_key, public_key, fingerprint, created_at)
     VALUES (1, ?, ?, ?, ?, ?)`
  ).run(fresh.algorithm, fresh.privateKey, fresh.publicKey, fresh.fingerprint, now);
  return { ...fresh, createdAt: now };
}

// Sign arbitrary bytes with the raw 32-byte Ed25519 seed. Returns the
// 64-byte detached signature as a Buffer.
export function signBytes(privateKeyBytes, messageBytes) {
  const priv = toBuffer(privateKeyBytes);
  const pub = derivePublicKeyFromPrivate(priv);
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      d: priv.toString('base64url'),
      x: pub.toString('base64url'),
    },
  });
  return sign(null, toBuffer(messageBytes), key);
}

// Verify a detached signature. Returns boolean; never throws on a
// malformed signature.
export function verifyBytes(publicKeyBytes, messageBytes, signatureBytes) {
  const pub = toBuffer(publicKeyBytes);
  const key = createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') },
  });
  try {
    return verify(null, toBuffer(messageBytes), key, toBuffer(signatureBytes));
  } catch {
    return false;
  }
}

// Verify an imported archive's authenticity before any of its content is
// trusted. The trust anchor is the key the *source host* publishes at
// /.well-known/plato-pubkey — the TLS-authenticated origin of the URL the
// importing user chose to import from. We confirm that key signed the archive
// bytes and that its fingerprint matches the one the manifest declares.
// Anchoring on the manifest's own base_url would be circular (the whole
// manifest is attacker-supplied on a forged archive); anchoring on the
// fetched-from origin is not — the user vouches for that host by pasting it.
//
// Returns { ok: true } on success, { ok: true, unsigned: true } when the
// archive carries no fingerprint and unsigned imports are explicitly allowed,
// or { ok: false, reason } describing the refusal. Never throws.
export function verifyArchiveSignature({ gzBytes, sigBytes, pubkeyHex, manifestFingerprint, allowUnsigned = false }) {
  if (manifestFingerprint == null) {
    if (allowUnsigned) return { ok: true, unsigned: true };
    return { ok: false, reason: 'archive is unsigned (manifest carries no pubkey fingerprint); set IMPORT_ALLOW_UNSIGNED=1 to accept unsigned archives' };
  }
  if (!sigBytes || !pubkeyHex) {
    return { ok: false, reason: 'archive claims a signature but the source did not serve its .sig and /.well-known/plato-pubkey' };
  }
  if (!/^[0-9a-fA-F]{64}$/.test(pubkeyHex)) {
    return { ok: false, reason: 'source published key is not a 32-byte hex Ed25519 key' };
  }
  const pub = Buffer.from(pubkeyHex, 'hex');
  const fp = fingerprintFromPublicKey(pub);
  if (fp !== manifestFingerprint) {
    return { ok: false, reason: `source key fingerprint (${fp}) does not match the archive's claim (${manifestFingerprint})` };
  }
  if (!verifyBytes(pub, gzBytes, sigBytes)) {
    return { ok: false, reason: 'signature does not verify — the archive was not signed by the source instance, or was altered in transit' };
  }
  return { ok: true };
}

// How to read the HTTP status of a signature-material fetch (the detached
// `.sig` or /.well-known/plato-pubkey). The distinction matters: collapsing
// every non-200 into "absent" lets a transient blip on a genuinely signed
// source masquerade as an unsigned archive, which then refuses terminally —
// a stable outage permanently kills a legitimate import.
//   'present' — 200, the material is in hand.
//   'absent'  — 404/410, the source serves no signature; the unsigned path
//               applies (per the manifest's own fingerprint claim). Stable, so
//               retrying is pointless.
//   'retry'   — anything else (5xx, 429, 403, an unresolved 3xx). The material
//               may well exist; treat it as a transient fetch failure so the
//               worker requeues rather than mislabeling the archive unsigned.
export function signatureFetchDisposition(status) {
  if (status === 200) return 'present';
  if (status === 404 || status === 410) return 'absent';
  return 'retry';
}

// Internal helper. Ed25519 derives the public key from the seed
// deterministically; we recover it via Node's crypto rather than
// hand-rolling curve math.
function derivePublicKeyFromPrivate(privateKeyBytes) {
  const seed = toBuffer(privateKeyBytes);
  if (seed.length !== 32) {
    throw new Error(`derivePublicKeyFromPrivate: expected 32-byte seed, got ${seed.length}`);
  }
  // PKCS#8-encoded Ed25519 private key: a fixed 16-byte ASN.1 prefix +
  // the 32-byte seed. Importing this lets us extract the public point.
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const der = Buffer.concat([prefix, seed]);
  const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  return Buffer.from(jwk.x, 'base64url');
}

function toBuffer(x) {
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  if (typeof x === 'string') return Buffer.from(x, 'utf8');
  throw new Error('signing: expected Buffer/Uint8Array/string');
}
