-- Migration 003: M3 discussion (comments, voting, score caches)
--
-- Design notes:
-- - comments.parent_comment_id is nullable: NULL = top-level reply, non-null
--   = reply to another comment. Threading depth is unbounded at the schema
--   level; UI may collapse but DB does not cap.
-- - votes uses a composite primary key (target_type, target_id, handle) so
--   one handle can cast at most one vote per target. Re-voting overwrites
--   the previous row via INSERT ON CONFLICT (commit 2).
-- - votes.value stores the *weighted* contribution per PRD §Voting:
--   new-account (< 7 days forum tenure) votes are 0.5, full-weight votes
--   are 1.0. CHECK locks the four legal magnitudes; the vote module is
--   responsible for picking the right one when inserting.
-- - score columns on posts/comments are cached sums of votes.value for
--   fast sort. Updated transactionally on every vote write so the cache
--   never drifts. SUM of REAL is order-dependent at extreme precisions
--   but at forum scale (millions of votes max) the drift is negligible.
-- - target_type is text not enum because SQLite has no enum; the vote
--   module is the single writer and only emits 'post' or 'comment'.

ALTER TABLE posts ADD COLUMN score REAL NOT NULL DEFAULT 0;

CREATE TABLE comments (
  id                 TEXT    PRIMARY KEY,
  post_id            TEXT    NOT NULL REFERENCES posts(id),
  parent_comment_id  TEXT             REFERENCES comments(id),
  handle             TEXT    NOT NULL REFERENCES handles(handle),
  body               TEXT    NOT NULL,
  created_at         INTEGER NOT NULL,
  score              REAL    NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX idx_comments_post_id ON comments(post_id);
CREATE INDEX idx_comments_parent  ON comments(parent_comment_id);
CREATE INDEX idx_comments_handle  ON comments(handle);

CREATE TABLE votes (
  target_type  TEXT    NOT NULL,
  target_id    TEXT    NOT NULL,
  handle       TEXT    NOT NULL REFERENCES handles(handle),
  value        REAL    NOT NULL CHECK (value IN (-1.0, -0.5, 0.5, 1.0)),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, handle),
  CHECK (target_type IN ('post', 'comment'))
) STRICT;

CREATE INDEX idx_votes_handle ON votes(handle);
