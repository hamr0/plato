-- Migration 017: M5/B12 — extend mod_actions for sub-level state changes.
--
-- Design notes:
-- - Two new action values:
--     'auto_disable_inactivity' — synthetic, written by the daily cron
--       when a sub has no mod activity for >30 days. mod_handle is NULL
--       (system action). Reason: '30 days no mod activity'. Surfaces
--       in the public modlog so operator/auto interventions are
--       visible alongside human ones.
--     'manual_reactivate' — written when any current mod flips
--       disabled_at = NULL via /sub/<name>/edit. mod_handle = the
--       reactivator. Reason: optional.
-- - target_type CHECK gains 'sub'. Previously 'post' / 'comment' /
--   'handle'; now also 'sub' for the disable / reactivate rows.
--   target_id holds the sub_name in those rows (redundant with
--   sub_name column but consistent with the existing pattern).
-- - SQLite can't ALTER a CHECK in place; rebuild the table. mod_handle
--   already nullable from migration 005.

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
  CHECK (action IN (
    'collapse', 'uncollapse', 'remove', 'unremove',
    'ban', 'unban',
    'promote_mod', 'demote_mod', 'transfer_owner',
    'auto_uncollapse_community',
    'auto_disable_inactivity', 'manual_reactivate'
  )),
  CHECK (target_type IN ('post', 'comment', 'handle', 'sub'))
) STRICT;

INSERT INTO mod_actions_new
  SELECT id, sub_name, mod_handle, action, target_type, target_id, reason, created_at
  FROM mod_actions;
DROP TABLE mod_actions;
ALTER TABLE mod_actions_new RENAME TO mod_actions;

CREATE INDEX idx_mod_actions_sub    ON mod_actions(sub_name, created_at DESC);
CREATE INDEX idx_mod_actions_target ON mod_actions(target_type, target_id);
CREATE INDEX idx_mod_actions_mod    ON mod_actions(mod_handle);
