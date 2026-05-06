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
  claimNextPendingJob, completeJob, failJob, pruneExpiredJobs, newDownloadToken,
} from '../src/archive/queue.js';
import { buildSubArchiveBytes, archiveFilenameFor } from '../src/archive/sub-export.js';

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

// House-keeping: prune expired download artifacts before doing new work.
const expiredFiles = pruneExpiredJobs(db);
for (const f of expiredFiles) {
  const p = resolve(EXPORTS_DIR, f);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch (err) { console.warn(`[export-queue] prune: failed to unlink ${p}: ${err.message}`); }
  }
}
if (expiredFiles.length > 0) console.log(`[export-queue] pruned ${expiredFiles.length} expired archive(s)`);

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
  if (job.kind !== 'sub') throw new Error(`unsupported job kind: ${job.kind}`);
  const exportedAt = new Date();
  const tarBytes = buildSubArchiveBytes(db, job.scope, {
    postsDir: POSTS_DIR,
    branding,
    platoVersion,
    exportedAt,
  });
  const gz = gzipSync(tarBytes);
  const filename = archiveFilenameFor(job.scope, exportedAt);
  mkdirSync(EXPORTS_DIR, { recursive: true });
  writeFileSync(resolve(EXPORTS_DIR, filename), gz);
  const token = newDownloadToken();
  completeJob(db, job.id, {
    archiveFilename: filename,
    archiveSizeBytes: gz.length,
    downloadToken: token,
  });
  console.log(`[export-queue] done job=${job.id} file=${filename} size=${gz.length} token=${token.slice(0, 8)}…`);
} catch (err) {
  const result = failJob(db, job.id, { errorMessage: err.message });
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
