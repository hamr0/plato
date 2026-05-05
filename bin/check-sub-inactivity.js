#!/usr/bin/env node
// Daily inactivity sweep — see PRD §Sub Lifecycle.
//
// Walks every active sub and auto-disables any whose mods (owner + co-
// mods) have been silent for >30 days, measured as the latest of: any
// post, comment, or mod_action by any current mod in that sub.
//
// Triggered actions write a synthetic mod_actions row (action=
// auto_disable_inactivity, mod_handle=SYSTEM_HANDLE) so the transition
// is visible in the public modlog. The sub becomes read-only — content
// stays viewable, no new posts/comments/votes/flags until a current mod
// reactivates via /sub/<name>/edit. If no mods remain (e.g. step-down
// without successor), the sub is permanently read-only and members
// migrate by forking. Operators do NOT have a recipe to reassign mods.
//
// Wire via system cron:
//   15 5 * * * cd /opt/plato && node bin/check-sub-inactivity.js >> /var/log/plato-inactivity.log 2>&1
//
// --dry-run lists the subs that *would* be disabled without writing.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/index.js';
import { runInactivitySweep, lastModActivity, SUB_INACTIVITY_THRESHOLD_MS } from '../src/content/mod.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FORUM_DB = process.env.DB_PATH ?? resolve(ROOT, 'forum.db');
const dryRun = process.argv.includes('--dry-run');

const now = Date.now();
const db = openDb(FORUM_DB);

try {
  if (dryRun) {
    const cutoff = now - SUB_INACTIVITY_THRESHOLD_MS;
    const candidates = db.prepare('SELECT name FROM subs WHERE disabled_at IS NULL').all();
    const would = [];
    for (const { name } of candidates) {
      const last = lastModActivity(db, name);
      if (last == null) continue;
      if (last < cutoff) would.push({ name, last });
    }
    if (would.length === 0) {
      console.log('inactivity sweep (dry-run): no subs would be disabled');
    } else {
      console.log(`inactivity sweep (dry-run): would disable ${would.length} sub(s):`);
      for (const w of would) {
        console.log(`  - //${w.name} (last mod activity: ${new Date(w.last).toISOString()})`);
      }
    }
  } else {
    const disabled = runInactivitySweep(db, { now });
    if (disabled.length === 0) {
      console.log(`[${new Date(now).toISOString()}] inactivity sweep: no subs disabled`);
    } else {
      console.log(`[${new Date(now).toISOString()}] inactivity sweep: ${disabled.length} sub(s) → read-only:`);
      for (const name of disabled) console.log(`  - //${name}`);
    }
  }
} finally {
  db.close();
}
