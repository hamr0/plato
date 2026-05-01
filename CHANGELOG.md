# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). plato has not yet shipped its first release; everything below is on the path to v1.

## [Unreleased]

### Added — M1 Foundation
- Project scaffolding: layered repo structure, idempotent SQL migrations runner, vanilla `node:http` server.
- HTML rendering: tagged-template `html\`\`` helper with safe-by-default escaping and `raw()` opt-out for trusted output (rendered markdown, inline SVG).
- Static-asset handler at `/static/*` with path-traversal protection.
- Initial schema (`handles`, `posts`, `drafts`) with foreign-key enforcement and STRICT typing.

### Added — M1 Auth
- Knowless library-mode integration. Forum derives identity via HMAC-SHA256 of the email; plaintext email is never stored.
- Configuration validation at boot: missing required environment fails fast with clear errors.
- Forking property: each instance has its own master secret, so the same email yields different pseudonym IDs across instances by design.

### Added — M1 Identity
- Deterministic two-word pseudonym generation, cached per handle, UNIQUE per instance.
- Collision retry uses crypto-random seeds (deterministic suffix retries had pathological collision chains in `unique-names-generator`'s seed→combo mapping).
- Deterministic identicon avatars (32×32 dicebear bottts-neutral SVG) — no uploads, ever.

### Added — M1 Markdown
- Secure rendering of post bodies. Raw HTML in source is escaped, never executed; image markdown is rewritten as a link (PRD §no inline embeds); URL schemes are allow-listed (`http(s)`, `mailto`, fragments, relatives) — `javascript:`, `data:`, `vbscript:`, `file:` are dropped.
- 11 lock-in security tests guard against silent regressions when marked upgrades.

### Added — M1 Content
- Post lifecycle: submit a draft, finalize after magic-link click, read posts back. Markdown body lives on disk as `posts/<date>-<id>.md` with frontmatter; the database is the index, regenerable from the file tree.
- Atomic finalize: post insert + draft update happen in a single transaction. Idempotent — re-finalizing an already-finalized draft returns the existing post id.
- XSS protections from `renderMarkdown` carry through end-to-end (verified by an integration test that puts `<script>` and `javascript:` URLs through the full draft → finalize → render path).

### Added — M1 Disposable-domain blocklist
- Forum-side disposable-email domain check (PRD spam rule 7). Blocked at form submission, before knowless is invoked. Operator owns the blocklist file; M5 adds the cron sync to the upstream community-maintained list.

### Added — M1 Integration (M1 done)
- HTTP request helpers (body reader, form/cookie parsers, send/redirect).
- Application factory `createApp({db, auth, disposableDomains, postsDir, baseUrl})` wires every M1 module behind the routes: `GET /`, `POST /draft`, `GET /draft/<id>/finalize`, `GET /post/<id>`, `GET /avatar/<handle>.svg`. Knowless handlers mounted at `/login`, `/auth/callback`, `/verify`, `/logout`.
- Terminal-aesthetic styles for posts, votes, author meta, and post-body article rendering.
- End-to-end integration test: a stranger posts via the form, the magic link is captured by an injected mailer, the click flow drives the redirect chain, and the finished post renders with pseudonym + identicon. Cookie jar preserves the session across hops.

### Added — M2 Multi-tenant content
- Schema migration `002_subs.sql`: `subs` (name PK, nullable owner, default sort) and `sub_mods` (composite PK on sub_name/handle). `posts.sub_name` and `drafts.sub_name` gain real foreign-key constraints to `subs(name)` via SQLite's table-rebuild dance with `defer_foreign_keys`. Existing rows backfill into a `general` sub created by the migration with NULL owner.
- `src/content/sub.js`: validator (lowercase + alphanumeric + hyphen, 3–30 chars, no leading/trailing hyphen), reserved namespace (`admin`, `mod`, `system`, `api`, `auth`, `assets`, `static`, `health`), transactional `createSub`, `getSubByName`, `listActiveSubs` (24h post count). Names are locked at creation per PRD §subs.
- Front page (`GET /`) now shows active subs (last-24h post count) and recent posts capped at 2 per sub via SQL `ROW_NUMBER() OVER (PARTITION BY sub_name)`.
- `GET /sub/<name>` lists posts in a sub and offers a contextual post form. `GET /sub/create` and `POST /sub/create` cover sub creation (logged-in only). `POST /draft` accepts a `sub_name` field and validates against existing subs.
- `applyAllMigrations` test helper replaces the per-file MIGRATION_001 constant — future migrations are picked up automatically.

### Added — M3 Discussion (comments, voting, sorting)
- **Schema** (migration 003): `comments` table (post_id FK, nullable parent_comment_id self-ref, score REAL cached), `votes` table (composite PK on target_type+target_id+handle, value REAL with CHECK locking the four legal magnitudes), `posts.score` column.
- **Vote module** (`src/content/vote.js`): `castVote` toggles same-direction votes off, switches opposite-direction votes, inserts fresh votes; transactionally updates the cached score column. New-account rules per PRD §Voting: half weight (0.5), posts only (not comments), and only on posts < 24h old. Tested across full-weight, half-weight, toggle, switch, and multi-voter cache integrity.
- **Comment module** (`src/content/comment.js`): `addComment` with explicit FK validation (post exists, parent exists if specified, parent belongs to the same post). `buildCommentTree` reconstructs the hierarchy at read time in O(n); orphans (parent removed by mod in M4) surface as roots so they don't vanish.
- **Sort module** (extended `post.js`): `listPostsInSub` gains `sort: 'new' | 'old' | 'top' | 'hot'`. Hot is the HN-shaped formula `score / (age_hours + 2)^1.5` computed in-query via SQLite's POWER — no recurring rank job. Time inputs injectable for deterministic tests.
- **Routes**: `GET /sub/<name>/post/<id>` (full post + threaded comments + reply forms), `POST /sub/<name>/post/<id>/comment` (add comment), `POST /vote` (toggle/switch with `return_to` whitelisted to local paths). `?sort=` query on sub pages with a tab-style nav.
- **UI**: real vote arrows (no JS — each arrow is its own POST form), active arrow highlighted in green/amber, score formatted as integer or one decimal. Comments render hierarchically with CSS depth indents (capped at 8 levels). Reply forms collapse into native `<details>` summaries (no JS). Score ≤ −3 collapses a comment behind a `<details>` (default threshold; per-sub override planned for M4).
- **Legacy URL**: `/post/<id>` 301-redirects to `/sub/<name>/post/<id>` so any external links keep working.
- 191/191 tests (8 new schema, 11 vote, 9 comment, 8 sort, 8 M3 route). Tree assembly, tree orphan handling, `return_to` open-redirect rejection all covered.

### Changed — kill default sub
- The legacy `general` catch-all is hidden from new-post forms. Posts must land in a sub with a real owner-mod, per PRD §Permanently out. Existing posts at `/sub/general` remain readable for archaeology; the operator can later delete the sub or rename it. First-run on a fresh instance shows an empty state until someone creates the first sub.
- Anonymous users now see a real sub picker (no hidden `general` fallback). If no postable subs exist, both anon and logged-in users see "create a sub first" instead of a post form. `POST /draft` rejects `sub_name=general` with a 400 explaining the archive-only status.
- PRD §Permanently out and §Front Page updated. Added a new §Age verification and NSFW section locking that as an operator-layer concern, not a forum feature.

### Changed — sub-page preview length
- Sub-page post previews dropped from ~1500 to ~600 chars. The 1500-char inline body produced unscrollable sub pages on busy subs; 600 is roughly double the home preview, fits a short reply or a long post's lede, and keeps the permalink as the read-and-(M3+)-comment destination. PRD §Front Page reflects this.

### Changed — UX iteration on M2
- After publishing, redirect lands on `/sub/<name>` instead of `/post/<id>`. Posts appear in their sub feed in context; the permalink stays canonical for sharing.
- Header restructured: title left, login status (avatar + pseudonym + logout) floats right via flex layout. Anonymous users see a single muted hint line; logged-in users see a compact status block. Frees the page strip for content.
- Post lists render a body preview: home shows ~280 chars (first paragraph) with `read more →` when truncated, sub pages show up to ~1500 chars (effectively full body for typical posts). `/post/<id>` continues to render the full body. Reads markdown files on demand — fine at M2 scale; revisit when post counts justify a `body_preview` column.
- `getPostPreview` is tolerant of missing files (returns empty preview rather than 500), so DB/file-tree drift never breaks a list view.
- `finalizeDraft` now returns `subName` alongside `postId` so the redirect doesn't need a follow-up DB query.
- PRD §Front Page and §Authentication Flow updated to match.

### Fixed
- Logged-in users no longer re-do the magic-link round trip on every post. The `/draft` form omits the email input when a session exists, and the handler short-circuits to `submitDraft` + `finalizeDraft` inline — matching PRD §post-flow step 6 ("Subsequent posts in the same session use the cookie. No re-click required."). Two integration tests cover the new path.

### Changed
- Repository renamed from `plato-forum` to `plato`. Documentation and code now live in one repository.
- POC graduated and was archived. Phase 2 implementation started in a clean repository per AGENT_RULES POC discipline.
