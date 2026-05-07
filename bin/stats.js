#!/usr/bin/env node
// Daily counter snapshot. Appends one JSON line to data/stats.log:
//   {"snapshot_at":"2026-05-04T04:35:00Z","users":35,"subs":12,"posts":63,"comments":77,"votes":221}
//
// Append-only — never rewrites history. The weekly digest reads this log,
// groups by ISO week, and emails a fixed-width WoW table.
//
// Counters:
//   users    = knowless.db handles (anyone who's ever requested a magic link)
//   subs     = forum.db subs
//   posts    = forum.db posts (not removed)
//   comments = forum.db comments (not removed)
//   votes    = forum.db votes (cast votes; non-zero value rows)
//
// Wire via system cron:
//   35 4 * * * cd /opt/plato && node bin/stats.js >> /var/log/plato-stats.log 2>&1
//
// --dry-run prints the JSON line to stdout instead of appending.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FORUM_DB = process.env.DB_PATH ?? resolve(ROOT, 'forum.db');
const KNOWLESS_DB = process.env.KNOWLESS_DB_PATH ?? resolve(ROOT, 'knowless.db');
const STATS_LOG = process.env.PLATO_STATS_LOG ?? resolve(ROOT, 'data/stats.log');

const dryRun = process.argv.includes('--dry-run');

function count(dbPath, sql) {
  if (!existsSync(dbPath)) return 0;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).get().n;
  } finally {
    db.close();
  }
}

const snapshot = {
  snapshot_at: new Date().toISOString(),
  users: count(KNOWLESS_DB, 'SELECT COUNT(*) AS n FROM handles'),
  subs: count(FORUM_DB, 'SELECT COUNT(*) AS n FROM subs'),
  posts: count(FORUM_DB, "SELECT COUNT(*) AS n FROM posts WHERE removed_at IS NULL"),
  comments: count(FORUM_DB, "SELECT COUNT(*) AS n FROM comments WHERE removed_at IS NULL"),
  votes: count(FORUM_DB, "SELECT COUNT(*) AS n FROM votes"),
};

const line = JSON.stringify(snapshot) + '\n';

if (dryRun) {
  process.stdout.write(line);
} else {
  mkdirSync(dirname(STATS_LOG), { recursive: true });
  appendFileSync(STATS_LOG, line);
  console.log(`[stats] appended ${snapshot.snapshot_at}: users=${snapshot.users} subs=${snapshot.subs} posts=${snapshot.posts} comments=${snapshot.comments} votes=${snapshot.votes}`);
}
