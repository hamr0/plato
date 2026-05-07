#!/usr/bin/env bash
# End-to-end smoke test of the M7 export → host → import round-trip
# across two plato instances on disk. Exercises the actual cron worker
# scripts (not stubbed), the actual gunzip + tar reader path, and a real
# HTTP fetch by instance B against an HTTP-served archive from instance A.
#
# Covers M7/B2-b (export queue + worker), M7/B4 (Ed25519 sig + .sig
# sibling + /.well-known fingerprint), M7/B5 (URL-fetch sub-import,
# pseudonym preservation, [imported] modlog tag, idempotence).
#
# Usage: bin/m7-smoke.sh
# Exits 0 on success; non-zero with a clear FAIL line on any breakage.
# Cleans up its tmpdir on exit (success or failure).

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d -t plato-m7-smoke.XXXXXX)

A_DB=$TMP/a.db
B_DB=$TMP/b.db
A_POSTS=$TMP/a-posts
B_POSTS=$TMP/b-posts
EXPORTS=$TMP/exports
SERVER_LOG=$TMP/server.log
SERVER_PID_FILE=$TMP/server.pid
mkdir -p "$A_POSTS" "$B_POSTS" "$EXPORTS"

cleanup() {
  if [ -f "$SERVER_PID_FILE" ]; then
    kill "$(cat "$SERVER_PID_FILE")" 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

step() { echo; echo "==> [smoke] $*"; }
fail() { echo; echo "FAIL: $*" >&2; exit 1; }

step "tmp=$TMP"
step "applying migrations to A and B"
DB_PATH=$A_DB node "$ROOT/bin/migrate.js" > /dev/null
DB_PATH=$B_DB node "$ROOT/bin/migrate.js" > /dev/null

step "seeding instance A (sub + posts + comments + mod action) and enqueueing export"
node --input-type=module <<EOF
import { openDb } from '$ROOT/src/db/index.js';
import { writeFileSync } from 'node:fs';
import { enqueueSubExport } from '$ROOT/src/archive/queue.js';
const db = openDb('$A_DB');
const ALICE = 'a'.repeat(64);
const BOB   = 'b'.repeat(64);
const now = Date.now();
db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(ALICE, 'alice-tiger', now);
db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(BOB, 'bob-otter', now);
db.prepare('INSERT INTO subs (name, description, owner_handle, created_at) VALUES (?, ?, ?, ?)')
  .run('lobby', 'the smoke-test sub', ALICE, now);
db.prepare('INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, ?)').run('lobby', ALICE, 'owner');
const postBody = '---\ntitle: "first post"\nhandle: ' + ALICE + '\nsub_name: lobby\ncreated_at: ' + now + '\n---\n\nhello world from alice\n';
writeFileSync('$A_POSTS/post01.md', postBody);
db.prepare('INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run('post0000000000aa', 'lobby', ALICE, 'first post', 'posts/post01.md', now, 1.5);
db.prepare('INSERT INTO comments (id, post_id, handle, body, created_at, score) VALUES (?, ?, ?, ?, ?, ?)')
  .run('comm0000000000bb', 'post0000000000aa', BOB, 'top reply from bob', now, 0.5);
db.prepare('INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  .run('mod00000000000cc', 'lobby', ALICE, 'collapse', 'comment', 'comm0000000000bb', 'noisy', now);
enqueueSubExport(db, { subName: 'lobby', requestedBy: ALICE });
console.log('[smoke] seeded A: alice-tiger (mod) + bob-otter, 1 post, 1 comment, 1 mod action');
EOF

step "running export worker on A (off-peak gate disabled)"
EXPORT_OFFPEAK_DISABLE=1 \
DB_PATH=$A_DB \
POSTS_DIR=$A_POSTS \
EXPORTS_DIR=$EXPORTS \
node "$ROOT/bin/run-export-queue.js"

TARFILE=$(ls "$EXPORTS"/*.tar.gz 2>/dev/null | head -n1 || true)
SIGFILE="${TARFILE}.sig"
[ -f "$TARFILE" ] || fail "no .tar.gz produced in $EXPORTS"
[ -f "$SIGFILE" ] || fail "no .tar.gz.sig produced (B4 wiring broken?)"
TARSIZE=$(wc -c < "$TARFILE" | tr -d ' ')
SIGSIZE=$(wc -c < "$SIGFILE" | tr -d ' ')
[ "$SIGSIZE" = "64" ] || fail ".tar.gz.sig is $SIGSIZE bytes, expected 64 (raw Ed25519)"
step "export produced $(basename "$TARFILE") (${TARSIZE} bytes) + .sig (${SIGSIZE} bytes)"

step "verifying signature against the keypair stored in A's DB"
node --input-type=module <<EOF
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { openDb } from '$ROOT/src/db/index.js';
import { verifyBytes, fingerprintFromPublicKey } from '$ROOT/src/archive/signing.js';
const db = openDb('$A_DB');
const kp = db.prepare('SELECT public_key, fingerprint FROM instance_keypair WHERE id = 1').get();
assert.ok(kp, 'A has no instance_keypair row — B4 lazy-create broken');
const tar = readFileSync('$TARFILE');
const sig = readFileSync('$SIGFILE');
assert.equal(verifyBytes(kp.public_key, tar, sig), true, 'sig does not verify against A\'s pubkey');
const fp = fingerprintFromPublicKey(kp.public_key);
assert.equal(fp, kp.fingerprint, 'stored fingerprint does not match recomputed');
console.log('[smoke] sig verified ✓ fingerprint=' + fp.slice(0, 24) + '…');
EOF

step "starting tiny HTTP server to host A's exports/ on a free local port"
node --input-type=module > "$SERVER_LOG" 2>&1 <<EOF &
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
const server = http.createServer((req, res) => {
  const path = join('$EXPORTS', basename(req.url || ''));
  try {
    const buf = readFileSync(path);
    res.writeHead(200, {
      'Content-Type': req.url.endsWith('.sig') ? 'application/octet-stream' : 'application/gzip',
      'Content-Length': buf.length,
    });
    res.end(buf);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, () => { console.log('[smoke-server] port=' + server.address().port); });
EOF
echo $! > "$SERVER_PID_FILE"

# Wait until the server prints its port.
PORT=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  PORT=$(grep -o 'port=[0-9]*' "$SERVER_LOG" 2>/dev/null | head -n1 | cut -d= -f2 || true)
  [ -n "$PORT" ] && break
  sleep 0.3
done
[ -n "$PORT" ] || { cat "$SERVER_LOG"; fail "smoke HTTP server didn't start within 3s"; }

URL="http://localhost:$PORT/$(basename "$TARFILE")"
step "archive served at $URL"

step "enqueueing import on B (importer = importer-bear)"
node --input-type=module <<EOF
import { openDb } from '$ROOT/src/db/index.js';
import { enqueueSubImport } from '$ROOT/src/archive/import-queue.js';
const db = openDb('$B_DB');
const IMPORTER = 'c'.repeat(64);
db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(IMPORTER, 'importer-bear', Date.now());
enqueueSubImport(db, { sourceUrl: '$URL', requestedBy: IMPORTER });
console.log('[smoke] enqueued import on B for source ' + '$URL');
EOF

step "running import worker on B (off-peak gate disabled)"
IMPORT_OFFPEAK_DISABLE=1 \
DB_PATH=$B_DB \
POSTS_DIR=$B_POSTS \
node "$ROOT/bin/run-import-queue.js"

step "verifying B's state matches expected"
node --input-type=module <<EOF
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb } from '$ROOT/src/db/index.js';
const db = openDb('$B_DB');
const IMPORTER = 'c'.repeat(64);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const sub = db.prepare('SELECT name, owner_handle, imported_from_url, imported_from_fingerprint, imported_at, imported_at_source FROM subs WHERE name = ?').get('lobby');
assert.ok(sub, 'sub //lobby is missing on B — import did not run');
assert.equal(sub.owner_handle, IMPORTER, 'importer is not the owner');
assert.equal(sub.imported_from_url, '$URL', 'imported_from_url not stored');
assert.match(sub.imported_from_fingerprint, /^sha256:[0-9a-f]{64}$/, 'fingerprint not in expected shape');
assert.ok(sub.imported_at > 0 && sub.imported_at_source > 0, 'imported timestamps not set');

const post = db.prepare('SELECT id, title, handle, score, file_path FROM posts WHERE id = ?').get('post0000000000aa');
assert.equal(post.title, 'first post');
assert.equal(post.handle, ALICE, 'archived alice handle should be inserted as synthetic');
assert.equal(post.score, 1.5, 'archived score not preserved');
assert.ok(existsSync(resolve('$B_POSTS', post.file_path.replace(/^posts\//, ''))), 'post .md not on disk under B_POSTS');

const comment = db.prepare('SELECT id, handle FROM comments WHERE id = ?').get('comm0000000000bb');
assert.ok(comment, 'comment missing on B');
assert.equal(comment.handle, BOB, 'archived bob handle should be inserted');

const action = db.prepare('SELECT action, imported_from_fingerprint FROM mod_actions WHERE id = ?').get('mod00000000000cc');
assert.equal(action.action, 'collapse');
assert.match(action.imported_from_fingerprint, /^sha256:/, '[imported] tag fingerprint not on mod action');

const aliceImported = db.prepare('SELECT pseudonym, imported_from_fingerprint FROM handles WHERE handle = ?').get(ALICE);
assert.equal(aliceImported.pseudonym, 'alice-tiger', 'pseudonym should be preserved verbatim (no collision in this run)');
assert.match(aliceImported.imported_from_fingerprint, /^sha256:/, 'imported handle missing fingerprint');

console.log('[smoke] B verified ✓ sub=//lobby owner=importer-bear posts=1 comments=1 mod_actions=1 imported=true');
EOF

step "idempotence: re-importing the same URL must fail with 'already imported'"
node --input-type=module <<EOF
import { openDb } from '$ROOT/src/db/index.js';
import { enqueueSubImport } from '$ROOT/src/archive/import-queue.js';
const db = openDb('$B_DB');
enqueueSubImport(db, { sourceUrl: '$URL', requestedBy: 'c'.repeat(64) });
EOF

WORKER_OUT=$(IMPORT_OFFPEAK_DISABLE=1 DB_PATH=$B_DB POSTS_DIR=$B_POSTS \
  node "$ROOT/bin/run-import-queue.js" 2>&1 || true)
echo "$WORKER_OUT" | grep -q 'already imported' \
  || fail "second import should have surfaced 'already imported', got: $WORKER_OUT"
step "idempotence verified ✓ (worker reported: $(echo "$WORKER_OUT" | grep -o 'already imported as[^"]*' | head -n1))"

echo
echo "==> [smoke] M7 round-trip OK: export → host → import → verify → idempotent"
echo "    (pseudonym bracket-on-collision is covered by importSubArchive unit test)"
