#!/usr/bin/env node
// Daily OpenTimestamps upgrade worker (M7/B6).
//
// At export time, the export-queue worker runs `ots stamp` on each
// archive's .tar.gz. The proof it writes is "calendar-pending": valid
// today (the OTS calendar servers attest the archive existed at this
// hash by this time), but the Bitcoin block attestation hasn't been
// merged in locally yet. After ~6 confirmations (~1 hour to a day),
// running `ots upgrade` against the proof file folds in the actual
// Bitcoin Merkle path, making it self-contained — no calendar lookup
// needed to verify.
//
// This worker walks the exports/ tree and runs `ots upgrade` on every
// .ots file. The signal that an upgrade actually happened is the
// file's sha256 changing — when the calendar's Bitcoin attestation
// gets merged in, the bytes change. We don't parse the proof binary
// format; the bytes-changed signal is sufficient.
//
// Idempotent: already-upgraded proofs are no-ops. Safe to run any
// frequency. Default cron: once a day. Suggested:
//   30 4 * * * cd /opt/plato && node bin/run-ots-upgrade.js >> /var/log/plato-ots-upgrade.log 2>&1
//
// Same gracious failure posture as `ots stamp`: if the binary is
// missing (operator hasn't opted in) or the calendar is unreachable,
// the worker logs and exits 0. Other workers / pages keep working.

import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { upgradeFile } from '../src/archive/timestamp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const EXPORTS_DIR = process.env.EXPORTS_DIR ?? resolve(ROOT, 'exports');

if (!existsSync(EXPORTS_DIR)) {
  console.log(`[ots-upgrade] no exports dir at ${EXPORTS_DIR} — nothing to do`);
  process.exit(0);
}

const proofs = readdirSync(EXPORTS_DIR)
  .filter((f) => f.endsWith('.tar.gz.ots'))
  .map((f) => resolve(EXPORTS_DIR, f));

if (proofs.length === 0) {
  console.log('[ots-upgrade] no .ots proofs to upgrade');
  process.exit(0);
}

let upgraded = 0;
let skipped = 0;
let errored = 0;

for (const p of proofs) {
  const before = sha256OfFile(p);
  const result = await upgradeFile(p);
  if (result.error) {
    // ENOENT (binary missing) is the most common case for operators
    // who haven't installed ots-cli — the .ots files are stamps from
    // a previous install, or someone copied them in by hand. Either
    // way, log once per file and continue.
    errored++;
    console.log(`[ots-upgrade] ${basename(p)}: ${result.error}`);
    continue;
  }
  const after = sha256OfFile(p);
  if (before !== after) {
    upgraded++;
    console.log(`[ots-upgrade] ${basename(p)}: anchored (proof changed ${before.slice(0, 8)} → ${after.slice(0, 8)})`);
  } else {
    skipped++;
  }
}

console.log(`[ots-upgrade] done: ${upgraded} anchored, ${skipped} pending/already-anchored, ${errored} errored, ${proofs.length} total`);

function sha256OfFile(path) {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}
