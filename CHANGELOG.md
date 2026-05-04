# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). plato has not yet shipped its first release; everything below is on the path to v1.

## [Unreleased]

### Added — M6/B5: inline subscribe form on `/subs` directory

New per-row column on `/subs` with an inline `subscribe`/`unsubscribe` text-link button (logged-in users only). Reuses the existing POST `/sub/<name>/subscribe` endpoint and the same `.subscribe-form` / `.subscribe-btn` styling as the sub-page header button — the directory becomes a one-screen subscription manager: browse, follow, no need to click into each sub. Hidden for anonymous (same precedent as the chip strip + sub-page header button).

### Added — M6/B4: per-sub Atom feed at `/sub/<name>/rss`

Atom 1.0 feed of the latest 50 posts in the sub, newest-first. **Excludes both hard-removed and soft-collapsed posts** — RSS bridges plato to readers in feed shape, not in drama shape; feed readers have no "this is collapsed" affordance, so a soft-collapsed entry would land too loud. Title + author pseudonym (not raw handle) + body excerpt (≤600 chars, same shape as the modlog target preview). Headers: `Content-Type: application/atom+xml; charset=utf-8`, `Cache-Control: public, max-age=300`. The sub HTML page advertises the feed via `<link rel="alternate" type="application/atom+xml">` (autodiscovery for reader extensions) plus a visible `rss` text link in the action row. 404 for missing subs. PRD §M6 → per-sub RSS feeds.

### Added — M6/B3: home-feed `subscribed | all` toggle

Replaces the placeholder chip pair on the home top-nav. `?feed=subscribed` filters both the posts and comments tabs to authored content from subs the user follows. Chip pair renders for logged-in users only (anonymous + `?feed=subscribed` is normalized to `all` so chip URLs don't carry sticky filters anonymous can't even see). Logged-in user with zero subscriptions sees an empty-state pointing at `/subs` instead of "no posts." `listPostsAcrossSubs` and `listRecentCommentsAcrossSubs` gained an optional `subNames` parameter (null = no restriction; [] = no rows, query short-circuited).

### Added — M6/B2: sub subscriptions

Migration 014 added `subscriptions(user_handle, sub_name, created_at)` with composite PK + index on `sub_name`. Inline subscribe/unsubscribe button in the sub-page header (logged-in only); POST `/sub/<name>/subscribe` is idempotent (form `action=subscribe|unsubscribe`, missing action toggles current state). `/subs?filter=mine` filters the directory to subscribed subs (anonymous silently falls back to `all`); the previously placeholder subscribers column now shows real counts. Subscriber identities are never exposed publicly — only aggregate counts. Disallowed in `robots.txt` (`Disallow: /sub/*/subscribe`). Per PRD §Front Page → Sub subscription mechanics: private (no public follower lists), exportable (M7 archive), no notifications by default — every later M6 surface (digest, ntfy, RSS preferences) keys off these rows.

### Added — M5/B16: `[new]` tag in `/modlog?mode=open` for fresh-account authors and flaggers

Triaging the mod queue is faster when mods can see at-a-glance whether the actor (target author or any flagger) is brand-new. The same 7-day window `vote.js` uses for half-weight + comment-vote block now drives a muted `[new]` chip rendered next to fresh-account pseudonyms. New `newAccountHandles(db, handles, now)` batch helper in `vote.js` returns a `Set` so one indexed query covers every handle on the page. Highest-signal use: a brigade of fresh accounts converging on the same target reads as `[new] · [new] · [new]` in the breakdown line.

### Changed — Flairs: server-validator cap 12 → 6, color-validator allowlist hex-only

Two stale-state cleanups in `src/content/flair.js`, both now matching what the editor actually emits:

- `MAX_FLAIRS_PER_SUB`: **12 → 6**. The form has rendered 6 rows since M5/B9 simplified the editor; the validator never tightened to match. No UI path reached values 7–12, so nothing is lost — the constant just stops lying. Drops three doc caveats about "legacy headroom."
- Color validator: replaced the `;{}<>"'` blocklist with allowlist `^#[0-9a-f]{6}$`. The 8 preset swatches and the free-form `<input type="color">` both emit `#rrggbb`, so an allowlist matches what the form can send and removes the inline-style XSS surface that `rgb()` / named / CSS-keyword colors carried (a CSS parser has more side doors than a five-char blocklist; allowlist is simpler and tighter). Error message clarified: "must be a 6-digit hex like `#3b82f6`."

Pre-v1, no migration shim: existing flair JSON in any DB that uses `rgb()` / named / short-hex would now fail validation on edit (per CLAUDE.md "don't add backwards-compat shims for code that isn't shipped yet"). Operators with pre-existing non-hex flairs re-pick from the swatches once.

### Changed — PRD: lock cross-instance identity non-portability

Identity does not travel across plato instances; history does. New instance = new pseudonym derived under the new master secret; archived posts and comments carry their origin-instance pseudonym strings as static attribution labels. **No "claim my old handle" flow, no email→pseudonym mapping in the archive, no magic-link reclaim**, all now explicit and rejected with rationale.

Three PRD edits: (a) §Identity Model → Forking / moving instances rewritten away from the prior "claim old pseudonym" path; (b) §Permanently out gains an explicit "Cross-instance identity portability" bullet naming each rejected mechanism (the privacy property: per-instance HMAC keeps email from being a cross-forum tracking key; the social property: "leaving is a fresh start" stays honest); (c) §Federation (Future) drops the contradicting "identity is portable via Ed25519 pubkey" sketch — the lock holds in a federated world too. Side effect: M7 export format simplifies (no email→pseudonym mapping, no claim ceremony).

### Changed — `/about` opening line: "questions or feedback" link replaces bare email; merged onto hosted-by line

Same pattern as the recent plato-repo link (`768250f`): the address sits behind the link text rather than being printed in plain. Also folds the feedback line into the hosted-by paragraph so the about page opens with one sentence, not two:

