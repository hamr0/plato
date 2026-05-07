#!/usr/bin/env bash
# Seed a //bigstudio sub with 120 posts on the manual-smoke A instance,
# spread across two years (60 in 2025, 60 in 2026), so the per-sub
# archive crosses the 100-post pagination threshold.
#
# Pre-req: bin/m7-manual-smoke-up.sh has been run and instance A is up.
#
# After seeding:
#   1. log in as alice@manual-smoke.test on http://localhost:8081
#      (watch /tmp/plato-manual-smoke/a.log for the magic link)
#   2. visit /sub/bigstudio/manage → "request archive"
#   3. drain the queue:
#        EXPORT_OFFPEAK_DISABLE=1 \
#          DB_PATH=/tmp/plato-manual-smoke/a/forum.db \
#          POSTS_DIR=/tmp/plato-manual-smoke/a/posts \
#          EXPORTS_DIR=/tmp/plato-manual-smoke/a/exports \
#          node bin/run-export-queue.js
#   4. download from /memlog, extract, open index.html — should show
#      chips (posts (120, 2p) + 2025 (60) + 2026 (60)) and a recent
#      activity preview, with posts.html / 2025.html / 2026.html as
#      filtered subpages.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

ROOT_TMP=/tmp/plato-manual-smoke
if [ ! -f "$ROOT_TMP/a/forum.db" ]; then
  echo "instance A not staged at $ROOT_TMP/a — run bin/m7-manual-smoke-up.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT_TMP/secrets.env"

A_SECRET="$A_SECRET" ROOT_TMP="$ROOT_TMP" node --input-type=module <<'EOF' >/dev/null
import { openDb } from './src/db/index.js';
import { deriveHandle, normalize } from 'knowless';
import { writeFileSync } from 'node:fs';

const ROOT_TMP = process.env.ROOT_TMP;
const A_SECRET = process.env.A_SECRET;
const ALICE = deriveHandle(normalize('alice@manual-smoke.test'), A_SECRET);
const BOB   = deriveHandle(normalize('bob@manual-smoke.test'),   A_SECRET);
const db = openDb(`${ROOT_TMP}/a/forum.db`);

const exists = db.prepare('SELECT 1 FROM subs WHERE name = ?').get('bigstudio');
if (exists) {
  console.error('//bigstudio already seeded — skip.');
  process.exit(0);
}

const subCreatedAt = Date.UTC(2025, 0, 1);
db.prepare('INSERT INTO subs (name, description, owner_handle, created_at) VALUES (?,?,?,?)')
  .run('bigstudio', 'paginated-reader smoke fixture — 120 posts across 2 years', ALICE, subCreatedAt);
db.prepare('INSERT INTO sub_mods (sub_name, handle, role) VALUES (?,?,?)').run('bigstudio', ALICE, 'owner');

const ins = db.prepare(
  'INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score) VALUES (?,?,?,?,?,?,?)'
);
const postIds = [];
for (let i = 0; i < 120; i++) {
  const id = `bs${i.toString(16).padStart(14, '0')}`;
  // 60 in 2025-Jun, 60 in 2026-Jun — drives both year buckets.
  const year = i < 60 ? 2025 : 2026;
  const created = Date.UTC(year, 5, 1) + i * 60_000;
  const fp = `posts/bigstudio-${id}.md`;
  writeFileSync(
    `${ROOT_TMP}/a/${fp}`,
    `---\ntitle: "bigstudio post ${i + 1}"\nhandle: ${ALICE}\nsub_name: bigstudio\ncreated_at: ${created}\n---\n\nfiller body for post ${i + 1}.\n`,
  );
  ins.run(id, 'bigstudio', ALICE, `bigstudio post ${i + 1}`, fp, created, 0);
  postIds.push({ id, created });
}

// Threaded comments on the first 30 posts so the per-post HTML pages
// have something to render. Each post gets one bob top-level + one
// alice reply nested under it — exercises both flat and threaded
// rendering paths.
const cIns = db.prepare(
  'INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at, score) VALUES (?,?,?,?,?,?,0)'
);
let cN = 0;
for (let i = 0; i < 30; i++) {
  const { id: pid, created } = postIds[i];
  const top = `bsc${(cN++).toString(16).padStart(13, '0')}`;
  cIns.run(top, pid, null, BOB, `bob top-level take on post ${i + 1}.`, created + 60_000);
  const reply = `bsc${(cN++).toString(16).padStart(13, '0')}`;
  cIns.run(reply, pid, top, ALICE, `alice reply to bob's take.`, created + 120_000);
}
console.error(`seeded //bigstudio (120 posts + ${cN} comments across first 30, owner=alice).`);
EOF

cat <<DONE

//bigstudio is seeded on A. next steps:

  1. log in as alice@manual-smoke.test on http://localhost:8081
     (watch the magic link in /tmp/plato-manual-smoke/a.log)
  2. visit http://localhost:8081/sub/bigstudio/manage
  3. click "request archive"
  4. drain the queue:
       EXPORT_OFFPEAK_DISABLE=1 \\
         DB_PATH=$ROOT_TMP/a/forum.db \\
         POSTS_DIR=$ROOT_TMP/a/posts \\
         EXPORTS_DIR=$ROOT_TMP/a/exports \\
         node bin/run-export-queue.js
  5. download from /memlog, extract, open index.html. expect chips:
       posts (120, 2p) | 2025 (60) | 2026 (60)
     plus recent activity preview, plus posts.html (2 pages) and
     2025.html / 2026.html year filters.
DONE
