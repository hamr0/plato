// Async export-job queue (M7/B2-a).
//
// Pure-function transactional helpers around the export_jobs table.
// Workers (bin/run-export-queue.js) and request handlers (M7/B2-b) both
// read through here so the state machine has one source of truth.
//
// State machine:
//   pending     — started_at IS NULL AND failed_at IS NULL
//   in-progress — started_at NOT NULL AND completed_at IS NULL AND failed_at IS NULL
//   succeeded   — completed_at NOT NULL
//   failed      — failed_at NOT NULL (terminal)
//
// Retry policy: on failure, if retry_count < MAX_ATTEMPTS the job is
// re-queued (started_at cleared) so the next worker tick picks it up. On
// the MAX_ATTEMPTS-th failure the row transitions to failed (terminal).
// User retries by re-requesting (new row).

import { randomBytes } from 'node:crypto';

const ID_BYTES = 8;        // → 16-hex job id
const TOKEN_BYTES = 32;    // → 64-hex download token
export const MAX_ATTEMPTS = 3;
export const DOWNLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Enqueue (or return the existing pending) per-sub export for `requestedBy`.
// Returns the job row. Idempotent: a second call while a job is pending or
// in-progress returns the same row, not a new one. Once a job has
// completed_at or failed_at set, the unique partial index releases the
// (kind, scope, requested_by) tuple and the next call enqueues anew.
export function enqueueSubExport(db, { subName, requestedBy, now = Date.now() }) {
  if (typeof subName !== 'string' || subName.length === 0) {
    throw new Error('enqueueSubExport: subName required');
  }
  if (typeof requestedBy !== 'string' || requestedBy.length === 0) {
    throw new Error('enqueueSubExport: requestedBy required');
  }
  const existing = db.prepare(
    `SELECT * FROM export_jobs
      WHERE kind = 'sub' AND scope = ? AND requested_by = ?
        AND completed_at IS NULL AND failed_at IS NULL`
  ).get(subName, requestedBy);
  if (existing) return existing;

  const id = randomBytes(ID_BYTES).toString('hex');
  db.prepare(
    `INSERT INTO export_jobs (id, kind, scope, requested_by, requested_at)
     VALUES (?, 'sub', ?, ?, ?)`
  ).run(id, subName, requestedBy, now);
  return db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(id);
}

// Pop the oldest pending job, mark it in-progress (started_at = now,
// retry_count++). Returns the claimed job row, or null if none pending.
// Single-process semantics — plato runs one node binary, the worker runs
// once per cron tick, so a transactional UPDATE … WHERE … is enough.
export function claimNextPendingJob(db, { now = Date.now() } = {}) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare(
      `SELECT * FROM export_jobs
        WHERE started_at IS NULL AND failed_at IS NULL AND completed_at IS NULL
        ORDER BY requested_at ASC
        LIMIT 1`
    ).get();
    if (!row) {
      db.exec('COMMIT');
      return null;
    }
    db.prepare(
      `UPDATE export_jobs
          SET started_at = ?, retry_count = retry_count + 1
        WHERE id = ?`
    ).run(now, row.id);
    db.exec('COMMIT');
    return db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(row.id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Mark job as completed. Caller passes the on-disk filename, byte size,
// and the freshly-generated download token. expires_at is computed here
// from `now` so timing tests can drive it.
export function completeJob(db, jobId, { archiveFilename, archiveSizeBytes, downloadToken, now = Date.now() }) {
  if (typeof archiveFilename !== 'string' || archiveFilename.length === 0) {
    throw new Error('completeJob: archiveFilename required');
  }
  if (!Number.isInteger(archiveSizeBytes) || archiveSizeBytes < 0) {
    throw new Error('completeJob: archiveSizeBytes must be a non-negative integer');
  }
  if (typeof downloadToken !== 'string' || !/^[0-9a-f]{64}$/.test(downloadToken)) {
    throw new Error('completeJob: downloadToken must be 64-char hex');
  }
  db.prepare(
    `UPDATE export_jobs
        SET completed_at = ?, archive_filename = ?, archive_size_bytes = ?,
            download_token = ?, expires_at = ?
      WHERE id = ?`
  ).run(now, archiveFilename, archiveSizeBytes, downloadToken, now + DOWNLOAD_TTL_MS, jobId);
}

// Record a failure. If retry_count < MAX_ATTEMPTS, re-queue the job (clear
// started_at) so the next worker tick retries. Otherwise terminal-fail
// with the error message. Returns 'requeued' | 'failed'.
export function failJob(db, jobId, { errorMessage, now = Date.now() }) {
  const job = db.prepare('SELECT retry_count FROM export_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`failJob: job ${jobId} not found`);
  if (job.retry_count < MAX_ATTEMPTS) {
    db.prepare(
      `UPDATE export_jobs
          SET started_at = NULL, error_message = ?
        WHERE id = ?`
    ).run(errorMessage ?? null, jobId);
    return 'requeued';
  }
  db.prepare(
    `UPDATE export_jobs
        SET failed_at = ?, error_message = ?
      WHERE id = ?`
  ).run(now, errorMessage ?? null, jobId);
  return 'failed';
}

// Token-based lookup for the download route. Returns the row if the token
// matches a completed, non-expired job; null otherwise.
export function findCompletedJobByToken(db, token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = db.prepare(
    `SELECT * FROM export_jobs
      WHERE download_token = ? AND completed_at IS NOT NULL
        AND expires_at IS NOT NULL AND expires_at > ?`
  ).get(token, now);
  return row ?? null;
}

// Public reader for /memlog or sub action row. Returns the most recent job
// per (kind, scope, requested_by) — pending, in-progress, succeeded
// (still-downloadable), or failed. Returns null if none.
export function findLatestJob(db, { kind, scope, requestedBy }) {
  return db.prepare(
    `SELECT * FROM export_jobs
      WHERE kind = ? AND scope = ? AND requested_by = ?
      ORDER BY requested_at DESC
      LIMIT 1`
  ).get(kind, scope, requestedBy) ?? null;
}

// Delete jobs whose download window has passed. Returns the list of
// archive filenames the caller should also unlink from disk.
export function pruneExpiredJobs(db, { now = Date.now() } = {}) {
  const expired = db.prepare(
    `SELECT id, archive_filename FROM export_jobs
      WHERE expires_at IS NOT NULL AND expires_at <= ?`
  ).all(now);
  if (expired.length === 0) return [];
  const ids = expired.map((j) => j.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM export_jobs WHERE id IN (${placeholders})`).run(...ids);
  return expired.map((j) => j.archive_filename).filter(Boolean);
}

export function newDownloadToken() {
  return randomBytes(TOKEN_BYTES).toString('hex');
}