`this is a <forumName> instance, hosted by <hostedBy>. questions or feedback.`

### Docs — Config surface map + fix stale `hostedBy` / `feedbackEmail` paragraphs

Operator-guide gains a single "Config surface map" table at the top of Tier 1 enumerating every `config.json` key (branding.\*, urlDisplayMax, feedPageSize, operator.\*) and every place it reflects — UI surfaces, magic-link emails, cron-job recipients. Closing line names the two `/about` paragraphs that are deliberately NOT operator-tunable so the fork-vs-config boundary is visible in one place.

Patched two stale paragraphs that pre-dated the about-page rewrite: `branding.hostedBy` now names both surfaces (footer + `/about` opening, with the `@<forumName>` fallback rule); `branding.feedbackEmail` now names both surfaces (footer + `/about` link) and notes both are `mailto:` with the address hidden behind link text. `plato.context.md` recipe rows for forumName/tagline/hostedBy and feedbackEmail enumerate every reflection surface and point at the new operator-guide table.

### Added — Privacy-led SEO (head meta, OpenGraph, robots.txt, sitemap.xml)

Implements [`docs/04-process/privacy-seo.md`](docs/04-process/privacy-seo.md) for plato. Tier 1 declarative head tags + Tier 2 static-files-at-root, no analytics, no tracking. The privacy posture is what self-selects the right audience in search snippets.

- **`/robots.txt` route** — declarative crawl policy: `Allow: /` plus `Disallow:` on auth callbacks (`/auth/`), POST-only endpoints (`/draft`, `/vote`, `/flag`, `/login`, `/logout`, `/verify`), the per-user `/memlog`, and `/modlog/resolve`. Public reads (homepage, sub feeds, post pages, `/about`, `/modlog`, `/subs`) are crawlable. Sitemap line points at `/sitemap.xml`.
- **`/sitemap.xml` route** — dynamic. Lists `/`, `/about`, `/modlog`, `/subs`, every sub at `/sub/<name>`, every non-removed post at `/sub/<name>/post/<id>`. `lastmod` from DB timestamps; `changefreq` + `priority` per page type. Removed posts excluded — won't reappear in indexes after a hard removal. Pagination + filter params excluded; canonical pages only.
- **`<head>` per-page** — every page now emits `<meta name="description">`, `<link rel="canonical">`, `<meta name="theme-color">`, OpenGraph (`og:type`, `og:title`, `og:description`, `og:url`, `og:site_name`), and `<meta name="twitter:card" content="summary">`. Skipped intentionally per the playbook: `og:image` (defer until a design pass), JSON-LD ("skippable on principle"), `humans.txt`, `security.txt`.
- **`branding.metaDescription`** in `config.json` (optional, ASCII, ≤200 chars). Falls back to `"a {forumName} instance: Reddit-shaped forum, magic-link auth, no tracking, no analytics, public modlog — {tagline}."` so a fresh fork's search snippet surfaces the privacy posture without operator effort. `resolveBrandingMetaDescription` exported for tests.
- **Per-page customization** — `/about` description: "what {forumName} keeps about its users — and what it doesn't"; `/modlog` description: "every moderation action on {forumName}, public and audited"; `/subs` description: "every sub on {forumName}"; `/sub/<name>` description: from `sub.description` when set, otherwise default; `/sub/<name>/post/<id>` description: first ~155 chars of post body with markdown stripped, `og:type=article`, canonical = post permalink. Removed posts get a minimal fallback description so an indexed snippet never quotes a body the operator already retracted.
- **`postExcerpt(body, max)` + `escapeXml(s)` helpers** — markdown-stripping for snippets; XML-attribute-safe escaping for sitemap output.
- **No analytics, no tracking pixels, no third-party JS, no cookie banner** — already true; this commit doesn't change that and the audit checklist is in `privacy-seo.md` for quarterly re-verification.

### Fixed — Hardening pass on cron scripts + branding resolvers

- **Atomic tarball write** in `scripts/cron-backup-db.sh` — writes to `$ARCHIVE.tmp` then `mv` on success, so a tar failure never leaves a half-written file under the canonical name (was the one Important issue from the QA review). Retention can no longer pick a corrupt newest archive.
- **Tmpfs-safe staging** — SQLite `.backup` snapshots stage inside `BACKUP_DIR` rather than `/tmp`. Small VPS often has tmpfs `/tmp`; multi-GB knowless.db could OOM the staging dir.
- **`CONFIG` / `FIELD` via env in `node -e`** — both cron scripts now read `config.json` with the JS source containing zero shell interpolation. Defence in depth even though both inputs are derived from the script's own location.
- **Sendmail-failure escape hatch** in both cron scripts (`} | sendmail -t || printf 'sendmail failed' >&2`). When sendmail itself dies, cron's own MAILTO surfaces the stderr instead of the failure being lost.
- **Upper bound on `disposable-domains.txt` refresh** (50000 lines). Defends against upstream compromise dumping a list that flags every legitimate provider; the lower bound (1000) was already there.
- **`branding.rules` URL ban broadened** — was http(s) only, now blocks any `[a-z]+://` scheme (`mailto://`, `data://`, `javascript://`, `ftp://`, …) AND bare-domain shapes (`example.com`, `host.io/path`) that mail clients auto-link. Phishing-vector defence depth on the magic-link email signature.
- **ASCII regex modernized** — `/[\x00-\x1f\x7f-￿]/` → `/[^\x20-\x7e]/` in both `resolveBrandingFeedbackEmail` and `resolveBrandingRules`. Same behaviour, drops the eslint-disable, far more readable.
- **Logged-out / non-mod `?mod=me` strips the param at dispatch** rather than silently rendering an unfiltered audit. Was a UX trap (chip looked active in URL but did nothing).
- **`PRUNE_COUNT` portability** — `printf '%s' "$PRUNED" | grep -c .` handles both empty-input (returns 0) and the leading-whitespace some `wc -l` builds emit. Empty `printf '%s\n'` no longer falsely reports 1.
- **ISO-week algorithm reference** in `bin/stats-weekly.js` (Wikipedia link to ISO 8601 week-date) + load-bearing `byWeek` string-compare invariant documented (depends on `bin/stats.js` always emitting trailing `Z`).

