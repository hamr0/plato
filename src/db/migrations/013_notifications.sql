-- Migration 013: per-user notifications table — memlog (M6/B0)
--
-- The personal counterpart to the public modlog. One row per event the
-- recipient should know about: a comment on their post, a reply to their
-- comment, or a mod action on their content / handle. Vote events are
-- intentionally not recorded — see PRD on "no engagement-bait pings."
--
-- Read items stay for 90 days (lazy prune on /memlog GET) so the user
-- has a personal record of "what happened to my stuff," then drop off.
-- Unread items follow the same prune — if a notification has sat unread
-- for >90d the moment has passed.
--
-- The composite index supports the two hot queries:
--   1. unread count for the header chip (recipient_handle, read_at IS NULL)
--   2. memlog feed listing (recipient_handle ORDER BY created_at DESC)

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_handle TEXT NOT NULL,
  kind          TEXT NOT NULL,
  sub_name      TEXT,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  actor_handle  TEXT,
  snippet       TEXT,
  created_at    INTEGER NOT NULL,
  read_at       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON notifications(recipient_handle, read_at, created_at DESC);
