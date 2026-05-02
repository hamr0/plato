# Phase 2 Build Plan — Forum v1

**Premise.** POC validated the architecture (knowless library mode, HMAC-only identity, markdown-as-source-of-truth, deterministic pseudonyms+identicons, forum-side disposable-domain seam). Phase 2 builds v1 properly: clean repo, real schema, tests, the full PRD scope.

**Constraint.** Per AGENT_RULES: POC code dies. Phase 2 starts empty. Build incrementally — small independent modules, each works on its own before integrating. Test behavior not implementation. Tests come after design stabilizes per milestone, not during exploration.

**Target.** ~3-4 months of focused work for solo dev, 8 milestones of ~2 weeks each.

---

## Milestone breakdown (high level)

| # | Milestone | Theme | Time |
|---|---|---|---|
| M1 | Foundation | Clean repo, auth, schema, one user posts to one hardcoded sub | ~2 wks |
| M2 | Multi-tenant content | Sub creation, joining, listing, content model, front page | ~2 wks |
| M3 | Discussion | Comments, voting, sorting, post pages | ~2 wks |
| M4 | Moderation | Two-tier mod, flag system, public mod log | ~2 wks |
| M5 | Spam defenses + per-sub structure | Rules 7-16 (rate limits, link caps, URLhaus, regex patterns, velocity dashboard) + per-sub flairs + per-sub NSFW flag | ~2 wks |
| M6 | Subscriptions + notifications | Sub subscribe, my-subs, email digests, ntfy, per-sub RSS | ~2 wks |
| M7 | Identity + export/import | Per-sub export, per-user export, archive signing, OpenTimestamps, fork flow | ~2 wks |
| M8 | Production polish | docker-compose, search, dark mode, mobile, deploy docs | ~2 wks |

This document details **M1-M4** (the scaffolding + core forum). M5-M8 get refined as M1-M4 land — defer detail until the foundation is real.

---

## M1: Foundation

**Goal.** A clean Phase 2 repo where one user, with a real magic-link login, can post markdown to one hardcoded sub. Everything POC validated, but built right: typed schema, tests, layered architecture, no shortcuts. Nothing else works yet.

**Why first.** Every later milestone leans on the schema, the auth integration, and the test harness. Getting these wrong cascades. M1 is where the bones are set; M2-M8 add features to a sound skeleton.

### Deliverables

- **Repo at `~/PycharmProjects/plato/`** (sibling to plato, knowless). Empty git history. No POC code copied — read the POC for reference, retype the parts that survive.
- **Layout:**
  ```
  plato/
    src/
      auth/       # knowless wiring, session helpers, handle accessor
      content/    # post model, markdown storage, draft lifecycle
      identity/   # pseudonym + identicon generation, handle→pseudonym cache
      web/        # http server, routing, request helpers, html rendering
      db/         # schema, migrations, transaction helpers
    test/
      integration/   # end-to-end tests against real sqlite + real knowless
      unit/          # pure-function tests (pseudonym derivation, markdown parse)
      conftest.js    # shared fixtures (tmp dirs, in-memory db, magic-link click stub)
    posts/        # markdown source of truth (gitignored)
    bin/
      server.js   # entry point
      migrate.js  # apply schema migrations
    .env.example
    package.json
    README.md
  ```
- **Schema (forum.db):** `handles`, `posts`, `drafts` only. No subs yet — single hardcoded `general` sub identifier on every post. (M2 adds `subs` table; this lets M1 ship without the sub abstraction yet half-built.)
- **Migrations:** numbered SQL files (`001_initial.sql`), `bin/migrate.js` applies them idempotently. No ORM — raw SQL, prepared statements, `node:sqlite`.
- **Routing:** dispatch table in `src/web/router.js` mapping `(method, pattern) → handler`. Replace POC's if-else chain.
- **HTML rendering:** one templating decision needed (see Open Questions below). For M1, vanilla template literals OK if we lock the decision before M2.
- **Tests:**
  - **Integration:** spin up server with `:memory:` SQLite + real knowless (also `:memory:`), simulate a full post-and-publish flow by calling `auth.startLogin()` directly and feeding the resulting magic-link token into `auth.callback`. ~5 tests covering happy path + 2-3 edges (bad email, expired token, double-click).
  - **Unit:** pseudonym determinism, identicon SVG output stability, disposable-domain check, markdown frontmatter parsing.
