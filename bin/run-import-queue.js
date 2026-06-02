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
//   2. Gunzip → tar buffer (decompressed size also capped).
//   3. Parse + verify per-file SHA-256 (transit integrity).
//   4. Verify the Ed25519 signature against the source origin's published
//      key (archive-format.md → Verifying). Refuse forged/unsigned archives
//      before any insert. The trust anchor is the pasted URL's origin.
//   5. Check idempotence — was this exact source archive already imported?
//   6. Open transaction; importSubArchive(); commit.
//   7. Emit memlog notification (import_ready or import_failed).
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
import { verifyArchiveSignature } from '../src/archive/signing.js';
import { assertPublicUrl } from '../src/archive/ssrf.js';
import { initFlightlog } from '../src/flightlog.js';

// flightlog error net for this short-lived worker. exitOnRejection:true so a
// stray rejection exits non-zero instead of a silent exit-0; bootCheck:false so
// an unwritable error sink can't take down the actual import work. The global
// net captures any throw before/after the try; captureSync in the job-failure
// catch records the operational error (the catch bypasses the global handlers).
const { captureSync } = initFlightlog({ proc: 'import-queue', exitOnRejection: true, bootCheck: false });

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FORUM_DB = process.env.DB_PATH ?? resolve(ROOT, 'forum.db');
const POSTS_DIR = process.env.POSTS_DIR ?? resolve(ROOT, 'posts');

// 500 MB default — matches the PRD lock for sub-import size cap. The
// fetch is rejected at Content-Length time and again as bytes accumulate
// so a server lying about Content-Length still hits the wall.
const MAX_ARCHIVE_BYTES = parseInt(process.env.IMPORT_MAX_BYTES ?? `${500 * 1024 * 1024}`, 10);
const FETCH_TIMEOUT_MS = parseInt(process.env.IMPORT_FETCH_TIMEOUT_MS ?? '120000', 10);
const MAX_REDIRECTS = 5;
const MAX_SIG_BYTES = 4096;          // a detached Ed25519 sig is 64 bytes
const MAX_PUBKEY_BYTES = 64 * 1024;  // /.well-known/plato-pubkey is tiny JSON

// Default-refuse archives that carry no signature (manifest fingerprint null —
// pre-signing exports, or a fork that strips signing). Operators migrating
// trusted legacy archives can opt in. Matches archive-format.md (Verifying).
const ALLOW_UNSIGNED = process.env.IMPORT_ALLOW_UNSIGNED === '1';

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
  // Cap the *decompressed* size too: the fetch limit bounds the compressed
  // bytes, but gzip ratios are unbounded, so a small blob could otherwise
  // expand to gigabytes and OOM the worker. Node throws ERR_BUFFER_TOO_LARGE
  // past the cap, which the surrounding catch turns into a job failure.
  const tarBuf = gunzipSync(gz, { maxOutputLength: MAX_ARCHIVE_BYTES });
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

  // Authenticity gate (archive-format.md → Verifying). Fetch the detached
  // signature and the source instance's published key, then confirm that key
  // signed these exact bytes and matches the fingerprint the manifest claims.
  // The trust anchor is the host the user chose to import from — not anything
  // self-asserted inside the (attacker-controllable) archive. Nothing is
  // inserted until this passes; a forged/unsigned archive fails terminally
  // (it won't start passing on a retry).
  const { sigBytes, pubkeyHex } = await fetchSignatureMaterial(job.source_url);
  const verdict = verifyArchiveSignature({
    gzBytes: gz, sigBytes, pubkeyHex,
    manifestFingerprint: parsed.manifest.instance.pubkey_fingerprint ?? null,
    allowUnsigned: ALLOW_UNSIGNED,
  });
  if (!verdict.ok) {
    const refusedErr = new Error(`archive verification failed: ${verdict.reason}`);
    refusedErr.terminal = true;
    throw refusedErr;
  }

  // Idempotence: same archive identity already imported? Fail loud, but
  // tag the failure so the user sees "already imported as X" instead of
  // a generic error.
  const prior = findCompletedImportBySource(db, {
    sourceScopeSub: parsed.manifest.scope.sub,
    sourceExportedAt: parsed.manifest.exported_at,
  });
  if (prior) {
    const dedupeErr = new Error(`already imported as //${prior.imported_sub_name} on ${new Date(prior.completed_at).toISOString().slice(0, 10)}`);
    // Skip the retry path — same source archive will hit the same lock
    // every attempt. Memlog row fires now instead of after 3 wasted ticks.
    dedupeErr.terminal = true;
    throw dedupeErr;
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
      sourceUrl: job.source_url,
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
  const result = failImport(db, job.id, { errorMessage: err.message, terminal: err.terminal === true });
  if (result === 'failed') {
    const snippet = err.terminal === true
      ? `import failed: ${err.message}. you can request a new one anytime.`
      : `import failed after 3 attempts: ${err.message}. you can request a new one anytime.`;
    recordNotification(db, {
      recipientHandle: job.requested_by,
      kind: 'import_failed',
      subName: null,
      targetType: 'import',
      targetId: job.id,
      snippet,
    });
  }
  console.error(`[import-queue] ${result} job=${job.id} attempt=${job.retry_count}: ${err.message}`);
  captureSync(err, { where: 'import-queue', jobId: job.id, outcome: result, terminal: err.terminal === true });
  process.exit(1);
}

