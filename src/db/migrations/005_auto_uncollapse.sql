-- Migration 005: auto-uncollapse soft-removed content on cumulative
-- community votes (PRD-locked at +20 net upvotes since collapse).
--
-- Design notes:
-- - score_at_collapse: snapshot of target.score taken when a mod
--   soft-removes (action='collapse'). Vote module compares
--   (current_score - score_at_collapse) >= 20 and auto-uncollapses
--   inside the same transaction as the vote write. NULL when target
--   is not currently collapsed.
-- - mod_actions.mod_handle becomes nullable so system-driven events
--   can record themselves with NULL handle. FK still applies when
--   not NULL.
-- - 'auto_uncollapse_community' added to the action enum. Modlog
--   display layer renders it as "community overruled."
-- - Hard removal (action='remove') is intentionally NOT subject to
--   the same auto-revert. Removed content is for harassment / doxxing
--   / illegal — letting +20 votes auto-undo it could revive abusive
--   content. Hard removals are reversed only manually.

ALTER TABLE posts    ADD COLUMN score_at_collapse REAL;
ALTER TABLE comments ADD COLUMN score_at_collapse REAL;

-- Rebuild mod_actions: mod_handle becomes nullable, action CHECK
-- expanded with auto_uncollapse_community. SQLite can't ALTER a
-- column to drop NOT NULL or amend a CHECK in place; rebuild.
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
    'auto_uncollapse_community'
  )),
  CHECK (target_type IN ('post', 'comment', 'handle'))
) STRICT;

INSERT INTO mod_actions_new
  SELECT id, sub_name, mod_handle, action, target_type, target_id, reason, created_at
  FROM mod_actions;
DROP TABLE mod_actions;
ALTER TABLE mod_actions_new RENAME TO mod_actions;

CREATE INDEX idx_mod_actions_sub    ON mod_actions(sub_name, created_at DESC);
CREATE INDEX idx_mod_actions_target ON mod_actions(target_type, target_id);
CREATE INDEX idx_mod_actions_mod    ON mod_actions(mod_handle);
