# plato — Operator Guide (humans)

> For people running, customizing, or considering forking a plato forum.
> Companion to the [Integration Guide](plato.context.md) which covers the same ground for AI assistants and developers.

---

## What plato is, in one minute

plato is a forum that lives at one URL. Reddit-shaped: subs, posts, hierarchical comments, upvotes/downvotes, two-tier moderation. **Owned by you.** No company, no algorithm, no surprise rule changes from above. If you (the operator) go bad, anyone can fork the archive and run it elsewhere.

It is text-first by design. No images, no videos, no rich embeds. Markdown for post bodies, that's it. The bet: text-first communities last decades, image/video communities don't.

It is pseudonymous by default. Users sign in with a magic link — no password, no email is stored, no real names. The forum knows them by a deterministic two-word pseudonym and a generated robot avatar.

It is one Node process, one SQLite file, one HTTP port. You can run it on a $5 VPS. Backup is `cp forum.db forum.db.bak` plus `rsync` of the `posts/` folder.

---

## Who plato is for

- **Communities that want to outlast the platform du jour.** Discord servers that lost their archives. Subreddits that got banned. Mailing lists that drifted into Slack and then died.
- **Operators willing to host one process.** If running `npm start` and editing a config file scares you, plato is not the right tool yet (M8 ships an opinionated install script).
- **People who think the social-media problem is ownership and rules, not technology.** If you want federation, ActivityPub, or a "decentralized" anything — plato isn't that. Plato is one website, owned by one person, that anyone can clone the archive of.

Plato is *not* for: image-first communities, communities that want voice/video, communities that want algorithmic ranking, communities that want anonymity beyond pseudonymous (no Tor, no zero-knowledge), communities that want monetization.

---

## What you get out of the box

- Front page: a chronological stream of recent posts across every sub. Sort chips (new / old / top / hot) and date chips (24h / week / all) are the only curation levers; no algorithmic per-sub cap and no recommendation feed. Once M6 ships subscriptions, the home becomes "your subs."
- Sub feeds with new/old/top/hot sort. "Hot" is HN-shaped (`score / (age + 2)^1.5`) — no recurring rank job.
- Hierarchical comments, indented up to 4 levels deep, with `+ N more replies` folds beyond that.
- Upvote/downvote with new-account safeguards (half weight, posts-only, posts < 24h only, for the first 7 days).
- Two-tier moderation: **soft removal** (collapse, reversible, body still readable behind a fold) and **hard removal** (remove, requires a written reason, body replaced with a `[− removed by mod]` stub).
- Public mod log per sub. Every action is on the record.
- Community auto-revert: if a soft-removed post racks up enough net upvotes after the collapse, the system lifts the collapse on its own and writes "community overruled" to the log. Defends against capricious mods. Does *not* apply to hard removals.
- Per-sub flag system. Five categories (spam, harassment, illegal, off-topic, other). Three distinct flaggers auto-collapse a post pending mod review.
- Unified mod surface at `/modlog`: three modes (`open` / `inbox` / `audit`). The audit mode is **public** — instance-wide, no login required; everyone sees every mod action across every sub from the footer link. The `open` and `inbox` modes are mod-only (pending queue + your inbox). Top-right nav for mods defaults to `/modlog?mod=me` ("my decisions"); the public footer link points at bare `/modlog`. Click-to-filter on every column; native `<details>` row expansion shows the body inline so mods rule without navigating away. Sub filter renders as inline chips up to `MODLOG_SUB_CHIP_LIMIT` (15) subs, then collapses to a `<select>` dropdown that sits inside the filter bar. Per-sub `/sub/<name>/modlog` is also public — same audit table, minus pending data.
- Unified personal log at `/memlog` for every logged-in user: three modes (notifications / activity / all). Notifications = comments and replies received plus mod actions on your content. Activity = your own posts and comments. Same surface, one mode chip flips between them. Kind chips are multi-select with cross-side semantics: `comments` matches both received-comment notifications AND comments you authored, so it works the same way regardless of which mode you're in. `posts` is activity-only; `replies` / `mod-actions` / `archives` / `imports` narrow only the notification half. When `show: unread` matches no rows but read history exists, the page auto-flips to `show: all` and surfaces a "no unread match — back to unread" hint. A modlog-style "showing: <filters> · clear all" footer surfaces below the chip row whenever the selection differs from defaults.
- Mobile-responsive layout at ≤640px: header stacks instead of overlapping, wide tables drop non-essential columns or scroll within their block, no full-page horizontal scroll on phones.
- Forum-wide spam defenses: tiered rate limits per account age, per-sub topic-flood limits, per-post link cap, an operator-editable `spam-patterns.txt` regex file, and an hourly URLhaus blocklist sync (cron script ships in `bin/`). All knobs have PRD-locked floors; operators tighten via `config.json`, never loosen.
- Magic-link login. No passwords ever. Your email never lands in the database in plaintext.
- Deterministic pseudonyms and robot avatars. Same user, same display, no uploads.
- Markdown-only post bodies, with raw HTML escaped, image-markdown turned into plain links, and dangerous URL schemes stripped.

---

## What plato will *never* be

These aren't "later" — they're decided.

- **No accounts with passwords.** Magic link only.
- **No real names, no profile pictures, no bios.** Pseudonym + identicon, full stop.
- **No image or video uploads.** Text only. Markdown-image syntax becomes a plain link.
- **No private subs.** PRD §Permanently out. Different product, different security story, different attack surface.
- **No tags or hashtags.** Closed-list per-sub flairs (M5/B10) instead — slug + label + 6-digit hex color, max 6 per sub, owner-curated, optional unless `flairsRequired`. Tags drift into spam vectors and taxonomy chaos; flairs stay clean because the sub owner curates.
- **No NSFW labeling, no age verification.** Plato uses a generic `sensitive` per-sub flag (M5/B11) — banner advisory, no age-gating. NSFW is excluded as a label specifically because the default rules ban porn, so the NSFW label would invite the very content the rules forbid. Age verification is an operator-layer concern (reverse proxy or content gateway in front of the forum), not a forum feature.
- **No algorithmic feed.** Hot + new + top + old. Simple, predictable, auditable.
- **No deletion of comments by their author.** Mods remove via the mod log. The log is the social pressure that keeps mods honest, and authors deleting their own words breaks the audit trail.
- **No federation, no ActivityPub.** One site, one URL, one operator. Forking is the answer to "what if the operator goes bad."
- **No DMs / private messages.** Out of v1. Possibly never.

---

## What you can change easily

Three categories. Pick the right tier before deciding.

### Tier 1: One-line edit, restart, you own the change

These are the operator surfaces. The project assumes you'll touch them.

**Colors.** Open `src/web/static/style.css`, find the `:root` block at the top. Every color in the forum is a `--variable`. Change `--accent: #58a6ff` to your brand color and reload — vote arrows, links, logo dots, mod-button hover, the modlog accent rows all switch together. Forkable color tokens are a v1 commitment, not a "we might do this someday" — every PR that adds a new color has to add a variable, not a hex literal.