- **CI:** `package.json` script `npm test` runs `node --test test/`. Set up GitHub Actions later (M8); for M1, local `npm test` is the gate.

### Definition of done

- `npm test` is green
- Manual: `npm start`, post a thing, click the dev-log magic link, see the post — same as POC, but in clean code with tests behind it
- Schema migration runs idempotently (`bin/migrate.js` twice in a row = no errors, no duplicate tables)
- A second developer (or future-you) can read `src/` and understand the architecture in 15 minutes
- POC dir archived: `mv forum-poc forum-poc-archived` so it stops being a temptation to copy from

### What's NOT in M1

- Multiple subs (single hardcoded `general`)
- Sub creation, joining, listing
- Comments, voting, sorting
- Moderation, flag system
- Subscriptions, notifications, RSS
- Rate limits beyond what knowless ships
- Search, dark mode, mobile polish
- Production deploy

---

## M2: Multi-tenant content

**Goal.** Anyone can create a sub. Posts attach to a sub. Front page shows active subs and recent posts (chronological, 2/sub cap, per PRD §Front Page). Sub pages list posts (chronological for now; sort modes come in M3).

**Why second.** "Subs are universes" is the PRD's load-bearing organizing principle. Most v1 features (mod tools, flags, vote tallies, exports) are *per-sub*. Without a real sub model, every later feature gets retrofitted into a single-tenant assumption. Add the multi-tenant abstraction now.

### Deliverables

- **Schema additions:**
  - `subs` (id, name, description, owner_handle, default_sort, created_at)
  - `sub_mods` (sub_id, handle, role) — owner + co-mods, M4 uses
  - `posts` gains `sub_id FK NOT NULL`
  - Migration: backfill existing posts into a `general` sub
- **Routes:**
  - `GET /` — front page: active subs (last 24h post count) + recent posts (chronological, 2/sub cap)
  - `GET /sub/<name>` — sub page, list posts (chronological for now)
  - `POST /sub/create` — form handler: validates name (lowercase, alphanumeric+hyphen, length limits), creates sub, sets caller as owner
  - `GET /sub/create` — form to create a sub (logged-in only)
  - `POST /draft` updated to take a `sub_name` field
- **Sub naming rules:**
  - Locked at creation
  - Lowercase, alphanumeric + hyphen, 3-30 chars
  - Reserved namespace: `admin`, `mod`, `system`, `api`, `auth`, `assets`, `static`, `health`
- **Per-sub URL paths under `/sub/<name>/...`** — keep all sub-scoped routes namespaced so M4-M7 don't have to refactor URL shapes later.
- **Tests:**
  - Integration: sub create → post in sub → front page shows it under right sub → another sub created → 2/sub cap on recent-posts list works
  - Unit: sub-name validator, reserved-name rejection, per-sub dedup logic for recent-posts list

### Definition of done

- `npm test` green
- Manual: create two subs as different users (different magic-link emails → different handles → different pseudonyms), each posts to their own sub, front page shows both correctly capped
- A user can browse without an account; sub create / post require auth

### What's NOT in M2

- Sub-level permissions beyond owner (co-mods come in M4)
- Sub subscriptions / following (M6)
- Sub deletion (out of v1 — phpBB-era forums never had this)
- Custom sub themes (permanently out)

---

## M3: Discussion (comments, voting, sorting)

**Goal.** Posts have hierarchical comments. Posts and comments have upvote/downvote. Sub pages support hot/new/top/old sort orders. The forum becomes useful for actual discussion, not just publishing.

**Why third.** Comments + voting + sorting are what distinguish a forum from a blog. Without them, M2's content model is dead-end. M4's moderation tools need posts and comments to act on.

### Deliverables

- **Schema additions:**
  - `comments` (id, post_id, parent_comment_id NULLABLE, handle, body, created_at)
  - `votes` (target_type ENUM[post,comment], target_id, handle, value INT[-1,+1], created_at), unique(target_type, target_id, handle)
  - Cached score columns on `posts` / `comments` for fast sort, updated transactionally on vote
- **Routes:**
  - `GET /sub/<name>/post/<id>` — post page with full thread, hierarchical comments, vote buttons, reply forms
  - `POST /sub/<name>/post/<id>/comment` — add comment (top-level or reply to comment)
  - `POST /vote` — upvote/downvote endpoint, requires auth
  - `GET /sub/<name>?sort=hot|new|top|old` — sub page with sort
