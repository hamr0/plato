-- Migration 016: M5/B12 — subs.disabled_at for the read-only state.
--
-- Design notes:
-- - disabled_at: NULL = active. Non-null = unix-ms timestamp when the
--   sub entered read-only state. While set, all POST routes scoped to
--   the sub (post, comment, vote, flag, mod action) reject; reads stay
--   open.
-- - Two entry paths to the disabled state:
--     1. Mod step-down with no co-mods (M5/B12, in-app).
--     2. Auto-disable after 30 days of no mod activity (M5/B12, cron).
--   Both write the same column. No `disabled_reason` enum — recovery
--   path diverges naturally on whether any mods exist:
--     - Mods exist  → any mod can flip disabled_at = NULL via the
--                     /sub/<name>/edit reactivate form.
--     - No mods    → operator reassigns owner via SQL, that mod then
--                     reactivates in-app. Same flow, two-step.
-- - State is just state, not a consequence. A sub may cycle
--   active ↔ read-only freely; no cooldown, no escalation, no count.

ALTER TABLE subs ADD COLUMN disabled_at INTEGER;

CREATE INDEX idx_subs_disabled_at ON subs(disabled_at) WHERE disabled_at IS NOT NULL;
