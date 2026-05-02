# plato — Operator Integration Guide

> For AI assistants and developers installing, running, forking, or extending a plato instance.
> v0.2.3 (M4 + M5 mod surface + M5 defenses + M5/B6 system audit rows + M5/B7 audit hardening + M5/B8 UX pass shipped) | Node.js >= 22.5 | five runtime deps | one HTTP port | SQLite single-file
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
| Change the forum name + tagline + "hosted by" line | `config.json` `branding` block (`forumName`, `tagline`, `hostedBy`). Logo + footer quote are locked. |
| Reserve more sub-name namespaces | `RESERVED_SUB_NAMES` in `src/content/sub.js` |
| Change new-account window or weight | `NEW_ACCOUNT_WINDOW_MS` / weight literal in `src/content/vote.js` |
| Change young-post window for new-account voting | `YOUNG_POST_WINDOW_MS` in `src/content/vote.js` |
| Change auto-uncollapse threshold for a sub | per-sub via `/sub/create` form (post ≥ 50, comment ≥ 20) |
| Change auto-hide flag threshold | `AUTO_HIDE_THRESHOLD` in `src/content/flag.js` (per-sub override pending) |
| Tighten rate limits / link cap | `config.json` at project root — see Operator Config below |
| Append spam regex patterns | `spam-patterns.txt` at project root, one regex per line |
| Refresh URLhaus blocklist | wire `bin/refresh-urlhaus.js` to system cron, hourly |
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
| GET | `/` | front page: active subs strip + recent posts (cap 2/sub). Top-nav filters: `?tab=posts\|comments`, `?sort=new\|old\|top\|hot`, `?date=24h\|week\|all`. Default tab = posts, default sort = new, default date = all. |
| GET | `/subs` | full directory of subs with sort (`?sort=active\|posts\|name`), client-side prefix filter, subscriber column (placeholder until M6) |
| GET | `/sub/<name>` | sub feed (sort: new/old/top/hot via `?sort=`) |
| GET | `/sub/create` | new-sub form (logged-in only) |
| POST | `/sub/create` | create sub (validates name + thresholds) |
| GET | `/sub/<name>/post/<id>` | post page with comments (sort: best/new via `?sort=`) |
| POST | `/sub/<name>/post/<id>/comment` | add comment (Accept: JSON for in-place insert) |
| GET | `/sub/<name>/modlog` | public mod-action audit (resolved-only; supports `?mod=`, `?user=`, `?date=`, `?type=` filters) |
| POST | `/sub/<name>/mod` | mod action (collapse/uncollapse/remove/unremove/ban/...) |
| GET | `/modlog` | unified mod inbox for any user moderating ≥1 sub. Modes: `?mode=open`/`inbox`/`audit`. Filters: `mode`, `date`, `type`, `sub`, `mod`, `user`, `page`. Default = open if pending exist, else audit. |
| POST | `/modlog/resolve` | one-shot decision endpoint for the open-mode form: `decision=uphold-soft|uphold-hard|dismiss` |
| POST | `/draft` | submit a draft post (logged-in: inlines finalize) |
| GET | `/draft/<id>/finalize` | finalize after magic-link click |
| GET | `/post/<id>` | canonical post permalink |
| POST | `/vote` | cast/toggle/switch a vote |
| POST | `/flag` | submit a flag (categories: spam/harassment/illegal/off_topic/other) |
| GET | `/avatar/<handle>.svg` | deterministic identicon |
| GET | `/static/*` | CSS/JS/icons (path-traversal-safe) |
| GET/POST | `/login`, `/auth/callback`, `/verify`, `/logout` | mounted by knowless |

Every sub-scoped route lives under `/sub/<name>/...` so future per-sub features don't have to refactor URL shapes.

## Configuration: locked vs forkable

Three categories. Pick the right effort tier before changing.

### Forkable (designed to be customized)

These are explicit operator surfaces. Changing them is a one-line edit + restart, and the design assumes you will.

- **Color tokens.** Every color in the UI is a `--*` CSS variable on `:root` in `style.css`. Re-skinning is a search-and-replace: `--bg`, `--text`, `--accent`, `--accent-warm`, `--border`, `--text-dim`. Vote arrows, links, logo dots, mod-button hover, modlog accent rows all re-skin together. **v1 requirement.**
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
- **`TITLE_MAX = 300` / `BODY_MAX = 40000`** (`src/content/post.js`) — server-side caps on draft input. Forms also carry `maxlength` but the server is authoritative.
- **`COMMENT_BODY_MAX = 10000`** (`src/content/comment.js`) — same shape as the post caps.
- **`NOTE_MAX = 280`** (`src/content/flag.js`) — server-side cap on flag notes.
- **`COMMENT_PREVIEW_CHARS = 280`** (`src/web/app.js`) — long-comment fold threshold; matches the post-preview cap on the home page.
- **`AUTO_HIDE_THRESHOLD = 3`** (`src/content/flag.js`) — distinct flaggers needed to auto-collapse pending mod review. Per-sub override is a follow-up.
- **`RATE_LIMIT_FLOOR`** (`src/content/rateLimit.js`) — PRD-locked floor for per-account + per-sub rate limits. Operator can tighten via `config.json`; loosening throws at boot.
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
- **No NSFW age verification.** Operator concern. M5 adds a per-sub NSFW flag (banner + advisory), nothing more.
- **No tags / hashtags.** M5 ships per-sub flairs (closed list, owner-curated) instead.
- **No private subs.** PRD §Permanently out — different product.
- **`general` is archive-only.** Legacy backfill bucket from migration 002. New posts must land in a real sub.
- **No image embeds, no video, no rich media.** Text-first by design.