- **Vote weighting (PRD §Voting):**
  - New account (forum-tenure < 7 days from `(handle, first_seen_at)`): vote weight 0.5, only on posts < 24h old
  - 7+ days: full weight, all targets
  - One vote per handle per target (DB unique constraint enforces)
  - Vote velocity limits deferred to v1.1 per PRD
- **Sort algorithms:**
  - **new**: ORDER BY created_at DESC
  - **old**: ORDER BY created_at ASC
  - **top**: ORDER BY score DESC
  - **hot**: hacker-news-shaped formula (score / (age_hours + 2)^1.5) — single SQL expression, no recurring job. Document the constants inline.
- **Comment tree rendering:**
  - Server-side render the full tree, no JS pagination in v1
  - Collapse threshold by score (configurable per sub, default -3) — collapsed comments rendered with "(score -7) [show]" link, expand via plain anchor link
- **Tests:**
  - Integration: post → comment → reply to comment → vote on post → vote on comment → sort order changes correctly → vote weight halved for new account
  - Unit: hot sort formula determinism, vote-tally update transaction (prevents race-y drift), tree-flattening for render

### Definition of done

- `npm test` green
- Manual: post + 5 comments (mixed depths) + votes from 2 accounts → all sort orders show right order → switching sort updates URL and content
- New account (< 7 days) votes are visibly half-weight in score column

### What's NOT in M3

- Vote velocity limits (v1.1)
- Comment editing (out of v1)
- Comment deletion by author (out of v1 — mod removes via M4 instead)
- Live updates (no websockets — PRD explicit)

---

## M4: Moderation [SHIPPED]

**Goal.** Sub owners can collapse, remove, ban. All actions land in a public mod log. Users can flag posts/comments by category. Flag thresholds auto-hide pending review. The forum has the social tools to stay non-toxic without external authority.

**Why fourth.** M2-M3 created the surface (subs, posts, comments, votes); M4 makes that surface defensible against abuse. Ship before public exposure.

**Vocabulary shipped (visible to users):** internal action enum stays `collapse` / `remove` for code/DB stability, but the public modlog displays them as **`soft removal`** and **`hard removal`**. Soft = chip-as-fold (`[+] [collapsed by mod]`, click expands body in place of label, reason optional). Hard = static stub (`[−] [removed by mod]`, body genuinely gone, reason required). Same chip shape, opposite sigil, opposite interactivity — symmetric design, honest about the asymmetric outcomes.

### Deliverables

- **Schema additions:**
  - `mod_actions` (id, sub_id, mod_handle, action ENUM[collapse,remove,ban,unban,promote_mod,demote_mod,transfer_owner], target_type, target_id, reason, created_at)
  - `flags` (id, target_type, target_id, flagger_handle, category ENUM[spam,harassment,illegal,off_topic,other], note, created_at, resolution ENUM[pending,upheld,dismissed], resolver_handle, resolved_at)
  - `bans` (id, sub_id, banned_handle, reason, expires_at NULLABLE, mod_handle, created_at)
  - `posts.collapsed_at`, `posts.removed_at` columns (soft state for tier 1 vs tier 2)
  - Same on `comments`
- **Routes:**
  - `POST /sub/<name>/mod/collapse` — mod action, target = post or comment id, reason required
  - `POST /sub/<name>/mod/remove` — same shape, harder action
  - `POST /sub/<name>/mod/ban` — bans handle from sub
  - `POST /sub/<name>/mod/promote` — owner-only, adds co-mod
  - `POST /flag` — user flags target, requires category + handle
  - `GET /sub/<name>/modlog` — public mod log, paginated, chronological
  - `GET /sub/<name>/modqueue` — mod-only, pending flags + new-account posts surfaced
- **Flag thresholds (PRD §Flag system):**
  - 3 flags from distinct handles AND distinct IP /24 AND each ≥7 days forum-tenure → auto-hide pending mod review
  - Flagger weight reduced after 5 dismissed flags in 30 days → flags become advisory only
- **Two-tier rendering:**
  - Collapsed posts/comments render as `<details>` with one-line reason; click to expand; vote tallies still show
  - Removed posts gone from thread; visible only via mod log link
- **Mod log:**
  - Public, paginated, chronological
  - Shows mod pseudonym, action, target snippet, reason, timestamp
  - Cannot be edited or deleted by mods (immutable insert-only table)
