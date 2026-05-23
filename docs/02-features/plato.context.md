# plato — Operator Integration Guide

> For AI assistants and developers installing, running, forking, or extending a plato instance.
> v0.12.5 — M5 (mod surface + spam defenses + branding) → M6 (subscriptions + token-gated RSS) → M7 (Ed25519-signed archives + URL-fetch sub-import + OpenTimestamps anchor) → M8 (light/dark theme + `/healthz` + `bin/backup.sh` + `bin/health-watch.sh` + sticky note + stats/digest) → post-M8 (canonical deploy guide validated end-to-end against terribic.com; eval Docker image; mail unification via knowless+postfix+opendkim; Ubuntu 24.04 primary path; Step 14 inbound aliases + Step 15 reputation tools). 0.10.0 closed cross-sub fan-out: `established` tier capped at 6/hr, 20/day, 60 comments/day (was uncapped); owner doubling on per-day post cap added for `recent` + `established` (new tier holds at 3/day as brigade-guard). 0.10.1 hardened the M8/B0 light-theme toggle for mobile after a long terribic test session: class-based switching (was attribute-based — fixed iOS Safari CSSOM-invalidation bug post-navigation), cookie+localStorage dual persistence (mobile Firefox's privacy mode session-clears localStorage between refreshes), bfcache `pageshow` re-sync handler, defensive try/catch around storage writes. 0.10.2 made `<pre>` code blocks soft-wrap on narrow viewports (was `overflow-x: auto`, broke prose-shaped fenced blocks on mobile by extending the `<pre>` past the viewport with internal horizontal scroll); switched `article pre` to `white-space: pre-wrap; overflow-wrap: anywhere;` so prose wraps cleanly and real code with critical alignment degrades to wrapped lines on phones — better failure mode for a prose-first forum than horizontal scroll. 0.10.3 reordered the magic-link email body (security warning leads above the URL, last-sign-in block stays below it, civility footer plus per-instance stub line under the `-- ` delimiter) via knowless v1.1.5's `bodyOverride` recipe — plato opens a parallel `createStore(KNOWLESS_DB_PATH)` read-only handle, derives the handle from the email at submit time, looks up `lastLoginAt`, threads it into `composeMailBody`. New `branding.hostedBy` + `branding.feedbackEmail` config drive the stub line `a plato instance hosted by @<X> . <Y>`. knowless stayed pure-doc at v1.1.5; callback-arg widening was drafted and rejected by the maintainer under walk-away ("first adopter asks and we extrapolate isn't the gate"). 0.10.4 was a UX-honesty wave: rate-limit messages stop revealing the cap and tier name, the time-to-unblock is bucketed into six coarse English ranges (`shortly`/`in less than an hour`/`in a few hours`/`later today`/`tomorrow`/`in a couple of days`) so probing the boundary doesn't leak the rolling-window length; per-block `reason` field carries precise diagnostic detail to operators (`{tier, capField, cap, count, msUntilUnblocked}`) so logs and tests stay rigorous. Same wave fixed three orthogonal paper-cuts: textarea body cap rejected at-cap submissions because browsers send CRLF and the client-side counter measures LF — `submitDraft`/`editPost`/`addComment`/`editComment` now normalize CRLF→LF before length-check + storage; the phone-shape spam regex (`\b(?:text|whatsapp|telegram).{0,30}...`) was matching dates like `2026-05-09` because the digit-and-separator class accepted any 10-char shape — tightened to require ≥9 actual digits via `\d(?:[\s().-]*\d){8,}`; modlog audit reason enriched when a mod overrules a system auto-collapse — the resulting `uncollapse` row carries `system: <flag.note> → mod: <reason>` so the false-positive trail is honest in `/modlog`. 0.11.0 was a capability release: post-in-any-language (seven user-content render sites carry `dir="auto"` + `unicode-bidi: plaintext` on block children, chrome stays English-LTR with explicit `dir="ltr"` on the header), `og:image` link-preview banner (1200×630 PNG of plato's three-dot mark at `/static/og.png`, served from the repo, `og:image:alt` reads `branding.forumName` so a fork rebrand still surfaces fork-correctly; `twitter:card` upgraded to `summary_large_image`), modlog audit-string null-fallback (mod-dismiss without a typed reason renders `→ mod: dismissed without reason` instead of the literal string `null`), and a PRD lock making post titles immutable. 0.11.1 was a first-contact-with-monitoring hotfix: `/healthz` and `/static/*` now accept HEAD as well as GET (uptime monitors and link-preview validators HEAD by default), plus a deploy-guide troubleshooting entry for `git config --global --add safe.directory` (exit hatch, not a fix — the canonical recipe `sudo -u plato -H bash -c '...'` for every git/npm/migrate step is what keeps uid drift from cascading into `error: insufficient permission for adding an object to repository database`). 0.12.0 was a mobile mod-surface pass driven by a Firefox-mobile-view session reviewing posts on terribic: at ≤640px the post-feed mod actions wrap below the title (`flex-basis: 100%` on `.post .body .post-title-line h1, h2` so `.post-actions` drops to its own row) instead of crushing long Arabic/Greek/CJK titles into 5 lines next to a button column; `/modlog` tables card-stack via `.modlog-page` wrapper + per-`<td>` `data-label` attrs, with cells flowing inline separated by `·` and reason on its own line; subs index hides the subscribe column and surfaces a passive `<span class="subscribed-mark">[in]</span>` chip after the sub name for subscribed-and-not-modded subs. Same release also promoted mod controls (`collapse · remove · ban`) from outlined-pill chrome with `--text-dim` text to warm-accent text verbs *across all viewports* — `--accent-warm` was already declared as "mod highlight" in the palette comment but mod-controls were the one site not honoring that, and the temperature shift mirrors `read more →`'s `--accent`-for-nav idiom. Dropped `.mod-btn-warn` entirely (the verb itself carries the state: `unban` vs `ban`), open-state feedback on `.mod-confirm[open]` shifted from border-color flip to `font-weight: 600`. 0.12.1 followed up with three live-on-terribic fixes: `[in]` chip now renders on subs you mod (mods are auto-subscribed at the data layer — the 0.12.0 suppression hid a true fact); `edit` link unified with `.mod-btn` (was still an outlined `--text-dim` pill while collapse/remove rendered as warm text verbs — one strip, one register), with a `.post-actions > * + *::before { content: "·" }` follow-up so the strip reads uniformly `edit · collapse · remove · ban` instead of gap-only between `edit` and the mod-controls block; PRD §Permanently out gained "Viewer-facing profile / per-user portal" — pseudonyms render as plain `<span class="name">` (never a link), no `/user/<handle>` route, no hover-popup, no per-user history aggregator. The byline (display name + account age bucket + sub tenure + per-post score) is the entire viewer-facing context surface; mods who need cross-sub user context use `/modlog?user=<handle>`. Earlier PRD drafts described a profile page + hover-verdicts; both were aspirational, never implemented, and decided-against on reflection (aggregation surfaces train parasocial scrutiny that the byline obviates). 0.12.2 closed two mobile-overflow sources surfaced in the same phone-review session: the markdown renderer now inserts `<wbr>` between outbound `<a>` and the glued `<span class="ext-host">↗ host.com</span>`, so the host can wrap to its own line instead of pushing the row past viewport (anchor + ext-host was previously one unbreakable unit); the sub-manage page's `.flair-editor .flair-row` and `.sub-thresholds .threshold-row` stack vertically at ≤640px so fixed-basis flex children stop competing for horizontal space. 0.12.3 made flair edits cascade — what the editor shows is what posts display. Renames (row's slug changes) move posts and drafts to the new slug via `UPDATE posts/drafts SET flair_slug = ? WHERE sub_name = ? AND flair_slug = ?`; clears (label emptied or slug no longer present) null the flair_slug. Carry-over detection prevents spurious cascades on swap or move. The hidden `flair_old_slug_${i}` input per editor row carries identity through the form submit so the handler can derive renames/removes via `computeFlairChanges` (pure, in `src/content/flair.js`); `cascadeFlairChanges` (in `src/content/sub.js`) runs the UPDATEs inside the same transaction as `setSubFlairs`. PRD §Moderation gained "Flair edits cascade" as the locked behavior — deliberate divergence from the post-title-immutable posture, because flair is a filing slot and title is the contract. deploy-guide gained a one-shot `&&`-chained upgrade bundle option, hardcoded the verify-URL example, and added a `?v=N` cache-token check for CSS-bumping releases. Apache 2.0 (LICENSE in repo). 0.12.4 retitled the `/about` data-handling block to `privacy`, promoted it to position #2 (directly under `rules`, above `how this place works`), gave its `<section>` `id="data-handling"` as a deep-link anchor, and added a `privacy` link to the global footer reading `feedback · about · privacy · modlog` with `privacy → /about#data-handling`. Same prose, same single source of truth — no new route, no duplicate copy, no operator override surface (the block is project-baked and uniform across forks by design; a self-promoted "verify with extension X" affordance was considered for the block and rejected for the same reason). The rename + reorder is the smallest possible surface that gives a privacy-conscious visitor a labelled page-section to find via Ctrl-F or via the new footer link — the closest thing to a `/privacy` page without minting a duplicate template (a standalone `/privacy` route was considered and not added; the footer link to the anchor avoids the drift hazard of duplicated prose). 0.12.5 was the 0.12.4→0.12.5 security review: added an SSRF guard to the sub-import URL fetch (the one place plato makes an outbound request from user input) — `src/archive/ssrf.js` resolves the pasted host and refuses private/loopback/link-local/reserved addresses (incl. the `169.254.169.254` cloud-metadata endpoint, IPv6 `::1`/`fc00::/7`/`fe80::/10`, and IPv4-mapped forms), re-validating on every redirect hop (`bin/run-import-queue.js` switched from `redirect: 'follow'` to manual hops, cap 5) so a public URL can't 302 into an internal one; the bytes-trust model is unchanged (SHA-256 + Ed25519 still verify everything before import), only the connection target is now bounded to public space — without the guard a logged-in user could turn the importer into a blind-SSRF oracle (the `import_failed` memlog reason leaks internal reachability). Same release added four always-on response headers set once at handler entry (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: same-origin`) — defense-in-depth, since authenticated POSTs are already SameSite=Lax-protected and HTML is escaped; no script/style CSP because inline `<script>`/`<style>`/`style=` are load-bearing without per-block nonces, and HSTS stays at the nginx TLS edge. Two review findings were re-verified and dropped as non-issues: per-IP login/handle caps are not globalized behind nginx (knowless defaults `trustedProxies` to the loopback set, so it already honors `X-Forwarded-For` from the local proxy), and the `0.0.0.0` listener bind is firewalled off on the documented deploy (`ufw default deny incoming`, only 22/80/443). Version surfaces: footer (`· v<version>`), startup log line, README shields.io badge — all read package.json once at boot.
>
> Full version trail in [CHANGELOG.md](../../CHANGELOG.md). Earlier milestone-close points retroactively tagged 0.5.0 (M5) → 0.6.0 (M6) → 0.7.0 (M7) → 0.8.0 (M8). 0.9.0 = first canonical deploy.
>
> Stack: Node.js >= 22.5 | five runtime deps | one HTTP port | SQLite single-file | no build step.
>
> Human-readable companion: [Operator Guide](operator-guide.md)

## What this is

plato is a Reddit-shaped, single-binary, single-database forum. One Node process serves the whole site over HTTP. The DB is a single SQLite file. Auth is magic-link only — no passwords, plaintext email is never stored. Pseudonyms are deterministic and identicons are generated on demand. Posts are markdown files on disk; the database is an index regenerable from the file tree.

```
git clone https://github.com/hamr0/plato
cd plato && npm install
cp .env.example .env       # edit KNOWLESS_SECRET (32-byte hex)
npm run migrate
npm start                  # serves on PORT (default 8080)
```

The forum is one operator's instance. If a moderator goes bad or the operator changes their mind, the recipe to fork is: copy `posts/`, copy `forum.db`, set a new `KNOWLESS_SECRET` (handles re-derive per instance — same email yields different pseudonym IDs across forks by design), run migrations, start.

## Which knobs do I need?

| I want to... | Touch this |
|---|---|
| Change the listening port | `PORT` in `.env` |
| Change the DB path | `DB_PATH` in `.env` |
| Send real magic-link emails | `KNOWLESS_SMTP_*` in `.env` |
| Change the public URL in magic links | `KNOWLESS_BASE_URL` in `.env` |
| Add or remove disposable-email domains | `disposable-domains.txt` |
| Re-skin the forum (colors, logo color) | `:root` block in `src/web/static/style.css` |
| Replace the favicon / logo mark | `src/web/static/favicon.svg` and `logoMark()` in `src/web/app.js` |
| Change the forum name + tagline + "hosted by" line | `config.json` `branding` block (`forumName`, `tagline`, `hostedBy`). `forumName` reflects in top + footer wordmark, every page `<title>`, magic-link header, `og:site_name`, `/about` opening, and the default meta description; `tagline` reflects on the home subtitle and default meta description; `hostedBy` reflects in the footer line and `/about` opening (falls back to `@<forumName>` on `/about` when unset). Logo + footer quote are locked. See [operator-guide § Config surface map](operator-guide.md#what-you-can-change-easily) for the full table. |
| Reserve more sub-name namespaces | `RESERVED_SUB_NAMES` in `src/content/sub.js` |
| Change new-account window or weight | `NEW_ACCOUNT_WINDOW_MS` / weight literal in `src/content/vote.js` |
| Change young-post window for new-account voting | `YOUNG_POST_WINDOW_MS` in `src/content/vote.js` |
| Change auto-uncollapse threshold for a sub | per-sub via `/sub/create` form (post ≥ 50, comment ≥ 20) |
| Change auto-hide flag threshold | per-sub via `/sub/create` form or owner-only `/sub/<name>/edit` (floor 3, raise-only). Floor and global default in `FLAG_THRESHOLD_FLOOR` / `AUTO_HIDE_THRESHOLD` in `src/content/flag.js`. |
| Add flairs / mark sensitive | per-sub via `/sub/create` form or owner-only `/sub/<name>/edit` |
| Subscribe / unsubscribe to a sub | inline button in the sub-page header (logged-in only) → POST `/sub/<name>/subscribe` (form `action=subscribe\|unsubscribe`, missing toggles). View subscribed subs at `/subs?filter=mine`. M6/B2. Subscriber identities are private; only aggregate counts surface (in the `/subs` directory column). |
| Override vote arrow colors | `branding.colors.{up,down}` in `config.json` |
| Tighten rate limits / link cap | `config.json` at project root — see Operator Config below |
| Append spam regex patterns | `spam-patterns.txt` at project root, one regex per line |
| Refresh URLhaus blocklist | wire `bin/refresh-urlhaus.js` to system cron, hourly — see [`cron-jobs.md`](cron-jobs.md) |
| Refresh disposable-email blocklist | install `scripts/cron-refresh-disposable.sh` quarterly. See [`cron-jobs.md`](cron-jobs.md) |
| Daily full-state backup | install `scripts/cron-backup-db.sh` daily — tarballs `forum.db` + `knowless.db` + `posts/`, 7-day retention with auto-prune. See [`cron-jobs.md`](cron-jobs.md) |
| Weekly stats digest by email | install `bin/stats.js` (daily snapshot) + `bin/stats-weekly.js` (Mon 06:00 UTC digest). 4-week WoW table delivered to `operator.email`. See [`cron-jobs.md`](cron-jobs.md) |
| Set operator contact (cron emails, restart unit) | `config.json` `operator` block (`email`, `service`) |
| Set the feedback contact link | `config.json` `branding.feedbackEmail`. Reflects in **two** places: the global footer (`feedback · about · modlog`) and the opening sentence of `/about` ("questions or feedback" mailto link). Address sits behind link text in both. ASCII, valid email shape, ≤120 chars. |
| Set the site rules (rendered on `/about` + magic-link email signature) | `config.json` `branding.rules` (array, ≤4 strings, joined ≤240 chars, printable ASCII, no URI schemes / bare domains — phishing-vector defence on email footer) |
| Override the search-engine snippet for the homepage | `config.json` `branding.metaDescription` (ASCII, ≤200 chars). Defaults to a privacy-posture-forward line so fresh forks self-document. Per-page descriptions auto-derived; see [`docs/04-process/privacy-seo.md`](../04-process/privacy-seo.md). |
| Crawl + index policy | `/robots.txt` (Allow: /, Disallow auth + POST + per-user routes); `/sitemap.xml` (homepage, sub indices, post pages, /about, /modlog, /subs). Both routes are dynamic, derive from current DB content. |
| Audience signals | `/humans.txt` (operator handle + project + Apache-2.0 + privacy-stance one-liners) and `/.well-known/security.txt` (RFC 9116; Contact = `branding.feedbackEmail` or GitHub issues; Expires auto-renews 365d from each request). Both static-shape, no operator config beyond what's already in branding. |
| View public moderation log | `/modlog` — instance-wide audit, no login required. `mode=open`/`mode=inbox` stay mod-only. Sub filter chips collapse to `<select>` inside the filter bar above 15 subs (`MODLOG_SUB_CHIP_LIMIT`). "my decisions" chip disabled for non-mods. Open-mode rows mark the flagged target's author and each flagger with a muted `[new]` chip when their handle is inside the 7-day new-account window (`newAccountHandles` in `vote.js`). |
| Change score-collapse threshold | `COLLAPSE_THRESHOLD` in `src/web/app.js` (default −3) |
| Change max comment-tree depth | `MAX_DEPTH` in `src/web/app.js` (default 4) |
| Change inline comment preview length | `COMMENT_PREVIEW_CHARS` in `src/web/app.js` (default 280) |
| Change post-preview lengths (home / sub) | `getPostPreview` callers in `src/web/app.js` |
| Add a new database column | new `src/db/migrations/NNN_*.sql` then `npm run migrate` |
| Inspect mod actions for a sub | `GET /sub/<name>/modlog` (public) |
| Hard-reset a fresh instance | `rm forum.db && rm -rf posts && npm run migrate` |

**Most operators only touch `.env` and the `:root` CSS block.** Everything else is in the source tree, version-controlled, and changes require a process restart.

## Minimal wiring: env + migrate + start

```bash
# .env
KNOWLESS_SECRET=<64 hex chars>          # forking property: this seeds handle derivation
KNOWLESS_BASE_URL=https://forum.example
KNOWLESS_FROM=auth@forum.example
KNOWLESS_SMTP_HOST=smtp.example
KNOWLESS_SMTP_PORT=587
PORT=8080
DB_PATH=./forum.db
```

```bash
npm run migrate    # idempotent — applied migrations are tracked in `schema_migrations`
npm start          # node --env-file=.env bin/server.js
```

Validate at boot: missing required env fails fast with a clear error. The server is plain `node:http` — no reverse proxy required for dev. Production puts Caddy or nginx in front for TLS. No build step.

## Routes (every URL the forum serves)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | front page: active subs strip + recent posts (cap 2/sub). Top-nav filters: `?tab=posts\|comments`, `?sort=new\|old\|top\|hot`, `?date=24h\|week\|all`, `?feed=subscribed\|all`. Default tab = posts, default sort = new, default date = all, default feed = all. `feed=subscribed` is logged-in only (anonymous silently degrades to `all`); empty-state when subscribed to nothing. |
| GET | `/subs` | full directory of subs with sort (`?sort=active\|posts\|name`), client-side prefix filter, subscriber column (live counts as of M6/B2). `?filter=mine` scopes to subscribed subs (logged-in only; anonymous falls back to `all`). Per-row inline subscribe/unsubscribe form for logged-in users (M6/B5). |
| POST | `/sub/<name>/subscribe` | toggle subscription. Form: `action=subscribe\|unsubscribe` (missing toggles current state); `return_to=<path>` redirects back. Auth-required (401 anon); 404 when sub missing. Idempotent. Disallowed in `robots.txt`. |
| GET | `/sub/<name>/rss` | per-sub Atom feed. Latest 50 posts (newest-first), excluding both hard-removed and soft-collapsed; title + author pseudonym + ≤600-char body excerpt. `application/atom+xml`, `Cache-Control: public, max-age=300`. The sub HTML page advertises this via `<link rel="alternate" type="application/atom+xml">`. M6/B4. |
| GET | `/sub/<name>` | sub feed (sort: new/old/top/hot via `?sort=`) |
| GET | `/sub/create` | new-sub form (logged-in only) |
| POST | `/sub/create` | create sub (validates name + thresholds) |
| GET | `/sub/<name>/post/<id>` | post page with comments (sort: best/new via `?sort=`) |
| POST | `/sub/<name>/post/<id>/comment` | add comment (Accept: JSON for in-place insert) |
| GET | `/sub/<name>/modlog` | public mod-action audit (resolved-only; supports `?mod=`, `?user=`, `?date=`, `?type=` filters). Includes `archive exported` rows when sub-archive exports complete (M7 followup). |
| POST | `/sub/<name>/mod` | mod action (collapse/uncollapse/remove/unremove/ban/...) |
| POST | `/sub/<name>/sticky` | M8/B1: any mod (owner or co) sets the sub's sticky note. Form: `note` (≤200 chars, markdown). Empty clears. 401 anon, 403 non-mod, 404 missing sub, 409 disabled sub. Redirects to `/edit`. |
| GET | `/modlog` | unified mod inbox for any user moderating ≥1 sub. Modes: `?mode=open`/`inbox`/`audit`. Filters: `mode`, `date`, `type`, `sub`, `mod`, `user`, `page`. Default = open if pending exist, else audit. |
| POST | `/modlog/resolve` | one-shot decision endpoint for the open-mode form: `decision=uphold-soft|uphold-hard|dismiss` |
| GET | `/memlog` | per-user personal log (recipient-only). Modes: `?mode=notifications`/`activity`/`all` (default notifications). Notifications = events received; activity = own posts + comments. Multi-select kind filter `?kind=a,b,c` toggles slugs in/out (e.g. `?kind=comments,archives`). Each chip declares both halves it touches: `comments` is cross-side (received-comment notifs + authored comments); `posts` is activity-only; `replies`/`mod-actions`/`archives`/`imports` are notification-only. Auto-flip: when `show: unread` matches 0 rows but read history exists, the page switches to `show: all` and surfaces a "no unread match" hint. Modlog-style "showing: X · clear all" footer when filters differ from defaults. 90-day lazy-prune retention on notifications. |
| POST | `/memlog/mark-read` | mark all visible (respecting active `kind` filter set) as read. Form `kind` is the comma-list of selected slugs; activity-only slugs contribute no notif kinds (harmless). |
| GET | `/memlog/go/<id>` | mark a single notification read + 302 to its deep link |
| POST | `/sub/<name>/export-request` | enqueue a per-sub archive job. Auth-required (401 anon); gated by `canExportSub` — mod or 60-day continuous subscriber, else 403. Idempotent: repeated submits collapse onto the existing pending row. Redirects to `/memlog?export=queued`. M7/B2-b. |
| POST | `/export-request` | enqueue a personal (per-user) archive job. Auth-required only; no tenure gate. Idempotent. Redirects to `/memlog?export=queued`. M7/B2-b. |
| GET | `/export/<token>.tar.gz` | token-bearer streaming download. **No auth check** — the 64-hex `download_token` IS the credential (same posture as `/u/<token>/rss`). Headers: `Content-Type: application/gzip`, `Content-Disposition: attachment`, `Cache-Control: private, no-store`. 404 on missing/expired token, malformed token, or file removed from disk. M7/B2-b. |
| GET | `/export/<token>.tar.gz.sig` | token-bearer detached Ed25519 signature (raw 64 bytes) over the gzipped archive. Same token-bearer posture as the `.tar.gz` route. 404 if the sig file is missing on disk (e.g. archive predates B4). M7/B4. |
| GET | `/export/<token>.tar.gz.ots` | token-bearer OpenTimestamps proof for the archive (operator-opt-in via the `ots` CLI). 404 with "operator may not have opted in" hint when the .ots file isn't on disk. M7/B6. |
| GET | `/.well-known/plato-pubkey` | JSON: `{algorithm, public_key_hex, fingerprint, created_at, instance:{forum_name,base_url}}`. Lazy-creates the instance keypair on first hit. `Cache-Control: public, max-age=300`. M7/B4. |
| GET | `/sub/create?mode=import` | second tab on the create page. Renders the URL-fetch import form. Auth-required (anon → 401). M7/B5. |
| POST | `/sub/import` | enqueue a sub-import from a URL the user pastes (`sourceUrl` + optional `renameTo`). Auth-required; URL must be http(s); rename must match plato sub-name format. Idempotent on `(source_url, requested_by)` while pending. Redirects to `/memlog?import=queued`. M7/B5. |
| POST | `/draft` | submit a draft post (logged-in: inlines finalize) |
| GET | `/draft/<id>/finalize` | finalize after magic-link click |
| GET | `/post/<id>` | canonical post permalink |
| POST | `/vote` | cast/toggle/switch a vote |
| POST | `/flag` | submit a flag (categories: spam/harassment/illegal/off_topic/other) |
| GET | `/healthz` | operator probe (M8/B2). Public, no auth, no body parsing. JSON `{ok, version, uptime_s, db_writable, exports_dir_writable, last_migration}`. `Cache-Control: no-store`. `200` when DB + exports dir are writable; `503` otherwise so an external watcher can alarm on non-2xx. |
| GET | `/avatar/<handle>.svg` | deterministic identicon |
| GET | `/static/*` | CSS/JS/icons (path-traversal-safe) |
| GET/POST | `/login`, `/auth/callback`, `/verify`, `/logout` | mounted by knowless |

Every sub-scoped route lives under `/sub/<name>/...` so future per-sub features don't have to refactor URL shapes.

## Configuration: locked vs forkable

Three categories. Pick the right effort tier before changing.

### Forkable (designed to be customized)

These are explicit operator surfaces. Changing them is a one-line edit + restart, and the design assumes you will.

- **Color tokens.** Every color in the UI is a `--*` CSS variable on `:root` in `style.css`. Re-skinning is a search-and-replace: `--bg`, `--text`, `--accent`, `--accent-warm`, `--border`, `--text-dim`. Vote arrows, links, logo dots, mod-button hover, modlog accent rows all re-skin together. **v1 requirement.** `style.css` also ships nine drop-in dark presets and five light presets — `tokyo-night` (active dark default), `github-dark`, `warm-amber`, `cool-cyan`, `mocha-purple`, `monokai-pro`, `nord`, `gruvbox-dark`, `night-owl`; `zinc-cool` (active light default), `github-light`, `notion-cream`, `solarized-light`, `stone-warm`. Each is a single commented `:root { ... }` line at the top of `style.css`; copy any block over the active one and reload. The light presets sit under `:root.theme-light` plus a `@media (prefers-color-scheme: light)` mirror — both blocks must change together.
- **Reserved sub names.** Add to `RESERVED_SUB_NAMES` to block names that collide with new top-level routes you've added.
- **Disposable-email blocklist.** `disposable-domains.txt`, one domain per line. Operator owns the file; M5 adds a cron sync to the upstream community-maintained list.
- **Auto-uncollapse thresholds (per sub).** Set on sub creation via the form; floors are enforced (post ≥ 50, comment ≥ 20). Higher means harder for the community to overrule a soft-removal.
- **SMTP / base URL / port / DB path.** All `.env`.
- **Static assets.** Anything under `src/web/static/`. Drop in your own logo SVG, swap `comment.js`, etc.

### Tunable (one-line changes, restart, but design assumes the default)

These have hardcoded constants because the right value is the same for almost every instance. Change if you have a strong reason; expect to revisit.

- **`COLLAPSE_THRESHOLD = -3`** (`src/web/app.js`) — score below which a comment auto-folds.
- **`MAX_DEPTH = 4`** (`src/web/app.js`) — beyond this, comment replies fold into a `+ N more` summary.
- **`HARD_DEPTH = 64`** (`src/web/app.js`) — hard recursion guard in `commentNodeView`. Beyond this, replies stop rendering entirely (defense-in-depth against pathological threads or re-parenting bugs).
- **`TITLE_MAX = 300` / `BODY_MAX = 40000`** (`src/content/post.js`) — server-side caps on draft input. Forms also carry `maxlength` but the server is authoritative. PRD-locked at Reddit's numbers — see PRD §Content Model → Length limits.
- **`COMMENT_BODY_MAX = 10000`** (`src/content/comment.js`) — same shape as the post caps. Likely first knob to drop (toward 5 000 = HN/Lobsters direction) if real usage shows runaway thread sprawl. Don't tighten preemptively.
- **`NOTE_MAX = 280`** (`src/content/flag.js`) — server-side cap on flag notes.
- **`COMMENT_PREVIEW_CHARS = 280`** (`src/web/app.js`) — long-comment fold threshold; matches the post-preview cap on the home page.
- **`FLAG_THRESHOLD_FLOOR = 3`** (`src/content/flag.js`) — floor for the per-sub `flagThreshold` setting. Each sub's threshold is set at creation (default 3) and can be raised by the owner but never lowered below this floor.
- **`RATE_LIMIT_FLOOR`** (`src/content/rateLimit.js`) — PRD-locked floor for per-account + per-sub rate limits. Three tiers by handle age: `new` (<24h, 1/3/10), `recent` (1–7d, 3/10/30), `established` (>7d, 6/20/60). The established cap is held (not removed) so a single voice can't dominate the home feed via cross-sub fan-out. Operator can tighten via `config.json`; loosening throws at boot. **Owner carve-out (posts)**: when the poster owns the destination sub, three caps are adjusted — (a) the per-sub topic-flood cap is skipped, (b) the per-hour burst-pacing cap is skipped (`{ skipHourly: true }`), and (c) the per-day cap is **doubled** for `recent` and `established` (10→20, 20→40) but **not** for `new` (3 stays 3 — brigade guard against "fresh account → fresh sub → flood seed posts"). `checkPostRate(..., { skipHourly: true, doubledForOwner: true })`. Wired in `handleDraft` and `handleFinalize` via `canModerate(...) === 'owner'`. **Owner carve-out (comments)**: when commenting in a sub you own, the daily cap is **doubled** for every tier (10→20 new, 30→60 recent, 60→120 established) — `checkCommentRate(..., { doubledForOwner: true })`. Cap is doubled, not lifted, so a compromised owner can't drop unlimited comments. New-tier comments *do* double because comment-flooding-own-sub is engagement, not brigading. Wired in `handleAddComment`. Doubled budget is "spent in own-sub only": once `dayCount` exceeds the base cap, posting elsewhere fails because the same dayCount is checked against the lower base cap.
- **`LINK_CAP_FLOOR`** (`src/content/linkCap.js`) — PRD-locked floor for per-post outbound link cap (1/3/5 by tier).
- **`NEW_ACCOUNT_WINDOW_MS = 7 days`** (`src/content/vote.js`) — how long a fresh handle is treated as "new" (half vote weight, no comment voting, posts < 24h only).
- **`YOUNG_POST_WINDOW_MS = 24h`** — companion to the new-account rules.

### Locked (changing requires a fork commit and lives in the project's identity)

These are deliberate product decisions. The PRD treats them as load-bearing; changing them changes what plato *is*.

- **Project quote: "opinion is the medium between knowledge and ignorance."** Renders in the footer below the operator's "instance hosted by" line. Source of the project's name. `PLATO_QUOTE` in `src/web/app.js`. Locked across all forks.
- **Logo: three blue dots, ascending opacity.** Three-dot wave pattern doubles as the loading animation. Locked across all forks (top wordmark + footer mark). Forks change the name next to the mark via `config.json:branding.forumName`; the mark itself stays.
- **Operator-replaceable**: forum name (top + footer wordmark, page title), home-page tagline, and an optional "instance hosted by" footer line. Set via `config.json` → `branding`. See operator-guide for the schema.
- **Magic-link auth, no passwords.** Plaintext email never stored. Handle = HMAC-SHA256(email, KNOWLESS_SECRET). Changing this means rebuilding the auth layer.
- **Pseudonym + identicon, no uploads.** Two-word pseudonym from `unique-names-generator`, deterministic per handle. Avatars are bottts-neutral SVG dicebear. No image uploads, ever (PRD §no inline embeds).
- **Markdown-only post bodies, raw HTML escaped.** `image:` markdown is rewritten as a link. URL schemes allow-listed (`http(s)`, `mailto`, fragments, relatives).
- **Sub names: lowercase + alphanumeric + hyphen, 3–30 chars, locked at creation.** No renames.
- **One owner per sub + co-mods.** Co-mods can `collapse/uncollapse/remove/unremove/ban/unban`. Owner-only: `promote_mod / demote_mod / transfer_owner`.
- **Two-tier moderation.** Soft removal (`collapse`, reversible, reason optional, `[+] [collapsed by mod]` chip-as-fold) vs hard removal (`remove`, reason required, `[−] [removed by mod]` static stub). Hard removals never auto-revert via votes; soft removals do, at the per-sub threshold.
- **Public mod log per sub.** Every action logged with mod handle, action, target, optional reason. System-driven actions (`auto_uncollapse_community`) write `mod_handle = NULL` and render as "community overruled".
- **No NSFW labeling, no age verification.** Plato uses a generic `sensitive` per-sub flag (M5/B11) — banner + advisory mark in the home strip, no age-gating. NSFW as a label is excluded specifically because the default rules ban porn, so labeling something NSFW would invite the very content the rules forbid. Age verification is an operator-layer concern (reverse proxy / content gateway), not a forum feature.
- **No tags / hashtags.** Per-sub flairs (M5/B10) are the structured-categorization escape valve: closed list, owner-curated, max 6 per sub, slug derived from label, color is 6-digit hex (8 preset swatches + free-form `<input type="color">` in the editor; both emit `#rrggbb` and the validator hard-rejects everything else), optional unless `flairs_required`.
- **No private subs.** PRD §Permanently out — different product.
- **No default sub.** Fresh installs have no `general` sub (migration 024 drops the empty backfill row from 002). Old instances with real M1 archives keep `general` as archive-only — new posts must land in a real sub regardless.
- **No image embeds, no video, no rich media.** Text-first by design.
- **Multilingual content, monolingual chrome.** User content (post titles, post bodies, comment bodies, feed-view excerpts) carries `dir="auto"` so the browser auto-detects writing direction per element from the first strong character — Arabic / Hebrew / Persian / Urdu flip RTL, Latin / CJK / Cyrillic / Greek stay LTR, mixed-script paragraphs render each block in its own direction (via `unicode-bidi: plaintext` on block-level children of the user-content containers in `style.css`). Any language the user's browser+OS can render; no enumerated locale list, no font shipping. UI chrome — header, action pills, vote arrows, modlog labels, error pages, timestamps — stays English-LTR. The `lang` attribute on `<html>` stays `en` because the chrome is English; user-content language is detected by the browser's bidi heuristics. Translating the chrome would require a real i18n surface (translation pipeline, locale switcher, plural-rule engine, RTL-mirrored layouts, locale-aware date formats), which is a separate project. Forks are free to take it on; plato proper won't.

If you want any of the locked items different on your instance, you're forking. That's fine — the licensing supports it.

## Database

Single SQLite file at `DB_PATH` (default `./forum.db`). WAL mode + STRICT tables + FK enforcement. All migrations idempotent and tracked in `schema_migrations` (id PRIMARY KEY).

| Table | Purpose |
|---|---|
| `handles` | HMAC-derived id + pseudonym + first_seen_at |
| `subs` | name PK, owner_handle FK, default_sort, auto_uncollapse_post, auto_uncollapse_comment, flairs JSON, flairs_required, sensitive, flag_threshold |
| `sub_mods` | (sub_name, handle) composite PK + role enum |
| `posts` | id PK, sub_name FK, handle FK, title, file_path, score, collapsed_at, removed_at, score_at_collapse, edited_at TEXT, flair_slug TEXT, sensitive INTEGER (per-post, migration 012) |
| `comments` | id PK, post_id FK, parent_comment_id self-ref FK (nullable), score, soft-state columns, edited_at TEXT |
| `votes` | (target_type, target_id, handle) composite PK, value REAL CHECK |
| `drafts` | pending posts awaiting magic-link confirmation; flair_slug TEXT, sensitive INTEGER |
| `mod_actions` | audit log; mod_handle nullable for system actors |
| `flags` | (target_type, target_id, flagger_handle) composite PK, category enum |
| `bans` | (sub_name, handle) composite PK |
| `notifications` | per-user memlog; recipient_handle, kind, target ref, read_at (migration 013) |
| `subscriptions` | (user_handle, sub_name) composite PK + index on `sub_name`; private per-user, never publicly listed (migration 014, M6/B2) |
| `export_jobs` | archive request queue (sub + user kinds); state encoded in three timestamps + retry_count; unique partial index dedupes pending duplicates per (kind, scope, requested_by); 64-hex `download_token`. Per-kind windows (M7/B2-b): production SLA from request → terminal-fail = sub 7d / user 3d; download TTL from completion = 3d both kinds. Worker pre-tick `markStaleAsFailed` sweep enforces the SLA (migration 018) |
| `instance_keypair` | single-row Ed25519 archive-signing keypair: `id` PK with `CHECK (id = 1)`, `algorithm` (`'ed25519'`-only), 32-byte raw `private_key` + `public_key` BLOBs, `fingerprint` (sha256 of pubkey bytes, `"sha256:<64-hex>"` form), `created_at`. Lazy-generated on first need via `getOrCreateInstanceKeypair`. Never rotated in v1 (migration 019, M7/B4) |
| `import_jobs` | sub-import request queue mirroring `export_jobs`'s state machine; idempotence via UNIQUE partial index on `(source_scope_sub, source_exported_at) WHERE completed_at IS NOT NULL` (same source archive succeeds once); fetch timeout + size cap enforced in `bin/run-import-queue.js`; `imported_sub_name` set on completion (== `rename_to` if provided, else `source_scope_sub`). 3-day SLA. Migration 020, M7/B5 |
| `schema_migrations` | id PRIMARY KEY |

Posts are stored as markdown files on disk at `posts/<date>-<id>.md` with frontmatter. The DB row is the index, regenerable from the file tree (so a backup of `posts/` + `forum.db` is sufficient; losing the DB is recoverable).

### Adding a column

```sql
-- src/db/migrations/007_my_change.sql
ALTER TABLE subs ADD COLUMN my_field TEXT NOT NULL DEFAULT '';
```

```bash
npm run migrate
```

For column drops or type changes, follow SQLite's table-rebuild dance with `defer_foreign_keys` (see `004_moderation.sql` and `005_auto_uncollapse.sql` for examples).

## Settings reference

### Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `KNOWLESS_SECRET` | yes | — | 32-byte hex; HMAC seed for handles. **Different secret = different forum identity.** |
| `KNOWLESS_BASE_URL` | yes | — | Public URL in magic-link emails. |
| `KNOWLESS_FROM` | yes | — | From-address on magic-link emails. |
| `KNOWLESS_SMTP_HOST` | yes | — | SMTP server. |
| `KNOWLESS_SMTP_PORT` | yes | — | SMTP port. |
| `PORT` | no | 8080 | HTTP listen port. |
| `DB_PATH` | no | `./forum.db` | SQLite file location. |

### Operator config (`config.json`)

Forum-wide spam-defense overrides. Lives at `<project root>/config.json` or wherever `PLATO_CONFIG=` points. Every numeric value is **tighten-only** — overrides must be ≤ floor; bad config throws at boot.

```jsonc
{
  "rateLimits": {
    "perAccount": {
      "new":         { "postsPerHour": 1, "postsPerDay": 3,  "commentsPerDay": 10 },
      "recent":      { "postsPerHour": 3, "postsPerDay": 10, "commentsPerDay": 30 },
      "established": { "postsPerHour": 6, "postsPerDay": 20, "commentsPerDay": 60 }
    },
    "perSubDay": { "newish": 5, "trusted": 20 }
  },
  "linkCaps":         { "new": 1, "recent": 3, "established": 5 },
  "spamPatternsFile": "spam-patterns.txt",
  "urlhausCacheFile": "data/urlhaus.txt",
  "urlDisplayMax":    30,
  "feedPageSize":     50,
  "operator": { "email": "you@example.com", "service": "plato" }
}
```

The `operator` block is metadata for cron tooling (see [`cron-jobs.md`](cron-jobs.md)) — `email` receives refresh / failure reports, `service` (default `plato`) is the systemd unit cron jobs restart on snapshot change. The forum process itself ignores the block. Both fields are optional: missing `email` falls back to stderr.

`urlDisplayMax` (default 30, integer 10–200) is a display-only knob: bare auto-linked URLs longer than this render with a `…` ellipsis on the visible text while keeping `href` and a `title`-attribute hover-preview intact. `[label](url)` markdown with explicit labels is untouched. No security floor; bad value still throws at boot.

`feedPageSize` (default 50, integer 10–200) controls how many items render per page on home (posts + comments tabs) and sub feeds before the `← prev | page N | next →` footer. No infinite scroll — server-side pages, `?page=N` is shareable. Smaller = more pause beats / more clicks; larger = heavier render. Bad value throws at boot.

Spam knobs are forum-wide on purpose: per-sub overrides invite "soft sub" loopholes. Per-sub config is reserved for non-spam decisions (auto-uncollapse thresholds, flairs, sensitive flag) and one moderation lever (`flag_threshold`, floor 3 — operators can raise but not lower).

The `branding.colors` (dark) and `branding.colorsLight` (light) sections of `config.json` override vote-arrow CSS variables at boot. Each section takes the same `{up, down}` shape and is independently optional:

```jsonc
{
  "branding": {
    "forumName": "terribic",
    "tagline":   "terrific or terrible",
    "hostedBy":  "@tedvdb",
    "colors":      { "up": "#7fd962", "down": "#73d0ff" },
    "colorsLight": { "up": "#117833", "down": "#0066cc" }
  }
}
```

`colors.up` overrides `--up` and `colors.down` overrides `--down` under `:root` (dark default). `colorsLight` overrides the same two variables under `:root.theme-light` plus the `@media (prefers-color-scheme: light)` block. Any CSS color string works (hex, `rgb()`, named); the same injection guard as flair colors rejects `;{}<>"'`. Bad value throws at boot with a field-name error — `branding.colors.up must be a string` vs `branding.colorsLight.down contains invalid characters` so the operator knows which palette failed.

The user-facing theme toggle (M8/B0) sits last in the header right-cluster. Two-state, no OS-default once clicked: a click stamps `.theme-light` or `.theme-dark` on `<html>` and persists to **both** `localStorage.theme` (string `'light'` or `'dark'`) **and** a first-party functional cookie `plato_theme=light|dark; path=/; max-age=31536000; SameSite=Lax`. Anti-flash inline `<script>` in `<head>` reads localStorage first (warm path), falls back to the cookie, applies the class before first paint so reloads don't strobe. The dual-persistence layer is the fix for mobile Firefox's privacy mode session-clearing localStorage between refreshes — first-party cookies survive that mode. Class-based, not attribute-based, because iOS Safari has chronic CSSOM-invalidation bugs around attribute selectors that surface as "first toggle works, post-navigation toggles fail" — class selectors don't have this problem in any engine. A `pageshow` listener gated on `event.persisted === true` also re-syncs theme state on bfcache restoration (mobile Firefox pull-to-refresh). Without JS the button hides itself (`html:not(.has-js) .theme-toggle`) so no-JS users get the OS-hint behavior with no dead chrome. **Known residual limitation**: regular mobile Firefox refresh (F5 / pull-to-refresh on some build variants) occasionally restores the page to dark even after toggling to light. Recoverable with one extra tap. Documented in operator-guide § Known limitations.

`spam-patterns.txt` is the operator's per-instance regex set, one line per pattern, `#` comments, blank-line tolerant. Bad regex skips with a stderr warning. Restart picks up edits.

`bin/refresh-urlhaus.js` is a standalone fetcher meant for system cron (`0 * * * *`). Restart plato to pick up a fresh fetch — the host set is built once at boot.

System auto-actions (spam-regex hits, URLhaus host hits) write a `mod_actions` row attributed to `SYSTEM_HANDLE` (pseudonym `system`) in addition to the system flag. They surface in `/modlog` audit/inbox modes and in the public `/sub/<name>/modlog`, with the pattern source or blocked host carried in the `reason` column. Filter with `?mod=system` to isolate auto-actions.

### Per-sub settings (set via `/sub/create` form; flairs / sensitive / flag-threshold / description also editable via owner-only `/sub/<name>/edit`)

| Field | Floor | Default | Purpose |
|---|---|---|---|
| `name` | 3–30 chars, locked at creation | — | Lowercase alphanumeric + hyphen, no leading/trailing hyphen. **Sub names are immutable** — renaming would break URLs, RSS feeds, archive scope keys, and modlog cross-references. PRD-locked. |
| `description` | optional | `''` | One-line tagline shown in the home strip. Editable. |
| `autoUncollapsePost` | **50** | 50 | Net upvotes since collapse to auto-uncollapse a soft-removed post. Locked at creation. |
| `autoUncollapseComment` | **20** | 20 | Same, for comments. Locked at creation. |
| `flagThreshold` | **3** | 3 | Distinct flaggers required to auto-hide a target. Raise to make niche subs more permissive; cannot lower (a single flagger collapsing a target would defeat the "distinct flaggers" defense). |
| `flairs` | max 6 | `[]` | JSON array `[{slug, label, color}]`. Slug `[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?` (no leading/trailing hyphen, 1–20 chars, derived from label by the form), label ≤ 24 chars, color is 6-digit hex `^#[0-9a-f]{6}$` (8 preset swatches + free-form `<input type="color">` in the editor — both emit `#rrggbb`; rgb()/named/CSS-keyword forms rejected at validate time). Owner-curated. |
| `flairsRequired` | requires ≥ 1 flair | `false` | When set, every new post in the sub must carry a flair. |
| `sensitive` | — | `false` | Generic content-advisory flag. Two layers: per-sub (this row, owner-set) renders the amber banner across the whole sub + `[!]` in directories; per-post (author-set on create or within edit window, migration 012) renders the same banner above the individual post body and `[!]` next to the title in feeds. Either source triggers the advisory. Not for porn (banned by default rules); covers graphic violence, abuse discussions, intense political topics, etc. |
| `disabled_at` | — | `NULL` | Read-only state (M5/B12, migration 016). NULL = active; non-null = unix-ms when the sub became read-only. Two entry paths: mod step-down with no co-mods (in-app), or 30-day mod inactivity (cron). Recovery: any current mod flips back via `/sub/<name>/edit`. If no mods remain, sub is permanently read-only — operators do not assign new mods or override sub state. See *Sub state model*. |

Auto-uncollapse thresholds: the operator can raise either but never below the floor — defends against a small brigade overturning a soft-removal.

### Sub state model (M5/B12)

Two states only: **active** (`disabled_at IS NULL`) and **read-only** (`disabled_at` set).

- **Active**: posts, comments, votes, flags, and mod actions all work normally. Subscribe/unsubscribe always works regardless of state.
- **Read-only**: writes blocked at the content-module layer (`isDisabled` check in `post.js`, `comment.js`, `vote.js`, `flag.js`, and `mod.js#recordAction`). Reads stay open. The only mod action accepted is `manual_reactivate`, which flips `disabled_at = NULL` and writes a modlog row.

Entry paths:
- **Step-down with no co-mods** — owner clicks "disable sub" on `/sub/<name>/edit`. Clears `owner_handle` to NULL and sets `disabled_at`; the sub now has zero mods and stays permanently read-only (no operator override path). Members migrate by forking.
- **30-day inactivity** — `bin/check-sub-inactivity.js` (daily cron) calls `runInactivitySweep` which auto-disables subs whose `lastModActivity` (max across post/comment/mod_action by any current mod) is older than `SUB_INACTIVITY_THRESHOLD_MS` (30 days, floor-locked). Synthesizes a modlog row with `mod_handle = SYSTEM_HANDLE` and `action = 'auto_disable_inactivity'`. Subs with zero mods are skipped — that's a different failure mode the cron isn't the right intervention for.

Warning surface (active-state, no DB column):
- 28 days since last mod activity → per-sub banner renders "this sub will become read-only in ~Nh; create a successor sub now" with explicit migration framing. Computed at request time from `lastModActivity(now) - SUB_INACTIVITY_WARNING_MS`.

Recovery: any current mod (owner OR co-mod) opens `/sub/<name>/edit` and clicks "reactivate." Synthesizes a `manual_reactivate` modlog row. No cooldown — a sub can cycle active ↔ read-only freely.

Marker: `/subs` directory shows `[read-only]` next to disabled-sub names. PRD-locked decision: marker lives on `/subs` (decision-time surface), NOT `/about` (instance-identity surface).

### Mod model (M5/B12)

- **One mod per sub** (`subs.owner_handle`). UI surfaces this as "mod"; code/schema keeps "owner" for precision.
- **Many co-mods** (`sub_mods` table, role `'co'`). Promoted by mod from the sub's subscribers — eligibility = `isSubscribed(target, sub)` at promotion time. After promotion, mod role and subscription are independent.
- **Self-demote** allowed for co-mods on `demote_mod` (carve-out from OWNER_ONLY check when `mod_handle === target_id`). Demoting *another* co-mod still requires owner.
- **Step-down (mod)** = `transfer_owner` to a chosen co-mod (if any exist) or `disable_sub` (if none). Mod cannot just leave; sub always has either a successor or read-only state.
- **Mod queue** is shared between mod and co-mods. No fan-out notifications when a flag arrives — pending actions are visible to anyone with mod role on the sub. The first to act records the row. Modlog rows do NOT carry a role badge — pseudonym is the actor identity, role at-time-of-action is intentionally not denormalized.
- **Mod role implies subscribership.** `createSub` auto-subscribes the owner; `transfer_owner` re-establishes the subscription for the new owner. On both `/sub/<name>` (header) and `/subs` (directory row), the subscribe / unsubscribe button renders as a disabled, struck-through button with an explanatory tooltip when the current user has any mod role on that sub. `subscribeForm({modRole})` and `subscribeCell` (in /subs) handle the branching. Subscriptions remain personal-preference for non-mod users (PRD lock unchanged). `listSubsModeratedBy` UNIONs `subs.owner_handle` with `sub_mods` so the post-transfer owner keeps their `/modlog` header link even though `transfer_owner` deletes their `sub_mods` row (owner_handle is the source of truth). `subStateBanner` in `src/web/app.js` branches the 28-day inactivity warning by `modRole` — mods see "you mod this sub. any post … resets the timer" (the primary actor's copy); non-mods see the migration framing pointing at `/sub/create`. Manage page (`/sub/<name>/edit`) renders a `// mod` heading with the owner's pseudonym above the `// co-mods` list so co-mods can see who their mod is.
- **Mod-management UI: pill triggers + inline `<details>` confirms.** Promote / save / reactivate are blue pills (`.mod-action-pill`); demote / step-down / disable-sub / transfer-owner triggers are `<details>` whose `<summary>` matches the same pill style and whose body contains the confirmation form + a `cancel` link. No browser-native `confirm()`. Subs the current user moderates carry a `>` indicator before the sub name in `/subs` and the home active-subs block.
- **Modlog action labels.** `MOD_ACTION_LABELS` (in `src/web/app.js`) covers `promote_mod`, `demote_mod`, `transfer_owner`, `auto_disable_inactivity`, `manual_reactivate` so rows render as e.g. "transferred mod role" rather than the raw enum.
- **Pseudonym → handle resolution** for the promote and successor pickers. The form posts the typed pseudonym (from a `<datalist>`); the handler resolves to a handle via the UNIQUE `handles.pseudonym` lookup before calling `recordAction`. 64-char hex handles still pass through for back-compat.
- **Friendly error helpers.** `friendlyError(message)` (used by vote, comment, flag handlers) strips the `<funcName>:` prefix and rewrites the cross-action read-only-sub case. `friendlyPostError(message, subName)` (used by the post-retry view) translates ban / read-only / flair-required / flair-not-available rejections into second-person copy and signals via `isSubSpecificRejection` whether the retry view should expose the sub dropdown for re-targeting. Both live in `src/web/app.js`.
- **Role chip on `/sub/<name>/edit`.** Renders `you are: mod` or `you are: co-mod of //<sub>` at the top of the manage page so the (intentionally) limited action set for co-mods doesn't read as broken state.
- **Active-subs block** (`listSubsForNav`) sorts by `MAX(p.created_at) DESC, post_count DESC, name ASC`. Recency-first so a freshly-created sub bubbles above older high-volume ones; volume is the tie-breaker.
- **`/static/uxbits.js`** is the shared progressive-enhancement script that handles (a) `data-copy-target="<input-name>"` clipboard buttons (used by the post-retry "copy your draft" pill) and (b) closing any `[open]` `inline-confirm` `<details>` on bfcache restore so mod-management forms aren't stuck-open after back-navigation.
- **Archive export is async + queued + bearer-downloadable.** Two kinds:
  - **Sub-export.** `POST /sub/<name>/export-request` enqueues an `export_jobs` row (kind=`sub`, scope=`<name>`). Gated by `canExportSub`: mod / co-mod, OR ≥60-day continuous subscriber. "Continuous" is automatic — `unsubscribe` hard-deletes the row, so resubscribe writes a fresh `created_at` and the clock restarts. Activity (posts/comments/votes) is intentionally NOT a gate.
  - **Personal export.** `POST /export-request` enqueues a row (kind=`user`, scope=`<requester-handle>`). No tenure gate beyond auth — your own data is yours from day one. Builder at `src/archive/user-export.js` packs cross-sub posts + comments + votes-cast (the user's own only, never other voters' handles) + subscriptions + subs moderated + mod actions taken/received. Manifest's `scope.handle_attribution` carries the public pseudonym, never the secret handle.
  - **Worker.** `bin/run-export-queue.js` (operator cron, default `*/15 * * * *`) picks one pending job per tick during the 01:00–06:00 server-time window, runs the `markStaleAsFailed` sweep first, then claims, builds, gzips, writes to `./exports/`, stamps the row with a 64-hex `download_token` + per-kind `expires_at`. Per-kind windows: production SLA from request = sub 7d / user 3d; download TTL from completion = 3d both kinds. Retry policy: 3 attempts then terminal-fail (still capped by the SLA sweep). Off-peak window overridable via `EXPORT_OFFPEAK_START` / `EXPORT_OFFPEAK_END` (hour 0–23) or disabled with `EXPORT_OFFPEAK_DISABLE=1`.
  - **Download.** `GET /export/<token>.tar.gz` is unauthenticated — token IS the credential, same posture as `/u/<token>/rss`. 3-day TTL bounds leak exposure.
  - **Memlog wiring.** Worker emits `export_ready` (links through bearer token via `/memlog/go/<id>`) or `export_failed` (snippet carries the reason; user re-requests) on completion / terminal-fail. Filter chip `archives` narrows `/memlog` to both kinds.
  - **Signing (M7/B4).** Worker writes a sibling `<archive>.tar.gz.sig` (raw 64-byte Ed25519 over the gzipped tarball bytes) and threads `pubkeyFingerprint` into the manifest's `instance.pubkey_fingerprint`. Keypair is single-row in the `instance_keypair` table (migration 019), lazy-created via `getOrCreateInstanceKeypair`, never rotated. Pubkey is advertised at `/.well-known/plato-pubkey`; fingerprint also surfaces on `/about`. Verification = fetch pubkey, confirm fingerprint matches manifest, verify sig against gzipped bytes.
- **OpenTimestamps anchor (M7/B6).** Operator-opt-in via the official `ots` CLI (no npm dep added). `src/archive/timestamp.js` is a thin wrapper around `spawn('ots', ['stamp'|'upgrade', file])` — ENOENT-tolerant; if the binary is missing, returns `{ error: 'ots not found' }` and the export worker logs + proceeds. Export worker calls `stampFile` after writing .sig, producing a `<archive>.tar.gz.ots` sidecar. Daily cron `bin/run-ots-upgrade.js` runs `ots upgrade` against each .ots in `EXPORTS_DIR`; bytes-changed signal indicates Bitcoin anchoring (mirrors gitdone). Token-bearer download at `/export/<token>.tar.gz.ots`. Verification recipe documented on `/about` with a pointer to opentimestamps.org.
- **Sub-import (M7/B5).** URL-fetch model — no uploads. Logged-in user pastes a URL into `/sub/create?mode=import`; `POST /sub/import` enqueues. Worker `bin/run-import-queue.js` fetches the bytes (size-capped streamed read, 120s timeout; SSRF guard via `src/archive/ssrf.js` resolves the host and refuses private/loopback/link-local/reserved addresses — incl. `169.254.169.254` metadata — and re-validates on every redirect hop using `redirect: 'manual'`, so a public URL can't 302 into an internal one), parses + verifies per-file SHA-256, refuses on `kind=user`, then runs `importSubArchive(db, ...)` in a transaction. Posts/comments/votes preserved verbatim (original IDs, timestamps, scores); imported handles inserted as synthetic non-claimable rows (`handles.imported_from_fingerprint` non-null); pseudonyms preserved unless they collide on this instance, in which case a numeric suffix is appended at storage time (`alice-tiger` → `alice-tiger-2`); imported pseudonyms render with two parallel signals at every UI cell — `<span class="imported-author">` styled `opacity: 0.6; font-style: italic` (visual; italic is the non-color hook for colorblind / high-contrast readers), and `aria-label="imported author <name>"` on the same span (assistive tech). A `-N` collision suffix on the canonical pseudonym is stripped at display time, gated on `imported_from_fingerprint` so native HMAC pseudonyms ending in `-N` are unaffected. `pseudonymsByHandle` returns an `AuthorView` value that's a plain string for native handles and a raw-html-with-toString object for imported, so html`` interpolation, string concat, and `escapeXml` all do the right thing without per-call-site changes. Render-time only — the DB pseudonym stays canonical; modlog rows tagged via `mod_actions.imported_from_fingerprint` and rendered with an `[imported]` prefix. Importing user becomes the new sub's mod. Idempotent: same source archive (manifest's `scope.sub` + `exported_at`) can only succeed once — second attempt fails with "already imported as <name>". Memlog notifications: `import_ready` (links to `/sub/<imported_sub_name>`), `import_failed`. Imported subs render an `.imported-banner` on the sub index showing source host + import date + importer pseudonym (no symbol-key footnote — the dim/italic styling speaks for itself). The bare `[i]` `.imported-chip` (gray, no chrome) appears next to the sub name everywhere it surfaces: sub index page brand row, inner sub-scoped pages (post detail, public modlog, sub-edit), home active-subs strip, and /subs directory rows. Hover the chip → `title="imported from <host> on <date>"`. The chip stays out of `<title>` and og:title — `pageView` accepts a separate `titleHtml` for body decorations so head metadata stays plain text.

The bundled offline reader inside both per-user and per-sub archive tarballs auto-paginates when items cross 100. Below the threshold the single-page index render is preserved. Above it, `index.html` becomes a chip navigator + a "// recent activity" preview of the last 20 items; subpages render the filtered lists paginated 100 per page (`posts-2.html`, `posts-3.html`, …) with prev/next links. No JS, no search — the reader's "fully offline, works in any browser" lock holds. Per-archive shape:

- **`kind=user` (personal)**: chips = `posts (N, Mp)` / `comments (N, Mp)` / one per `<year> (N)`; subpages `posts.html`, `comments.html`, `<year>.html` (year pages combine posts + comments authored that year, newest-first).
- **`kind=sub` (per-sub)**: chips = `posts (N, Mp)` / one per `<year> (N)`; subpages `posts.html`, `<year>.html`. Comments stay nested inside per-post HTML pages — sub archives are post-centric, not flat comment streams. Threshold trigger keys on `posts.length` only.

Pagination primitives live in `src/archive/reader-pagination.js` (shared module: `PAGINATION_THRESHOLD`/`PAGE_SIZE`, `bucketByYear`, `paginateBucket`, `pagerHtml`, `PAGINATION_CSS`). Both `user-export.js` and `sub-export.js` import from it so future tweaks land in lockstep. The new HTML subpages are inert from an importer's perspective — `import.js` walks `manifest.files`, hashes everything, and only consumes `*.json` + `posts/<id>.md`, ignoring the HTML.
- **Sub-export → public-modlog row (M7 followup).** Migration 021 adds `'export'` to the `mod_actions` action CHECK enum. `recordSubExport(db, { subName, requestedBy, now })` in `src/content/mod.js` writes the row directly (bypasses `recordAction`'s mod-role gate — sub-export eligibility is `canExportSub`, not mod-only). Wired into all three sub-export completion paths in `src/archive/queue.js`: `completeJob` parent, `completeJob` sentinel fan-out (each sibling credits its own requester), and the `enqueueSubExport` same-day shared-artifact dedupe path (`insertSharedCompletedRow`). `kind='user'` exports do NOT write a row. Failed exports do not write a row. Renderer label `MOD_ACTION_LABELS.export = 'archive exported'`.
- **Sub-import → public-modlog row (M7 followup).** Migration 022 adds `'import'` to the `mod_actions` action CHECK enum (parallel to 021). `recordSubImport(db, { subName, importedBy, now })` in `src/content/mod.js` writes the row at the end of `importSubArchive`. The row is **native** to the destination — `imported_from_fingerprint` stays NULL — because the import act happened on this instance, not in the archive being imported. Renderer label `MOD_ACTION_LABELS.import = 'sub imported'`. Together with the historical `[imported]`-tagged rows from the archive, the destination modlog tells the full migration story for the sub.

### Per-handle rules (locked)

| Rule | Value |
|---|---|
| New-account window | 7 days from `first_seen_at` |
| New-account vote weight | 0.5× (vs 1.0× for established) |
| New-account voting on comments | blocked |
| New-account voting on posts | only if post < 24h old |
| One vote per handle per target | enforced by composite PK |
| Re-vote same direction | toggles off |
| Re-vote opposite direction | switches |
| Edit window | 24h from creation (`EDIT_WINDOW_MS`); applies to posts and comments; migration 008 added `edited_at` column |

## Numeric reference (every threshold in one place)

Every number in plato that gates behavior. Floors are PRD-locked safe minimums; operators tighten via `config.json` but cannot loosen. Source files in parens.

### Posting + commenting (`src/content/rateLimit.js`)

| Tier (`accountAgeTier`) | posts/hour | posts/day | comments/day | per-sub posts/day |
|---|---|---|---|---|
| **new** (<24h)         | 1 | 3  | 10 | 5 |
| **recent** (1d–7d)     | 3 | 10 | 30 | 5  (still <30d) |
| **established** (>7d)  | 6 | 20 | 60 | 5  (still <30d) |
| **trusted** (≥30d)     | (uses established per-account caps) | — | — | 20 |

**Owner-in-own-sub carve-outs** (`canModerate(...) === 'owner'`):

| Tier | post/day base | post/day owner | comment/day base | comment/day owner |
|---|---|---|---|---|
| new         | 3  | 3 (unchanged — brigade guard) | 10 | 20 (2×) |
| recent      | 10 | 20 (2×) | 30 | 60 (2×) |
| established | 20 | 40 (2×) | 60 | 120 (2×) |

Code path: `checkPostRate(db, handle, now, config, { skipHourly: true, doubledForOwner: true })` and `checkCommentRate(db, handle, now, config, { doubledForOwner: true })`. The post-side `doubledForOwner` is gated by `tier !== 'new'` inside `checkPostRate` so new-tier owners always cap at 3/day. Per-hour cap and per-sub topic-flood cap are skipped for owners independently of doubling. Doubled budget is "spent in own-sub only" — `dayCount` is global, so once it exceeds the base cap, posting in any non-owned sub fails.

### Outbound link cap per post (`src/content/linkCap.js` — `LINK_CAP_FLOOR`)

| Tier | links per post |
|---|---|
| new | 1 |
| recent | 3 |
| established | 5 |

### Per-sub thresholds (set at `/sub/create`, raise-only via `/sub/<name>/edit`)

| Knob | Floor | Default | Source |
|---|---|---|---|
| Auto-uncollapse posts (net upvotes to lift soft-removal) | 50 | 50 | `AUTO_UNCOLLAPSE_POST_FLOOR` (`sub.js`) |
| Auto-uncollapse comments | 20 | 20 | `AUTO_UNCOLLAPSE_COMMENT_FLOOR` (`sub.js`) |
| Flag threshold (distinct flaggers to auto-hide for review) | 3 | 3 | `FLAG_THRESHOLD_FLOOR` (`flag.js`) |

### Length limits (server-side validation + browser `maxlength` + live char counter)

Every long-form input pairs three layers: `<textarea data-charcount maxlength="…">` for browser-side hard-stop, a sibling `.char-counter` updated by `static/charcount.js` so users see how much room remains, and a server-side `if (body.length > MAX) throw` in the content module as the backstop. The browser refuses keystrokes past the cap; the counter goes accent-warm at 90% so a paste-near-the-limit isn't surprising.


| Field | Max chars | Source |
|---|---|---|
| Post title | 300 | `TITLE_MAX` (`post.js`) |
| Post body | 40 000 | `BODY_MAX` (`post.js`) |
| Comment body | 10 000 | `COMMENT_BODY_MAX` (`comment.js`) |
| Flag note | 280 | `NOTE_MAX` (`flag.js`) |
| Sub name | 3–30 | `validateSubName` (`sub.js`); regex `[a-z0-9-]`, no leading/trailing hyphen |
| Sub description | 200 | `SUB_DESCRIPTION_MAX` (`sub.js`) |
| Flair label | 24 | `FLAIR_LABEL_MAX` (`flair.js`) |
| Flairs per sub | 6 | `MAX_FLAIRS_PER_SUB` (`flair.js`) / `FLAIR_EDITOR_ROWS` (`web/app.js`) |
| Notification snippet | 160 | `SNIPPET_MAX` (`notification.js`) — auto-truncated with `…` |
| Bare-URL display (visible text only) | 30 | `URL_DISPLAY_MAX` operator-tunable 10–200 (`markdown.js`) |
| Comment fold preview | 280 | `COMMENT_PREVIEW_CHARS` (`app.js`) |

### Time windows

| Window | Duration | Source |
|---|---|---|
| Post edit window | 24h | `EDIT_WINDOW_MS` (`post.js`) |
| Comment edit window | 24h | `EDIT_WINDOW_MS` (`comment.js`) |
| New-account voting window (half weight, no comment voting, posts <24h only) | 7d | `NEW_ACCOUNT_WINDOW_MS` (`vote.js`) |
| Young-post window (new accounts can only vote on posts younger than this) | 24h | `YOUNG_POST_WINDOW_MS` (`vote.js`) |
| Trusted account threshold (per-sub day cap raises 5→20) | 30d | `TRUSTED_AGE_MS` (`rateLimit.js`) |
| Memlog notification retention (lazy prune on every `/memlog` GET) | 90d | `NOTIFICATION_RETENTION_MS` (`notification.js`) |
| Magic-link draft TTL | 15 min | knowless default |
| Memlog draft stash (localStorage, guest comment) | 24h | `PENDING_TTL_MS` (`comment.js`) |

### Display + structure

| Knob | Default | Source / override |
|---|---|---|
| Feed page size (`?page=N`) | 50 | operator config `feedPageSize`, range 10–200 (`app.js`) |
| Comment-tree max render depth (further nesting folds behind "+ N more replies") | 4 | `MAX_DEPTH` (`app.js`) |
| Avatar size (header / row / comment) | 16 / 18 / 20 px | `app.js` inline |

### Vote rules (`src/content/vote.js`)

| Rule | Value |
|---|---|
| Vote weight, new account (<7d) | 0.5× |
| Comment voting, new account (<7d) | disabled |
| Vote target age, new account (<7d) | posts only, post younger than 24h |
| Vote weight, ≥7d | 1× |

## Patterns, not features

- **Progressive enhancement.** Every form works without JS. JS layers add: in-place comment insertion (no reload), the loading-dots wave on the logo during fetch round-trips. `<noscript>` users get redirects + reloads.
- **Native `<details>`.** Reply forms, score-collapsed comments, mod-confirm forms, mod-state chips all use the platform fold. Zero JS for the fold itself.
- **HMAC handles for forking.** Same email yields different handle on a different instance. Identity is per-forum by design.
- **Score-snapshot at collapse.** When a mod soft-removes, `score_at_collapse` is captured. Cumulative-vote auto-revert checks `current_score - score_at_collapse >= per_sub_threshold` on every vote. Cheap; transactional; no background job.
- **Soft moderation supersedable, hard moderation not.** Hard removal is `mod_handle`-only undo. Soft removal can be undone by mod *or* by community. Mutually exclusive in the UI: when hard-removed, the collapse button is dimmed.
- **Baseline hardening headers on every response.** The request handler in `src/web/app.js` sets four headers once at entry (via `setHeader`, so each route's `writeHead` keeps them): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'` (clickjacking; authenticated POSTs are already SameSite=Lax-protected so this is belt-and-suspenders), `Referrer-Policy: same-origin` (don't leak the originating post URL to outbound links; same-origin keeps the in-site referrer so knowless's logout Origin/Referer check still passes). No script/style CSP — inline `<script>`/`<style>`/`style=` are load-bearing and a strict policy would need per-block nonces. HSTS lives at the nginx TLS edge, not here. (Added 0.12.5.)
- **One canonical page chrome.** Every user-facing page in `src/web/app.js` goes through `pageView({db, currentHandle, title, subtitle}, body)` (or its short-error sugar `quickPage(req, ctx, title, body)`). The `title` arg doubles as the document title and the wordmark replacement in `siteHeader` — every page reads the same as the home, with the forum name swapped for the page action. Renderers must not call `layout()` or `siteHeader()` directly; both are internal to the helpers. The convention is enforced by code, not comment — drift would require deleting both helpers.

## Production usage

- One Node process. No clustering needed at hobby scale; SQLite WAL handles concurrent readers fine.
- Tested on **RackNerd KVM VPS** (~$20/year, 1 GB / 1 vCPU is plenty). Port 25 + PTR are unblocked via a one-paragraph support ticket — paste-ready text in [operator-guide § Hosting](operator-guide.md#hosting--budget-vps-recommendation). Hetzner / OVH / Linode / Vultr also work; avoid DigitalOcean (port-25 unblock is harder to get).
- Reverse proxy (Caddy/nginx) for TLS. M8 adds opinionated Caddy config.
- Backups: `cp forum.db forum.db.bak` and rsync `posts/`. SQLite WAL means you can copy the live file (`.backup` is safer for hot copies).
- Logging: plato writes to stdout/stderr. The deploy-shipped systemd unit redirects both to `/var/log/plato.log` (so journalctl shows lifecycle only; app output is in plato.log). knowless's mail-outcome hooks land here as `[plato mail.submit]` / `[plato mail.fail]` / `[plato mail.suppressed]` — grep-friendly observability without a metrics endpoint.
- Monitoring: hit `/` and check 200; failures are loud. No metrics endpoint yet.
- Secrets: `KNOWLESS_SECRET` is the entire identity of the forum. Losing it doesn't break anything (handles still work — they were derived once and stored). Leaking it lets someone forge handles, so treat like a session-signing key. The Ed25519 archive-signing privkey lives in the DB's `instance_keypair` table (M7/B4); leaking it lets someone forge archives that match this instance's pubkey, so back up `forum.db` securely and don't ship it to anyone you don't trust.

## Gotchas

- **Magic-link emails go to a real SMTP server.** Production stack is postfix + opendkim on the box (deploy-guide §5); knowless connects to localhost:25, postfix delivers direct, opendkim signs with the operator's domain DKIM key. In dev, no MTA runs; `KNOWLESS_DEV_LOG_LINKS=true` (set in `.env.dev` for `npm run dev`) prints the magic link to stderr via `[knowless dev:from] magic link: ...` instead of mailing it. Without that flag, login forms 200 silently and the link goes nowhere.
- **`general` sub doesn't exist on fresh installs.** Migration 024 drops it. Old archive-bearing installs keep it but it's hidden from new-post forms by design.
- **Post permalinks are `/post/<id>` and `/sub/<name>/post/<id>` — both work.** The sub-scoped form is canonical (used everywhere internally); the bare `/post/<id>` is kept for share-links from before sub-scoping.
- **Score is a `REAL` cache, not a source of truth.** It's updated transactionally on every vote. If it ever drifts, the source of truth is `SUM(value) FROM votes WHERE target_*`. There's no rebuild script yet.
- **Comments don't have hard delete by author.** Mods remove via the mod controls. PRD §M3 explicitly punts author-side delete to never (use mod tools).
- **Mods can't reply at depth >= MAX_DEPTH inline.** The reply form is inside the `+ N more replies` fold. Click the fold to see deep replies and their reply forms.
- **Flag button is hidden from a sub's mods on their own sub.** Mods have collapse/remove instead — no need to flag yourself for review.
- **No PRG for mod actions yet.** A successful mod action redirects to the `return_to` (the page the action came from). If you `POST /sub/<name>/mod` with curl, expect a 302 to `/`.
- **Migration ordering matters.** The runner sorts by filename, so name new ones with the next zero-padded number. Don't rename old migrations once shipped.

## Recipes

### Recipe 1: Re-skin in one minute

```css
/* src/web/static/style.css :root */
:root {
  --bg: #0d1117;
  --text: #e6edf3;
  --accent: #ff6b6b;       /* was #58a6ff */
  --accent-warm: #d29922;
  --border: #30363d;
  --text-dim: #7d8590;
}
```

Restart not needed — CSS is a static asset; reload the page. Logo dots, vote arrows, links, mod-button hover all switch.

### Recipe 2: Add a custom sub-name reservation

```javascript
// src/content/sub.js
export const RESERVED_SUB_NAMES = new Set([
  'admin', 'mod', 'system', 'api', 'auth', 'assets', 'static', 'health',
  'shop',  // your new top-level route
]);
```

Restart `npm start`. Existing subs with the now-reserved name still work; only `createSub` rejects new attempts.

### Recipe 3: Tighter auto-uncollapse for a controversial sub

On `/sub/create`, set:
- `auto_uncollapse_post` = 200 (up from 50)
- `auto_uncollapse_comment` = 75 (up from 20)

The community needs more sustained agreement to overrule the mod. The mod can still collapse and uncollapse manually at any time.

### Recipe 4: Run a co-mod election

There's no UI for promote/demote yet (M5). For now:

```bash
sqlite3 forum.db "INSERT INTO sub_mods (sub_name, handle, role) VALUES ('cooking', '<handle>', 'co')"
```

The new co-mod sees collapse/remove controls on every post in `cooking` from their next page load.

### Recipe 5: Inspect a sub's flag queue

```bash
sqlite3 -header -column forum.db "
  SELECT f.created_at, f.target_type, f.target_id, f.category, f.note, h.pseudonym
  FROM flags f
  LEFT JOIN handles h ON h.handle = f.flagger_handle
  WHERE f.target_id IN (
    SELECT id FROM posts WHERE sub_name = 'forever-friends'
    UNION
    SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE sub_name = 'forever-friends')
  )
  AND f.resolved_at IS NULL
  ORDER BY f.created_at DESC;
"
```

Or, since M5 shipped: visit `/modlog?sub=forever-friends&mode=open` for the same view in the unified mod surface.

### Recipe 6: Hot-fix a hardcoded constant

Change `MAX_DEPTH` from 4 to 6:

```javascript
// src/web/app.js
const MAX_DEPTH = 6;
```

Restart. No DB migration needed; the constant only affects render. Existing deeper conversations re-flatten automatically.

### Recipe 7: Backup + restore

```bash
# backup
sqlite3 forum.db ".backup forum.db.bak"
tar czf posts.tgz posts/

# restore on a new host
cp forum.db.bak forum.db
tar xzf posts.tgz
KNOWLESS_SECRET=<same as before> npm start
```

If `KNOWLESS_SECRET` changes, existing sessions invalidate but stored handles remain valid (handles were derived once and persist). New logins will re-derive — for the same email, a different secret yields a different handle, so the user looks like a new account. Don't rotate `KNOWLESS_SECRET` unless you intend a full identity reset.

### Recipe 8: Tighten rate limits for an unannounced public trial

```jsonc
// config.json
{
  "rateLimits": {
    "perAccount": {
      "new":    { "postsPerHour": 1, "postsPerDay": 1, "commentsPerDay": 5 }
    },
    "perSubDay": { "newish": 2 }
  },
  "linkCaps": { "new": 0, "recent": 1, "established": 3 }
}
```

`linkCaps.new: 0` means new accounts can't post links at all — ratchets back during the soak window and relax after. Boot validates that no value exceeds the floor.

### Recipe 9: Append a spam pattern after observing a wave

```
# spam-patterns.txt
# ...existing patterns...

# 2026-05 wave: fake "AI tutor" recruitment
\bAI tutor\b.{0,80}\$?\d{2,4}.{0,30}/hour
```

Restart plato. Matching posts auto-collapse and surface in `/modlog?mode=open`. Mods rule via the open-mode form.

### Recipe 10: Check the build status

```bash
npm test            # 408 tests, ~3s
npm run migrate     # idempotent; no-op if up to date
node --check bin/server.js     # syntax check without starting
```

## Vocabulary cheat-sheet

| DB action | UI label | Reversible? | Reason? |
|---|---|---|---|
| `collapse` | "soft removal" | yes (`uncollapse` or auto) | optional |
| `uncollapse` | "soft removal undone" | — | n/a |
| `remove` | "hard removal" | yes (`unremove`, mod-only) | **required** |
| `unremove` | "hard removal undone" | — | optional |
| `ban` | "banned" | yes (`unban`) | optional |
| `unban` | "ban lifted" | — | n/a |
| `auto_uncollapse_community` | "community overruled" | — | system row, `mod_handle = NULL` |
| `promote_mod` | — | yes (`demote_mod`) | optional, owner-only |
| `transfer_owner` | — | irreversible | owner-only |

## Forking checklist

You're considering whether to fork this instance. Before you do:

1. **Brand identity changes** (logo, tagline, color tokens, copy): forkable, ~30 min of work.
2. **Auth model changes** (passwords, OAuth, no-auth): full fork; ~1 week.
3. **Different content type** (image-first, video, etc.): wrong project — start from scratch.
4. **Different moderation model** (no public modlog, mod-can-edit, etc.): full fork; the public modlog is load-bearing for plato's value prop.
5. **Different identity model** (real names, persistent display names, deletable accounts): full fork; collides with PRD §pseudonyms.

If you only need 1, plato supports you. If you need 2+ from 2–5, plato isn't your starting point.
