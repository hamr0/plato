-- Migration 001: M1 initial schema
--
-- Design notes:
-- - handles: HMAC-SHA256(secret, email) hex from knowless. Plaintext email never stored.
-- - pseudonym: generated from handle, UNIQUE per instance (PRD §Pseudonyms).
--   Generator must retry on collision; the constraint enforces this.
-- - first_seen_at: forum-tenure clock starts on first post by this handle (NOT knowless
--   registration time — see build-plan.md §Knowless Integration Spec).
-- - sub_name on posts/drafts is hardcoded 'general' in M1. M2 introduces a real subs
--   table and the column gains an FK + uniqueness rules at that point.
-- - file_path: relative to repo root, points at posts/<date>-<id>.md. Markdown file is
--   source of truth; this row is the index, regenerable from disk.
-- - STRICT tables: Node 22's node:sqlite supports STRICT; type-safer than classic.
-- - Foreign keys are enforced via PRAGMA foreign_keys = ON in src/db/index.js.

CREATE TABLE handles (
  handle        TEXT    PRIMARY KEY,
  pseudonym     TEXT    NOT NULL UNIQUE,
  first_seen_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_handles_pseudonym ON handles(pseudonym);

CREATE TABLE posts (
  id          TEXT    PRIMARY KEY,
  sub_name    TEXT    NOT NULL DEFAULT 'general',
  handle      TEXT    NOT NULL REFERENCES handles(handle),
  title       TEXT    NOT NULL,
  file_path   TEXT    NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_handle     ON posts(handle);
CREATE INDEX idx_posts_sub_name   ON posts(sub_name);

CREATE TABLE drafts (
  id                 TEXT    PRIMARY KEY,
  sub_name           TEXT    NOT NULL DEFAULT 'general',
  title              TEXT    NOT NULL,
  body               TEXT    NOT NULL,
  created_at         INTEGER NOT NULL,
  finalized_post_id  TEXT    UNIQUE REFERENCES posts(id)
) STRICT;

CREATE INDEX idx_drafts_created_at ON drafts(created_at);
