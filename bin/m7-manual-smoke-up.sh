#!/usr/bin/env bash
# Stage + launch the M7 manual-smoke instance pair.
#
# Spawns two `bin/server.js` processes in the background:
#   A  http://localhost:8081  source instance (seeded with //lobby + //bytes)
#   B  http://localhost:8082  destination instance (empty, fresh DB)
#
# Re-run is idempotent: any previous pair is killed first, /tmp dirs are
# wiped and re-staged, fresh secrets generated. Logs (incl. magic-link
# URLs from KNOWLESS_DEV_LOG_LINKS=true) are tailed live to whichever
# terminal called this script — `tail -f /tmp/plato-manual-smoke/{a,b}.log`
# also works.
#
# Tear down with `bin/m7-manual-smoke-down.sh`.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

ROOT_TMP=/tmp/plato-manual-smoke
A_PORT=8081
B_PORT=8082

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
muted() { printf '\033[2m%s\033[0m\n' "$*"; }

# 1. tear down any previous run.
if [ -f "$ROOT_TMP/a.pid" ]; then kill "$(cat "$ROOT_TMP/a.pid")" 2>/dev/null || true; fi
if [ -f "$ROOT_TMP/b.pid" ]; then kill "$(cat "$ROOT_TMP/b.pid")" 2>/dev/null || true; fi
# Belt-and-suspenders: kill anything already on these ports too.
for p in "$A_PORT" "$B_PORT"; do
  pid=$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)
  [ -n "$pid" ] && kill $pid 2>/dev/null || true
done
rm -rf "$ROOT_TMP"

# 2. stage dirs + secrets.
mkdir -p "$ROOT_TMP"/a/posts "$ROOT_TMP"/a/exports "$ROOT_TMP"/b/posts "$ROOT_TMP"/b/exports
node -e 'const c=require("crypto");process.stdout.write("export A_SECRET="+c.randomBytes(32).toString("hex")+"\nexport B_SECRET="+c.randomBytes(32).toString("hex")+"\n")' \
  > "$ROOT_TMP/secrets.env"
# shellcheck disable=SC1091
source "$ROOT_TMP/secrets.env"

# 3. migrate both DBs.
DB_PATH="$ROOT_TMP/a/forum.db" node bin/migrate.js > /dev/null
DB_PATH="$ROOT_TMP/b/forum.db" node bin/migrate.js > /dev/null

# 4. seed instance A — //lobby (alice mod), //bytes (bob mod), 4 posts,
# 2 comments, 1 mod action. Realistic-enough surface for the eyeball
# checklist (5-state pill, modlog [imported] tag after round-trip, etc).
A_SECRET="$A_SECRET" ROOT_TMP="$ROOT_TMP" node --input-type=module <<'EOF' >/dev/null
import { openDb } from './src/db/index.js';
import { deriveHandle, normalize } from 'knowless';
import { writeFileSync } from 'node:fs';
const ROOT_TMP = process.env.ROOT_TMP;
const A_SECRET = process.env.A_SECRET;
const ALICE = deriveHandle(normalize('alice@manual-smoke.test'), A_SECRET);
const BOB   = deriveHandle(normalize('bob@manual-smoke.test'),   A_SECRET);
const db = openDb(`${ROOT_TMP}/a/forum.db`);
const now = Date.now(), HOUR = 3600_000, DAY = 86_400_000;
db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?,?,?)').run(ALICE, 'alice-tiger', now - 70*DAY);
db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?,?,?)').run(BOB,   'bob-otter',   now - 70*DAY);
db.prepare('INSERT INTO subs (name, description, owner_handle, created_at) VALUES (?,?,?,?)').run('lobby', 'general chitchat — the smoke-test sub', ALICE, now - 70*DAY);
db.prepare('INSERT INTO sub_mods (sub_name, handle, role) VALUES (?,?,?)').run('lobby', ALICE, 'owner');
db.prepare('INSERT INTO subs (name, description, owner_handle, created_at) VALUES (?,?,?,?)').run('bytes', 'small fun things', BOB, now - 60*DAY);
db.prepare('INSERT INTO sub_mods (sub_name, handle, role) VALUES (?,?,?)').run('bytes', BOB, 'owner');
const post = (id, sub, h, title, body, ageH, score) => {
  const ts = now - ageH*HOUR, fp = `posts/${id}.md`;
  writeFileSync(`${ROOT_TMP}/a/${fp}`, `---\ntitle: "${title}"\nhandle: ${h}\nsub_name: ${sub}\ncreated_at: ${ts}\n---\n\n${body}\n`);
  db.prepare('INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score) VALUES (?,?,?,?,?,?,?)').run(id, sub, h, title, fp, ts, score);
};
post('1a01000000000001','lobby',ALICE,'welcome to //lobby','make a fake account and poke around.',4,3.2);
post('1a02000000000002','lobby',BOB,  'a question about archives','how do you trust bytes once they leave the source instance?',12,1.7);
post('1a03000000000003','lobby',ALICE,'sticky: posting tips','use markdown. links are link-only. images are not embedded.',48,0.4);
post('1b01000000000001','bytes',BOB,  'tiny static-site generators','list of sub-1k LOC tools.',3,0.9);
db.prepare('INSERT INTO comments (id, post_id, handle, body, created_at, score) VALUES (?,?,?,?,?,?)').run('c0010000000a0001','1a01000000000001',BOB,  'hello! glad to be here.',now - 3*HOUR,0.6);
db.prepare('INSERT INTO comments (id, post_id, handle, body, created_at, score) VALUES (?,?,?,?,?,?)').run('c0010000000a0002','1a02000000000002',ALICE,'cryptographic answer: the .sig sibling. sociological: trust the URL.',now - 11*HOUR,0.4);
db.prepare('INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?,?)').run('m0010000000a0001','lobby',ALICE,'collapse','comment','c0010000000a0001','low signal',now - 2*HOUR);
EOF