// --- helpers ---

// SSRF-guarded, redirect-following, size-capped GET. Returns { status, buf }
// (buf is null for any non-200). Throws only on network/abort failure so the
// caller can distinguish "server said 404" from "could not reach server".
async function fetchCapped(url, maxBytes) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    // SSRF guard: validate the host resolves to a public address, then
    // follow redirects manually so a public URL can't 302 into an
    // internal one — each hop is re-validated before we connect.
    let current = (await assertPublicUrl(url)).href;
    for (let hop = 0; ; hop++) {
      res = await fetch(current, { redirect: 'manual', signal: ctrl.signal });
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!location) break;
      if (hop >= MAX_REDIRECTS) throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
      const next = (await assertPublicUrl(new URL(location, current).href)).href;
      try { await res.body?.cancel(); } catch {}
      current = next;
    }
  } catch (err) {
    clearTimeout(t);
    throw new Error(`fetch failed: ${err.message}`);
  }
  if (res.status !== 200) {
    clearTimeout(t);
    try { await res.body?.cancel(); } catch {}
    return { status: res.status, buf: null };
  }
  const len = parseInt(res.headers.get('content-length') ?? '0', 10);
  if (Number.isFinite(len) && len > maxBytes) {
    clearTimeout(t);
    throw new Error(`response too large: ${len} bytes (limit ${maxBytes})`);
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
    if (total > maxBytes) {
      clearTimeout(t);
      try { ctrl.abort(); } catch {}
      throw new Error(`response too large: streamed past ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  clearTimeout(t);
  return { status: 200, buf: Buffer.concat(chunks.map((c) => Buffer.from(c))) };
}

async function fetchArchive(url) {
  const { status, buf } = await fetchCapped(url, MAX_ARCHIVE_BYTES);
  if (status !== 200) throw new Error(`source returned HTTP ${status}`);
  return buf;
}

// Fetch the detached `.sig` (written beside the archive by the exporter) and
// the source instance's published key (/.well-known/plato-pubkey on the same
// origin as the pasted URL). Returns nulls when the source serves neither — an
// unsigned/forked export — which verifyArchiveSignature then handles per the
// archive's own fingerprint claim. A network failure (not a 404) propagates so
// the job retries rather than mislabeling a transient outage as "unsigned".
async function fetchSignatureMaterial(sourceUrl) {
  const sig = await fetchCapped(`${sourceUrl}.sig`, MAX_SIG_BYTES);
  const pub = await fetchCapped(new URL('/.well-known/plato-pubkey', sourceUrl).href, MAX_PUBKEY_BYTES);
  if (sig.status !== 200 || pub.status !== 200) return { sigBytes: null, pubkeyHex: null };
  let pubkeyHex = null;
  try { pubkeyHex = JSON.parse(pub.buf.toString('utf8')).public_key_hex ?? null; } catch { pubkeyHex = null; }
  return { sigBytes: sig.buf, pubkeyHex };
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
