-- Migration 024: drop the legacy 'general' sub on fresh installs.
--
-- Migration 002 created a 'general' sub as the FK target for backfilling
-- M1-era posts (no sub abstraction yet). On instances with real M1
-- archives that backfill landed real posts/drafts there, and the row
-- has archaeology value — those installs MUST keep general so their
-- archive stays readable. PRD §Permanently out has the carve-out.
--
-- On fresh installs the backfill INSERT is a no-op (no M1 posts to
-- migrate), and 'general' becomes pure dead weight: a NULL-owner row
-- that's hidden from every UI surface, can't accept new posts, and
-- exists only to satisfy the FK that nothing actually points at.
-- This migration removes it for that case.
--
-- Idempotent. The DELETE is conditional on no rows in posts/drafts/
-- sub_mods referencing 'general'. Archive-bearing installs are
-- preserved; everyone else loses the cruft.

DELETE FROM subs
 WHERE name = 'general'
   AND NOT EXISTS (SELECT 1 FROM posts    WHERE sub_name = 'general')
   AND NOT EXISTS (SELECT 1 FROM drafts   WHERE sub_name = 'general')
   AND NOT EXISTS (SELECT 1 FROM sub_mods WHERE sub_name = 'general');
