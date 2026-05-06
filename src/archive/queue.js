// Async export-job queue (M7/B2-a, extended in B2-b).
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
//
// Per-kind windows (B2-b):
//   sub  : SLA 7 days from request, download TTL 3 days from completion
//   user : SLA 3 days from request, download TTL 3 days from completion
// SLA = how long the job may sit pending/in-progress before terminal-fail
// (regardless of retry count). TTL = how long the completed download URL
// works before the row + on-disk file are pruned.

import { randomBytes } from 'node:crypto';

const ID_BYTES = 8;        // → 16-hex job id
const TOKEN_BYTES = 32;    // → 64-hex download token
export const MAX_ATTEMPTS = 3;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Per-kind download TTL. Both kinds are 3 days — sub archives can be
// large and personal archives are PII-shaped, so neither benefits from
// a longer retention. Keeping them as a map (not a single constant) so
// future divergence is a one-line change, not a refactor.
export const DOWNLOAD_TTL_MS = Object.freeze({
  sub:  3 * ONE_DAY_MS,
  user: 3 * ONE_DAY_MS,
});

// Per-kind production SLA. If a job hasn't reached completed_at within
// SLA_MS of requested_at it's terminal-failed by the worker's pre-tick
// sweep, regardless of retry_count. Sub gets the longer window because
// the archive can be large and the queue may sit through several
// off-peak windows.
export const SLA_MS = Object.freeze({
  sub:  7 * ONE_DAY_MS,
  user: 3 * ONE_DAY_MS,
});

const KINDS = Object.freeze(['sub', 'user']);

function assertHandle(label, value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}: requestedBy required`);
  }
}

// Enqueue (or return the existing pending) per-sub export for `requestedBy`.
// Returns the job row. Idempotent: a second call while a job is pending or
// in-progress returns the same row, not a new one. Once a job has
// completed_at or failed_at set, the unique partial index releases the
// (kind, scope, requested_by) tuple and the next call enqueues anew.
export function enqueueSubExport(db, { subName, requestedBy, now = Date.now() }) {
  if (typeof subName !== 'string' || subName.length === 0) {
    throw new Error('enqueueSubExport: subName required');
  }
  assertHandle('enqueueSubExport', requestedBy);
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

// Enqueue (or return existing pending) per-user export. scope == requestedBy
// so the unique partial dedupe index naturally caps one pending job per
// user. No tenure gate at this layer — the caller (route handler) decides
// whether the user is allowed to ask.
export function enqueueUserExport(db, { requestedBy, now = Date.now() }) {
  assertHandle('enqueueUserExport', requestedBy);
  const existing = db.prepare(
    `SELECT * FROM export_jobs
      WHERE kind = 'user' AND scope = ? AND requested_by = ?
        AND completed_at IS NULL AND failed_at IS NULL`
  ).get(requestedBy, requestedBy);
  if (existing) return existing;

  const id = randomBytes(ID_BYTES).toString('hex');
  db.prepare(
    `INSERT INTO export_jobs (id, kind, scope, requested_by, requested_at)
     VALUES (?, 'user', ?, ?, ?)`
  ).run(id, requestedBy, requestedBy, now);
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
// and the freshly-generated download token. expires_at uses the kind's
// TTL (looked up from the row, so the worker doesn't have to thread it).
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
  const row = db.prepare('SELECT kind FROM export_jobs WHERE id = ?').get(jobId);
  if (!row) throw new Error(`completeJob: job ${jobId} not found`);
  const ttl = DOWNLOAD_TTL_MS[row.kind];
  if (ttl == null) throw new Error(`completeJob: unknown kind ${row.kind}`);
  db.prepare(
    `UPDATE export_jobs
        SET completed_at = ?, archive_filename = ?, archive_size_bytes = ?,
            download_token = ?, expires_at = ?
      WHERE id = ?`
  ).run(now, archiveFilename, archiveSizeBytes, downloadToken, now + ttl, jobId);
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

// Sweep: terminal-fail any pending job whose requested_at is older than
// SLA_MS[kind]. Caller (worker) runs this before claimNextPendingJob so
// stale jobs don't sit in the queue forever even when retries keep
// succeeding-and-failing inside the SLA window. Returns the rows that
// were just terminal-failed (so the caller can emit memlog
// notifications); empty array if nothing was swept.
export function markStaleAsFailed(db, { now = Date.now() } = {}) {
  const swept = [];
  for (const kind of KINDS) {
    const cutoff = now - SLA_MS[kind];
    const stale = db.prepare(
      `SELECT * FROM export_jobs
        WHERE kind = ? AND requested_at < ?
          AND completed_at IS NULL AND failed_at IS NULL`
    ).all(kind, cutoff);
    if (stale.length === 0) continue;
    const reason = `exceeded SLA window (${kind}: ${SLA_MS[kind] / ONE_DAY_MS}d)`;
    const update = db.prepare(
      `UPDATE export_jobs SET failed_at = ?, error_message = ? WHERE id = ?`
    );
    for (const row of stale) {
      update.run(now, reason, row.id);
      swept.push({ ...row, failed_at: now, error_message: reason });
    }
  }
  return swept;
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
