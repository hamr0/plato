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

// Sentinel value for `started_at` on rows that share an artifact with
// another in-flight job. The worker's claim query filters on
// `started_at IS NULL` so sentinels are skipped automatically; the
// fan-out logic in completeJob/failJob is what eventually closes them.
const SHARES_ARTIFACT_SENTINEL = -1;

// Find a previously-built archive for `(kind, scope)` whose download
// window is still open. Used by the enqueue helpers to dedupe — if the
// bytes are still on disk and reachable, the second requester gets a
// fresh bearer token pointing at the same file rather than a fresh
// build. Returns the canonical (oldest completed_at) job row or null.
function findReusableArtifact(db, kind, scope, now) {
  return db.prepare(
    `SELECT * FROM export_jobs
      WHERE kind = ? AND scope = ?
        AND completed_at IS NOT NULL AND failed_at IS NULL
        AND archive_filename IS NOT NULL
        AND expires_at > ?
      ORDER BY completed_at ASC
      LIMIT 1`
  ).get(kind, scope, now) ?? null;
}

// Find an in-flight (pending OR claimed) PRIMARY job (not a sentinel
// row that's already waiting for someone else) for `(kind, scope)`.
// New requests for an in-flight sub piggyback on this row via a
// sentinel. Returns null when none exists.
function findInFlightPrimary(db, kind, scope) {
  return db.prepare(
    `SELECT * FROM export_jobs
      WHERE kind = ? AND scope = ?
        AND completed_at IS NULL AND failed_at IS NULL
        AND (started_at IS NULL OR started_at > 0)
      ORDER BY requested_at ASC
      LIMIT 1`
  ).get(kind, scope) ?? null;
}

// Insert a freshly-completed row that reuses an existing archive on
// disk. Same archive_filename + size, fresh download_token, shared
// expires_at (so the pruner can unlink the file once the LAST holder
// has expired). Returns the new row.
function insertSharedCompletedRow(db, { kind, scope, requestedBy, parent, now }) {
  const id = randomBytes(ID_BYTES).toString('hex');
  const token = newDownloadToken();
  db.prepare(
    `INSERT INTO export_jobs (
       id, kind, scope, requested_by, requested_at,
       started_at, completed_at,
       archive_filename, archive_size_bytes, download_token, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, kind, scope, requestedBy, now,
    now, now,
    parent.archive_filename, parent.archive_size_bytes, token, parent.expires_at,
  );
  return db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(id);
}

// Insert a sentinel row that waits for an in-flight primary job to
// complete. The row's started_at is the SHARES_ARTIFACT_SENTINEL value
// (-1) so the worker's claim query (started_at IS NULL) skips it.
// Fan-out at completeJob / terminal failJob fills it in.
function insertSentinelRow(db, { kind, scope, requestedBy, now }) {
  const id = randomBytes(ID_BYTES).toString('hex');
  db.prepare(
    `INSERT INTO export_jobs (id, kind, scope, requested_by, requested_at, started_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, kind, scope, requestedBy, now, SHARES_ARTIFACT_SENTINEL);
  return db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(id);
}

// Enqueue (or reuse) a per-sub export.
//
// Three-tier dedupe:
//   1) Same user already has a pending/in-progress request for this sub
//      → return that row (existing behavior; handled by the partial
//      unique index on (kind, scope, requested_by) WHERE pending).
//   2) An archive for this sub is already completed and downloadable
//      → create a new completed row pointing at the same on-disk file
//      with a fresh bearer token. No worker run.
//   3) A primary build is in-flight for this sub
//      → create a sentinel row (started_at = -1) that fan-out will
//      complete when the parent finishes.
//   4) Else regular pending insert.
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

  const reusable = findReusableArtifact(db, 'sub', subName, now);
  if (reusable) {
    return insertSharedCompletedRow(db, { kind: 'sub', scope: subName, requestedBy, parent: reusable, now });
  }
  const inFlight = findInFlightPrimary(db, 'sub', subName);
  if (inFlight) {
    return insertSentinelRow(db, { kind: 'sub', scope: subName, requestedBy, now });
  }

  const id = randomBytes(ID_BYTES).toString('hex');
  db.prepare(
    `INSERT INTO export_jobs (id, kind, scope, requested_by, requested_at)
     VALUES (?, 'sub', ?, ?, ?)`
  ).run(id, subName, requestedBy, now);
  return db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(id);
}

