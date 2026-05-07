-- Migration 020: M7/B5 — sub-import support.
--
-- Mirrors export_jobs (migration 018) but for imports. The state machine
-- is the same (pending → in-progress → succeeded | failed; encoded in
-- three timestamps + retry_count) so workers, helpers, and tests can
-- follow the same shape.
--
-- Design notes:
-- - source_url: the URL the importing user pasted. Server fetches over
--   HTTPS at worker time. URL itself is the trust anchor — the bytes that
--   come back from the URL ARE the archive (TLS handles transit
--   integrity; nothing else verifies provenance).
-- - source_scope_sub / source_exported_at / source_fingerprint /
--   source_base_url / source_forum_name: parsed from the fetched
--   manifest. NULL on a freshly-enqueued row, populated when the worker
--   first reads the manifest. Stored for memlog rendering, the imported
--   sub badge, and idempotence.
-- - rename_to: optional destination sub name override (filled in if the
--   user picked "import as" because the source name was taken on this
--   instance). NULL means "use the source's sub name verbatim".
-- - imported_sub_name: the actual name on this instance after completion
--   (== rename_to if set, else source_scope_sub). Filled in alongside
--   completed_at.
-- - Idempotence index: (source_scope_sub, source_exported_at) where
--   completed. The same archive (uniquely identified by source instance's
--   sub name + export timestamp) can only succeed once on this instance,
--   regardless of which user imported it or what they renamed it to.
--   Subsequent attempts surface "already imported" rather than creating
--   a duplicate sub.
-- - Pending-dedupe index: (source_url, requested_by) where pending. A
--   double-click on the import button collapses onto one row, same
--   pattern as export_jobs.
--
-- Per-table additions for imported subs:
-- - subs.imported_from_url + .imported_from_fingerprint + .imported_at +
--   .imported_at_source: the imported badge on /sub/<name> renders from
--   these. NULL on native subs.
-- - handles.imported_from_fingerprint: marks synthetic non-claimable
--   handles. A non-null value means "this handle was inserted by an
--   import, has no email derivation path on this instance, and nobody
--   can ever log in as it." NULL on native handles. Pseudonym lookups
--   for these handles still work — the row is real, just identity-less.
-- - mod_actions.imported_from_fingerprint: when non-null, the modlog
--   render layer prepends "[imported]" to the action label so live
--   moderation history can be visually separated from archived history.

CREATE TABLE import_jobs (
  id                  TEXT    PRIMARY KEY,
  source_url          TEXT    NOT NULL,
  source_scope_sub    TEXT,
  source_exported_at  TEXT,
  source_fingerprint  TEXT,
  source_base_url     TEXT,
  source_forum_name   TEXT,
  rename_to           TEXT,
  imported_sub_name   TEXT,
  requested_by        TEXT    NOT NULL REFERENCES handles(handle),
  requested_at        INTEGER NOT NULL,
  started_at          INTEGER,
  completed_at        INTEGER,
  failed_at           INTEGER,
  retry_count         INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  archive_size_bytes  INTEGER
) STRICT;

CREATE INDEX idx_import_jobs_pending
  ON import_jobs(requested_at)
  WHERE completed_at IS NULL AND failed_at IS NULL;

CREATE UNIQUE INDEX idx_import_jobs_source
  ON import_jobs(source_scope_sub, source_exported_at)
  WHERE completed_at IS NOT NULL;

CREATE UNIQUE INDEX idx_import_jobs_dedupe
  ON import_jobs(source_url, requested_by)
  WHERE completed_at IS NULL AND failed_at IS NULL;

ALTER TABLE subs ADD COLUMN imported_from_url         TEXT;
ALTER TABLE subs ADD COLUMN imported_from_fingerprint TEXT;
ALTER TABLE subs ADD COLUMN imported_at               INTEGER;
ALTER TABLE subs ADD COLUMN imported_at_source        INTEGER;

ALTER TABLE handles ADD COLUMN imported_from_fingerprint TEXT;

ALTER TABLE mod_actions ADD COLUMN imported_from_fingerprint TEXT;