If you want any of the locked items different on your instance, you're forking. That's fine — the licensing supports it.

## Database

Single SQLite file at `DB_PATH` (default `./forum.db`). WAL mode + STRICT tables + FK enforcement. All migrations idempotent and tracked in `schema_migrations` (id PRIMARY KEY).

| Table | Purpose |
|---|---|
| `handles` | HMAC-derived id + pseudonym + first_seen_at |
| `subs` | name PK, owner_handle FK, default_sort, NSFW flag (M5), auto_uncollapse_post, auto_uncollapse_comment |
| `sub_mods` | (sub_name, handle) composite PK + role enum |
| `posts` | id PK, sub_name FK, handle FK, title, file_path, score, collapsed_at, removed_at, score_at_collapse |
| `comments` | id PK, post_id FK, parent_comment_id self-ref FK (nullable), score, soft-state columns |
| `votes` | (target_type, target_id, handle) composite PK, value REAL CHECK |
| `drafts` | pending posts awaiting magic-link confirmation |
| `mod_actions` | audit log; mod_handle nullable for system actors |
| `flags` | (target_type, target_id, flagger_handle) composite PK, category enum |
| `bans` | (sub_name, handle) composite PK |
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
      "new":    { "postsPerHour": 1, "postsPerDay": 3,  "commentsPerDay": 10 },
      "recent": { "postsPerHour": 3, "postsPerDay": 10, "commentsPerDay": 30 }
    },
    "perSubDay": { "newish": 5, "trusted": 20 }
  },
  "linkCaps":         { "new": 1, "recent": 3, "established": 5 },
  "spamPatternsFile": "spam-patterns.txt",
  "urlhausCacheFile": "data/urlhaus.txt"
}
```

Spam knobs are forum-wide on purpose: per-sub overrides invite "soft sub" loopholes. Per-sub config is reserved for non-spam decisions (auto-uncollapse thresholds today, NSFW banner + flag-threshold override later).

`spam-patterns.txt` is the operator's per-instance regex set, one line per pattern, `#` comments, blank-line tolerant. Bad regex skips with a stderr warning. Restart picks up edits.

`bin/refresh-urlhaus.js` is a standalone fetcher meant for system cron (`0 * * * *`). Restart plato to pick up a fresh fetch — the host set is built once at boot.

System auto-actions (spam-regex hits, URLhaus host hits) write a `mod_actions` row attributed to `SYSTEM_HANDLE` (pseudonym `system`) in addition to the system flag. They surface in `/modlog` audit/inbox modes and in the public `/sub/<name>/modlog`, with the pattern source or blocked host carried in the `reason` column. Filter with `?mod=system` to isolate auto-actions.

### Per-sub settings (set via `/sub/create` form)

| Field | Floor | Default | Purpose |
|---|---|---|---|
| `name` | 3–30 chars, locked | — | Lowercase alphanumeric + hyphen, no leading/trailing hyphen. |
| `description` | optional | `''` | One-line tagline shown in the home strip. |
| `autoUncollapsePost` | **50** | 50 | Net upvotes since collapse to auto-uncollapse a soft-removed post. |
| `autoUncollapseComment` | **20** | 20 | Same, for comments. |

Operator can raise either threshold but never below the floor — defends against a small brigade overturning a soft-removal.

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

## Patterns, not features

- **Progressive enhancement.** Every form works without JS. JS layers add: in-place comment insertion (no reload), the loading-dots wave on the logo during fetch round-trips. `<noscript>` users get redirects + reloads.
- **Native `<details>`.** Reply forms, score-collapsed comments, mod-confirm forms, mod-state chips all use the platform fold. Zero JS for the fold itself.
- **HMAC handles for forking.** Same email yields different handle on a different instance. Identity is per-forum by design.
- **Score-snapshot at collapse.** When a mod soft-removes, `score_at_collapse` is captured. Cumulative-vote auto-revert checks `current_score - score_at_collapse >= per_sub_threshold` on every vote. Cheap; transactional; no background job.
- **Soft moderation supersedable, hard moderation not.** Hard removal is `mod_handle`-only undo. Soft removal can be undone by mod *or* by community. Mutually exclusive in the UI: when hard-removed, the collapse button is dimmed.

## Production usage

- One Node process. No clustering needed at hobby scale; SQLite WAL handles concurrent readers fine.
- Reverse proxy (Caddy/nginx) for TLS. M8 adds opinionated Caddy config.
- Backups: `cp forum.db forum.db.bak` and rsync `posts/`. SQLite WAL means you can copy the live file (`.backup` is safer for hot copies).
- Logging: stdout. Pipe to `journalctl` via systemd or your favorite log shipper.
- Monitoring: hit `/` and check 200; failures are loud. No metrics endpoint yet.
- Secrets: `KNOWLESS_SECRET` is the entire identity of the forum. Losing it doesn't break anything (handles still work — they were derived once and stored). Leaking it lets someone forge handles, so treat like a session-signing key.

## Gotchas

- **Magic-link emails go to a real SMTP server.** In dev, run `python3 -m smtpd -c DebuggingServer -n localhost:1025` or use mailhog. Without it, the form will accept submissions but the magic link is logged to stdout (knowless dev mode).
- **`general` sub is hidden from new-post forms by design.** Don't be surprised if the sub picker doesn't show it.
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
npm test            # 298 tests, ~3s
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