### Fixed — Footer separator before feedback / about / modlog

The footer-links span sat directly adjacent to the hosted-by span with no delimiter, rendering as `hosted by @x feedback · about · modlog`. Prepend `· ` to the footer-links span so the chain reads `… hosted by @x · feedback · about · modlog`. Works whether `feedbackEmail` is set or not.

### Fixed — Modlog filter-bar layout + non-mod chip state

- **Sub `<select>` now renders inline with the filter chips** (next to `date · type · my decisions`), not on its own row above the table. `subFilterControl()` returns `{ inline, strip }`; the >20-subs branch hands `inline` to `modlogFilterBar` and skips the strip, the ≤20 branch leaves `inline` null and renders the chip strip as a separate `<p>` below the bar (chips would wrap awkwardly inline).
- **`modlogFilterBar` container changed from `<p>` to `<div>`** so the inline `<form>` is valid HTML — `<form>` inside `<p>` auto-closes the paragraph at parse time. `.modlog-filters` was already `display: flex`; nothing visual changes for the small-N path.
- **"my decisions" filter chip is disabled for non-mods** (logged-out OR logged-in without any moderated subs). Renders as a `<span class="filter-btn filter-btn-disabled">` with `title="mod-only: you have no actions to filter"` instead of a clickable `<a>`. Existing `.filter-btn-disabled` style (opacity 0.35, no pointer events) reused. `isMod` threaded through `renderMyModLog → renderModlogAudit`; `open`/`inbox` renderers always pass `true` since those modes are mod-gated upstream.

### Added — Public modlog, /about page, footer module, operator-supplied rules

- **`/modlog` is now public.** Logged-out and non-mod visitors get the instance-wide audit view (every mod action across every sub, newest-first, paginated, fully filterable). The "public modlog" pitch is now actually visible from the footer of every page rather than gated behind a mod login. `mode=open` and `mode=inbox` stay mod-only (those are the pending-queue + inbox views). When `?sub=` is set in `mode=open`/`inbox`, plato re-clamps to subs the viewer moderates so a mod can't peek at another sub's queue via URL editing.
- **Top-right "modlog" nav link defaults to `?mod=me`.** A mod's primary entry point lands on "my decisions" — the public footer link points at bare `/modlog` (everyone's actions). One page, two entry points, zero divergence in renderer.
- **Sub filter collapses to a `<select>` dropdown above 15 subs** (`MODLOG_SUB_CHIP_LIMIT`). Below that the inline chip strip stays — chips read better at a glance for small instances, and the row would wrap into a wall of names at higher counts. Default option is `all (N)`; `?sub=<name>` preselects. JS-on path auto-submits on change; JS-off path uses the `filter` button. Same control rendered in audit / inbox / open views via the new `subFilterControl()` helper.
- **`/about` page** rendered at `/about`. Operator-authored prelude (forum name + hosted-by) plus an optional rules section, plus project-baked sections that aren't operator-edited: data handling (what plato keeps, doesn't keep — replaces a "privacy policy" without lying about how minimal plato actually is) and the "if you don't trust this operator" fork escape hatch. Project-baked sections are uniform across forks by design — the public-honesty contract isn't operator-tunable.
- **`branding.feedbackEmail`** in `config.json` (optional). When set, footer renders `feedback · about · modlog`; when unset, footer drops `feedback`. Boot-time validation: ASCII, has-`@`-and-domain shape, ≤120 chars, no quotes/CRLF. `resolveBrandingFeedbackEmail` exported for tests.
- **`branding.rules`** in `config.json` (optional, ≤4 strings, total ≤240 chars when joined, ASCII, no URLs). Rendered as a list on `/about` AND injected into the magic-link email signature via knowless `bodyFooter`. Single source of truth — operators edit one config field, both surfaces stay in sync. URL ban is a phishing-vector defense (mirrors knowless validateBodyFooter AF-8.2). `resolveBrandingRules` exported for tests.
- **Footer is one global module.** `siteFooter()` already rendered on every page via `layout()`; now carries `feedback · about · modlog · — quote` plus the locked-mark + hosted-by line. Same DOM on every page, no per-route wiring.

### Added — Operator cron jobs (autoconfig + email)

- **`config.json operator` block** — top-level `{ email, service }` for cron tooling. The forum process ignores it; cron scripts read it instead of hardcoding paths or notify addresses. `email` falls back to stderr when unset; `service` defaults to `plato`.
- **Disposable-domains quarterly refresh** — `scripts/refresh-disposable-domains.sh` (atomic curl + sanity check, refuses upstream <1000 lines) + `scripts/cron-refresh-disposable.sh` (autoconfig, sha256-gated `systemctl restart`, sendmail report). Snapshot refreshed from 16 → 5437 domains (upstream `disposable-email-domains`, MIT). List is never fetched at runtime — a remote change can't silently expand the block surface.
- **Daily full-state backup** — `scripts/cron-backup-db.sh` tars `forum.db` + `knowless.db` + `posts/` (WAL-safe via SQLite `.backup`) to `data/backups/plato-YYYY-MM-DD.tar.gz`. 7-day retention with auto-prune; `BACKUP_KEEP_DAYS` env override. Mails operator only on failure or prune events — silent success on quiet days.
- **Daily stats snapshot + weekly digest** — `bin/stats.js` appends `{snapshot_at, users, subs, posts, comments}` JSONL to `data/stats.log` (append-only, never rewrites). `bin/stats-weekly.js` reads the log, groups by ISO week (latest snapshot per week), takes the most recent 4 weeks, renders a fixed-width WoW-delta table, mails to `operator.email`. Both support `--dry-run`. Counter definitions: users = `knowless.db.handles` (anyone who ever requested a magic link), posts/comments exclude `removed_at`.
- **`docs/02-features/cron-jobs.md`** — single source for all 5 cron jobs (URLhaus hourly + the 4 above), including a copy-paste 5-line root crontab block, manual verification recipe, sendmail preflight, disk-pressure escape hatch, and per-cadence rationale. Operator-guide gets Tier 1 entries for backup + stats + operator block; plato.context gets table rows mirroring the same surfaces (these are part of setup, not optional polish). Cross-linked from operator-guide, plato.context, and README.

