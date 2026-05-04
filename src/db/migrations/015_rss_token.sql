-- Migration 015: per-user RSS token (M6/B6)
--
-- Drives the two token-gated personal feeds:
--   /u/<token>/subs.rss  — all-subs activity
--   /u/<token>/rss       — all-subs activity + memlog notifications
--
-- One token per user covers both URLs. The token *is* the credential —
-- no handle in the URL, which keeps the pseudonym out of reader app
-- logs, corporate proxies, screenshots, and support tickets. PRD
-- §Outbound channels (deliberately pull-only).
--
-- Schema choices:
--   - Nullable: tokens are generated lazily on first /memlog visit, not
--     at handle creation. A user who never opens /memlog never has a
--     token row, which keeps the surface honest (the column reflects
--     "this user has set up a feed URL", not "the system pre-issued one
--     just in case").
--   - UNIQUE so token→handle lookup is O(1) via the index sqlite gives
--     us for free on UNIQUE columns. Regeneration is an UPDATE, not an
--     INSERT, so the row count never grows beyond one per user.
--   - 32 random bytes, hex-encoded → 64 ASCII chars. Long enough that
--     enumeration is infeasible; short enough that the URL stays
--     pasteable.
--
-- Intentionally NOT here: token issued_at, last_used_at, rotation
-- history. Plato isn't running an audit log on feed URLs; rotating
-- the token invalidates the old one and that's the entire mechanism.

ALTER TABLE handles ADD COLUMN rss_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_handles_rss_token
  ON handles(rss_token) WHERE rss_token IS NOT NULL;