# 5. spawn A and B in the background. Each instance writes its own log;
# stderr (incl. magic-link URLs from KNOWLESS_DEV_LOG_LINKS=true) is in
# there. nohup detaches from this shell so closing the launcher
# terminal doesn't kill them.
spawn() {
  local label=$1 port=$2 secret=$3
  local dir=$ROOT_TMP/$label
  PORT=$port \
  DB_PATH=$dir/forum.db \
  KNOWLESS_DB_PATH=$dir/knowless.db \
  KNOWLESS_SECRET=$secret \
  KNOWLESS_BASE_URL=http://localhost:$port \
  KNOWLESS_FROM=auth-$label@manual-smoke.local \
  KNOWLESS_DEV_LOG_LINKS=true \
  KNOWLESS_COOKIE_SECURE=false \
  KNOWLESS_SMTP_HOST=127.0.0.1 \
  KNOWLESS_SMTP_PORT=1 \
  KNOWLESS_MAX_NEW_HANDLES_PER_IP_PER_HOUR=1000 \
  KNOWLESS_MAX_LOGIN_REQUESTS_PER_IP_PER_HOUR=1000 \
  EXPORTS_DIR=$dir/exports \
  POSTS_DIR=$dir/posts \
  nohup node "$ROOT/bin/server.js" >> "$ROOT_TMP/$label.log" 2>&1 &
  echo $! > "$ROOT_TMP/$label.pid"
}
spawn a "$A_PORT" "$A_SECRET"
spawn b "$B_PORT" "$B_SECRET"

# 6. wait for both /robots.txt to come up.
wait_ready() {
  local url=$1 label=$2
  for _ in $(seq 1 50); do
    if curl -sSf -o /dev/null "$url/robots.txt" 2>/dev/null; then return 0; fi
    sleep 0.1
  done
  echo "FAIL: $label didn't come up; tail of log:" >&2
  tail -n 30 "$ROOT_TMP/$label.log" >&2
  return 1
}
wait_ready "http://localhost:$A_PORT" a
wait_ready "http://localhost:$B_PORT" b

# 7. print what to do next.
cat <<INFO

$(bold "manual-smoke pair is up:")
  A (source)      http://localhost:$A_PORT   (seeded: //lobby, //bytes)
  B (destination) http://localhost:$B_PORT   (empty)

$(bold "pre-seeded handles on A") (knowless secret is per-instance — same
emails on B will be different handles):
  alice@manual-smoke.test  → mod of //lobby
  bob@manual-smoke.test    → mod of //bytes

$(bold "logging in"): visit /login on either instance, submit any email.
SMTP is pointed at 127.0.0.1:1 (no listener) so knowless falls through
to the dev-stderr fallback and prints the magic link to the log file.
Watch live with:

  tail -f $ROOT_TMP/a.log $ROOT_TMP/b.log | grep -E 'magic link|silent-miss'

paste the printed http://localhost:$A_PORT/auth/callback?t=… URL into
your browser to land logged in.

$(bold "running the workers") (off-peak gate disabled):

  # after clicking 'request archive' on A
  EXPORT_OFFPEAK_DISABLE=1 \\
    DB_PATH=$ROOT_TMP/a/forum.db \\
    POSTS_DIR=$ROOT_TMP/a/posts \\
    EXPORTS_DIR=$ROOT_TMP/a/exports \\
    node bin/run-export-queue.js

  # after pasting an A export URL into /sub/create?mode=import on B
  IMPORT_OFFPEAK_DISABLE=1 \\
    DB_PATH=$ROOT_TMP/b/forum.db \\
    POSTS_DIR=$ROOT_TMP/b/posts \\
    node bin/run-import-queue.js

$(bold "tear down"):  bin/m7-manual-smoke-down.sh

$(muted "PIDs: A=$(cat "$ROOT_TMP/a.pid")  B=$(cat "$ROOT_TMP/b.pid")")
INFO
