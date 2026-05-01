-- Migration 006: per-sub auto-uncollapse thresholds
--
-- The community auto-revert threshold (+N net upvotes since soft-removal
-- to lift the collapse automatically) was hardcoded to 20 in code. Per-
-- target configurable now: posts and comments can have different
-- thresholds. Mod sets these on sub creation; both default to 20 if the
-- mod accepts the default.
--
-- Why split posts vs comments: posts surface in feeds and accumulate
-- votes faster than comments; the same threshold lands harder on post
-- moderation than comment moderation. Operators may want a higher bar
-- for posts, lower for comments — or the reverse.

-- Defaults match the floor (50 posts, 20 comments). Posts are more
-- discoverable than comments so the post threshold must be ≥ 50 to
-- raise the brigade bar; comments need ≥ 20. createSub enforces these
-- floors at the app layer; the DB defaults give newly-created subs a
-- sensible starting point.
ALTER TABLE subs ADD COLUMN auto_uncollapse_post    INTEGER NOT NULL DEFAULT 50;
ALTER TABLE subs ADD COLUMN auto_uncollapse_comment INTEGER NOT NULL DEFAULT 20;