**Logo.** Drop your own SVG into `src/web/static/favicon.svg` and edit the `logoMark()` function in `src/web/app.js` to match. The default three-blue-dot mark is the project's; on your fork it doesn't have to be.

**Config surface map.** Quick reference: every `config.json` knob and where it shows up. Discursive paragraphs and validation rules below.

| `config.json` key | Required? | Reflects in |
|---|---|---|
| `branding.forumName` | yes (default `"plato"`) | top wordmark, footer wordmark, every page `<title>`, the magic-link "check your email" header, `og:site_name` meta, `/about` opening sentence, the default `metaDescription` template |
| `branding.tagline` | optional | home-page subtitle, the default `metaDescription` template |
| `branding.hostedBy` | optional | global footer line `a <forumName> instance hosted by <hostedBy>` (hidden when unset), `/about` opening sentence (falls back to `@<forumName>` when unset) |
| `branding.feedbackEmail` | optional | global footer link (`feedback · about · modlog`), `/about` "questions or feedback" link — both `mailto:`, address hidden behind link text |
| `branding.rules` | optional, ≤4 lines (defaults ship if omitted) | `/about` rules section, footer of every magic-link email (single source of truth — knowless mail-footer cap, no URL schemes, no bare domains) |
| `branding.colors.up` / `branding.colors.down` | optional | `--up` / `--down` CSS variables — vote arrows, score color, "you voted here" memory shade |
| `branding.metaDescription` | optional | `<meta name="description">` and `og:description` for `/`, link-unfurls (Slack/Signal/iMessage/Mastodon). Per-page descriptions for `/about`, `/modlog`, `/subs`, `/sub/<name>`, `/sub/<name>/post/<id>` are auto-derived and not operator-tunable |
| `urlDisplayMax` | optional, default 30 | bare-URL truncation ceiling in rendered post + comment bodies (`href` always preserved; full URL on hover) |
| `feedPageSize` | optional, default 50 | items per page on the home feed and on each sub feed before the `← prev | page N | next →` footer |
| `operator.email` | optional | recipient for cron-job reports: daily DB backup failures, weekly stats digest, quarterly disposable-domain refresh, hourly URLhaus refresh failures (see [`cron-jobs.md`](cron-jobs.md)). When unset, scripts print to stderr (cron's mailer or `journalctl` surfaces it) |
| `operator.service` | optional, default `"plato"` | systemd unit cron jobs restart when `disposable-domains.txt` snapshot changes |

The forum process never reads the `operator.*` block — it exists purely for the cron scripts. Pages that are *not* operator-configurable (deliberately uniform across forks): the data-handling paragraph and fork-escape paragraph on `/about`, the project footer quote, and the 3-blue-dot logo. To change those, fork.

**Branding (operator-replaceable, `config.json`).** Five knobs:

```json
{
  "branding": {
    "forumName": "plato",
    "tagline": "a forum that lives at one URL",
    "hostedBy": "@tedvdb",
    "colors": { "up": "#3fb950", "down": "#58a6ff" }
  }
}
```

- `forumName` shows in the top wordmark, footer wordmark, page title, and the "check your email" header.
- `tagline` shows as the subtitle on the home page.
- `hostedBy` (optional) renders in **two** places: the global footer line `a <forumName> instance hosted by <hostedBy>` (hidden when empty), and the opening sentence of `/about` (`this is a <forumName> instance, hosted by <hostedBy>`). When unset on `/about`, falls back to `@<forumName>`.
- `colors.up` (optional) overrides `--up` — positive score color and the voted-up arrow's "you voted here" memory shade.
- `colors.down` (optional) overrides `--down` — negative score color and the voted-down arrow's "you voted here" memory shade.

Color values accept any CSS color string (hex `#fff`, rgb `rgb(127, 217, 98)`, named `tomato`). Boot-time validation rejects any string containing `;{}<>"'` to block CSS-injection. Bad config throws at boot, not on first user request.

**Locked across all forks.** The 3-blue-dot logo and the footer quote `— "opinion is the medium between knowledge and ignorance."` travel with the project. Forks rename the forum, never the mark or the quote.

**SMTP, port, DB path, public URL.** All in `.env`. Standard environment configuration.

**Disposable-email blocklist.** `disposable-domains.txt`, one domain per line. New signups from these domains are rejected at form submission, before the magic-link is even attempted. Snapshot of the [disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains) community list (~5400 domains, MIT). Refresh manually with `./scripts/refresh-disposable-domains.sh`, or install the autoconfigured quarterly cron — see [`cron-jobs.md`](cron-jobs.md). The list is never fetched at runtime so a remote change can't silently expand the block surface.

**Operator contact (`config.json`).** Optional `operator` block carries the operator's email and systemd unit name. Cron jobs read these instead of hardcoding paths — no script editing required.

```jsonc
{
  "operator": {
    "email": "you@example.com",   // where cron jobs send refresh / failure reports
    "service": "plato"            // systemd unit to restart when a snapshot changes
  }
}
```

If `email` is missing, cron jobs print to stderr (cron's default mailer or `journalctl` will surface it). If `service` is missing it defaults to `plato`. The forum process itself doesn't read this block — it only exists for operator tooling.

**Daily backup.** `scripts/cron-backup-db.sh` snapshots `forum.db` + `knowless.db` + `posts/` to `data/backups/plato-YYYY-MM-DD.tar.gz` using SQLite `.backup` (WAL-safe). 7-day retention with auto-prune; override via `BACKUP_KEEP_DAYS` env (drop to 4 if disk-tight). Mails the operator on failure or prune events — silent success on quiet days. See [`cron-jobs.md`](cron-jobs.md) for the crontab line.

**Weekly stats digest.** `bin/stats.js` (daily snapshot → `data/stats.log`) + `bin/stats-weekly.js` (Mon 06:00 UTC digest → operator email). Counters: users (`knowless.db.handles` row count — anyone who's ever requested a magic link), subs, posts, comments (the latter two excluding `removed_at`). Digest is a fixed-width 4-week table with WoW deltas; `--dry-run` prints to stdout for local testing. See [`cron-jobs.md`](cron-jobs.md).

**Feedback email (`branding.feedbackEmail`).** Optional. Surfaces in **two** places: the global footer (`feedback · about · modlog` when set; just `about · modlog` when unset), and the opening sentence of `/about` (a "questions or feedback." link appended after the hosted-by line; absent when unset). Both are `mailto:` links — the address sits behind the link text rather than being printed in plain. Boot-time validation: ASCII, valid email shape, ≤120 chars, no quotes/CRLF.

```jsonc
{ "branding": { "feedbackEmail": "you@example.com" } }
```

**Site rules (`branding.rules`).** Optional array of up to 4 short strings (joined ≤240 chars, printable ASCII only, no URLs and no bare domains). Rendered as a list on `/about` AND injected into the magic-link email signature so users see the same text in the medium they actually read. Single source of truth — edit one config field, both surfaces stay in sync. The URL ban covers any `[a-z]+://` scheme (`http`, `https`, `mailto`, `data`, `ftp`, …) AND bare domain shapes (`example.com`, `host.io/path`) that mail clients auto-link — a phishing-vector defence on the email signature. Constraints inherit from knowless's `validateBodyFooter` (AF-8.2).

```jsonc
{
  "branding": {
    "rules": [
      "be civil",
      "no spam, scams, or doxxing",
      "no porn",
      "mods can remove; votes can reverse soft removes"
    ]
  }
}
```

**Defaulting policy.** A fresh instance with no `branding.rules` configured ships with the canonical four-line default set (lowercase ASCII, plato voice):

```
be civil, especially when disagreeing. no racism, sexism, ableism, homophobia, or transphobia.
no porn, no illegal content.
no ads, spam, scams, or doxxing.
mods are accountable; the modlog is public, and votes can reverse soft removes.
```

Operators who want a different tone override `branding.rules` with their own array. Operators who want **no** rules surface anywhere set `branding.rules: []` (or `null`) explicitly — the empty/null case is the documented opt-out and remains supported.

Bad shape (too many entries, non-ASCII, contains a URL, joined length over 240) throws at boot.

**`/about` page.** Auto-generated. Renders the operator-supplied prelude (forum name + hosted-by + optional feedback line + optional rules) followed by project-baked sections that aren't operator-edited: a data-handling paragraph (what plato stores and doesn't), and a fork-escape paragraph. The baked sections are uniform across forks by design — the public-honesty contract isn't operator-tunable. Replaces "privacy policy" / "terms of service" boilerplate with text that's actually true of plato.

**Search engine snippet (`branding.metaDescription`).** Optional. The default lands a privacy-posture-forward sentence in Google snippets and link unfurls (Slack, Signal, Discord, Mastodon, iMessage): *"a {forumName} instance: Reddit-shaped forum, magic-link auth, no tracking, no analytics, public modlog — {tagline}."* Override if you want bespoke copy. ASCII, ≤200 chars, throws at boot on bad shape.

```jsonc
{ "branding": { "metaDescription": "A bespoke description for your instance." } }
```

Per-page descriptions are auto-derived: `/about` says what plato keeps and doesn't, `/modlog` describes the public audit, sub pages prefer `sub.description`, post pages excerpt the first ~155 chars of the body. See [`docs/04-process/privacy-seo.md`](../04-process/privacy-seo.md) for the full SEO playbook (head tags, robots.txt, sitemap.xml, what's never added).

Two more audience signals ship at root: `/humans.txt` (lists the operator handle, the project, Apache-2.0, and the "what we don't do" stance — no analytics, no third-party JS, no tracking, no email retention, no algorithmic feed) and `/.well-known/security.txt` (RFC 9116 — Contact resolves to `branding.feedbackEmail` if set, else the GitHub issues URL; Expires auto-renews to 365 days from each request so a long-running instance never serves a stale date). Both static-shape, no new config keys, derive entirely from existing branding. Tier 1 + tier 2 of the playbook complete; `og:image` (1200×630 PNG card for richer link unfurls) and JSON-LD remain explicitly deferred — image is M8 polish, JSON-LD is "skip on principle" per the playbook itself.

**Reserved sub names.** Add to `RESERVED_SUB_NAMES` in `src/content/sub.js` if your fork adds a new top-level URL (e.g., `/shop`) that you don't want a sub to collide with.

### Tier 2: Hardcoded constant, restart, requires a deliberate decision

These have one default that's right for almost every instance. The project doesn't expose them as runtime config because almost no one changes them, and exposing them invites bikeshedding.

| Constant | Default | Where | What it does |
|---|---|---|---|
| `COLLAPSE_THRESHOLD` | -3 | `src/web/app.js` | Score below which a comment auto-folds (community-driven). |
| `MAX_DEPTH` | 4 | `src/web/app.js` | Comment indent depth before deeper replies fold into "+ N more". |
| `COMMENT_PREVIEW_CHARS` | 280 | `src/web/app.js` | Long-comment fold threshold (Twitter's old cap, deliberately the same for muscle memory). |
| `FLAG_THRESHOLD_FLOOR` | 3 | `src/content/flag.js` | Default for new subs; per-sub override via `flagThreshold` field. The constant is also the floor — operators can raise per-sub but never lower (a single flagger collapsing a target would defeat the "distinct flaggers" defense). |
| `NEW_ACCOUNT_WINDOW_MS` | 7 days | `src/content/vote.js` | How long a fresh account counts as "new". |
| `YOUNG_POST_WINDOW_MS` | 24h | `src/content/vote.js` | New accounts can only vote on posts within this window. |

If you change these, document *why* in your fork's CHANGELOG so future-you remembers.

### Tier 3: Per-sub setting, no restart

Set at `/sub/create` (all knobs) or via owner-only `/sub/<name>/edit` (everything except auto-uncollapse thresholds and the sub name, which are locked at creation):

- **Auto-uncollapse threshold for posts.** Floor 50, default 50. Net upvotes since a soft-removal that auto-lifts the collapse. Higher = harder for the community to overrule a mod. Locked at creation.
- **Auto-uncollapse threshold for comments.** Floor 20, default 20. Same, lower bar because comments accumulate fewer votes. Locked at creation.
- **Flag auto-hide threshold (`flagThreshold`).** Floor 3, default 3. Distinct flaggers required before a target auto-hides for mod review. Operators can raise (more permissive — useful for niche subs where a small audience would otherwise auto-hide normal content) but never lower. Editable.
- **Flairs.** Closed list, owner-curated, **max 6 per sub** (`MAX_FLAIRS_PER_SUB`). The `/sub/create` and owner-only `/sub/<name>/edit` form gives 6 flair rows — fill any 1–6 with a label + color, leave the rest blank. Slugs derive from labels automatically (lowercase, hyphenated). Color picker offers 8 preset swatches (`#3b82f6` blue, `#10b981` green, `#f59e0b` amber, `#ef4444` red, `#8b5cf6` violet, `#ec4899` pink, `#14b8a6` teal, `#64748b` slate) plus a free-form native `<input type="color">` — both emit 6-digit hex (`#rrggbb`), which is the *only* shape the server validator accepts (no rgb()/named/CSS-keyword side doors). Optional unless `flairsRequired = true`. Each flair renders as a colored pill in the post-meta line; users filter with `?flair=<slug>`. Editable. Removing a flair from the list does not invalidate posts that already use it (the post just renders without a pill until the flair is re-added).
- **Sensitive content flag (per sub).** Generic community-wide advisory. Renders an amber `[!] sensitive content — use discretion` banner on the sub page and a small `[!]` mark in the home active-subs strip and `/subs` directory. Editable.
- **Sensitive content flag (per post).** Author-set per-post checkbox at create time and within the 24h edit window. Stacks with the per-sub flag — either source triggers the advisory. Renders the same banner above the post body and a `[!]` mark next to the post title in feeds. Migration `012_post_sensitive.sql` adds `posts.sensitive` and `drafts.sensitive` (default 0). The two-layer model handles both broad-advisory subs (e.g. a community whose entire scope is sensitive) and one-off shocking posts inside otherwise-normal subs.

Spam defenses (rate limits, link cap, regex patterns, URLhaus) live at the **forum level** in `config.json`, not per sub. Sub owners inherit the operator's settings. This is intentional: per-sub spam knobs invite "soft sub" loopholes; one forum-wide policy is auditable in one file. The per-sub `flagThreshold` is the one exception — it's a moderation lever (when does mod review trigger), not a spam-defense permissiveness control, and the floor prevents abuse.

### Tier 4: Operator config (`config.json`), boot-validated, tighten-only

Forum-wide spam-defense knobs. Drop a `config.json` at the project root (or set `PLATO_CONFIG=` to point elsewhere). Every value has a PRD-locked floor — overrides must be **at most** as permissive as the floor. Bad config throws at boot, not on first user request.

```jsonc
{
  "rateLimits": {
    "perAccount": {
      "new":    { "postsPerHour": 1, "postsPerDay": 3,  "commentsPerDay": 10 },
      "recent": { "postsPerHour": 3, "postsPerDay": 10, "commentsPerDay": 30 }
    },
    "perSubDay": { "newish": 5, "trusted": 20 }
  },
  "linkCaps": { "new": 1, "recent": 3, "established": 5 },
  "spamPatternsFile": "spam-patterns.txt",
  "urlhausCacheFile": "data/urlhaus.txt"
}
```

The values shown are the floors. To tighten (e.g. limit new accounts to 1 post/day instead of 3), drop `postsPerDay` to a lower number. Setting `perAccount.new.postsPerHour: 5` would throw `exceeds floor of 1; operator can only tighten`.

**`spam-patterns.txt`** ships with conservative starter regexes for crypto/job/wire/romance scams. Add one line per spam wave you encounter; restart picks them up. Comments start with `#`. Bad regex skips with a stderr warning rather than killing boot.

**`bin/refresh-urlhaus.js`** fetches the URLhaus blocklist hourly. Wire to system cron — see [`cron-jobs.md`](cron-jobs.md) for the full crontab + how it interacts with `data/urlhaus.txt`. Posts/comments linking to a blocked host auto-collapse + flag for mod review with the note `blocked-url: <host>`.

**System events in the modlog.** Spam-regex and URLhaus auto-collapses also write a `mod_actions` row attributed to the `system` pseudonym. They appear in `/modlog` audit/inbox modes and in the public `/sub/<name>/modlog` so anyone can see when and why the system intervened. Use `/modlog?mod=system` to view only auto-actions; the `reason` column carries the pattern source or blocked host.

**Sub-archive exports in the modlog (M7 followup).** Every successful sub-archive export writes a `mod_actions` row (action `export`, target_type `sub`, mod_handle = the requester) so the act of taking a copy is visible alongside collapses and bans. Renders as `archive exported · <pseudonym>` in `/sub/<name>/modlog` and the unified `/modlog`. Personal exports (kind=user) are private and do NOT appear; failed exports do not appear. Imported sub-archives carry historical export rows verbatim with the `[imported]` tag pattern. See PRD §Cross-instance imports.

**Sub-archive imports in the modlog (M7 followup).** Parallel to the export side. Every successful sub-archive import writes a `mod_actions` row on the destination (action `import`, target_type `sub`, mod_handle = the importer). Renders as `sub imported · <pseudonym>`. The row is **native** — `imported_from_fingerprint` stays NULL — because the import act happened on this instance, not in the archive. Together with the historical `[imported]`-tagged rows from the archive, the destination modlog tells the full migration story for the sub.

**Display knob: `urlDisplayMax`.** Top-level integer in `config.json` (default 30, valid range 10–200). Bare auto-linked URLs longer than this are visually truncated to `prefix...` in rendered post bodies and comments; `href` is preserved (clicks still work) and the full URL surfaces via the `title` hover. `[label](url)` markdown with explicit labels is left untouched. No security floor — purely cosmetic. Bad value throws at boot.

```jsonc
{ "urlDisplayMax": 30 }
```

**Display knob: `feedPageSize`.** Top-level integer in `config.json` (default 50, valid range 10–200). Controls how many items render per page on the home feed (posts + comments tabs) and on each sub page before the `← prev | page N | next 50 →` footer offers the next page. No infinite scroll — pages give a clean pause beat and keep `?page=N` URLs shareable / back-button-honest. Smaller value = more pause beats, more click friction; larger value = heavier per-render work (previews, link-badge build). Bad value throws at boot.

```jsonc
{ "feedPageSize": 50 }
```

---

## All the numbers (rate limits, length caps, thresholds, windows)

Every threshold that gates behavior. Floors are PRD-locked safe minimums; you tighten via `config.json` but cannot loosen — overrides above the floor reject at boot. Per-sub thresholds are set at `/sub/create` and can only be raised by the owner. See `docs/02-features/plato.context.md` §Numeric reference for the full developer-facing table including source files.

### Rate limits — posts and comments

| Tier | posts/hour | posts/day | comments/day | per-sub posts/day |
|---|---|---|---|---|
| new (<24h)        | 1 | 3  | 10 | 5 |
| recent (1d–7d)    | 3 | 10 | 30 | 5 (still <30d) |
| trusted (≥30d)    | — | —  | —  | 20 |
| established (>7d) | uncapped | uncapped | uncapped | (per-sub still applies until 30d) |

**Owner carve-outs (in own sub only)**: per-hour cap skipped on posts, per-sub topic-flood cap skipped on posts, comment cap doubled (10→20 new, 30→60 recent). Per-day **post** cap is never lifted — the spam-floor stays.

### Outbound link cap per post

| Tier | links per post |
|---|---|
| new | 1 |
| recent | 3 |
| established | 5 |

### Per-sub thresholds (operator-tunable per sub by owner)

| Knob | Floor | Default at sub creation | Where edited |
|---|---|---|---|
| Auto-uncollapse posts (net upvotes) | 50 | 50 | `/sub/create`, `/sub/<name>/edit` |
| Auto-uncollapse comments | 20 | 20 | same |
| Flag threshold (distinct flaggers to auto-hide) | 3 | 3 | same |

### Length limits

| Field | Max chars |
|---|---|
| Post title | 300 |
| Post body | 40 000 |
| Comment body | 10 000 |
| Flag note | 280 |
| Sub name | 3–30 (lowercase, hyphens, no leading/trailing) |
| Sub description | 200 |
| Flair label | 24 |
| Flairs per sub | 6 |
| Notification snippet | 160 (auto-truncated with …) |
| Bare-URL display text | 30 (operator `urlDisplayMax`, range 10–200) |

### Time windows

| Window | Duration |
|---|---|
| Post / comment edit window | 24h after creation |
| New-account voting window (half weight, no comment voting, posts <24h only) | 7d |
| Trusted account threshold (per-sub day cap raises 5→20) | 30d |
| Memlog notification retention (lazy prune on `/memlog` GET) | 90d |
| Magic-link draft TTL | 15 min |

### Display + structure

| Knob | Default | Override |
|---|---|---|
| Feed page size | 50 | operator `feedPageSize`, range 10–200 |
| Comment-tree max render depth | 4 | hardcoded |

### Vote rules

| Rule | Value |
|---|---|
| Vote weight, new account (<7d) | 0.5× |
| Comment voting, new account (<7d) | disabled |
| Vote target age, new account (<7d) | posts only, post <24h |

---

## What's locked in (changing means forking)

The product decisions below are load-bearing. Each one is a deliberate choice the project makes about what plato *is*. You can change them in a fork — the license allows it — but understand that you're then maintaining a fork.

- **Magic-link auth, no passwords.** Adding passwords means adding password-reset flows, breach-detection, hashing, complexity rules — the whole thing the magic-link sidesteps.
- **Pseudonym + identicon, no uploads.** Allowing uploads means content moderation for images, storage costs, CDN, scrubbing EXIF data, image-spam vectors. None of which plato wants to deal with.
- **HMAC-derived handles.** The same email yields a different pseudonym ID on every instance because each instance has its own `KNOWLESS_SECRET`. This is the forking property — a forum's identity is *per-forum*. Don't lose your secret.
- **Markdown-only bodies, raw HTML escaped, dangerous URL schemes stripped.** The XSS guarantee. Plato has 11 tests pinned to this; you don't want to be the one who weakens them.
- **Sub names locked at creation.** No renames. Reddit's renaming flexibility caused most of its URL-archaeology problems.
- **Two-tier moderation with public modlog.** The combination of (a) reversible-by-default soft removal, (b) reason-required hard removal, and (c) every action logged publicly is what makes plato moderation defensible. Removing the modlog would break the trust model. Removing the soft tier would over-escalate every disagreement.
- **Operators do not arbitrate sub-level governance.** You run the instance. Communities run themselves. You do not assign mods to abandoned subs, do not reactivate read-only subs, do not rename subs, and do not have an admin UI to do so. The only paths to read-only are the in-app step-down without successor and the 30-day mod inactivity cron — both inside the community, neither requiring you. If a community disagrees with a mod, the answer is to *fork the sub* (create a successor) — not for you to install a chosen mod. Yes, you have DB access and could override. The design does not put you in that position to begin with; this is the load-bearing defense against authority-coercion (a lawful order to install a chosen mod has no admin path in plato to attach to). If you do override at the SQL layer in defiance of this posture, you are forking; users who don't trust you fork further.
- **`general` sub is archive-only.** The catch-all from the migration era. New posts must land in a real sub with a real owner-mod. Reddit's `r/all` problem shouldn't be re-imported.
- **No feed personalization, no ranking algorithm.** Hot is a closed-form formula. New is chronological. Top is sum of votes over a window. Old is reverse chronological. That's it.
- **Body typeface (mono).** Locked at `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` (`style.css:62`). The mono voice is part of the product's identity — terminal-honest, scannable, line-aligned. Operator config covers colors, name, tagline, host handle; it does not cover the typeface. Same precedent as HN, lobste.rs, old.reddit (locked). If you want a different font, fork the one CSS line.
- **Mod role implies subscribership; subscribe-toggle disabled-with-tooltip for mods on subs they moderate.** Sub creation auto-subscribes the owner; transfer-of-ownership re-establishes the subscription for the new owner. On both `/sub/<name>` (header) and `/subs` (directory row), the subscribe / unsubscribe button renders as a disabled, struck-through button with an explanatory tooltip when the current user has any mod role on that sub. Visible-but-disabled (vs. silently hidden) so the lock is legible to a mod who looks for the toggle. Reason: mod role is a stickier relationship than subscription, and unsubscribing while modding would just remove the sub from the feed they need to monitor. Subscriptions remain personal-preference for non-mod users. See PRD §Permanently out for the design lock.
- **Self-flag is rejected, in mechanism and UI.** A user cannot flag their own post or comment. The flag affordance is hidden in render, and `submitFlag` rejects the call defensively if it ever reaches the mechanism. No legitimate use case (authors edit / delete their own content directly), and accepting it would let a single user inflate the distinct-flagger count on their own content.
- **Mod-management confirms are inline `<details>` reveals, not browser-native popups.** Demote, step-down, disable-sub, and transfer-owner triggers expand inline (rounded-blue pill matching the promote / save / reactivate buttons) to reveal the confirmation copy + submit + cancel link. No `confirm()` popups in plato's voice. Cancel hard-refreshes the manage page so half-typed pickers can't get stuck open across navigations.
- **Sub-export gate: 60-day continuous subscription, no activity gate (M7/B2-b).** A sub archive can be requested by the sub's mod / co-mods, OR by any user who has been *continuously* subscribed for ≥60 days. "Continuous" = current unbroken span; unsubscribe-then-resubscribe restarts the clock (which is automatic — `unsubscribe` is a hard `DELETE`, so resubscribe writes a fresh `created_at`). Activity (posts / comments / votes) is intentionally NOT a gate — lurkers are real members. Personal exports have NO tenure gate (your own data is yours from day one). Picked because it's the cleanest, hardest-to-game friction for filtering drive-by forkers without policy fragmentation. See PRD §Exit as the real check.
- **Token-bearer downloads — no auth check on `GET /export/<token>.tar.gz`.** The 64-hex `download_token` IS the credential. Same posture as `/u/<token>/rss` (M6/B6 personal RSS). The user can paste the URL anywhere they want the archive sent (archive.org, a successor mod, another device). The 3-day TTL bounds leak exposure. Adding a login check to the download route would invert the design — see PRD §Exit as the real check.
- **Offline static reader inside archives auto-paginates above 100 items.** Both per-user and per-sub archive tarballs ship a no-JS reader. Below the threshold (`PAGINATION_THRESHOLD = 100`) the single-page `index.html` is preserved. Above it, `index.html` becomes a chip navigator + a "// recent activity" preview of the 20 newest items; subpages render filtered lists paginated 100 per page (`posts-2.html`, `posts-3.html`, …). Per-user archives carry `posts (N, Mp)` / `comments (N, Mp)` / per-`<year>` chips; per-sub archives carry `posts (N, Mp)` / per-`<year>` chips (comments stay nested inside per-post HTML pages — sub archives are post-centric, not flat comment streams). Pagination primitives live in `src/archive/reader-pagination.js` and are shared between `user-export.js` and `sub-export.js`. The new HTML subpages are inert from an importer's perspective — `import.js` consumes only `*.json` + `posts/<id>.md` and ignores the HTML.
- **Sub-import — URL-fetch only, no uploads (M7/B5).** The fork-and-go mechanism. Any logged-in user can paste the URL of an exported sub archive into the second tab of `/sub/create` (`?mode=import`); the server fetches the bytes itself at worker time (off-peak gating, env `IMPORT_OFFPEAK_*` mirroring export). The pasting user becomes the new sub's mod (transferable later through normal mod-management). Imported pseudonyms render dim + italic in the destination UI via `<span class="imported-author" aria-label="imported author alice-tiger">alice-tiger</span>` — render-time only; the DB pseudonym stays clean. Pseudonym collisions on the destination get a numeric suffix at storage time (`alice-tiger` → `alice-tiger-2`); the renderer strips the trailing `-N` for display so the visible name stays `alice-tiger` (gated on `imported_from_fingerprint` so native HMAC pseudonyms ending in `-N` aren't touched). Modlog rows from the archive carry the `[imported]` tag; the imported sub's page renders a banner showing source host, date, and importer; every sub-scoped page (post detail, modlog, sub-edit, sub index brand row) and every sub-listing surface (home active-subs strip, /subs directory) also carries a bare `[i]` chip with provenance in its hover tooltip. Idempotent: same source archive (manifest's `scope.sub` + `exported_at`) can only succeed once on a given instance — re-runs surface "already imported as <name>". Size cap defaults to 500MB (env `IMPORT_MAX_BYTES`) with a 120s fetch timeout; per-job retry up to 3 attempts then SLA-sweep at 3 days. Personal (kind=user) archives are NOT importable — they exist for personal viewing only.
- **Archive signing — Ed25519, instance-scoped, lazy + persistent (M7/B4).** Every archive ships with a sibling `<archive>.tar.gz.sig` (raw 64-byte detached Ed25519 signature over the gzipped tarball bytes). The keypair is generated lazily on first need (worker boot, first `/.well-known/plato-pubkey` hit, or first `/about` render) and stored in the DB's single-row `instance_keypair` table — backed up the same way you back up `forum.db`. Never rotated in v1. Public key is advertised at `GET /.well-known/plato-pubkey` (JSON: `algorithm`, `public_key_hex`, `fingerprint`, `created_at`, `instance.{forum_name,base_url}`); the same fingerprint lands in every archive's `manifest.json.instance.pubkey_fingerprint` and on `/about`. Importers verify by: (1) reading the manifest's claim, (2) fetching `/.well-known/plato-pubkey` from the manifest's `base_url`, (3) confirming the served fingerprint matches the manifest, (4) verifying the `.sig` against the gzipped bytes. Fingerprint mismatch = refuse. See `docs/02-features/archive-format.md` §Signing for the full recipe.

