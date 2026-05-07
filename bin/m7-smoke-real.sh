#!/usr/bin/env bash
# Real-instance end-to-end smoke for the M7 export → import round-trip.
#
# Spins up two actual `bin/server.js` instances on free ports with
# distinct DBs and KNOWLESS_SECRETs, drives the full HTTP surface
# (POST /login → magic link via dev-stderr → GET /auth/callback,
# POST /sub/<name>/export-request, GET /memlog scrape, POST /sub/import,
# GET /sub/<name> on the importer side), and runs the real cron worker
# scripts in between.
#
# Complements bin/m7-smoke.sh, which exercises the same worker pipeline
# but mocks the HTTP layer with a throwaway file server.
#
# Usage: bin/m7-smoke-real.sh
# Exits 0 on success; non-zero with a clear FAIL line and dumps both
# server logs on failure. Cleans up tmpdir + spawned servers on exit.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"  # so the inline node ESM imports below can use repo-relative paths.
TMP=$(mktemp -d -t plato-m7-real.XXXXXX)

A_DB=$TMP/a.db ; A_KN=$TMP/a-knowless.db ; A_POSTS=$TMP/a-posts ; A_EXPORTS=$TMP/a-exports ; A_LOG=$TMP/a.log ; A_PID_FILE=$TMP/a.pid
B_DB=$TMP/b.db ; B_KN=$TMP/b-knowless.db ; B_POSTS=$TMP/b-posts ; B_EXPORTS=$TMP/b-exports ; B_LOG=$TMP/b.log ; B_PID_FILE=$TMP/b.pid
A_JAR=$TMP/a.jar ; B_JAR=$TMP/b.jar
mkdir -p "$A_POSTS" "$B_POSTS" "$A_EXPORTS" "$B_EXPORTS"

# Distinct per-instance secrets. Same email → different handles across
# A and B, exactly as a real fork pair would behave.
A_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
B_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')

ALICE_EMAIL=alice@a.test
IMPORTER_EMAIL=importer@b.test

