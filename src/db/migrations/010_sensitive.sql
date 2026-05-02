-- Migration 010: per-sub sensitive content flag (M5/B11)
--
-- Generic content advisory. The flag is intentionally not labeled "NSFW"
-- because plato's default community rules ban porn — labeling something
-- NSFW in a porn-banned forum invites the very content the rules forbid.
-- "sensitive" is the operator/community-defined catch-all (graphic
-- violence, abuse discussions, intense political topics, suicide /
-- eating-disorder threads, etc.).
--
-- The forum does NOT run age verification (PRD §Permanently out). The
-- flag triggers a banner on the sub page and a small mark in the home
-- active-subs strip; M6 subscriptions can use it to hide-by-default.

ALTER TABLE subs ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0;