- **Protocol-level blocks (instance-wide):**
  - `protocol_blocks` config file (CSAM hashes, malware URL list refs)
  - Posts checked at submit; failure rejects without entering DB
  - This is *instance admin*, not sub mods (PRD §No instance-level moderation above sub mods, but protocol blocks are the explicit exception)
- **Display additions (PRD §User Display):**
  - On every post/comment hover/profile: mod-confirmed removals last 90 days per-sub, active sub bans
  - Old removals roll off automatically (query is time-windowed)
- **Tests:**
  - Integration: 3 distinct flagger accounts → post auto-hides → mod resolves (upheld or dismissed) → log entry created → user-display shows removal
  - Unit: flag-threshold logic (distinct handles + distinct /24 + tenure check), flagger-weight degradation
  - Authorization: non-mod cannot collapse/remove; non-owner cannot promote; banned user cannot post in sub but can in others

### Definition of done

- `npm test` green
- Manual: as mod, collapse a post → reason shows, can expand. Remove another → gone from thread, visible in modlog. Ban a user → they can't post in this sub, can still post elsewhere. Flag a post 3x from 3 accounts → auto-hides → resolve → behavior consistent.
- Mod log is read-only (no UI to edit)

### What's NOT in M4

- Instance-level mod council (PRD: option 2 — no such authority)
- Sub deletion or mass-removal tools
- Appeals process (informal — fork the sub if you disagree)
- AI-assisted moderation (permanently out)

---

## M5-M8 (sketch, refined as M1-M4 land)

### M5 polish carryover from M4

- **My mod decisions panel — SHIPPED M5/B13.** Folded into the existing `/modlog` audit surface. The "[me]" filter button (now labeled "my decisions") scopes to the current mod's actions. Inline `revoke` buttons render in the audit table for the current mod's own actions whose effect is still in place: `collapse → uncollapse`, `remove → unremove`, `ban → unban`. Buttons POST to the existing `/sub/<sub>/mod` endpoint with the inverse action and return the user to the same audit view. Sub-keys-of-the-kingdom actions (`promote_mod`, `demote_mod`, `transfer_owner`) are intentionally NOT one-click revocable — those changes route through the explicit mod-management surface so they require deliberate action. Surfaces a mod's pattern of decisions to themselves (the "self-watching" dynamic — knowing your record is visible to you discourages capricious moderation).
- **Per-sub flag-threshold override — SHIPPED M5/B12.** Migration 011 added `subs.flag_threshold INTEGER NOT NULL DEFAULT 3`. PRD §Spam 7's "configurable per-sub, default 3 unique flaggers" is now operator-tunable via `/sub/create` and `/sub/<name>/edit` (owner only). `FLAG_THRESHOLD_FLOOR = 3` enforced at the content layer — operators can raise (more permissive for niche subs) but not lower (a single flagger collapsing a target would defeat the "distinct flaggers" defense). `submitFlag` now resolves the threshold per-target via `resolveFlagThreshold(db, targetType, targetId)` — comments inherit their post's sub setting.
- **Auto-uncollapse threshold (per-sub) — SHIPPED in M4 polish.** Migration 006 added `subs.auto_uncollapse_post` (floor 50) and `subs.auto_uncollapse_comment` (floor 20). `createSub` enforces the floors; `/sub/create` exposes both as number inputs. Higher floor on posts because feed exposure means votes accumulate faster — same vote count on a post represents a smaller fraction of the audience that saw it.

### M5: Spam defenses + per-sub structure
Rules 7-16 from PRD §Spam & Abuse Defenses. Per-account rate limits with new-account scrutiny, per-sub limits, link cap + URLhaus integration (hourly cron), spam pattern file (regex), velocity alerts dashboard, public mod log already done in M4.