If you want any of the above different, plato is the wrong starting point — fork it or pick another project.

---

## Running plato

### First-time install

```bash
git clone https://github.com/hamr0/plato.git
cd plato
npm install
cp .env.example .env
# Edit .env. The KNOWLESS_SECRET is the most important field.
# Generate one with:
#   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
npm run migrate
npm start
```

Visit `http://localhost:8080`. You'll see "no subs yet — create the first one to get started." Click through, get a magic link (it'll print to your terminal in dev), and you're up.

### Recurring operations

- **`npm run migrate`** — apply any new migrations. Idempotent; safe to run on every deploy.
- **`npm test`** — run the 408-test suite. Should pass cleanly on every commit.
- **`npm start`** — start the server. No build step.
- **Cron jobs** — install the 6-line root crontab block from [`cron-jobs.md`](cron-jobs.md) once per instance. Covers daily backups (7-day retention), hourly URLhaus refresh, daily stats snapshot, weekly stats digest by email, quarterly disposable-domains refresh, and **daily sub-inactivity sweep** (auto-disables subs whose mods have been silent for 30 days; see *Sub state model* in [plato.context.md](plato.context.md) and the entry in cron-jobs.md). All autoconfig from `config.json operator.{email,service}` — no per-script editing.
- **Archive export queue (M7/B2-a + B2-b)** — `bin/run-export-queue.js` runs as a separate cron, suggested `*/15 * * * *`. Picks one pending export job per tick (sub or user kind) and only does work between `EXPORT_OFFPEAK_START` (default `01`) and `EXPORT_OFFPEAK_END` (default `06`) server time. To widen the window on an idle VPS, override the env vars (hour 0–23) or set `EXPORT_OFFPEAK_DISABLE=1` to ignore the gate. Output lands in `./exports/` (gitignored). Per-kind windows (locked floors): production SLA is **7 days for sub, 3 days for user** from request — past that the worker terminal-fails with `exceeded SLA window` so the queue can't grow unboundedly; download TTL is **3 days for both**, picked for disk-pressure not policy. Both sweeps run at the start of each tick. Archives self-describe their origin from `branding.forumName` + `branding.baseUrl` — set `branding.baseUrl` in `config.json` so the README and index.html include a working link back to the live instance. Suggested crontab line:

  ```
  */15 * * * * cd /opt/plato && node bin/run-export-queue.js >> /var/log/plato-export.log 2>&1
  ```
