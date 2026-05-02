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

### Changed — home subs nav: horizontal strip with progressive disclosure
- Active subs moved out of a vertical list into a horizontal strip at the top of the home page (phpBB/HN-style nav row). Top 3 subs by last-24h post count are always inline; the remainder hide behind `+ show all (N)`, a native `<details>` that expands into a wrapped grid (`auto-fill, minmax(180px, 1fr)`) — 3-across on desktop, 2 on tablet, 1 on phone, no media query needed. Keeps the M1-locked 720px column. Logged-in users see a `+ new` link aligned right; the strip prints a friendly "none yet" with the same `+ new` when no subs exist.
- The 24h-with-zero-fallback ordering surfaces what's lively today and quietly buries dead subs at the tail of the show-all grid.
- `static.js` Content-Type table gains `.html` and `.js` (was falling back to `application/octet-stream`, which made browsers download instead of render).
- 2 new integration tests: top-3-and-show-all rendering, and hide-show-all when ≤ 3 subs.

### Added — M3 Discussion (comments, voting, sorting)
- **Schema** (migration 003): `comments` table (post_id FK, nullable parent_comment_id self-ref, score REAL cached), `votes` table (composite PK on target_type+target_id+handle, value REAL with CHECK locking the four legal magnitudes), `posts.score` column.
- **Vote module** (`src/content/vote.js`): `castVote` toggles same-direction votes off, switches opposite-direction votes, inserts fresh votes; transactionally updates the cached score column. New-account rules per PRD §Voting: half weight (0.5), posts only (not comments), and only on posts < 24h old. Tested across full-weight, half-weight, toggle, switch, and multi-voter cache integrity.
- **Comment module** (`src/content/comment.js`): `addComment` with explicit FK validation (post exists, parent exists if specified, parent belongs to the same post). `buildCommentTree` reconstructs the hierarchy at read time in O(n); orphans (parent removed by mod in M4) surface as roots so they don't vanish.
- **Sort module** (extended `post.js`): `listPostsInSub` gains `sort: 'new' | 'old' | 'top' | 'hot'`. Hot is the HN-shaped formula `score / (age_hours + 2)^1.5` computed in-query via SQLite's POWER — no recurring rank job. Time inputs injectable for deterministic tests.
- **Routes**: `GET /sub/<name>/post/<id>` (full post + threaded comments + reply forms), `POST /sub/<name>/post/<id>/comment` (add comment), `POST /vote` (toggle/switch with `return_to` whitelisted to local paths). `?sort=` query on sub pages with a tab-style nav.
- **UI**: real vote arrows (no JS — each arrow is its own POST form), active arrow highlighted in green/amber, score formatted as integer or one decimal. Comments render hierarchically with CSS depth indents (capped at 8 levels). Reply forms collapse into native `<details>` summaries (no JS). Score ≤ −3 collapses a comment behind a `<details>` (default threshold; per-sub override planned for M4).
- **Legacy URL**: `/post/<id>` 301-redirects to `/sub/<name>/post/<id>` so any external links keep working.
- 191/191 tests (8 new schema, 11 vote, 9 comment, 8 sort, 8 M3 route). Tree assembly, tree orphan handling, `return_to` open-redirect rejection all covered.

