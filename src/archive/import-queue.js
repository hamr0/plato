// Async sub-import job queue (M7/B5).
//
// State machine mirrors src/archive/queue.js (export side):
//   pending     — started_at IS NULL AND failed_at IS NULL
//   in-progress — started_at NOT NULL AND completed_at IS NULL AND failed_at IS NULL
//   succeeded   — completed_at NOT NULL
//   failed      — failed_at NOT NULL (terminal)
//
// Retry policy: up to MAX_ATTEMPTS attempts, then terminal-fail with the
// error message preserved. User retries by re-pasting the URL (which
// creates a fresh row).
//
// SLA: imports must reach a terminal state within IMPORT_SLA_MS or the
// pre-tick sweep terminal-fails them. The window is the same as the
// per-user export SLA (3 days) — imports are typically smaller and
// shouldn't sit in the queue forever.
//
// Idempotence (locked in PRD §Exit as the real check):
// - Per-source-archive: a UNIQUE partial index on
//   (source_scope_sub, source_exported_at) WHERE completed forbids
//   importing the same archive twice. Second attempt sees the existing
//   completed row and surfaces "already imported as <name>".
// - Per-pending-request: a UNIQUE partial index on
//   (source_url, requested_by) WHERE pending dedupes double-clicks.

import { randomBytes } from 'node:crypto';

const ID_BYTES = 8; // → 16-hex job id
export const MAX_ATTEMPTS = 3;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const IMPORT_SLA_MS = 3 * ONE_DAY_MS;

function assertHandle(label, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}: requestedBy required`);
  }
}

function assertUrl(label, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}: sourceUrl required`);
  }
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label}: sourceUrl is not a valid URL`); }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label}: sourceUrl must be http(s)`);
  }
}