// Enqueue (or reuse) a per-user export. Same three-tier dedupe as
// enqueueSubExport — a user re-requesting their personal archive while
// a previous one is still downloadable gets a fresh bearer URL pointing
// at the existing bytes, not a re-build.
export function enqueueUserExport(db, { requestedBy, now = Date.now() }) {
  assertHandle('enqueueUserExport', requestedBy);
  const existing = db.prepare(
    `SELECT * FROM export_jobs
      WHERE kind = 'user' AND scope = ? AND requested_by = ?
        AND completed_at IS NULL AND failed_at IS NULL`
  ).get(requestedBy, requestedBy);
  if (existing) return existing;

  const reusable = findReusableArtifact(db, 'user', requestedBy, now);
  if (reusable) {
    return insertSharedCompletedRow(db, { kind: 'user', scope: requestedBy, requestedBy, parent: reusable, now });
  }
  const inFlight = findInFlightPrimary(db, 'user', requestedBy);
  if (inFlight) {
    return insertSentinelRow(db, { kind: 'user', scope: requestedBy, requestedBy, now });
  }

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
//
// Fan-out: any sentinel rows (started_at = SHARES_ARTIFACT_SENTINEL)
// for the same (kind, scope) are also completed atomically, each with
// a FRESH download_token but the same archive_filename + size +
// expires_at. Sharing the parent's expires_at means all bearer URLs
// expire together, so the pruner can unlink the file when its window
// closes without orphaning rows that still reference it.
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
  const row = db.prepare('SELECT kind, scope FROM export_jobs WHERE id = ?').get(jobId);
  if (!row) throw new Error(`completeJob: job ${jobId} not found`);
  const ttl = DOWNLOAD_TTL_MS[row.kind];
  if (ttl == null) throw new Error(`completeJob: unknown kind ${row.kind}`);
  const expiresAt = now + ttl;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE export_jobs
          SET completed_at = ?, archive_filename = ?, archive_size_bytes = ?,
              download_token = ?, expires_at = ?
        WHERE id = ?`
    ).run(now, archiveFilename, archiveSizeBytes, downloadToken, expiresAt, jobId);

    // Fan out to sentinel siblings sharing this artifact.
    const siblings = db.prepare(
      `SELECT id FROM export_jobs
        WHERE kind = ? AND scope = ?
          AND started_at = ?
          AND completed_at IS NULL AND failed_at IS NULL`
    ).all(row.kind, row.scope, SHARES_ARTIFACT_SENTINEL);
    const fanOutUpdate = db.prepare(
      `UPDATE export_jobs
          SET completed_at = ?, started_at = ?,
              archive_filename = ?, archive_size_bytes = ?,
              download_token = ?, expires_at = ?
        WHERE id = ?`
    );
    for (const s of siblings) {
      fanOutUpdate.run(
        now, now, archiveFilename, archiveSizeBytes,
        newDownloadToken(), expiresAt, s.id,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Record a failure. If retry_count < MAX_ATTEMPTS, re-queue the job (clear
// started_at) so the next worker tick retries. Otherwise terminal-fail
// with the error message. Sentinel siblings sharing the (kind, scope)
// terminal-fail too so they don't sit forever waiting on a parent that
// won't deliver. Returns 'requeued' | 'failed'.
export function failJob(db, jobId, { errorMessage, now = Date.now() }) {
  const job = db.prepare('SELECT kind, scope, retry_count FROM export_jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`failJob: job ${jobId} not found`);
  if (job.retry_count < MAX_ATTEMPTS) {
    db.prepare(
      `UPDATE export_jobs
          SET started_at = NULL, error_message = ?
        WHERE id = ?`
    ).run(errorMessage ?? null, jobId);
    return 'requeued';
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE export_jobs
          SET failed_at = ?, error_message = ?
        WHERE id = ?`
    ).run(now, errorMessage ?? null, jobId);
    db.prepare(
      `UPDATE export_jobs
          SET failed_at = ?, error_message = ?
        WHERE kind = ? AND scope = ?
          AND started_at = ?
          AND completed_at IS NULL AND failed_at IS NULL`
    ).run(now, errorMessage ?? null, job.kind, job.scope, SHARES_ARTIFACT_SENTINEL);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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

// Delete jobs whose download window has passed. Returns a deduped list
// of archive filenames the caller should unlink from disk. With the
// shared-artifact dedupe (M7 followup), several expired rows can
// reference the same file; we deduplicate so the caller doesn't try to
// unlink the same path twice.
export function pruneExpiredJobs(db, { now = Date.now() } = {}) {
  const expired = db.prepare(
    `SELECT id, archive_filename FROM export_jobs
      WHERE expires_at IS NOT NULL AND expires_at <= ?`
  ).all(now);
  if (expired.length === 0) return [];
  const ids = expired.map((j) => j.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM export_jobs WHERE id IN (${placeholders})`).run(...ids);
  const unique = new Set();
  for (const j of expired) if (j.archive_filename) unique.add(j.archive_filename);
  return [...unique];
}

export function newDownloadToken() {
  return randomBytes(TOKEN_BYTES).toString('hex');
}
