-- Migration 009: per-sub flairs (M5/B10)
--
-- Sub owners curate a closed list of flairs (slug + label + color). Users
-- pick from the list when creating a post. If flairs_required = 1, every
-- post must carry one. Filter via /sub/<name>?flair=<slug>.
--
-- Stored as a JSON array on subs.flairs:
--   [{"slug":"news","label":"news","color":"#58a6ff"}, ...]
--
-- The JSON layout (vs a flairs table) keeps subs self-contained: dropping
-- a column removes the feature cleanly with no orphan rows. Flair count is
-- capped in the content layer (≤ 12), so the JSON stays small.

ALTER TABLE subs   ADD COLUMN flairs           TEXT    NOT NULL DEFAULT '[]';
ALTER TABLE subs   ADD COLUMN flairs_required  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts  ADD COLUMN flair_slug       TEXT;
ALTER TABLE drafts ADD COLUMN flair_slug       TEXT;
