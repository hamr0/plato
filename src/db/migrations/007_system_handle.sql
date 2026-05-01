-- Migration 007: seed the SYSTEM handle.
--
-- M5/B3 (spam regex pattern file) auto-flags posts/comments matching a
-- pattern in spam-patterns.txt. The flags table requires
-- flagger_handle NOT NULL, so the system needs a handle row to attach
-- those flags to. We use a sentinel: 64 zero hex characters. The
-- pseudonym is 'system' so the renderer can detect and label it.
--
-- Why a real handle row instead of nullable flagger_handle:
-- - Existing UNIQUE(target_type, target_id, flagger_handle) on flags
--   means the system can flag a target multiple times only if categories
--   differ — which matches "one flag per pattern label". Reuses the
--   existing data shape.
-- - The /modlog open renderer already groups flags by target and shows
--   the flagger pseudonym in expansion. With the system handle present,
--   pattern matches surface naturally as "flagged for: spam (1) by system".

INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at)
VALUES ('0000000000000000000000000000000000000000000000000000000000000000', 'system', 0);