**Per-sub structure adds:**
- **Flairs (per-sub) — SHIPPED M5/B10.** Migration 009 added `subs.flairs` JSON column, `subs.flairs_required`, and nullable `posts.flair_slug`/`drafts.flair_slug`. Owner curates the closed list (max 12 per sub) at `/sub/create` or via owner-only `/sub/<name>/edit`; users pick from it at post time. `flairsRequired` enforced in `finalizeDraft`. Display: colored pill in `authorMeta`, filter strip at top of sub page, filter via `?flair=<slug>`. No global flair index, no user-created flairs, no cross-sub flairs. Color is any valid CSS color (raw, like `branding.colors`); CSS-injection guard reused from `resolveBrandingColors`.
- **Sensitive content per-sub flag — SHIPPED M5/B11.** Migration 010 added `subs.sensitive INTEGER NOT NULL DEFAULT 0`. Toggled at sub creation and via owner-only `/sub/<name>/edit`. Renders as: amber banner on the sub page (`[!] sensitive content — use discretion`) plus a small `[!]` mark next to the sub name in the home active-subs strip and `/subs` directory. Forum does **not** run age verification (operator concern, see PRD §Permanently out). The flag is intentionally generic rather than NSFW because plato's default community rules ban porn — labeling something "NSFW" in a porn-banned forum invites the very content the rules forbid. `sensitive` covers graphic violence, abuse discussions, intense political topics, suicide/eating-disorder threads, etc. — operator/community decides what counts. Ties cleanly into M6 subscription preferences (hide sensitive subs from my-subs by default). A fork that wants to allow porn can rename/repurpose this flag.

### M6: Subscriptions + notifications
Sub subscribe/unsubscribe, my-subs page, email digest mode (reuses knowless's Postfix), ntfy push (one-line POST per notification), per-sub RSS feeds. Subscription list export (folds into M7's export format).

**Home-feed Subscribed/All toggle.** Deferred from the M5/UX pass that introduced top-of-page Posts/Comments tabs and sort/date filters. Adds an `All | Subscribed` row above the existing tab strip; "Subscribed" reads from the M6 subscriptions table. No-op until M6 lands.

**Outbound-mail signature + default rules.** Every plato → user email (magic link, digest, ntfy fallback) appends a footer block carrying the instance's default community rules. Default ruleset shipped with plato:

```
Basic Rules
- No bigotry — including racism, sexism, ableism, homophobia, transphobia, or xenophobia.
- Be respectful, especially when disagreeing. Everyone should feel welcome here.
- No porn.
- No ads / spamming.
- No illegal content.
```

Operator-overridable in `config.json` (`mailFooter` field). Rationale: every email is a touchpoint, and surfacing the rules in the medium where users actually read text (vs the forum chrome they skim past) makes them remembered. Same footer rendered as plato's default `/about` content so a fresh instance has the rules visible from day one.

### M7: Identity + export/import
Per-sub export (folder of markdown + JSON, archive.sig, server-pubkey.pem, archive.ots). Per-user export. Import flow on a fresh instance. Archive signing (one Ed25519 keypair instance-wide). OpenTimestamps daily anchor.

### M8: Production polish
docker-compose for self-host. Full-text search (SQLite FTS5 single-instance, Postgres tsvector multi-instance — pick one, document the swap). Dark mode (CSS variables, prefers-color-scheme). Mobile-responsive layout pass. Deploy guide. GitHub Actions CI. Migration story (POC → v1, but also "v1 → fork → v1 elsewhere" via the export/import).

---

## Locked Decisions

These were open questions; locked after the rendering-and-aesthetic discussion. Tweakable later (CSS variables make most adjustments trivial), but these are the M1 baselines.

### Visual baseline — Terminal (sample #1)

`forum-poc/samples/1-terminal.html` is the reference. Inspired by gitdone. Charcoal background, monospace throughout, subtle blue/amber/green accents, 720px column, generous whitespace, bordered post separators.

