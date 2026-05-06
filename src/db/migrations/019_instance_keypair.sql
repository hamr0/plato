-- Migration 019: M7/B4 — Ed25519 instance keypair for archive signing.
--
-- One Ed25519 keypair instance-wide. Generated lazily on first export
-- (or first /.well-known/plato-pubkey hit), never rotated. The privkey
-- lives in the DB rather than on disk to honor plato's "single SQLite
-- file" rule — the same posture as every other persistent secret on the
-- forum (knowless's master_secret is the operator-managed exception).
--
-- Single-row enforcement via CHECK (id = 1). A future migration could
-- relax this to support rotation, but v1 is fixed-key.
--
-- private_key/public_key are 32-byte raw Ed25519 (the seed and the point,
-- respectively). The wire format on /.well-known/plato-pubkey serializes
-- the public_key as 64-char hex; the manifest's pubkey_fingerprint is
-- "sha256:<64-hex>" of the raw public_key bytes.

CREATE TABLE instance_keypair (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  algorithm       TEXT    NOT NULL CHECK (algorithm = 'ed25519'),
  private_key     BLOB    NOT NULL,
  public_key      BLOB    NOT NULL,
  fingerprint     TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);
