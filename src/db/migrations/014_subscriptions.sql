-- Migration 014: per-user sub subscriptions (M6/B2)
--
-- The keystone of M6: a small relational table that lets a logged-in
-- user pin subs they care about. Reads from this table will drive the
-- /subs?filter=mine view (B2), the home-feed Subscribed/All toggle (B3),
-- email digests (B5), and ntfy push (B6) — every other M6 surface keys
-- off the same rows. PRD §Front Page → Sub subscription mechanics:
--   - private (no public follower lists)
--   - exportable (M7 archive)
--   - no notifications by default
--   - bookmarking a place, not idolizing a person
--
-- Schema choices:
--   - Composite PK (user_handle, sub_name) gives O(1) is-subscribed
--     lookups + natural dedupe; double-subscribe is a no-op INSERT OR
--     IGNORE rather than an UPDATE, which keeps created_at honest as
--     "the moment they first subscribed."
--   - Secondary index on sub_name supports subscriber-count aggregates
--     for the /subs directory column and the future home-feed
--     `WHERE sub_name IN (subscribed)` join.
--   - FK to subs(name) so deleting a sub (when M7 ships sub deletion)
--     cascades cleanly. FK to handles(handle) for the same reason on
--     the user side. Both already exist throughout the schema.
--
-- Intentionally NOT here: notifications config, digest cadence, push
-- preferences. Those join in B5/B6 as additional columns or sibling
-- tables; subscribing is a single bit of state for now.

CREATE TABLE IF NOT EXISTS subscriptions (
  user_handle  TEXT    NOT NULL REFERENCES handles(handle),
  sub_name     TEXT    NOT NULL REFERENCES subs(name),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_handle, sub_name)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_sub
  ON subscriptions(sub_name);
