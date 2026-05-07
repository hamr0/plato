#!/usr/bin/env node
// Off-peak export-queue worker (M7/B2-a).
//
// Wired via system cron, e.g.:
//   */15 * * * * cd /opt/plato && node bin/run-export-queue.js >> /var/log/plato-export.log 2>&1
//
// Picks one pending export job per tick, builds the archive, gzips it,
// writes it to ./exports/, and updates the row. On failure: re-queues for
// up to MAX_ATTEMPTS (3) attempts, then terminal-fails with the error
// message preserved on the row.
//
// Off-peak gating: by default, the worker only runs between 01:00 and
// 06:00 server time. Operators with idle VPS capacity can widen via
// EXPORT_OFFPEAK_START / EXPORT_OFFPEAK_END (hour integers, 0–23) or
// disable the gate entirely with EXPORT_OFFPEAK_DISABLE=1. Outside the
// window the script logs and exits cleanly so cron logs stay quiet.
//
// --once : process at most one job (default behavior)
// --dry-run : report the pending job without claiming or building.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db/index.js';
import {
  claimNextPendingJob, completeJob, failJob, pruneExpiredJobs,
  markStaleAsFailed, newDownloadToken,
} from '../src/archive/queue.js';
import { recordNotification } from '../src/content/notification.js';
import { buildSubArchiveBytes, archiveFilenameFor } from '../src/archive/sub-export.js';
import { buildUserArchiveBytes, userArchiveFilenameFor } from '../src/archive/user-export.js';
import { getOrCreateInstanceKeypair, signBytes } from '../src/archive/signing.js';
import { stampFile } from '../src/archive/timestamp.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FORUM_DB = process.env.DB_PATH ?? resolve(ROOT, 'forum.db');
const POSTS_DIR = process.env.POSTS_DIR ?? resolve(ROOT, 'posts');
const EXPORTS_DIR = process.env.EXPORTS_DIR ?? resolve(ROOT, 'exports');

const dryRun = process.argv.includes('--dry-run');
const startHour = clampHour(process.env.EXPORT_OFFPEAK_START, 1);
const endHour = clampHour(process.env.EXPORT_OFFPEAK_END, 6);
const offpeakDisabled = process.env.EXPORT_OFFPEAK_DISABLE === '1';

if (!offpeakDisabled && !inOffPeakWindow(new Date(), startHour, endHour)) {
  console.log(`[export-queue] outside off-peak window (${startHour}:00–${endHour}:00). exit.`);
  process.exit(0);
}

const platoVersion = readPackageVersion();
const branding = readBranding();

const db = openDb(FORUM_DB);

// Lazy-load (or create on first call) the instance Ed25519 keypair. Every
// archive built this tick carries the fingerprint in its manifest and a
// detached .tar.gz.sig signed with the privkey. M7/B4.
const instanceKey = getOrCreateInstanceKeypair(db);

// House-keeping: prune expired download artifacts before doing new work.
const expiredFiles = pruneExpiredJobs(db);
for (const f of expiredFiles) {
  const p = resolve(EXPORTS_DIR, f);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch (err) { console.warn(`[export-queue] prune: failed to unlink ${p}: ${err.message}`); }
  }
}
if (expiredFiles.length > 0) console.log(`[export-queue] pruned ${expiredFiles.length} expired archive(s)`);

// SLA sweep: terminal-fail jobs that have sat past their per-kind SLA
// window. Runs every tick so a job stuck in retry/queue forever doesn't
// linger. Each swept row gets an export_failed memlog notification so
// the user knows to re-request.
const swept = markStaleAsFailed(db);
for (const row of swept) {
  recordNotification(db, {
    recipientHandle: row.requested_by,
    kind: 'export_failed',
    subName: row.kind === 'sub' ? row.scope : null,
    targetType: 'export',
    targetId: row.id,
    snippet: row.error_message ?? 'archive could not be produced',
  });
}
if (swept.length > 0) {
  console.log(`[export-queue] SLA-swept ${swept.length} stale job(s)`);
}

const job = claimNextPendingJob(db);
if (!job) {
  console.log('[export-queue] no pending jobs.');
  process.exit(0);
}

if (dryRun) {
  console.log(`[export-queue] DRY-RUN: would build job=${job.id} kind=${job.kind} scope=${job.scope} attempt=${job.retry_count}`);
  // dry-run shouldn't claim — but claimNextPendingJob already incremented
  // retry_count and set started_at. Roll those back.
  db.prepare('UPDATE export_jobs SET started_at = NULL, retry_count = retry_count - 1 WHERE id = ?').run(job.id);
  process.exit(0);
}

