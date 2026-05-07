#!/usr/bin/env node
// Off-peak sub-import worker (M7/B5).
//
// Wired via system cron, e.g.:
//   */15 * * * * cd /opt/plato && node bin/run-import-queue.js >> /var/log/plato-import.log 2>&1
//
// Picks one pending import per tick during the off-peak window
// (defaults match the export worker — 01:00 to 06:00 server time, env
// IMPORT_OFFPEAK_START / IMPORT_OFFPEAK_END / IMPORT_OFFPEAK_DISABLE).
//
// Per-job flow:
//   1. Fetch source URL (HTTPS preferred). Refuse non-200, oversize.
//   2. Gunzip → tar buffer.
//   3. Parse + verify per-file SHA-256 (transit integrity).
//   4. Check idempotence — was this exact source archive already imported?
//   5. Open transaction; importSubArchive(); commit.
//   6. Emit memlog notification (import_ready or import_failed).
// Retry up to MAX_ATTEMPTS; SLA sweep terminal-fails stuck rows.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db/index.js';
import {
  claimNextPendingImport, completeImport, failImport,
  recordSourceMetadata, markStaleImportsAsFailed,
  findCompletedImportBySource,
} from '../src/archive/import-queue.js';
import { recordNotification } from '../src/content/notification.js';
import { parseAndVerifyArchive, importSubArchive } from '../src/archive/import.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FORUM_DB = process.env.DB_PATH ?? resolve(ROOT, 'forum.db');
const POSTS_DIR = process.env.POSTS_DIR ?? resolve(ROOT, 'posts');

// 500 MB default — matches the PRD lock for sub-import size cap. The
// fetch is rejected at Content-Length time and again as bytes accumulate
// so a server lying about Content-Length still hits the wall.
const MAX_ARCHIVE_BYTES = parseInt(process.env.IMPORT_MAX_BYTES ?? `${500 * 1024 * 1024}`, 10);
const FETCH_TIMEOUT_MS = parseInt(process.env.IMPORT_FETCH_TIMEOUT_MS ?? '120000', 10);

const dryRun = process.argv.includes('--dry-run');
const startHour = clampHour(process.env.IMPORT_OFFPEAK_START, 1);
const endHour = clampHour(process.env.IMPORT_OFFPEAK_END, 6);
const offpeakDisabled = process.env.IMPORT_OFFPEAK_DISABLE === '1';

if (!offpeakDisabled && !inOffPeakWindow(new Date(), startHour, endHour)) {
  console.log(`[import-queue] outside off-peak window (${startHour}:00–${endHour}:00). exit.`);
  process.exit(0);
}

const db = openDb(FORUM_DB);

const swept = markStaleImportsAsFailed(db);
for (const row of swept) {
  recordNotification(db, {
    recipientHandle: row.requested_by,
    kind: 'import_failed',
    subName: row.imported_sub_name ?? null,
    targetType: 'import',
    targetId: row.id,
    snippet: row.error_message ?? 'import could not complete',
  });
}
if (swept.length > 0) {
  console.log(`[import-queue] SLA-swept ${swept.length} stale job(s)`);
}

const job = claimNextPendingImport(db);
if (!job) {
  console.log('[import-queue] no pending jobs.');
  process.exit(0);
}

if (dryRun) {
  console.log(`[import-queue] DRY-RUN: would import job=${job.id} url=${job.source_url} attempt=${job.retry_count}`);
  db.prepare('UPDATE import_jobs SET started_at = NULL, retry_count = retry_count - 1 WHERE id = ?').run(job.id);
  process.exit(0);
}

console.log(`[import-queue] start job=${job.id} url=${job.source_url} attempt=${job.retry_count}/3`);

try {
  const gz = await fetchArchive(job.source_url);
  const tarBuf = gunzipSync(gz);
  const parsed = parseAndVerifyArchive(tarBuf);

  // Stamp manifest metadata onto the row regardless of what comes next —
  // useful for memlog rendering on a later failure, and for idempotence
  // checks if a partial run is retried.
  recordSourceMetadata(db, job.id, {
    sourceScopeSub: parsed.manifest.scope.sub,
    sourceExportedAt: parsed.manifest.exported_at,
    sourceFingerprint: parsed.manifest.instance.pubkey_fingerprint ?? null,
    sourceBaseUrl: parsed.manifest.instance.base_url ?? null,
    sourceForumName: parsed.manifest.instance.forum_name ?? null,
    archiveSizeBytes: gz.length,
  });

  // Idempotence: same archive identity already imported? Fail loud, but
  // tag the failure so the user sees "already imported as X" instead of
  // a generic error.
  const prior = findCompletedImportBySource(db, {
    sourceScopeSub: parsed.manifest.scope.sub,
    sourceExportedAt: parsed.manifest.exported_at,
  });
  if (prior) {
    throw new Error(`already imported as //${prior.imported_sub_name} on ${new Date(prior.completed_at).toISOString().slice(0, 10)}`);
  }

  // Transaction so partial imports don't leave the DB in a half-state.
  db.exec('BEGIN IMMEDIATE');
  let result;
  try {
    result = importSubArchive(db, {
      parsed,
      postsDir: POSTS_DIR,
      importerHandle: job.requested_by,
      renameTo: job.rename_to ?? null,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  completeImport(db, job.id, { importedSubName: result.subName });

  recordNotification(db, {
    recipientHandle: job.requested_by,
    kind: 'import_ready',
    subName: result.subName,
    targetType: 'import',
    targetId: job.id,
    snippet:
      `imported //${result.subName} from ${parsed.manifest.instance.forum_name || 'an external instance'} · ` +
      `${result.counts.posts} posts, ${result.counts.comments} comments` +
      (result.counts.bracketed > 0 ? ` · ${result.counts.bracketed} pseudonyms bracketed` : ''),
  });
  console.log(`[import-queue] done job=${job.id} sub=//${result.subName} posts=${result.counts.posts} comments=${result.counts.comments} bracketed=${result.counts.bracketed}`);
} catch (err) {
  const result = failImport(db, job.id, { errorMessage: err.message });
  if (result === 'failed') {
    recordNotification(db, {
      recipientHandle: job.requested_by,
      kind: 'import_failed',
      subName: null,
      targetType: 'import',
      targetId: job.id,
      snippet: `import failed after 3 attempts: ${err.message}. you can request a new one anytime.`,
    });
  }
  console.error(`[import-queue] ${result} job=${job.id} attempt=${job.retry_count}: ${err.message}`);
  process.exit(1);
}

// --- helpers ---

async function fetchArchive(url) {
  // Cap response size to MAX_ARCHIVE_BYTES; abort on timeout.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
  } catch (err) {
    clearTimeout(t);
    throw new Error(`fetch failed: ${err.message}`);
  }
  if (res.status !== 200) {
    clearTimeout(t);
    throw new Error(`source returned HTTP ${res.status}`);
  }
  const len = parseInt(res.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(len) && len > MAX_ARCHIVE_BYTES) {
    clearTimeout(t);
    throw new Error(`archive too large: ${len} bytes (limit ${MAX_ARCHIVE_BYTES})`);
  }
  // Read the body in chunks so a server lying about Content-Length can't
  // exhaust memory.
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ARCHIVE_BYTES) {
      clearTimeout(t);
      try { ctrl.abort(); } catch {}
      throw new Error(`archive too large: streamed past ${MAX_ARCHIVE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  clearTimeout(t);
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
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
  return h >= startHour || h < endHour;
}
