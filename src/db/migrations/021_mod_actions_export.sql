-- Migration 021: M7 followup — `export` action in mod_actions.
--
-- Sub-archive exports are public-facing transparency events: a tenured
-- subscriber or mod has pulled a copy of //<sub> off this instance.
-- The community deserves to know it happened and who did it, so the
-- export is logged into the same audit table as collapse/remove/ban —
-- one renderer, one feed, one chain-of-custody.
--
-- Differences from existing actions:
-- - Not gated by mod role (sub_export tenure replaces it).
-- - No state flip — the row is purely informational; nothing in
--   posts/comments/subs changes.
-- - Written from completeJob (worker) AND from insertSharedCompletedRow
--   (same-day dedupe). Sentinel fan-out writes one row per sibling so
--   each requester gets their own credit.
-- - target_type = 'sub'; target_id = sub_name.
-- - mod_handle = the requester (export_jobs.requested_by). On the
--   importer's side, imported_from_fingerprint marks rows that arrived
--   via sub-archive import (same as M7/B5).
--
-- SQLite cannot ALTER a CHECK constraint in place; rebuild the table.
-- Schema otherwise identical to migration 017 (post-020 column set).

PRAGMA defer_foreign_keys = ON;

CREATE TABLE mod_actions_new (
  id          TEXT    PRIMARY KEY,
  sub_name    TEXT    NOT NULL REFERENCES subs(name),
  mod_handle  TEXT             REFERENCES handles(handle),
  action      TEXT    NOT NULL,
  target_type TEXT    NOT NULL,
  target_id   TEXT    NOT NULL,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  imported_from_fingerprint TEXT,
  CHECK (action IN (
    'collapse', 'uncollapse', 'remove', 'unremove',
    'ban', 'unban',
    'promote_mod', 'demote_mod', 'transfer_owner',
    'auto_uncollapse_community',
    'auto_disable_inactivity', 'manual_reactivate',
    'export'
  )),
  CHECK (target_type IN ('post', 'comment', 'handle', 'sub'))
) STRICT;

INSERT INTO mod_actions_new
  SELECT id, sub_name, mod_handle, action, target_type, target_id, reason, created_at, imported_from_fingerprint
  FROM mod_actions;
DROP TABLE mod_actions;
ALTER TABLE mod_actions_new RENAME TO mod_actions;

CREATE INDEX idx_mod_actions_sub    ON mod_actions(sub_name, created_at DESC);
CREATE INDEX idx_mod_actions_target ON mod_actions(target_type, target_id);
CREATE INDEX idx_mod_actions_mod    ON mod_actions(mod_handle);