**Tweak vectors** (CSS-variable level, cheap to adjust later):
- Palette: `--accent` (currently #58a6ff blue), `--amber` (#d29922), `--green` (#56d364) — could shift to all-amber, or pick per-instance variant
- Column width: `max-width: 720px` — wider/narrower per taste
- Font: JetBrains Mono → could swap for IBM Plex Mono / SF Mono / system monospace
- Border style: solid 1px → could go dashed or subtler

What does **not** change:
- Identicons next to authors (32×32 bottts-neutral, deterministic from handle)
- Domain hints next to outbound links: `↗ host.com` text only (favicon image dropped — `s2/favicons` proxy leaks viewer→Google, self-hosting favicons reintroduces the no-uploads exception. Text alone delivers the affordance "I see I'm leaving to youtube.com before I click")
- Account-age + new-account badges
- Vote arrows + score on the left of every post
- Typography hierarchy: title > meta > body
- Server-rendered HTML, no client JS in v1
- **Logo (3-blue-dot mark)** — appears in top wordmark and footer, never replaced or recolored across forks
- **Project quote** in the footer: `— "opinion is the medium between knowledge and ignorance."` — locked, source of plato's name

### Branding (operator-replaceable via `config.json:branding`)

Three values an operator can override at boot:

| Field | Default | Where it appears |
|---|---|---|
| `forumName` | `"plato"` | Top wordmark next to the logo, footer wordmark, page `<title>`, "check your email" page header |
| `tagline` | `"a forum that lives at one URL"` | Subtitle line under the wordmark on the home page |
| `hostedBy` | `null` (line hidden when empty) | Footer line: `a <forumName> instance hosted by <hostedBy>` |

Example `config.json`:

```json
{
  "branding": {
    "forumName": "plato",
    "tagline": "a forum that lives at one URL",
    "hostedBy": "@tedvdb"
  }
}
```

What's **not** replaceable: the logo (the 3-blue-dot mark) and the locked project quote in the footer. Forks can rename the forum and change the tagline; the mark and the quote travel with the project.

### HTML rendering — tagged-template `html\`\`` + `raw()`

Lifted in shape from `~/PycharmProjects/gitdone/app/src/web/templates.js`. ~60 lines, zero deps, vanilla. Three primitives:

```js
escapeHTML(s)   // &<>"' → entities
raw(html)       // opt-out wrapper for trusted HTML (markdown output, inline SVG)
html`...`       // tagged template: escapes by default, passes raw() through
```

POC's manual `escape()` calls are out — too easy to forget. Auto-escape-by-default with explicit opt-out is strictly safer.

### CSS — single stylesheet file

`src/web/static/style.css`. Served by a static-file handler in `src/web/`. No inline `<style>`, no per-page CSS. Light/dark mode via CSS variables in M8.

### Static asset serving — `node:http` handler at `/static/*`

One handler in `src/web/static.js`. Serves `style.css`, favicon, generated identicons, cached external favicons (M5+). No reverse proxy in dev. Production (M8) puts Caddy in front for TLS + caching.

### Test framework — `node:test` (stdlib)

`node --test test/`. Zero deps. AGENT_RULES dependency hierarchy: stdlib first. Revisit only if we hit a missing feature.

### POC fate — archived, not deleted

`mv forum-poc forum-poc-archived` before M1 starts. Reference-only. Phase 2 retypes survivors with proper structure; no copy-paste from POC.

### Themes — instance-wide only, no per-sub themes

CSS variables for an instance-wide palette. Light/dark in M8. Per-sub themes are PRD-permanently-out (§What's explicitly out of v1). Sub mods get content tools, not visual styling.

### Media rendering — domain hints only

Plain markdown rendering (`marked`) for body content. Outbound links surface as plain hostname badges in the post-meta line — no fetched assets, no preview cards, no embeds, no thumbnails. PRD §Permanently out holds. (M5/B9 shipped a brand-icon palette for ~10 popular domains; rolled back in favor of plain hostnames for simplicity and zero network surface.)

---

## Cross-cutting principles for Phase 2

- **No POC code copied.** Read the POC for the shape, retype the survivors with proper structure.
- **Tests come after the design stabilizes per milestone.** Don't TDD M1 — build the working skeleton, then write tests against the public API. Per AGENT_RULES: "After the design stabilizes, not during exploration."
- **Each milestone ships green before the next starts.** No partial M1 + partial M2 in flight. Each milestone has clear DoD.
- **Manual verification per milestone.** Tests catch regressions; manual catches design flaws. Both required for DoD.
- **Defer ruthlessly.** Anything not in v1 (per PRD) doesn't sneak in. Any v1 feature not in this milestone waits its turn.
- **Documentation pass at end of each milestone.** Update the README, the schema doc, and the deploy notes. Don't let docs rot.

---

## Pre-M1 checklist

Before opening the Phase 2 repo:

- [ ] POC archived (`mv forum-poc forum-poc-archived`)
- [ ] Open Questions 1-5 resolved (locks above are leans; confirm or override)
- [ ] Empty git repo at `~/PycharmProjects/plato/`
- [ ] M1 starts with: layout dirs, package.json, .env.example, schema migration 001, knowless wiring in `src/auth/`, simplest possible homepage that lists posts. Build outward from there.

When all checked: M1 starts. ~2 weeks of focused work to first DoD.
