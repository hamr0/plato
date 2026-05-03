-- Migration 012: per-post sensitive content flag (M5/B9)
--
-- Authors mark individual posts as sensitive at create time, and within the
-- edit window. The flag is independent from the per-sub sensitive flag from
-- migration 010: a non-sensitive sub can still host a single sensitive post,
-- and vice versa. Renderers OR the two flags when deciding whether to show
-- the advisory banner / [!] mark.
--
-- No backfill: existing posts default to 0 (not sensitive).

ALTER TABLE posts  ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drafts ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 0;
