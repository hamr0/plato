-- Migration 018: M7/B2-a — async export-job queue.
--
-- Design notes:
-- - One row per requested export. State is encoded in three timestamps
--   plus retry_count:
--     pending     : started_at IS NULL AND failed_at IS NULL
--     in-progress : started_at NOT NULL AND completed_at IS NULL AND failed_at IS NULL
--     succeeded   : completed_at NOT NULL
--     failed      : failed_at NOT NULL (terminal: 3rd attempt errored out)
-- - retry_count: number of completed *attempts* so far. Worker increments
--   on claim; on success → completed_at; on failure with retry_count<3 →
--   re-queue (clear started_at) so the next worker tick picks it up; on
--   failure with retry_count==3 → terminal failed_at + error_message.
--   User retries by re-requesting (which creates a new row).
-- - Unique partial index dedupes pending requests so a double-click on
--   "request export" doesn't enqueue two jobs for the same target.
-- - download_token: 64-hex random per job. Token IS the credential — same
--   posture as /u/<token>/rss. URL has no handle, no sub name leakage in
--   the path (only the .tar.gz suffix).
-- - expires_at: 7d after completed_at. Pruner runs alongside the worker
--   and removes both the row and the on-disk file.
-- - kind is 'sub' for now; 'user' lands in M7/B3.

CREATE TABLE export_jobs (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL CHECK (kind IN ('sub', 'user')),
  scope               TEXT NOT NULL,
  requested_by        TEXT NOT NULL,
  requested_at        INTEGER NOT NULL,
  started_at          INTEGER,
  completed_at        INTEGER,
  failed_at           INTEGER,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  archive_filename    TEXT,
  archive_size_bytes  INTEGER,
  download_token      TEXT,
  expires_at          INTEGER
);

CREATE INDEX idx_export_jobs_pending
  ON export_jobs(requested_at)
  WHERE completed_at IS NULL AND failed_at IS NULL;

CREATE UNIQUE INDEX idx_export_jobs_token
  ON export_jobs(download_token)
  WHERE download_token IS NOT NULL;

CREATE UNIQUE INDEX idx_export_jobs_dedupe
  ON export_jobs(kind, scope, requested_by)
  WHERE completed_at IS NULL AND failed_at IS NULL;