### Added — Operator + integration documentation
- **[Operator Guide](docs/02-features/operator-guide.md)** for humans: what plato is and isn't, who it's for, three tiers of customization (forkable / tunable / locked), day-to-day operations, troubleshooting, moderation philosophy, brand identity, FAQ, how-to-fork. Calibrated for non-developer operators considering whether to run an instance.
- **[Integration Guide](docs/02-features/plato.context.md)** for AI assistants and developers: full routes table, settings reference (env vars, per-sub knobs with floors, per-handle locked rules), DB schema, eight recipes (re-skin in a minute, sub-name reservation, threshold tuning, co-mod insertion, flag-queue SQL, hot-fix constants, backup/restore, build status), vocabulary cheat-sheet, forking checklist. Mirrors the structure of [bareagent's integration guide](https://github.com/hamr0/bareagent/blob/main/bareagent.context.md) so agents wiring multiple projects see consistent shape.
- Both docs cross-reference: forkable surfaces (color tokens, logo, tagline, reservations, env, per-sub thresholds), tunable constants (`MAX_DEPTH`, `COLLAPSE_THRESHOLD`, `AUTO_HIDE_THRESHOLD`, etc.), and locked-in product decisions (magic-link auth, no uploads, HMAC handles, locked sub names, two-tier mod with public log, no tags, no private subs, no NSFW age verification). Each entry names the file and line it lives at so a fork knows the cost before it starts.

### Added — M4 Moderation (two-tier mod, flag system, public mod log)
- **Schema** (migration 004): `mod_actions` (audit log), `flags` (user reports), `bans` (per-sub), plus soft-state columns `posts.collapsed_at` / `posts.removed_at` and the matching pair on `comments`.
- **Two-tier moderation**:
  - **Soft removal (collapse).** Body folds behind a `[+] [collapsed by mod]` chip; clicking the chip expands the original content in place. Reason optional. Reversible with `uncollapse`. Modlog renders this as `soft removal`.
  - **Hard removal (remove).** Body replaced with a static `[−] [removed by mod]` stub, no fold. Reason required. Reversible only by mod via `unremove`. Modlog renders this as `hard removal`.
  - Both display side by side in the public modlog at `/sub/<name>/modlog` so the community can audit mod patterns.
- **Mod module** (`src/content/mod.js`): `MOD_ACTIONS` enum, `canModerate` (owner/co-mod resolution), transactional `recordAction` that applies state alongside writing the audit row, `isBanned` for write-path checks. Owner-only actions (`promote_mod`, `demote_mod`, `transfer_owner`) gated separately from collapse/remove/ban.
- **Ban enforcement on write paths**: `castVote`, `addComment`, and `finalizeDraft` reject banned handles in the target sub before any DB write. Resolves the sub via post (direct) or comment → post (one hop).
- **Flag module** (`src/content/flag.js`): five categories (`spam`, `harassment`, `illegal`, `off_topic`, `other`); `submitFlag` writes the flag and auto-collapses at threshold (default 3 distinct flaggers). Re-flagging is idempotent (UNIQUE collision swallowed). UI: inline flag trigger with category dropdown, no JS.
- **Public modlog**: `/sub/<name>/modlog` lists every action chronologically with mod handle, action label, target type+id, optional reason, and timestamp. System-driven actions render `mod_handle` as `<em>system</em>`.

### Added — M4 polish: community auto-uncollapse with per-sub thresholds
- **Score-snapshot at collapse** (migration 005): `posts.score_at_collapse` and `comments.score_at_collapse`. `mod_handle` made nullable so system actors can write audit rows. New `auto_uncollapse_community` action added to the action enum (rebuild via the FK-deferred table-rebuild dance).
- **Cumulative-vote auto-revert**: when a soft-removed target accumulates enough net upvotes since the collapse landed, the system lifts the collapse and writes a `mod_handle = NULL` audit row (rendered as `community overruled` in the modlog). Vote-weight rules (new-account 0.5×, ban-checks) apply to the votes that count toward the threshold. Hard removals are *never* eligible — letting cumulative votes auto-undo a hard removal could revive abusive content.
- **Per-sub, per-target thresholds with floors** (migration 006): `subs.auto_uncollapse_post` (default & floor 50) and `subs.auto_uncollapse_comment` (default & floor 20). `createSub` enforces the floors; `/sub/create` exposes both as number inputs with `min` set to the floor. Rationale: posts surface in feeds and accumulate votes faster than comments — a higher floor on posts ensures a small brigade can't overturn a soft-removal. PRD §Moderation Tier 1 documents the design.

### Changed — modlog vocabulary
- `collapse` / `uncollapse` → display as `soft removal` / `soft removal undone`.
- `remove` / `unremove` → display as `hard removal` / `hard removal undone`.
- `auto_uncollapse_community` → display as `community overruled`.
- The DB action enum stays mechanical; the user-facing labels are mapped at render time.

### Added — comment progressive enhancement
- `comment.js` static asset (~95 lines) intercepts the comment submit, fetches with `Accept: application/json`, splices the rendered fragment into the tree, bumps the count badge, and scroll-flashes the new comment. Falls back gracefully without JS — the same handler returns HTML for non-JSON requests.
- Loading-dots wave animation on the logo mark while the request is in flight (the same animation re-used at any future "loading" surface). Honors `prefers-reduced-motion`.

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

### Added — M5 Mod surface (unified `/modlog` with three modes)
- **Spec**: `docs/01-product/m5-mod-surface-spec.md` locks the design — open / inbox / audit modes, click-to-filter as toggle (not chip), 50/page, native `<details>` row expansion, public per-sub modlog stays audit-only.
- **Audit mode**: filtered chronological event stream over `mod_actions`. Filters: date (24h/all-time), type (flagged/banned/removed/all), sub picker, mod click-to-filter (with `system` for NULL), user click-to-filter (works across post/comment authors via author-handle join, plus ban targets directly). Filters compose; pager preserves them.
- **Inbox mode**: deduped target view via `ROW_NUMBER() OVER (PARTITION BY target_type, target_id)` plus an event-count column. One row per affected user/post/comment with `Nx` warm-colored badge when there's mod ping-pong. Pager counts targets, not events.
- **Open mode**: pending-flag list grouped by target. Each row is a vertical `<details>` with the entire summary line clickable. Expanded body shows the post/comment body inline (~600-char markdown preview for posts, full body for comments), flag breakdown ("flagged for: spam (2), harassment (1) · by alpha-x, beta-y"), and a three-button decision form. Default mode = open when pending exist, else audit.
- **`POST /modlog/resolve`** (one-shot decision endpoint): `uphold-soft` calls `recordAction(collapse)` + `resolveFlagsForTarget(upheld)`; `uphold-hard` does `remove` + `upheld` and requires a reason; `dismiss` resolves flags as `dismissed` and emits an `uncollapse` audit row when the target had been auto-hidden.
- **Public per-sub modlog** (`/sub/<name>/modlog`) refactored to match the audit table shape: same columns including a `user` column (target author resolved via post.handle/comment.handle), date + type filter bar, mod and user click-to-filter. Heading reads `// modlog`. Sub-feed page links to it as `← home · public //modlog`.
- **`flaggedTargetsByHandle`** filters by `resolution = 'pending'` so the flagger's button stops dimming after resolution.

### Added — M5 Defenses (forum-wide config with floor-only tightening)
- **Per-account rate limits** (`src/content/rateLimit.js`, PRD §Spam 2): account-age tiers (`new` <24h, `recent` 1-7d, `established` >7d). New: 1 post/hour, 3/day, 10 comments/day. Recent: 3/hour, 10/day, 30/day. Established: no per-account ceiling. Wired into `handleFinalize`, `handleDraft` (logged-in path), `handleAddComment` with 429 + recovery link.
- **Per-sub topic-flood limits** (PRD §Spam 3): 5 posts/day per sub for accounts <30d, 20/day for established. Stacks on top of per-account checks.
- **Outbound link cap per post** (`src/content/linkCap.js`, PRD §Spam 6): tier'd cap (1/3/5 links). Counts bare and markdown URLs, dedupes. Rejects pre-publish with cap + actual count.
- **Spam regex pattern file** (`spam-patterns.txt` + `src/content/spamPatterns.js`, PRD §Spam 9): version-controlled regex set. Conservative starter (crypto, fake jobs, wire fraud, romance scams, phone-text). Match → collapse + system flag (category=spam, note=`pattern: <source>`). Surfaces in `/modlog` open mode.
- **URLhaus blocklist** (`src/content/urlhaus.js` + `bin/refresh-urlhaus.js`, PRD §Spam 6): hourly cron fetches `urlhaus.abuse.ch`'s text feed to `data/urlhaus.txt`; app loads the host set at boot. Match by host (operators rotate paths) → collapse + system flag with note `blocked-url: <host>`.
- **Migration 007**: seeds the `SYSTEM_HANDLE` row (`'0'.repeat(64)`, pseudonym `system`) used by every system-attributed flag. Re-uses the existing flags table — no new schema for system events.
- **System-attributed audit rows (M5/B6)**: `applySpamMatches` and `applyUrlhausMatches` now write a `mod_actions` row attributed to `SYSTEM_HANDLE` with the pattern source / blocked host as the reason whenever they actually flip state. Auto-collapses now appear in `/modlog` audit + inbox modes and in the public `/sub/<name>/modlog` as `system` events — completing the public-modlog leg of the trust model. `?mod=system` filter wired across all three modlog renderers.
- **Operator config (`config.json`)**: `bin/server.js` reads optional config from project root or `PLATO_CONFIG` env. Sections: `rateLimits`, `linkCaps`, `spamPatternsFile`, `urlhausCacheFile`. Each spam knob has a PRD-locked floor; overrides must be ≤ floor (operator can tighten, never loosen). Bad config throws at boot. Per-sub overrides are intentionally **not** supported — spam limits live at the forum level; sub owners only control auto-uncollapse thresholds via `/sub/create`.

### Added — Friendly error UX
- New `errorPage(req, ctx, { title, message, links })` helper renders every error inside the full site chrome (top `siteHeader` + bottom `siteFooter`). Banned-from-sub errors parse the sub name and surface a `← back to /sub/<name>` link. Sweep applied to: login required, post failed, comment failed, rate limited, sub-create errors, mod failures, resolve failures.
- Immediate-post catch (`handleDraft` logged-in path) was missed in the original sweep; M5/B6 converts it to `errorPage` with the same ban-message back-link parsing as the finalize path.

### Changed — Header consistency
- `siteHeader` defaults to home-page chrome (`plato` wordmark + `a forum that lives at one URL`) when a page passes neither `title` nor `subtitle`. Stripped six `title: 'plato · forum'` overrides — every cross-sub view now matches the home page. Per-sub feed keeps its own identity (`/sub/<name>` + description).

### Security & correctness — M1–M4 audit fixes (M5/B7)

A code-review audit of M1–M4 (the pre-M5 surface) flagged a handful of issues that earlier review missed. Fixed before any public trial:

- **Open-redirect partial bypass** — `safeLocalRedirect()` helper rejects `//evil.com` (protocol-relative) and `/\evil` shapes in `?return_to=` across `/vote`, `/flag`, `/sub/*/mod`, `/modlog/resolve`. Prior `startsWith('/')` accepted both.
- **Atomic post finalize** — `finalizeDraft` now writes `<id>.md.tmp-<rand>`, runs the DB transaction, renames inside the success path. INSERT failure unlinks the temp; no orphan markdown ever exists under its permanent name. Previously the file was written before BEGIN, so a rolled-back INSERT left the body on disk forever.
- **Frontmatter sentinel parser** — `parseFrontmatter` now anchors on the leading `---\n…\n---\n` block and requires every interior line to look like `key: value`. A user body whose paragraph contains its own `---\n…\n---\n` no longer gets re-stripped on read.
- **Length caps on user input** — server-side: `TITLE_MAX = 300`, `BODY_MAX = 40000` in `submitDraft`; `COMMENT_BODY_MAX = 10000` in `addComment`; `NOTE_MAX = 280` in `submitFlag`. Forms had `maxlength` but a crafted POST bypassed it; the schema columns were unbounded TEXT.
- **Fresh-user first action** — `pseudonymFor()` at the top of `castVote` and `submitFlag` so a logged-in user whose first action is a vote or flag (no post yet) doesn't crash on the FK or `isNewAccount` lookup.
- **Comment under removed parent** — `addComment` now rejects when the parent post or parent comment is hard-removed. Previously, replies were accepted under `[removed by mod]` stubs.
- **Comment cycle / deep recursion** — `buildCommentTree` detects parent-chain cycles (a→a, a→b→a) and surfaces cycle nodes as roots. `commentNodeView` enforces `HARD_DEPTH = 64` so a pathological thread can't blow the render stack.
- **`transfer_owner` validation** — explicit existence check on the target handle with a clean error, before the FK fires; transactionally rolls back on failure.
- **Avatar regex** — tightened from `[0-9a-f]{1,128}` to `{64}`. Prior regex accepted 1-char "handles" producing nonsense identicons.
- **`pendingFlagCount`** — `count(DISTINCT flagger_handle)`, spelling the PRD "3 distinct flaggers" intent (equivalent under the current UNIQUE).
- **CSRF / SameSite** — verified knowless sets `SameSite=Lax; HttpOnly` on every session cookie (`node_modules/knowless/src/handlers.js:217`). No code change needed; documented for the threat model.

### Added — UX pass (M5/B8)

A small read-the-design-mockups + close-the-feedback-loop pass:

- **`/subs` directory page.** Sortable list of every sub (most recent / most posts / a-z) with description, owner pseudonym, post count, **subscribers** column (placeholder `—` until M6), and last-activity timestamp. Client-side prefix filter via the search input. Linked from the subs strip as the `all` chip.
- **`//<sub>` display style.** Replaced `/sub/<x>` text in feed post-meta, comment-feed context line, post-page breadcrumb, sub-page heading, post-form dropdown, and back-to-sub error links with `//<x>` (Reddit-shape with a leaner sigil). The actual route stays `/sub/<x>`; only display text changed.
- **Reply-count link on feed.** "47 replies" / "1 reply" / "0 replies" text link replacing the SVG bubble experiment (icon felt foreign to the terminal aesthetic; text is denser and reads in any column-width). Zero-reply state stays muted but readable.
- **Sub color accent on feed.** `/sub/<x>` links in post-meta and the communities directory now use a deterministic 8-color palette indexed by hash of the sub name (`subColorIndex` in `app.js`). Same sub keeps the same color across renders — visual anchor without an avatar / image / icon. Forks override the palette in one place (`--sub-color-0..7` on `:root`).
- **Domain hint after outbound links.** `markdown.js` link renderer now appends a `↗ host.com` span after every absolute http(s) link. Pure text, no favicon image (the design mocks had favicons via `s2/favicons` but that proxy leaks viewer→Google; self-hosting favicons reintroduces the no-uploads exception). Reader sees where each link goes before clicking.
- **Home top-nav: Posts | Comments + sort + date.** Tab strip above the home feed:
  - **Posts** (default, capped per-sub on the unfiltered feed; switches to global `listPostsAcrossSubs` when any filter is active) | **Comments** (`listRecentCommentsAcrossSubs`, `removed_at IS NULL`).
  - Sort chips: **new** (default, `created_at DESC`) | **old** (`created_at ASC`) | **top** (`score DESC`) | **hot** (post-only, HN-shape `score / (age_hours + 2)^1.5`).
  - Date chips: **24h** | **week** | **all** (default).
  - `Subscribed | All` toggle deferred to **M6** (subscriptions table doesn't exist yet).
- **Width tightening.** Body `max-width` 720px → 880px globally — comment trees + modlog table + post-meta now breathe at 4-deep nesting without wrapping. Reading column inside `<article>` bodies is unchanged.

### Tests
- 245 → 340 (95 new): rate limits (9 + 5 config), per-sub rate (3), modlog resolve flow (5), spam patterns (13), link cap (12), URLhaus (11), `modlog-http.test.js` (22) covering /modlog dispatcher modes + filter chain, `POST /modlog/resolve` decisions/permissions, end-to-end defense firing through `POST /draft`, `errorPage` chrome on banned-from-sub, the open-redirect fallback (3 cases: `//evil`, `/\evil`, legit `/sub/x`), and the M5/B8 UX wiring (`/communities` listing, `/?tab=comments` feed, `/?sort=top&date=24h` filtering). M5/B7 audit fixes (15) covering title/body/note/comment caps, atomic finalize, frontmatter round-trip, fresh-user vote/flag, removed-parent rejection, comment-tree cycle detection, transfer_owner validation.
