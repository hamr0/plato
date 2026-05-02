-- Migration 008: 24h edit window for posts and comments (M5/B9)
--
-- edited_at is NULL until the author edits. The content layer enforces a
-- 24h window from created_at; outside that window edits are rejected.
-- No body history is kept — content is overwritten in place.

ALTER TABLE posts    ADD COLUMN edited_at INTEGER;
ALTER TABLE comments ADD COLUMN edited_at INTEGER;