console.log(`[export-queue] start job=${job.id} kind=${job.kind} scope=${job.scope} attempt=${job.retry_count}/3`);

try {
  const exportedAt = new Date();
  let tarBytes; let filename;
  if (job.kind === 'sub') {
    tarBytes = buildSubArchiveBytes(db, job.scope, {
      postsDir: POSTS_DIR, branding, platoVersion, exportedAt,
      pubkeyFingerprint: instanceKey.fingerprint,
    });
    filename = archiveFilenameFor(job.scope, exportedAt, { jobId: job.id });
  } else if (job.kind === 'user') {
    tarBytes = buildUserArchiveBytes(db, job.scope, {
      postsDir: POSTS_DIR, branding, platoVersion, exportedAt,
      pubkeyFingerprint: instanceKey.fingerprint,
    });
    filename = userArchiveFilenameFor(job.scope, exportedAt, { jobId: job.id });
  } else {
    throw new Error(`unsupported job kind: ${job.kind}`);
  }
  const gz = gzipSync(tarBytes);
  mkdirSync(EXPORTS_DIR, { recursive: true });
  writeFileSync(resolve(EXPORTS_DIR, filename), gz);
  // Detached signature over the gzipped bytes. Sibling file, same name
  // + .sig. Spec: docs/02-features/archive-format.md (Signing).
  const sig = signBytes(instanceKey.privateKey, gz);
  writeFileSync(resolve(EXPORTS_DIR, `${filename}.sig`), sig);
  // OpenTimestamps anchor (M7/B6). Best-effort: if `ots` CLI is missing
  // (operator hasn't opted in) or any calendar is down, log and proceed
  // — the export still ships .tar.gz + .sig regardless. The proof is
  // calendar-pending until bin/run-ots-upgrade.js refreshes it.
  const otsResult = await stampFile(resolve(EXPORTS_DIR, filename));
  if (otsResult.error) {
    console.log(`[export-queue] ots stamp skipped (${otsResult.error})`);
  } else {
    console.log(`[export-queue] ots stamp ok → ${filename}.ots (calendar-pending until next ots-upgrade)`);
  }
  const token = newDownloadToken();
  completeJob(db, job.id, {
    archiveFilename: filename,
    archiveSizeBytes: gz.length,
    downloadToken: token,
  });
  // Memlog: tell the requester the archive is ready, with snippet shape
  // "expires <YYYY-MM-DD>". The download URL is resolved by the memlog
  // renderer via the job's download_token (not stored on the notification
  // itself, so a future token rotation would invalidate cleanly).
  const completed = db.prepare('SELECT expires_at FROM export_jobs WHERE id = ?').get(job.id);
  const expiry = new Date(completed.expires_at).toISOString().slice(0, 10);
  recordNotification(db, {
    recipientHandle: job.requested_by,
    kind: 'export_ready',
    subName: job.kind === 'sub' ? job.scope : null,
    targetType: 'export',
    targetId: job.id,
    snippet: job.kind === 'sub'
      ? `archive of //${job.scope} ready · expires ${expiry}`
      : `your personal archive is ready · expires ${expiry}`,
  });
  console.log(`[export-queue] done job=${job.id} kind=${job.kind} file=${filename} size=${gz.length} token=${token.slice(0, 8)}…`);
} catch (err) {
  const result = failJob(db, job.id, { errorMessage: err.message });
  if (result === 'failed') {
    // Terminal: notify the user that retries are exhausted.
    recordNotification(db, {
      recipientHandle: job.requested_by,
      kind: 'export_failed',
      subName: job.kind === 'sub' ? job.scope : null,
      targetType: 'export',
      targetId: job.id,
      snippet: `archive request failed after 3 attempts: ${err.message}. you can request a new one anytime.`,
    });
  }
  console.error(`[export-queue] ${result} job=${job.id} attempt=${job.retry_count}: ${err.message}`);
  process.exit(1);
}

function clampHour(raw, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0 || n > 23) return fallback;
  return n;
}

function inOffPeakWindow(date, startHour, endHour) {
  const h = date.getHours();
  if (startHour === endHour) return false;
  if (startHour < endHour) return h >= startHour && h < endHour;
  // Wraps midnight (e.g. 22 → 4): early morning OR late evening.
  return h >= startHour || h < endHour;
}

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readBranding() {
  try {
    const cfg = JSON.parse(readFileSync(resolve(ROOT, 'config.json'), 'utf8'));
    return {
      forumName: cfg?.branding?.forumName ?? 'plato',
      baseUrl: cfg?.branding?.baseUrl ?? process.env.BASE_URL ?? '',
    };
  } catch {
    return { forumName: 'plato', baseUrl: process.env.BASE_URL ?? '' };
  }
}