// Enqueue (or return existing pending) sub-import for `requestedBy`.
// Idempotent on (source_url, requested_by) while pending — a second click
// while a job is pending or in-progress returns the same row, not a new
// one. Once the row reaches a terminal state, the unique partial index
// releases and a new request enqueues anew. Note: the per-source-archive
// idempotence (completed-archive de-dupe) is enforced AT COMPLETION time
// inside the worker, since we don't know the source archive identity
// until the manifest is fetched.
export function enqueueSubImport(db, { sourceUrl, renameTo = null, requestedBy, now = Date.now() }) {
  assertUrl('enqueueSubImport', sourceUrl);
  assertHandle('enqueueSubImport', requestedBy);
  if (renameTo != null && (typeof renameTo !== 'string' || renameTo.length === 0)) {
    throw new Error('enqueueSubImport: renameTo must be null or non-empty string');
  }
  const existing = db.prepare(
    `SELECT * FROM import_jobs
      WHERE source_url = ? AND requested_by = ?
        AND completed_at IS NULL AND failed_at IS NULL`
  ).get(sourceUrl, requestedBy);
  if (existing) return existing;

  const id = randomBytes(ID_BYTES).toString('hex');
  db.prepare(
    `INSERT INTO import_jobs (id, source_url, rename_to, requested_by, requested_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, sourceUrl, renameTo, requestedBy, now);
  return db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id);
}

// Pop the oldest pending import, mark in-progress (started_at = now,
// retry_count++). Returns the claimed row, or null if none pending.
export function claimNextPendingImport(db, { now = Date.now() } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(
      `SELECT * FROM import_jobs
        WHERE started_at IS NULL AND failed_at IS NULL AND completed_at IS NULL
        ORDER BY requested_at ASC
        LIMIT 1`
    ).get();
    if (!row) {
      db.exec('COMMIT');
      return null;
    }
    db.prepare(
      `UPDATE import_jobs
          SET started_at = ?, retry_count = retry_count + 1
        WHERE id = ?`
    ).run(now, row.id);
    db.exec('COMMIT');
    return db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(row.id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Stamp manifest-derived metadata onto a claimed row. Called by the
// worker once it has fetched the archive and parsed the manifest. Stored
// so that memlog rendering / sub-imported badges have the source
// instance's identity even if the import later fails.
export function recordSourceMetadata(db, jobId, {
  sourceScopeSub, sourceExportedAt, sourceFingerprint,
  sourceBaseUrl, sourceForumName, archiveSizeBytes,
}) {
  db.prepare(
    `UPDATE import_jobs
        SET source_scope_sub = ?, source_exported_at = ?,
            source_fingerprint = ?, source_base_url = ?,
            source_forum_name = ?, archive_size_bytes = ?
      WHERE id = ?`
  ).run(
    sourceScopeSub ?? null, sourceExportedAt ?? null,
    sourceFingerprint ?? null, sourceBaseUrl ?? null,
    sourceForumName ?? null, archiveSizeBytes ?? null, jobId
  );
}

// Mark job completed. `importedSubName` is the name of the new sub on
// THIS instance (== rename_to if renamed, else source_scope_sub).
export function completeImport(db, jobId, { importedSubName, now = Date.now() }) {
  if (typeof importedSubName !== 'string' || importedSubName.length === 0) {
    throw new Error('completeImport: importedSubName required');
  }
  db.prepare(
    `UPDATE import_jobs
        SET completed_at = ?, imported_sub_name = ?
      WHERE id = ?`
  ).run(now, importedSubName, jobId);
}

// Record a failure. retry_count < MAX_ATTEMPTS → re-queue (clear
// started_at). Otherwise terminal-fail. Returns 'requeued' | 'failed'.
//
// `terminal: true` short-circuits the retry path and writes failed_at
// immediately. Use this for errors that are guaranteed to recur on
// retry (dedupe collision: same source archive, same exported_at,
// already imported here — three attempts will hit the same lock).
export function failImport(db, jobId, { errorMessage, terminal = false, now = Date.now() }) {
  const job = db.prepare('SELECT retry_count FROM import_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`failImport: job ${jobId} not found`);
  if (!terminal && job.retry_count < MAX_ATTEMPTS) {
    db.prepare(
      `UPDATE import_jobs SET started_at = NULL, error_message = ? WHERE id = ?`
    ).run(errorMessage ?? null, jobId);
    return 'requeued';
  }
  db.prepare(
    `UPDATE import_jobs SET failed_at = ?, error_message = ? WHERE id = ?`
  ).run(now, errorMessage ?? null, jobId);
  return 'failed';
}

// Sweep stale imports — terminal-fail any pending row past IMPORT_SLA_MS.
// Returns the rows that were swept so the caller can emit memlog
// notifications.
export function markStaleImportsAsFailed(db, { now = Date.now() } = {}) {
  const cutoff = now - IMPORT_SLA_MS;
  const stale = db.prepare(
    `SELECT * FROM import_jobs
      WHERE requested_at < ?
        AND completed_at IS NULL AND failed_at IS NULL`
  ).all(cutoff);
  if (stale.length === 0) return [];
  const reason = `exceeded SLA window (${IMPORT_SLA_MS / ONE_DAY_MS}d)`;
  const update = db.prepare(
    `UPDATE import_jobs SET failed_at = ?, error_message = ? WHERE id = ?`
  );
  const swept = [];
  for (const row of stale) {
    update.run(now, reason, row.id);
    swept.push({ ...row, failed_at: now, error_message: reason });
  }
  return swept;
}

// Look up the most recent import job per (requested_by, source_url) for
// the import-form pill. Returns null if none.
export function findLatestImportJob(db, { sourceUrl, requestedBy }) {
  return db.prepare(
    `SELECT * FROM import_jobs
      WHERE source_url = ? AND requested_by = ?
      ORDER BY requested_at DESC
      LIMIT 1`
  ).get(sourceUrl, requestedBy) ?? null;
}

// Idempotence check: has THIS source-archive identity (sub + exported_at)
// already been imported successfully on this instance? Returns the
// completed row or null. Worker calls this after parsing the manifest,
// before doing any inserts.
export function findCompletedImportBySource(db, { sourceScopeSub, sourceExportedAt }) {
  if (!sourceScopeSub || !sourceExportedAt) return null;
  return db.prepare(
    `SELECT * FROM import_jobs
      WHERE source_scope_sub = ? AND source_exported_at = ?
        AND completed_at IS NOT NULL
      ORDER BY completed_at ASC
      LIMIT 1`
  ).get(sourceScopeSub, sourceExportedAt) ?? null;
}