cleanup() {
  for f in "$A_PID_FILE" "$B_PID_FILE"; do
    [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

step() { echo; echo "==> [real-smoke] $*"; }
fail() {
  echo
  echo "FAIL: $*" >&2
  if [ -f "$A_LOG" ]; then echo "--- A log (tail) ---" >&2; tail -n 60 "$A_LOG" >&2; fi
  if [ -f "$B_LOG" ]; then echo "--- B log (tail) ---" >&2; tail -n 60 "$B_LOG" >&2; fi
  exit 1
}

free_port() {
  node -e 'const s=require("net").createServer().listen(0,()=>{process.stdout.write(String(s.address().port));s.close();})'
}

step "tmp=$TMP"
step "applying migrations to A and B"
DB_PATH=$A_DB node "$ROOT/bin/migrate.js" > /dev/null
DB_PATH=$B_DB node "$ROOT/bin/migrate.js" > /dev/null

# Pre-derive alice's handle on A so we can seed //lobby with her as
# owner. Knowless's deriveHandle is deterministic on (normalized email,
# secret), so the handle that results from her real magic-link login
# matches what we pre-seed here.
step "deriving alice's handle on A"
ALICE_HANDLE=$(A_SECRET=$A_SECRET ALICE_EMAIL=$ALICE_EMAIL node --input-type=module -e "
  import { deriveHandle, normalize } from 'knowless';
  process.stdout.write(deriveHandle(normalize(process.env.ALICE_EMAIL), process.env.A_SECRET));
")
[ ${#ALICE_HANDLE} -eq 64 ] || fail "alice handle derivation produced ${#ALICE_HANDLE} chars (expected 64)"
step "alice handle on A = ${ALICE_HANDLE:0:16}…"

step "seeding A: alice + bob handles, //lobby (alice owner), 1 post, 1 comment, 1 mod action"
A_DB=$A_DB A_POSTS=$A_POSTS ALICE_HANDLE=$ALICE_HANDLE node --input-type=module <<'EOF'
import { openDb } from './src/db/index.js';
import { writeFileSync } from 'node:fs';
const db = openDb(process.env.A_DB);
const ALICE = process.env.ALICE_HANDLE;
const BOB = 'b'.repeat(64);
const now = Date.now();
db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(ALICE, 'alice-tiger', now);
db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(BOB, 'bob-otter', now);
db.prepare('INSERT INTO subs (name, description, owner_handle, created_at) VALUES (?, ?, ?, ?)').run('lobby', 'real-smoke sub', ALICE, now);
db.prepare('INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, ?)').run('lobby', ALICE, 'owner');
const body = '---\ntitle: "first post"\nhandle: ' + ALICE + '\nsub_name: lobby\ncreated_at: ' + now + '\n---\n\nhello world from alice (real-smoke)\n';
writeFileSync(process.env.A_POSTS + '/post01.md', body);
db.prepare('INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score) VALUES (?, ?, ?, ?, ?, ?, ?)').run('post0000000000aa', 'lobby', ALICE, 'first post', 'posts/post01.md', now, 1.5);
db.prepare('INSERT INTO comments (id, post_id, handle, body, created_at, score) VALUES (?, ?, ?, ?, ?, ?)').run('comm0000000000bb', 'post0000000000aa', BOB, 'top reply from bob', now, 0.5);
db.prepare('INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('mod00000000000cc', 'lobby', ALICE, 'collapse', 'comment', 'comm0000000000bb', 'noisy', now);
EOF

A_PORT=$(free_port)
B_PORT=$(free_port)

# Common server env. SMTP points at 127.0.0.1:1 (no listener → ECONNREFUSED
# instantly), which makes knowless fall through to the DEV_LOG_LINKS path
# and print magic links to stderr. KNOWLESS_COOKIE_SECURE=false because
# we serve plain HTTP on localhost.
spawn_instance() {
  local label=$1 port=$2 db=$3 kn=$4 secret=$5 posts=$6 exports=$7 logfile=$8 pidfile=$9
  PORT=$port \
  DB_PATH=$db \
  KNOWLESS_DB_PATH=$kn \
  KNOWLESS_SECRET=$secret \
  KNOWLESS_BASE_URL=http://localhost:$port \
  KNOWLESS_FROM=auth-$label@forum.local \
  KNOWLESS_DEV_LOG_LINKS=true \
  KNOWLESS_COOKIE_SECURE=false \
  KNOWLESS_SMTP_HOST=127.0.0.1 \
  KNOWLESS_SMTP_PORT=1 \
  KNOWLESS_MAX_NEW_HANDLES_PER_IP_PER_HOUR=1000 \
  KNOWLESS_MAX_LOGIN_REQUESTS_PER_IP_PER_HOUR=1000 \
  EXPORTS_DIR=$exports \
  POSTS_DIR=$posts \
  node "$ROOT/bin/server.js" > "$logfile" 2>&1 &
  echo $! > "$pidfile"
}

step "spawning instance A on :$A_PORT"
spawn_instance a "$A_PORT" "$A_DB" "$A_KN" "$A_SECRET" "$A_POSTS" "$A_EXPORTS" "$A_LOG" "$A_PID_FILE"
step "spawning instance B on :$B_PORT"
spawn_instance b "$B_PORT" "$B_DB" "$B_KN" "$B_SECRET" "$B_POSTS" "$B_EXPORTS" "$B_LOG" "$B_PID_FILE"

wait_ready() {
  local url=$1
  for _ in $(seq 1 50); do
    if curl -sSf -o /dev/null "$url/robots.txt" 2>/dev/null; then return 0; fi
    sleep 0.1
  done
  return 1
}
wait_ready "http://localhost:$A_PORT" || fail "instance A didn't come up within 5s"
wait_ready "http://localhost:$B_PORT" || fail "instance B didn't come up within 5s"
step "both instances up (A=$A_PORT, B=$B_PORT)"

# POST /login → grep stderr log for the just-printed magic link → GET it
# with the cookie jar, following the post-callback redirect to /. After
# this, $jar holds an authenticated session for $email on $base.
login_via_magic_link() {
  local label=$1 base=$2 email=$3 jar=$4 logfile=$5
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" \
    -c "$jar" -b "$jar" \
    -d "email=$email" \
    "$base/login")
  [ "$code" = "200" ] || { echo "POST /login on $label → $code"; return 1; }
  # The stderr line is written synchronously inside the failure-catch
  # before the response is sent, so it's already in $logfile by now.
  # One short retry loop in case of OS-level flush delay.
  local link=""
  for _ in 1 2 3 4 5; do
    link=$(grep -oE "http://localhost:${base##*:}/auth/callback\?t=[A-Za-z0-9._-]+" "$logfile" | tail -n1 || true)
    [ -n "$link" ] && break
    sleep 0.1
  done
  [ -n "$link" ] || { echo "no magic link found in $logfile"; return 1; }
  curl -sS -o /dev/null -L -c "$jar" -b "$jar" "$link"
}

step "alice logs in on A"
login_via_magic_link a "http://localhost:$A_PORT" "$ALICE_EMAIL" "$A_JAR" "$A_LOG" \
  || fail "alice login on A failed"
ROOT_HTML=$(curl -sS -b "$A_JAR" "http://localhost:$A_PORT/")
echo "$ROOT_HTML" | grep -q 'alice-tiger' \
  || fail "alice's session on A didn't stick (no pseudonym on /; check that pre-seeded handle matched derived one)"
step "alice's session on A is live"

step "POST /sub/lobby/export-request as alice — expecting 302 to /memlog"
EXP_HTTP=$(curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  -b "$A_JAR" -X POST -d '' \
  "http://localhost:$A_PORT/sub/lobby/export-request")
EXP_CODE=$(echo "$EXP_HTTP" | awk '{print $1}')
[ "$EXP_CODE" = "302" ] || fail "/sub/lobby/export-request returned $EXP_CODE, expected 302 (mod gate broken? auth not sticky?)"

step "running export worker on A (off-peak gate disabled)"
EXPORT_OFFPEAK_DISABLE=1 \
DB_PATH=$A_DB \
POSTS_DIR=$A_POSTS \
EXPORTS_DIR=$A_EXPORTS \
node "$ROOT/bin/run-export-queue.js" > "$TMP/exp-worker.log" 2>&1 \
  || { cat "$TMP/exp-worker.log"; fail "export worker failed"; }

DISK_TAR=$(ls "$A_EXPORTS"/*.tar.gz 2>/dev/null | head -n1)
[ -f "$DISK_TAR" ] || fail "export worker did not produce .tar.gz"
[ -f "${DISK_TAR}.sig" ] || fail "export worker did not produce .tar.gz.sig"

step "GET /memlog as alice — finding the chain-of-custody go-link"
MEMLOG_HTML=$(curl -sS -b "$A_JAR" "http://localhost:$A_PORT/memlog")
echo "$MEMLOG_HTML" > "$TMP/memlog.html"
GO_PATH=$(echo "$MEMLOG_HTML" | grep -oE '/memlog/go/[0-9]+' | head -n1 || true)
[ -n "$GO_PATH" ] || { cat "$TMP/memlog.html"; fail "/memlog does not contain a /memlog/go/<id> link"; }

step "GET $GO_PATH to resolve the bearer-token download URL"
# The go-link 302s to /export/<token>.tar.gz. Capture the Location header
# without following it, so we have the canonical bearer URL to hand to
# instance B.
DL_URL=$(curl -sS -o /dev/null -w "%{redirect_url}" \
  -b "$A_JAR" "http://localhost:$A_PORT$GO_PATH")
echo "$DL_URL" | grep -qE '/export/[a-f0-9]+\.tar\.gz$' \
  || fail "/memlog/go/* did not redirect to an /export/<token>.tar.gz URL (got: $DL_URL)"
step "download URL = $DL_URL"

step "GET <download URL> token-bearer (no cookie) — bytes must match disk"
curl -sSf -o "$TMP/copy.tar.gz" "$DL_URL"
DISK_SIZE=$(wc -c < "$DISK_TAR" | tr -d ' ')
HTTP_SIZE=$(wc -c < "$TMP/copy.tar.gz" | tr -d ' ')
[ "$HTTP_SIZE" = "$DISK_SIZE" ] || fail "downloaded bytes ($HTTP_SIZE) != on-disk bytes ($DISK_SIZE)"

step "importer logs in on B"
login_via_magic_link b "http://localhost:$B_PORT" "$IMPORTER_EMAIL" "$B_JAR" "$B_LOG" \
  || fail "importer login on B failed"
# A logged-in session on B has a "log out" link in the chrome — anon doesn't.
B_ROOT=$(curl -sS -b "$B_JAR" "http://localhost:$B_PORT/")
echo "$B_ROOT" | grep -qiE 'log[ -]?out' \
  || fail "importer's session on B didn't stick (no log-out link rendered)"

step "POST /sub/import on B with A's URL — expecting 302 to /memlog"
IMP_HTTP=$(curl -sS -o "$TMP/imp.html" -w "%{http_code}\n" \
  -b "$B_JAR" -X POST \
  --data-urlencode "sourceUrl=$DL_URL" \
  "http://localhost:$B_PORT/sub/import")
[ "$IMP_HTTP" = "302" ] || { cat "$TMP/imp.html"; fail "/sub/import returned $IMP_HTTP, expected 302"; }

step "running import worker on B (off-peak gate disabled)"
IMPORT_OFFPEAK_DISABLE=1 \
DB_PATH=$B_DB \
POSTS_DIR=$B_POSTS \
node "$ROOT/bin/run-import-queue.js" > "$TMP/imp-worker.log" 2>&1 \
  || { cat "$TMP/imp-worker.log"; fail "import worker failed"; }

step "GET /sub/lobby on B — verify imported banner + post visible"
SUB_HTML=$(curl -sS -b "$B_JAR" "http://localhost:$B_PORT/sub/lobby")
echo "$SUB_HTML" | grep -qi 'imported' \
  || fail "/sub/lobby on B is missing the imported banner"
echo "$SUB_HTML" | grep -q 'first post' \
  || fail "/sub/lobby on B does not show the imported post"

step "GET /sub/lobby/modlog on B — verify [imported] tag rendered"
MODLOG=$(curl -sS -b "$B_JAR" "http://localhost:$B_PORT/sub/lobby/modlog")
echo "$MODLOG" | grep -qi 'imported' \
  || fail "/sub/lobby/modlog on B does not render the [imported] tag"

step "idempotence: re-POST /sub/import with the same URL on B"
curl -sS -o /dev/null -b "$B_JAR" -X POST \
  --data-urlencode "sourceUrl=$DL_URL" \
  "http://localhost:$B_PORT/sub/import"
IMPORT_OFFPEAK_DISABLE=1 \
DB_PATH=$B_DB \
POSTS_DIR=$B_POSTS \
node "$ROOT/bin/run-import-queue.js" > "$TMP/imp2.log" 2>&1 || true
grep -q 'already imported' "$TMP/imp2.log" \
  || fail "second import did not surface 'already imported'; saw: $(cat "$TMP/imp2.log")"
step "idempotence verified ($(grep -o 'already imported as[^\"]*' "$TMP/imp2.log" | head -n1))"

echo
echo "==> [real-smoke] full HTTP round-trip OK on real bin/server.js instances"
echo "    (A=$A_PORT, B=$B_PORT, both shut down on exit)"