### Added — Memlog activity unification

- **Memlog gains a top-level `mode:` axis** — `notifications` (default, prior behavior), `activity` (your authored posts + comments, removed content excluded), `all` (both streams merged by created_at desc, capped 200 rows). Mirrors the modlog mode pattern (`open / inbox / audit`) so memlog is one surface for everything personal: things done *to* the user, things done *by* the user. New `listActivityForHandle()` in `src/content/notification.js` returns posts + comments shaped to match the notification row contract; renderer slots them into the same table.
- **First column `type`** with values `ntfy` (notification rows) / `actv` (activity rows). At-a-glance discriminator, especially in `all` mode where rows are mixed.
- **Show / kind / mark-all-read chips hidden in activity mode** — own posts aren't unread, and the notification kind axis (comments/replies/mod actions) doesn't apply to authored content.
- **Page header rewritten** to position memlog as a unified personal log; mode-specific second line tells the user what they're looking at.
- **Activity-row navigation** routes directly via `memlogTargetLink` (no /memlog/go redirect — there's no read-state to mark on your own content).

### Fixed — `/modlog` 500 on `auto_uncollapse_community` rows

- **`modCell` rendering crashed on `mod_handle = NULL`** — the auto-uncollapse-community insert (`src/content/vote.js:140`) writes NULL by design (the event isn't a moderator decision, it's the community threshold firing), but all three modlog renderers (`renderModlogAudit`, `renderModlogInbox`, public per-sub `renderModLog`) called `mod_handle.slice(0, 8)` unconditionally. Now NULL renders as italic-muted `community` so the row distinguishes itself from a system-handle action without crashing the page.

### Changed — Mobile responsive layout pass

- **Mobile breakpoint at ≤640px** added as a single `@media` block at the bottom of `style.css`. Targets the three actual pain points: header overlap, table overflow, full-page horizontal scroll.
- **Header (brand + status)** now flex-wraps so it stacks instead of overlapping on phones.
- **Memlog table** drops `from` and `where` columns on narrow viewports; remaining `type/when/kind/snippet` fit one line per row.
- **Subs index table** drops `description`, `subscribers` (placeholder anyway), and `owner` columns; keeps `sub / posts / active` — the navigational essentials.
- **Wide tables generally** (audit modlog, inbox) get `overflow-x: auto` *within their own block*, so any residual horizontal scroll is contained inside the table, never the full page.
- **Filter chip rows** wrap to multiple lines instead of overflowing.
- **Form inputs** capped at 100% width; **login popover** anchored to viewport edge with adjusted min-width.

### Changed — `/modlog` page title

- **Top banner reads `modlog`** instead of `/modlog`. The leading slash conflated URL syntax with display; banner is now consistent with `// modlog` body H2 (the `//` is plato's section marker, kept on the H2; the H1 / browser tab title gets the clean form).

### Fixed — Sham/expired-token redirect leak

- **Anti-enumeration silent-miss now extends to the link-click stage.** Knowless's POST `/login` flow takes pains to make valid/invalid/rate-limited responses indistinguishable, but `failureRedirect` defaulted to `loginPath` (`/login`) — meaning a user clicking a sham/expired/used token landed on a "Sign in" page that telegraphed the failure. Plato now passes `failureRedirect: '/'` to knowless (`src/auth/index.js`); rejected clicks now land on home, looking identical to any logged-out visit. The home page reveals nothing about whether a login attempt occurred.

### Added — Branded `/login` page

- **GET `/login` rendered with plato chrome** instead of knowless's bare fallback form. New `renderLogin()` uses `pageView` + `siteHeader` + `siteFooter` so deliberate navigation to `/login` (bookmark, "Sign in" link, popover-escape) lands on a styled page rather than a stylesheet-less standalone HTML. Already-logged-in users see a "you're already signed in" notice with a home link. The `?next=` param round-trips through `return_to` for post-login destination.

### Added — Auto-uncollapse round-trip on flag-collapsed targets

- **Flag-count auto-collapse now snaps `score_at_collapse`** alongside `collapsed_at` (`src/content/flag.js`). Without this, posts/comments collapsed by 3+ distinct flaggers could never auto-uncollapse since `vote.js` gates the threshold check on `score_at_collapse != null`. Mirrors the urlhaus + spam-pattern paths. The third community-signal collapse path now has the symmetric reversibility: community-flag-down can be community-upvote-up. Mod-collapses still don't auto-undo (by design — `score_at_collapse` stays NULL on manual mod actions).

### Added — Modlog open-items counter chip

- **Header now surfaces an open-items counter next to `modlog`** for active mods. New `countPendingTargetsAcrossSubs(db, subNames)` in `flag.js` counts distinct (target_type, target_id) pairs with pending flags across the calling mod's subs. Renders as ` · modlog (N)` when N > 0, links to `/modlog?mode=open`. Same `.memlog-chip` styling as the unread-notifications counter. `style.css?v=20`.

### Added — Dev/prod env split

- **`npm run dev` loads `.env` then `.env.dev`** via Node 22 multi-`--env-file`, so dev-only knobs override base config. `.env.dev` (committed) holds `KNOWLESS_DEV_LOG_LINKS=true`, `KNOWLESS_MAX_NEW_HANDLES_PER_IP_PER_HOUR=100`, and `KNOWLESS_MAX_LOGIN_REQUESTS_PER_IP_PER_HOUR=1000`; `.env` (gitignored) keeps the secret + production-shaped config. `npm start` does NOT read `.env.dev`, so prod stays prod. New env wiring in `src/auth/index.js` for both per-IP cap overrides — the total-login cap (default 30/hour) silently early-returns without an SMTP attempt when exceeded, so dev sessions cross it quickly and lose the magic-link log fallback; bumped to 1000 in `.env.dev`.

### Fixed — Back-button stale-auth + login popover layout

- **`Cache-Control: no-store` is now the default** for every HTML response and redirect (`src/web/request.js`). Browser bfcache no longer revives a logged-in page after logout. Static assets and avatars bypass `send()` so their long cache stays.
- **Login form is an absolute-positioned popover** (`style.css`) instead of an in-flow flex item; opening the `<details>` no longer pushes surrounding nav chips onto a second line.
- **Memlog filter wrapper switched from `<p>` to `<div>`** so the inline `<form>` for "mark all read" sits on the same line as the `show:` / `kind:` chips. The HTML5 spec auto-closes `<p>` on a child `<form>`, which was visibly breaking the layout.
- **Header pseudonym no longer rendered bold** — `<strong>` removed from the markup; pseudonym now reads as part of the nav weight, not an emphasis.
- **Subs page "last activity" column relabeled `active`** — single word, fits the table row without wrapping.

### Changed — Owner comment cap doubled in own sub

- **Sub owners get 2× the daily comment cap when commenting in their own sub** — engagement carve-out for leading discussion. New owner: 10/day → 20/day. Recent: 30/day → 60/day. Established: still uncapped. The cap is *doubled, not lifted* — a compromised owner can't drop unlimited comments. `checkCommentRate` gained a `{ doubledForOwner }` option; `handleAddComment` passes it when `canModerate(...) === 'owner'`. One new test in `rateLimit.test.js` verifies the doubling and that the doubled cap also bites at 20.

### Fixed — Self-ban footgun

- **Mods can no longer ban themselves out of their own sub.** UI: the ban form is hidden (not dimmed) on a mod's own posts/comments — dimming would suggest "could become available." Server: `recordAction` rejects any handle-targeted action (`ban`/`unban`/`promote_mod`/`demote_mod`/`transfer_owner`) where `targetId === modHandle` with a clear error. Belt-and-suspenders for any future caller that bypasses the UI. Collapse/remove on your own content stay visible — mod-removing your own old post is the only path after the 24h author edit window. Two new tests in `mod.test.js` verify both the ban and unban guard.

### Changed — Owner carve-out from per-sub + per-hour rate caps

- **Sub owners bypass two rate caps when posting in their own sub**: (a) `checkPostRatePerSub` (5/20 by tier — the topic-flood defense, meaningless when you own the sub) and (b) the per-hour portion of `checkPostRate` (1/3/∞ by tier — the burst-pacing defense, symbolic friction for an owner seeding their freshly-created sub). The global **per-day** cap (3/10/∞ by tier) still applies, so a compromised owner account can't drain the day's quota across the instance — the spam-floor defense holds. `checkPostRate` gained a `{ skipHourly }` option; `handleDraft` and `handleFinalize` pass it when the actor owns the destination sub via `canModerate(...) === 'owner'`. Solves the founder-bootstrap UX where a fresh owner would hit "1/hour" between each post in their own sub. operator-guide and plato.context updated to mark the carve-out alongside the other anti-spam rules.

### Changed — Chrome enforcement (post-M6/B0 polish)

- **Every page now goes through `pageView`** — single canonical chrome helper. Renderers no longer compose their own header; passing `title` to `pageView` doubles as the document title *and* the wordmark replacement in `siteHeader`. ~30 bare `layout(...)` error blurbs migrated to a `quickPage(req, ctx, title, body)` sugar that wraps `pageView` so short responses stay readable. Three handlers (`handleLogin`, `handleLogout`, `redirectLegacyPost`) picked up `db` in their context so chrome reaches auth + legacy-redirect pages too. Convention is now codified in code: `layout()` and `siteHeader()` are internal to the helpers; renderers must use `pageView` or `quickPage`.
- **Header pseudonym restyled** — accent-colored (same blue as sub links) so the "click your name → memlog" affordance is visible at a glance, with hover underline. `style.css?v=17`.
- **Memlog deep-link click expands enclosing details on hash jump** — `comment.js` now walks up from `location.hash`, opens any `<details>` (long-collapsed body, score-collapsed comment, depth-folded subtree), re-scrolls, and pulses the highlight so the eye lands on the body the user was notified about. Works on every page that loads `comment.js` (which is every page). `comment.js?v=3`.
- **`/sub/create` uses the shared `siteHeader`** (via `pageView`) — was rendering a bare `<header><h1>` with no logo or login affordance.
- **`flair-form-row[hidden]` respects the hidden attribute** — `display: inline-flex` was overriding the browser-default `[hidden] { display: none }`, so the cross-sub flair picker stayed visible when the user picked a sub without flairs. Explicit override added.

### Added — M6/B0 memlog (per-user notifications)

- **New table `notifications`** (migration 013) — recipient, kind, sub_name, target, actor, snippet, created_at, read_at. One row per event the user should know about. Composite index `(recipient_handle, read_at, created_at DESC)` covers the unread-count and feed queries. `target_id` is TEXT to fit both integer post/comment ids and 64-char ban handles.
- **Three notification kinds**: `comment_on_post` (top-level comment on your post), `reply_to_comment` (someone replied to your comment), `mod_action` (your content/handle was acted on by a mod). Vote events are deliberately not recorded — score is the visible signal; per-vote pings are an engagement-bait surface plato refuses.
- **Insert sites** wired in `handleAddComment` (post author for top-level, parent-comment author for replies) and via a new `notifyModAction` helper called after every successful `recordAction` in `handleModAction` and `handleModlogResolve`. Owner-only sub-management actions (promote/demote/transfer) are intentionally not notified — those land in the public modlog where co-mods see them directly. Self-notifications are skipped at the `recordNotification` call.
- **`/memlog` route** — recipient-only personal feed, 401 to logged-out visitors. Same `table.modlog` chrome as the modlog audit view (one mental model). Filter row: `show: unread / all` × `kind: all / comments / replies / mod actions` plus a `mark all read` button that respects the active kind filter. Rows older than 90 days are lazily pruned on every GET regardless of read-state — bounded table, predictable retention.
- **`/memlog/go/<id>`** — single-click follow-through. Marks that one notification read server-side, then 302s to the deep link (`/sub/x/post/y#comment-z` for content events, `/sub/x/modlog` for ban events).
- **Header chip** — pseudonym in the top-right is now a link to `/memlog`. Non-zero unread count renders as a colored `(N)` chip next to the name, recomputed per-request via `unreadCount`. No JS, no polling.
- **CSS**: `.memlog-link` (subtle hover), `.memlog-chip` (accent-colored unread count), `tr.memlog-row-read td { opacity: 0.55 }` so read rows visually recede in the `all` view.
- **Tests**: 9 new (`notification.test.js`) covering insert/skip-self/unknown-kind/snippet-trim, listNotifications filters, mark-read scoping, mark-all kind filter, and prune retention.

### Added — M5/B15 Sub description length cap

- **Sub description capped at 200 chars.** New `validateSubDescription` rejects oversize input at `createSub` and `setSubDescription`. Form inputs on `/sub/create` and `/sub/<name>/edit` carry `maxlength="200"` so the no-JS path can't trip the server check accidentally. Closes a small but real abuse vector — long descriptions could inflate every sub-listing row.

### Added — M5/B14 Guest comment composer

- **Always-visible composer on post pages** — the `// comments` composer renders for every visitor, logged in or out. The "log in to comment" placeholder is gone. Without JS the form posts normally and the existing 401 page catches it (honest fallback). Replies still require auth-first; only the top-level composer is guest-friendly in v1.
- **Login-deferred submit (localStorage stash)** — when a logged-out visitor types a comment and hits *comment*, JS stashes `{postPath, body, ts}` under `plato:pendingComment` (24h TTL), opens the header `log in` details, focuses the email field, scrolls it into view, and shows an inline `.guest-notice` banner on the composer: *saved — sign in above to post it*. Nothing reaches the server; the comment endpoint still 401s anonymous POSTs. No new schema, no anonymous-content abuse surface.
- **Auto-submit on magic-link return** — on every page load `comment.js` checks the stash; if the user is now signed in, the path matches, and a non-guest composer is on the page, it fills the textarea and `requestSubmit()`s through the existing JSON splice path. The new comment lands in place with the same loading-dots wave as a normal logged-in submit.
- **Login `return_to`** — header login form now carries a hidden `return_to` field; `comment.js` fills it with `location.pathname + location.search` so the magic-link `nextUrl` lands the visitor back on the post they tried to comment on (instead of `/`). Validated server-side with the existing `safeLocalRedirect` helper. No new endpoint.

### Added — M5/B9 Branding + UI polish (in progress)

- **Vote widget** — single rule: arrows default grey, hover brightens to text; voted-up arrow holds green (`--up`), voted-down arrow holds blue (`--down`). Score number is the primary signal: green if positive, blue if negative, grey at zero. JS handler updates the score class live so a vote that flips the sign re-colors the number without a page reload.
- **Operator-replaceable vote colors** — `branding.colors.up` and `branding.colors.down` in `config.json`; injected into `:root` at boot via a `<style>` block. Boot-time validation rejects CSS-injection characters (`;{}<>"'`) and non-strings; bad config throws before serving any request. 8 unit tests.
- **Outbound-link badges simplified** — `BRAND_ICONS` SVG palette removed; every detected host now renders as a plain `.lh` text badge. Smaller surface, no per-domain styling, easier to fork.
- **Action button unification** — `edit` link converted from plain text to a pill matching `flag` and `collapse/remove/ban` (border, padding, radius). All action buttons now sit in `.post-actions` at the top-right of the row: feed (next to `<h2>`), post detail page (next to `<h1>`), and comments (next to the comment header). Comment header gains `flex: 1` on `.meta` so actions push right.
- **Sub page consistency** — `+ new post` button uses the same `<details class="new-post-toggle">` collapsed pattern as the home page (was an expanded form with `<h3>` heading).
- **Pill height alignment** — `.action-link`, `.flag-trigger`, and `.mod-controls .mod-btn` now share `display: inline-flex; align-items: center; line-height: 1.2; padding: 0.15rem 0.5rem; font-size: 0.78rem; border-radius: 3px`. Edit / collapse / remove / ban / flag pills align cleanly across post and comment rows.
- **Reply-count visibility** — root cause was `.meta a { color: var(--text-dim) }` outranking `.reply-count` by specificity; both zero and non-zero painted grey. Re-qualified rules as `a.reply-count` (0,2,1) so non-zero counts show `var(--accent)` + `font-weight: 600` (an active-conv signal at a glance), zero stays muted at normal weight.
- **Flair editor simplified** — slug input removed from `/sub/create` and `/sub/<name>/edit`; operators only fill **label** + **color**. New `slugifyFlairLabel()` derives the URL slug server-side (a–z, 0–9, hyphen, ≤20 chars; auto-deduped with `-2`/`-3` on collision). Color now uses native `<input type="color">` plus an 8-color preset palette (clickable swatches via `flair.js`). New `contrastTextFor(hex)` picks black or white text per pill so labels stay readable on any operator-chosen background; replaces the hardcoded `--flair-text` constant. Help text links to htmlcolorcodes.com for hex picking.
- **Flair preview on post form** — `flair.js` paints a live colored pill next to the flair `<select>` so authors see the destination tag before submitting. `data-flair-colors` JSON on the wrapper carries the slug→color map, no extra round-trip. No-JS path still works (plain select).
- **Sensitive content per-post** — migration `012_post_sensitive.sql` adds `posts.sensitive` and `drafts.sensitive` (default 0). `submitDraft` / `finalizeDraft` / `editPost` thread the flag through with default `false` so existing callers/tests are unaffected. New post form has a checkbox; edit form too. Render: full `[!] sensitive content — use discretion` banner above the post body on the post page; `[!]` mark next to the title on feed rows. Stacks with the existing per-sub flag — either source triggers the advisory; PRD's no-age-verification rule stays.
- **Form prefill on rejection** — when a logged-in user's `/draft` POST trips the link cap, post-rate, per-sub-rate, ban, or flair-mismatch checks, the page re-renders with `postRetryView` instead of redirecting to an error page. Title, body, flair, and sensitive checkbox are preserved (HTML form values, no draft-table involvement); inline `.post-error-banner` shows the reason. Status codes preserved (400 / 429). Anonymous email-magic-link flow is untouched.
- **Bare URL truncation** — markdown link renderer truncates the *visible text* of bare auto-linked URLs (where `text === href`) past `urlDisplayMax` chars to `prefix...`; `href` and a new `title="full URL"` attribute keep navigation and hover-preview intact. `[label](url)` markdown with explicit labels is left alone — operators chose that text. New operator config `urlDisplayMax` (default 30, integer 10–200) wired through `createApp` → `setUrlDisplayMax()` → module-scoped `URL_DISPLAY_MAX`. Bad value throws at boot.
- **Comment count cleanup** — removed redundant `(${comments.length})` from the `// comments · sort:` H3 on the post page; the comments are right below.
- **Flair filter location** — moved the per-sub flair filter strip below `// posts · sort:` so it sits right above the post list as a sub-filter, not between the new-post toggle and the heading.
- **Pagination — server-side pages, no infinite scroll** — every feed (home posts, home comments, sub) now over-fetches `limit + 1`, slices to `feedPageSize`, and renders a centered `← prev | page N | next 50 →` footer below the list. Disabled prev on page 1, "end" stub on the last page so the layout stays stable. `?page=N` stacks cleanly with existing `?sort=`/`?date=`/`?flair=` params, so deep positions are URL-shareable and back-button-honest. New `parsePage` / `sliceForPage` / `paginationFooter` helpers; new `offset` param threaded through `listRecentPosts`, `listRecentPostsCappedPerSub`, `listPostsAcrossSubs`, `listPostsInSub`, and `listRecentCommentsAcrossSubs` (defaults preserved — backwards compatible). No JS auto-scroll: terminal-honest pause beat, matches HN / lobste.rs / old Reddit. CSS `.page-nav` block uses bordered pill links.
- **Operator config: `feedPageSize`** — top-level integer in `config.json` (default 50, valid range 10–200). Wired through `createApp` → `resolveFeedPageSize` → module-scoped `FEED_PAGE_SIZE`. Smaller pages = more pause beats but more clicks; larger pages strain previews + link-badge build per render. Bad value throws at boot.
- **Unified home feed (per-sub diversity cap removed)** — default home no longer routes through `listRecentPostsCappedPerSub` (cap of 2 newest posts per sub). One feed shape now: `listPostsAcrossSubs` with `sort=new`/`old`/`top`/`hot` × `date=24h`/`week`/`all`. The cap was a small algorithmic intervention that conflicts with "no algorithm decides what you see"; the chips give the reader the levers, and (M6) subscriptions will turn the home into "your subs". Helper deleted from `src/content/post.js`. Test updated: `M2: home page caps recent posts to 2 per sub` → `M5/B9 polish: home page is one unified feed (no per-sub cap)`.
- **Cache busting** — `style.css?v=8`, `flair.js?v=1`.

### Changed — Locked decision: body typeface

- Added "Operator-configurable typeface" to PRD §Permanently out: the body font (`'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` at `style.css:62`) is locked. Mono-by-default is part of plato's voice; an open-ended `fontStack` string invites a typography decision operators didn't ask to make. Same precedent as HN, lobste.rs, old.reddit. Mirrored in operator-guide §What's locked in.

### Added — M5/B10 Flairs (per-sub)

- **Migration 009** — `subs.flairs` JSON column (default `'[]'`), `subs.flairs_required INTEGER NOT NULL DEFAULT 0`, nullable `posts.flair_slug` and `drafts.flair_slug`.
- **Content module `src/content/flair.js`** — `parseFlairs(json)`, `serializeFlairs`, `validateFlair`, `findFlair`. Floors: max 12 flairs per sub, slug `[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?`, label ≤ 24 chars, color is any CSS string with the same injection guard as `branding.colors`.
- **`sub.js`** — `createSub` accepts `flairs` and `flairsRequired`; new `setSubFlairs(db, name, { flairs, flairsRequired })` and `getSubFlairs(db, name)`. `flairs_required` cannot be set when no flairs are defined.
- **`post.js`** — `submitDraft` and `finalizeDraft` thread `flairSlug`. `finalizeDraft` validates the slug against the sub's current list at finalize time (a flair removed between draft and finalize rejects the post). `listPostsInSub` accepts an optional `flairSlug` filter.
- **Routes** — `/sub/create` form has a 6-row flair editor (slug / label / color) plus a "require a flair" checkbox; new owner-only `GET/POST /sub/<name>/edit` for editing flairs (and description) after creation; `/sub/<name>?flair=<slug>` filters the feed; sub-pinned post form shows a flair `<select>` (required attribute set when `flairs_required`).
- **Display** — `flair-pill` rendered in `authorMeta` next to the sub link (clickable to filter); flair filter strip at top of sub page (`all` + each flair as a colored pill); owner sees an `edit sub` link in the sub-page nav.
- **24 new tests** — `flair.test.js` (16): valid/invalid hex/rgb/named, empty→null, label/slug/color floors, duplicate slugs, CSS-injection in color, `findFlair`, `validateFlair` index in error. `flair.test.js` integration (8): persists flairs as JSON, `flairsRequired` requires flairs, invalid flair rejects whole sub creation, `setSubFlairs` replaces list, unknown sub throws, `finalizeDraft` rejects unknown/missing flair, writes `flair_slug` onto post, `listPostsInSub` filters.

### Added — M5/B11 Sensitive content per-sub flag

- **Migration 010** — `subs.sensitive INTEGER NOT NULL DEFAULT 0`. Generic content advisory; intentionally NOT labeled "NSFW" (porn is banned by default rules — labeling something NSFW in a porn-banned forum invites the very content the rules forbid).
- **`sub.js`** — `createSub` accepts `sensitive`; new `setSubSensitive(db, name, bool)`; `listActiveSubs` and `listAllSubs` return the flag.
- **UI** — checkbox in `/sub/create` and `/sub/<name>/edit`. Sub page renders an amber `[!] sensitive content — use discretion` banner under the nav row. Home active-subs strip and `/subs` directory show a small amber `[!]` mark next to the sub name. No age verification (PRD §Permanently out).
- **6 new tests** — defaults to 0, persists 1, toggles, unknown sub throws, list functions return the flag.

### Added — M5/B12 Per-sub flag-threshold override

- **Migration 011** — `subs.flag_threshold INTEGER NOT NULL DEFAULT 3`.
- **`flag.js`** — new `FLAG_THRESHOLD_FLOOR = 3` (raising allowed, lowering forbidden — a single flagger collapsing a target would defeat the "distinct flaggers" defense). New `resolveFlagThreshold(db, targetType, targetId)` resolves the effective threshold per-target (comments inherit their post's sub setting). `submitFlag` now uses the resolved value instead of the global constant.
- **`sub.js`** — `createSub` accepts `flagThreshold` (validates ≥ floor); new `setSubFlagThreshold(db, name, threshold)`.
- **UI** — number input (`min=3, step=1`) on `/sub/create` and `/sub/<name>/edit`.
- **11 new tests** — floor enforcement on create + setter, raising allowed, comment threshold inherits from post's sub, per-sub auto-hide fires at the right count, default still fires at 3.

### Added — M5/B13 My mod decisions panel

Folded into the existing `/modlog` audit surface rather than a separate page. The `[me]` filter button is renamed **my decisions** for discoverability.

- **Inline `revoke` buttons** in the audit table, only on rows where the current handle is the actor AND the action's effect is still in place.
- **`buildRevokeMap(db, actions, currentHandle)`** — batches lookups for posts (`collapsed_at`/`removed_at`), comments (same), and bans (`bans` table existence). Returns `Map<actionId, inverseAction>`.
- **`REVOKE_MAP`** — `collapse → uncollapse`, `remove → unremove`, `ban → unban`. Sub-keys-of-the-kingdom actions (`promote_mod`, `demote_mod`, `transfer_owner`) intentionally NOT one-click revocable — those changes route through the explicit mod-management surface so they require deliberate action.
- **POST flow** — buttons POST to the existing `/sub/<sub>/mod` endpoint with the inverse action; `return_to` carries the audit URL so the page comes back to where it was.
- **7 new tests** — own-active collapse offers uncollapse, no offer when target already uncollapsed, no offer for someone else's action, comment remove offers unremove, ban → unban while still banned then drops, empty when not logged in, `promote_mod` is not one-click revocable.

### Changed — M5 doc updates

- **`build-plan.md`** — B10/B11/B12/B13 marked SHIPPED with implementation details. NSFW per-sub flag renamed to "Sensitive content per-sub flag" with rationale (porn banned → NSFW label invites what the rules forbid). Obsolete favicon-cache section removed (M5/B9 rolled back the brand-icon palette in favor of plain hostname text).
- **PRD §Permanently out** — added "NSFW labeling" entry: `sensitive` is the generic primitive; the NSFW label is excluded specifically because it invites porn that the default rules ban. Forks that want porn can rename/repurpose.

### Tests
- 340 → 408 (68 new): branding colors (8), flair unit (16), flair integration (8), sensitive (6), per-sub flag threshold (11), mod-revoke (7), plus existing pass-through.

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
- **Operator branding (`config.json:branding`).** Three knobs — `forumName` (top + footer wordmark + page title), `tagline` (home-page subtitle), `hostedBy` (footer line `a <forumName> instance hosted by <hostedBy>`, line hidden when empty). The 3-blue-dot logo and the footer quote `— "opinion is the medium between knowledge and ignorance."` are locked across all forks. Wired through `createApp({ branding })` and `bin/server.js`.

### Tests
- 245 → 340 (95 new): rate limits (9 + 5 config), per-sub rate (3), modlog resolve flow (5), spam patterns (13), link cap (12), URLhaus (11), `modlog-http.test.js` (22) covering /modlog dispatcher modes + filter chain, `POST /modlog/resolve` decisions/permissions, end-to-end defense firing through `POST /draft`, `errorPage` chrome on banned-from-sub, the open-redirect fallback (3 cases: `//evil`, `/\evil`, legit `/sub/x`), and the M5/B8 UX wiring (`/communities` listing, `/?tab=comments` feed, `/?sort=top&date=24h` filtering). M5/B7 audit fixes (15) covering title/body/note/comment caps, atomic finalize, frontmatter round-trip, fresh-user vote/flag, removed-parent rejection, comment-tree cycle detection, transfer_owner validation.
