-- Migration 002: M2 multi-tenant subs
--
-- Design notes:
-- - subs.name is the natural primary key. Locked at creation per PRD §subs;
--   no surrogate id needed.
-- - owner_handle is nullable so the legacy 'general' sub (created by this
--   migration on existing instances) can have no owner. App-level validation
--   requires an owner on user-created subs.
-- - sub_mods will be populated for user-created subs in commit 3 of M2.
--   M4 reads the role column ('owner' | 'co').
-- - posts.sub_name and drafts.sub_name gain real FK constraints to subs(name).
--   SQLite cannot ALTER TABLE ADD CONSTRAINT, so we use the canonical
--   table-rebuild dance. defer_foreign_keys = ON makes self-consistent
--   intermediate states acceptable.

CREATE TABLE subs (
  name           TEXT    PRIMARY KEY,
  description    TEXT    NOT NULL DEFAULT '',
  owner_handle   TEXT             REFERENCES handles(handle),
  default_sort   TEXT    NOT NULL DEFAULT 'new',
  created_at     INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_subs_created_at ON subs(created_at DESC);

CREATE TABLE sub_mods (
  sub_name TEXT NOT NULL REFERENCES subs(name),
  handle   TEXT NOT NULL REFERENCES handles(handle),
  role     TEXT NOT NULL,
  PRIMARY KEY (sub_name, handle)
) STRICT;

CREATE INDEX idx_sub_mods_handle ON sub_mods(handle);

INSERT INTO subs (name, description, owner_handle, created_at)
  VALUES ('general', 'The general discussion sub.', NULL, strftime('%s', 'now') * 1000);

PRAGMA defer_foreign_keys = ON;

CREATE TABLE posts_new (
  id          TEXT    PRIMARY KEY,
  sub_name    TEXT    NOT NULL DEFAULT 'general' REFERENCES subs(name),
  handle      TEXT    NOT NULL REFERENCES handles(handle),
  title       TEXT    NOT NULL,
  file_path   TEXT    NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
) STRICT;

INSERT INTO posts_new (id, sub_name, handle, title, file_path, created_at)
  SELECT id, sub_name, handle, title, file_path, created_at FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_handle     ON posts(handle);
CREATE INDEX idx_posts_sub_name   ON posts(sub_name);

CREATE TABLE drafts_new (
  id                 TEXT    PRIMARY KEY,
  sub_name           TEXT    NOT NULL DEFAULT 'general' REFERENCES subs(name),
  title              TEXT    NOT NULL,
  body               TEXT    NOT NULL,
  created_at         INTEGER NOT NULL,
  finalized_post_id  TEXT    UNIQUE REFERENCES posts(id)
) STRICT;

INSERT INTO drafts_new (id, sub_name, title, body, created_at, finalized_post_id)
  SELECT id, sub_name, title, body, created_at, finalized_post_id FROM drafts;

DROP TABLE drafts;
ALTER TABLE drafts_new RENAME TO drafts;

CREATE INDEX idx_drafts_created_at ON drafts(created_at);