- **Archive import queue (M7/B5)** — `bin/run-import-queue.js` runs on the same off-peak schedule as exports. Picks one pending import per tick, fetches the URL the user pasted (size cap `IMPORT_MAX_BYTES` default 500MB, fetch timeout `IMPORT_FETCH_TIMEOUT_MS` default 120s), parses + verifies per-file SHA-256s, checks idempotence (same source archive can only succeed once via the manifest's scope.sub + exported_at), runs the insert in a transaction, emits memlog `import_ready` or `import_failed`. Off-peak window overridable via `IMPORT_OFFPEAK_START` / `IMPORT_OFFPEAK_END` (hour 0–23) or fully disable with `IMPORT_OFFPEAK_DISABLE=1`. Per-job retry up to 3 attempts then terminal-fail; 3-day SLA sweep on stuck rows. Suggested crontab line:

  ```
  */15 * * * * cd /opt/plato && node bin/run-import-queue.js >> /var/log/plato-import.log 2>&1
  ```
- **OpenTimestamps anchor — operator-opt-in (M7/B6).** plato never bundles the OTS client to keep its "five runtime deps" posture intact. Operators who want their archives Bitcoin-anchored install the official Python client once: `apt install opentimestamps-client` (Debian/Ubuntu) or `pipx install opentimestamps-client` (anywhere with Python ≥ 3.7). The default binary lookup is `ots` on `$PATH`; override with `OTS_BIN=/path/to/ots` if needed. Once installed, the export worker calls `ots stamp <archive>.tar.gz` automatically after writing the .sig — failures (network hiccup, calendar timeout, binary missing) log and skip; the export still ships .tar.gz + .sig. Initial proofs are "calendar-pending" until Bitcoin confirmations land (~1 hour to a day); add a daily upgrade cron to refresh in place:

  ```
  30 4 * * * cd /opt/plato && node bin/run-ots-upgrade.js >> /var/log/plato-ots-upgrade.log 2>&1
  ```

  Importers / auditors verify with `ots verify <archive>.tar.gz.ots` (requires the .tar.gz alongside; see opentimestamps.org). Archives without a .ots are not "broken" — they just predate operator opt-in or the binary failed at stamp time. Verification falls back to the Ed25519 signature alone in that case.
- **Backups** — copy `forum.db` and `posts/`. SQLite WAL means a hot copy works; for safety, use `sqlite3 forum.db ".backup forum.db.bak"`.
- **Restoring** — drop the files in place, ensure `KNOWLESS_SECRET` is the same as before (otherwise users look like new accounts), `npm start`.

### When something goes wrong

- **Magic-link emails not arriving.** Check `KNOWLESS_SMTP_*`. In dev, run a local MTA: `python3 -m smtpd -c DebuggingServer -n localhost:1025`. If `KNOWLESS_SMTP_HOST` is unset, knowless prints the link to stdout — useful for testing, but make sure it's set in production.
- **Server won't start with "missing env".** The boot validator is loud and specific. Read the error.
- **A column-add migration failed.** The runner aborts on the first failure and rolls back. Fix the SQL, re-run; previously-applied migrations are tracked in `schema_migrations` so they won't re-run.
- **A post page 500s on render.** The most common cause is a missing markdown file in `posts/`. The DB row points at a path; if the file is gone, the read raises. `getPostPreview` is tolerant (returns empty), but the full post page expects the file. Restore from backup or delete the row.

---

## Moderation philosophy

Plato bets on **soft moderation by default + visible accountability**.

- **Most things should be soft-removable, not hard-removable.** Soft removal collapses content behind a clickable chip. The body is still readable to anyone who chooses to expand. Reason is optional. Mods can collapse aggressively — they don't have to weigh "is this *really* worth removing forever?" Compare: Reddit-style hard removal where mods agonize, then the comment is gone, then the user thinks the mod is censoring them.
- **Hard removal is for content the mod doesn't want anyone seeing.** Targeted harassment, doxxing, illegal content, deliberate harm. Reason is *required* — the destructive direction needs a written justification, both as a self-discipline gate and as an artifact in the public log.
- **Community can overrule a soft removal.** If 50 net upvotes (per-sub configurable, floor 50) accumulate after the collapse, the system auto-lifts the collapse and logs it as "community overruled". The mod isn't notified to do anything; the system handles the reversal. This means a mod can soft-remove anything they want, and the community has a recourse that doesn't require a confrontation.
- **Community cannot overrule a hard removal.** If the mod escalated to hard, that's the mod saying "this content is genuinely harmful." Letting cumulative votes auto-undo a hard removal could revive abusive content. Hard removals are reversed only by a mod (`unremove`), and the unremove is itself logged.
- **Every mod action is in the public log.** `/sub/<name>/modlog` lists every collapse, remove, ban, system override, with mod handle, action, target, reason, timestamp. Mods know the community is watching. Communities know what their mods do.
- **Bans are per-sub.** A user banned from /sub/cooking can still participate in /sub/gardening. There's no global ban; there's no "platform-level" anything.

---

## Brand identity

The aesthetic is **terminal-honest**. Mono font where it fits, no emoji unless the operator adds them, no rich icons. Logo is three blue dots with ascending opacity, doubling as the loading indicator. Color palette is dark by default with a warm accent (`--accent-warm`) for moderation actions.

- The dots ascend in opacity left-to-right, suggesting thinking-through-things. The wave animation on the same dots is the loading state — you only ever see it during fetch round-trips, like comment submission.
- The tagline "opinion is the medium between knowledge and ignorance." is from Plato's *Republic* (Book V) and is the project's name origin. It's locked on the official build; your fork can change it.
- Light mode is M8. Until then, it's dark. The forkable color tokens make a light-mode skin a CSS-only change.

---

## What's coming next

- **M5 — Mod surface + spam defenses [SHIPPED].** Unified `/modlog` (open/inbox/audit) shipped. Forum-wide rate limits, per-sub topic-flood limit, link cap, regex spam-patterns, URLhaus hourly cron all shipped. M5/B6 added system-attributed audit rows so spam-regex and URLhaus auto-collapses appear in the public modlog with `mod_handle = system`. M5/B7 closed an M1–M4 audit pass: open-redirect guard on `?return_to=`, atomic post-file/DB ordering, anchored frontmatter parser, length caps on title/body/comment/flag-note, fresh-user vote/flag handle bootstrap, comments under removed parents rejected, comment-tree cycle detection + render depth cap, `transfer_owner` validation. M5/B8 UX pass: `/subs` directory (with subscriber column placeholder for M6), `//<sub>` display style replaces `/sub/<x>` in feed/post-meta/breadcrumbs, comment-count "N replies" link with zero-reply visibility, sub color accent on feed, domain-hint after outbound links, home top-nav with Posts/Comments tabs + new/old/top/hot sort + 24h/week/all date filters, body width 720→880, post-page spacing tightened. M5/B9: branding color overrides + vote recolor + 24h edit window + action-pill unification. M5/B10: per-sub flairs (closed-list, owner-curated, max 6, hex-only color, optional `flairs_required`). M5/B11: per-sub sensitive content flag (amber banner; not NSFW labeling). M5/B12: per-sub flag-threshold override (`FLAG_THRESHOLD_FLOOR = 3`, raise-only). M5/B13: inline revoke in `/modlog` audit view (actor-only; promote/demote/transfer excluded). M5/B14: guest comment composer (logged-out post page renders the composer; submit stashes the draft in `localStorage` and nudges the user to the header login; magic-link `return_to` brings them back and `comment.js` autoposts the stashed body through the existing JSON splice — no server schema, comment endpoint still 401s anonymous POSTs, top-level only). M5/B16: `[new]` tag in `/modlog?mode=open` — both the flagged target's author and each flagger get a muted `[new]` chip when their handle is inside the 7-day new-account window (same window `vote.js` uses for half-weight + comment-vote block). Renders via batch `newAccountHandles(db, handles)` so one query covers the whole page. Highest-signal use: triaging brigades where multiple fresh accounts converge on the same target.
- **M6 — Subscriptions and notifications.** M6/B0: memlog (per-user notification log) shipped — `/memlog` route reachable from the pseudonym in the header (now accent-colored to mirror sub-link affordance), three kinds (`comment_on_post`, `reply_to_comment`, `mod_action`), unread chip, 90-day lazy-prune retention, no vote events; click-through auto-opens any enclosing `<details>` so you land on the body of the relevant comment. Page chrome enforcement (post-B0): every page now goes through one canonical `pageView` helper, so the header is consistent across home, sub, post, modlog, memlog, edit, login, error pages — the rule "every subpage uses the home format with the forum name replaced by the page action" is now codified in code. M6/B2: sub subscriptions — migration 014 added `subscriptions(user_handle, sub_name, created_at)` with composite PK + index on `sub_name`. Inline `subscribe`/`unsubscribe` button in the sub-page header (logged-in only); POST `/sub/<name>/subscribe` is idempotent (form's `action=subscribe|unsubscribe`, missing action toggles). `/subs?filter=mine` filters the directory to subscribed subs only (anonymous silently falls back to `all`); the previously placeholder subscribers column now shows real counts. Subscriber identities are never exposed publicly — only aggregate counts. Disallowed in `robots.txt` (`/sub/*/subscribe`). M6/B3: home-feed `subscribed | all` toggle — replaces the placeholder chip pair. `?feed=subscribed` restricts both the posts and comments tabs to authored content from subscribed subs; chip pair renders only for logged-in users; anonymous + `?feed=subscribed` silently degrades (filter normalized to `all` so chip URLs stay clean). Logged-in user with zero subs sees an empty-state pointing at `/subs`. `listPostsAcrossSubs` and `listRecentCommentsAcrossSubs` gained a `subNames` option (null = no restriction; [] = no rows). M6/B4: per-sub Atom feed at `/sub/<name>/rss` — latest 50 posts (newest first), excluding **both** hard-removed and soft-collapsed (RSS bridges plato to readers in feed shape, not in drama shape — feed readers have no "this is collapsed" affordance, so soft-collapsed entries would land too loud). Titles + author pseudonym + body excerpt (≤600 chars). `Content-Type: application/atom+xml`, `Cache-Control: public, max-age=300`. Sub HTML page advertises the feed via `<link rel="alternate" type="application/atom+xml">` for reader autodiscovery and a visible `rss` link in the action row. 404 for missing subs. M6/B5: per-row subscribe form on `/subs` directory — logged-in users see an inline `subscribe`/`unsubscribe` text-link button per row that flips state without leaving the directory. Hidden for anonymous (same precedent as the chip strip + the sub-page header button). M6/B6: token-gated personal RSS feeds, branded "rssvp" in the visible UI (plato voice; the substring "rss" is preserved so reader users still recognize the feed affordance). Migration 015 added `handles.rss_token TEXT` with a UNIQUE partial index. Two routes share one per-user token: `/u/<token>/subs.rss` (latest 50 posts merged across subscribed subs, drama-shape exclusion of removed + collapsed) and `/u/<token>/rss` (the above plus memlog notifications interleaved by time). Token is 32 random bytes hex-encoded, generated lazily on first `/memlog` visit, regenerable via POST `/memlog/rss-regenerate` (button under "personal rssvp feed" on /memlog). Regen redirects to `/memlog?rssvp=open` so the `<details>` panel stays open. Rotation invalidates both URLs in one move. No handle in URL — token *is* the credential — which keeps pseudonyms out of reader app logs / corporate proxies / screenshots. Headers: `Content-Type: application/atom+xml`, `Cache-Control: private, no-store`. 404 on bad/missing token. Disallowed in `robots.txt` (`Disallow: /u/`). The two URLs render as click-to-copy text on /memlog (vanilla `navigator.clipboard.writeText` with a transient "copied!" flash; plain text selection still works without JS). Per-sub feed link in the sub action row is also relabeled `rssvp` (URL path unchanged at `/sub/<name>/rss`). New module `src/content/rss-token.js`. M6 closeout polish: (a0) **per-sub `rssvp` link is click-to-copy** (consistent with `/memlog` — `static/rssvp.js` handles both `.rssvp-copy` buttons and `.rssvp-link` anchors with one delegated listener; modifier-clicks bypass to preserve "open in new tab" / "copy link address" via the browser); subscribe / unsubscribe button drops its static underline (dotted underline on hover instead, matching the rest of the action row). (a) **default community rules ship out of the box** — fresh instance with no `branding.rules` configured surfaces the canonical four-line default on `/about` and at the foot of every magic-link email; operators override or suppress via `branding.rules` (see Tier-1 config above). (b) **Subscribe in-place via fetch** (`src/web/static/subscribe.js`, ~50 LOC) — clicking subscribe/unsubscribe on a sub page now flips the label without a full reload, fixing the below-the-fold flicker users reported. Pure progressive enhancement: no-JS path still POSTs the form and follows the 302 redirect. (c) **Sub-page action row layout fix** — was `<p>` containing a `<form>` (HTML5 forbids flow content inside paragraphs; parser auto-closed the `<p>`, pushing subscribe to a new line); now a `<div class="sub-action-row">` so `← home · public //modlog · rssvp · subscribe · edit sub` stays one line. (d) **/subs directory polish** — `subscribers` column renamed `mem` (frees horizontal real estate); `active` and `owner` columns get `white-space: nowrap` so relative-time and pseudonym strings stay single-line. M6 functionally complete. (Email digest and ntfy push were both on the original M6 plan and are now PRD-locked under §Permanently out — pull-shape RSS in three tiers covers the same surface without email storage or platform-skew push.)
- **M7 — Identity + export/import.** Per-sub export, per-user export, archive signing, OpenTimestamps, fork flow.
- **M8 — Production polish.** docker-compose, full-text search, light-mode toggle (forkable tokens already in place), mobile-responsive layout, deploy guide, GitHub Actions CI.

The build plan in `docs/01-product/build-plan.md` has the running tally; the PRD in `docs/01-product/prd-open-web-revival.md` has the rationale for every decision.

---

## How to fork

1. Fork the repo on GitHub.
2. Generate a new `KNOWLESS_SECRET`. (Different secret = different forum identity. Same email yields a different pseudonym on your fork than on the original.)
3. Re-skin: edit the `:root` block in `style.css`, swap the favicon and logo SVG, change the tagline.
4. Decide what's locked for *you*: are you keeping plato's no-uploads, no-passwords, no-tags rules? Each one you change is a maintenance burden you're now signing up for.
5. Run `npm install`, `npm run migrate`, `npm start`. You're now operating your own forum.

The point of plato isn't that everyone runs the canonical instance — it's that anyone *can* run an instance, and operator turnover is a fork, not an emergency.

---

## Frequently asked

**Q: Can I use my own auth system?**
A: Magic-link is locked. If you need OAuth or passwords, you're forking. Replace the `knowless` integration in `src/auth/`.

**Q: Can users delete their own posts?**
A: No. Mods remove via the mod log. The log is the audit trail; author-side deletion would break it.

**Q: What's stopping someone from spamming sign-ups with disposable emails?**
A: Layered defense: (1) `disposable-domains.txt` blocklist at form submit, (2) magic-link requires a working inbox per identity, (3) account-age tiered rate limits (1 post/hour for accounts <24h) — **owners are exempt from the per-hour burst cap when posting in their own sub**; the global per-day cap (3/10/established by tier) still bites, so a fresh owner can seed their freshly-created sub but can't drain quota across the instance — and **the daily comment cap is doubled when commenting in a sub you own** (20/60/established) so owners can lead discussion without becoming tyrants, (4) per-sub topic-flood limit (5 posts/day per sub for new accounts) — **owners are exempt from this cap when posting in their own sub** since topic-flooding a sub you define is a contradiction, (5) per-post outbound link cap (1 link/post for new accounts), (6) `spam-patterns.txt` regex match → auto-collapse for mod review, (7) URLhaus hourly cron blocks known-malicious link hosts. New-account vote-weight rules (half weight, no comment voting, posts < 24h only) limit damage from any sockpuppet that gets through.

**Q: How big can a plato instance get?**
A: SQLite + one Node process handles tens of thousands of daily-active users on a small VPS, which covers basically every community plato is targeting. Past that, you're forking and adding read replicas — but if you're at that scale, you've outgrown the project's design center anyway.

**Q: Can I monetize my instance?**
A: The project doesn't care. Donate buttons, paid memberships, ads — all operator concerns. The license (Apache 2.0) doesn't restrict commercial use.

**Q: What if plato itself disappears?**
A: You already have the code. Apache 2.0. Run `npm install` from your local checkout, you're fine.
