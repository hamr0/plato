-- Migration 004: M4 moderation (mod actions, flags, soft state)
--
-- Design notes:
-- - mod_actions is an immutable append-only log. Every collapse / remove /
--   ban / unban / promote_mod / demote_mod / transfer_owner action lands
--   here with the actor's handle, target, and reason. Mod log page
--   (/sub/<name>/modlog) is the public view over this table. PRD §Moderation
--   §Public mod log: "every moderator action is recorded and visible."
-- - target_type covers the three things mods act on: posts, comments, and
--   handles (for bans). target_id is the target's id (post id, comment id,
--   or handle hex). The mod module is the single writer; UI never inserts
--   directly.
-- - flags is the user-reporting surface (PRD §Spam Defenses 7). One row per
--   flag; one (target, flagger) is unique so users can't flood. category
--   covers the four canonical buckets plus an "other" escape hatch.
-- - flags.resolution defaults to 'pending'. When a mod acts (upholds or
--   dismisses), they fill resolver_handle + resolved_at and set the
--   resolution. Threshold-based auto-hide happens at the read layer
--   (post/comment list query), not here.
-- - Soft-state columns on posts and comments: 'collapsed' (mod-applied
--   soft fold; UI shows a "+ show" toggle) and 'removed' (mod-applied hard
--   fold; UI shows "removed by mod" stub but body is gone from view).
--   Both are NULL for live content. NULL = visible; non-null = the unix-ms
--   timestamp the action was taken (also recorded in mod_actions, but the
--   denormalized column lets list queries filter without joining the log).
-- - bans live in the bans table keyed by (sub_name, handle). Banned users
--   can't post or comment in that sub. Read access is unaffected (PRD
--   §Moderation: bans are participation-only, never read-blocking).

ALTER TABLE posts    ADD COLUMN collapsed_at INTEGER;
ALTER TABLE posts    ADD COLUMN removed_at   INTEGER;
ALTER TABLE comments ADD COLUMN collapsed_at INTEGER;
ALTER TABLE comments ADD COLUMN removed_at   INTEGER;

CREATE TABLE mod_actions (
  id          TEXT    PRIMARY KEY,
  sub_name    TEXT    NOT NULL REFERENCES subs(name),
  mod_handle  TEXT    NOT NULL REFERENCES handles(handle),
  action      TEXT    NOT NULL,
  target_type TEXT    NOT NULL,
  target_id   TEXT    NOT NULL,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  CHECK (action IN (
    'collapse', 'uncollapse', 'remove', 'unremove',
    'ban', 'unban',
    'promote_mod', 'demote_mod', 'transfer_owner'
  )),
  CHECK (target_type IN ('post', 'comment', 'handle'))
) STRICT;

CREATE INDEX idx_mod_actions_sub      ON mod_actions(sub_name, created_at DESC);
CREATE INDEX idx_mod_actions_target   ON mod_actions(target_type, target_id);
CREATE INDEX idx_mod_actions_mod      ON mod_actions(mod_handle);

CREATE TABLE flags (
  id              TEXT    PRIMARY KEY,
  target_type     TEXT    NOT NULL,
  target_id       TEXT    NOT NULL,
  flagger_handle  TEXT    NOT NULL REFERENCES handles(handle),
  category        TEXT    NOT NULL,
  note            TEXT,
  created_at      INTEGER NOT NULL,
  resolution      TEXT    NOT NULL DEFAULT 'pending',
  resolver_handle TEXT    REFERENCES handles(handle),
  resolved_at     INTEGER,
  CHECK (target_type IN ('post', 'comment')),
  CHECK (category IN ('spam', 'harassment', 'illegal', 'off_topic', 'other')),
  CHECK (resolution IN ('pending', 'upheld', 'dismissed')),
  UNIQUE (target_type, target_id, flagger_handle)
) STRICT;

CREATE INDEX idx_flags_target  ON flags(target_type, target_id);
CREATE INDEX idx_flags_pending ON flags(resolution) WHERE resolution = 'pending';

CREATE TABLE bans (
  sub_name    TEXT    NOT NULL REFERENCES subs(name),
  handle      TEXT    NOT NULL REFERENCES handles(handle),
  banned_by   TEXT    NOT NULL REFERENCES handles(handle),
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (sub_name, handle)
) STRICT;

CREATE INDEX idx_bans_handle ON bans(handle);
