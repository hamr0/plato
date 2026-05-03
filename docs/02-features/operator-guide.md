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
- Unified mod surface at `/modlog` for any user moderating one or more subs: three modes (open / inbox / audit), click-to-filter on every column, native `<details>` row expansion that shows the body inline so mods rule without navigating away. Public per-sub `/sub/<name>/modlog` shows the same audit table, minus pending data.
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
- **No tags or hashtags.** Closed-list per-sub flairs (M5/B10) instead — slug + label + raw CSS color, max 12 per sub, owner-curated, optional unless `flairsRequired`. Tags drift into spam vectors and taxonomy chaos; flairs stay clean because the sub owner curates.
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
- `hostedBy` (optional) renders as a footer line: `a <forumName> instance hosted by <hostedBy>`. Hidden when empty.
- `colors.up` (optional) overrides `--up` — positive score color and the voted-up arrow's "you voted here" memory shade.
- `colors.down` (optional) overrides `--down` — negative score color and the voted-down arrow's "you voted here" memory shade.

Color values accept any CSS color string (hex `#fff`, rgb `rgb(127, 217, 98)`, named `tomato`). Boot-time validation rejects any string containing `;{}<>"'` to block CSS-injection. Bad config throws at boot, not on first user request.

**Locked across all forks.** The 3-blue-dot logo and the footer quote `— "opinion is the medium between knowledge and ignorance."` travel with the project. Forks rename the forum, never the mark or the quote.

**SMTP, port, DB path, public URL.** All in `.env`. Standard environment configuration.

**Disposable-email blocklist.** `disposable-domains.txt`, one domain per line. New signups from these domains are rejected at form submission, before the magic-link is even attempted. M5 syncs this to a community-maintained upstream list automatically.

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
- **Flairs.** Closed list, max 12 per sub, slug + label + raw CSS color. Owner-curated. Optional unless `flairsRequired = true`. Each flair renders as a colored pill in the post-meta line; users filter with `?flair=<slug>`. Editable. Removing a flair from the list does not invalidate posts that already use it (the post just renders without a pill until the flair is re-added).
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

**`bin/refresh-urlhaus.js`** fetches the URLhaus blocklist hourly. Wire to system cron:

```
0 * * * * cd /path/to/plato && node bin/refresh-urlhaus.js >> /var/log/plato-urlhaus.log 2>&1
```

The script writes to `data/urlhaus.txt`. Restart plato to pick up a fresh fetch (or wait for the next deploy). Posts/comments linking to a blocked host auto-collapse + flag for mod review with the note `blocked-url: <host>`.

**System events in the modlog.** Spam-regex and URLhaus auto-collapses also write a `mod_actions` row attributed to the `system` pseudonym. They appear in `/modlog` audit/inbox modes and in the public `/sub/<name>/modlog` so anyone can see when and why the system intervened. Use `/modlog?mod=system` to view only auto-actions; the `reason` column carries the pattern source or blocked host.

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
| Flairs per sub | 12 |
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
- **`general` sub is archive-only.** The catch-all from the migration era. New posts must land in a real sub with a real owner-mod. Reddit's `r/all` problem shouldn't be re-imported.
- **No feed personalization, no ranking algorithm.** Hot is a closed-form formula. New is chronological. Top is sum of votes over a window. Old is reverse chronological. That's it.
- **Body typeface (mono).** Locked at `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` (`style.css:62`). The mono voice is part of the product's identity — terminal-honest, scannable, line-aligned. Operator config covers colors, name, tagline, host handle; it does not cover the typeface. Same precedent as HN, lobste.rs, old.reddit (locked). If you want a different font, fork the one CSS line.

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

- **M5 — Mod surface + spam defenses [SHIPPED].** Unified `/modlog` (open/inbox/audit) shipped. Forum-wide rate limits, per-sub topic-flood limit, link cap, regex spam-patterns, URLhaus hourly cron all shipped. M5/B6 added system-attributed audit rows so spam-regex and URLhaus auto-collapses appear in the public modlog with `mod_handle = system`. M5/B7 closed an M1–M4 audit pass: open-redirect guard on `?return_to=`, atomic post-file/DB ordering, anchored frontmatter parser, length caps on title/body/comment/flag-note, fresh-user vote/flag handle bootstrap, comments under removed parents rejected, comment-tree cycle detection + render depth cap, `transfer_owner` validation. M5/B8 UX pass: `/subs` directory (with subscriber column placeholder for M6), `//<sub>` display style replaces `/sub/<x>` in feed/post-meta/breadcrumbs, comment-count "N replies" link with zero-reply visibility, sub color accent on feed, domain-hint after outbound links, home top-nav with Posts/Comments tabs + new/old/top/hot sort + 24h/week/all date filters, body width 720→880, post-page spacing tightened. M5/B9: branding color overrides + vote recolor + 24h edit window + action-pill unification. M5/B10: per-sub flairs (closed-list, owner-curated, max 12, optional `flairs_required`). M5/B11: per-sub sensitive content flag (amber banner; not NSFW labeling). M5/B12: per-sub flag-threshold override (`FLAG_THRESHOLD_FLOOR = 3`, raise-only). M5/B13: inline revoke in `/modlog` audit view (actor-only; promote/demote/transfer excluded). M5/B14: guest comment composer (logged-out post page renders the composer; submit stashes the draft in `localStorage` and nudges the user to the header login; magic-link `return_to` brings them back and `comment.js` autoposts the stashed body through the existing JSON splice — no server schema, comment endpoint still 401s anonymous POSTs, top-level only). Still open: "new account" tag in mod queue.
- **M6 — Subscriptions and notifications.** M6/B0: memlog (per-user notification log) shipped — `/memlog` route reachable from the pseudonym in the header (now accent-colored to mirror sub-link affordance), three kinds (`comment_on_post`, `reply_to_comment`, `mod_action`), unread chip, 90-day lazy-prune retention, no vote events; click-through auto-opens any enclosing `<details>` so you land on the body of the relevant comment. Page chrome enforcement (post-B0): every page now goes through one canonical `pageView` helper, so the header is consistent across home, sub, post, modlog, memlog, edit, login, error pages — the rule "every subpage uses the home format with the forum name replaced by the page action" is now codified in code. Still upcoming in M6: subscriptions (subscribe/unsubscribe, `/subs?filter=mine` view, home-feed `subscribed | all` toggle), email digest, ntfy push, per-sub RSS feeds, outbound-mail signature.
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
