-- Migration 011: per-sub flag threshold (M5/B12)
--
-- PRD §Spam 7: "auto-hide on N distinct flaggers, configurable per-sub,
-- default 3 unique flaggers." Previously hardcoded; now operator-tunable
-- per sub. Floor is 3 — going lower would let a single flagger collapse
-- a target, defeating the "distinct flaggers" defense entirely. Higher
-- means more flaggers needed before auto-hide kicks in (more permissive
-- for niche subs where small audiences would otherwise auto-hide normal
-- content). Sub owners pick at sub creation; editable via owner-only
-- /sub/<name>/edit.

ALTER TABLE subs ADD COLUMN flag_threshold INTEGER NOT NULL DEFAULT 3;
