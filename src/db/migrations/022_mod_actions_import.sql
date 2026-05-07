-- Migration 022: M7 followup — `import` action in mod_actions.
--
-- Sub-archive imports are public-facing too: the moment a community's
-- bytes land on this instance is exactly the kind of transparency the
-- modlog is for. Parallels the `export` row (migration 021) on the
-- source side; together they let either side's modlog tell the
-- migration story end-to-end.
--
-- Differences from existing actions:
-- - Not gated by mod role at the recordAction layer (the importer
--   becomes the sub's mod by virtue of importing; the row is the
--   transparency receipt of the act, not a mod-on-mod action).
-- - No state flip — purely informational.
-- - Written from importSubArchive after the imported sub + handles +
--   posts + comments + modlog rows land. mod_handle = the importer.
-- - target_type = 'sub'; target_id = destName.
-- - imported_from_fingerprint stays NULL on this row: the import act
--   happened on this instance, not in the archive being imported.
--
-- SQLite cannot ALTER a CHECK constraint in place; rebuild the table.
-- Schema otherwise identical to migration 021 (post-021 column set).

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
    'export', 'import'
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
