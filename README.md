<p align="center">
  <img src="src/web/static/favicon.svg" alt="" width="64" height="64">
</p>

<h1 align="center">plato</h1>

<p align="center"><em>"opinion is the medium between knowledge and ignorance."</em></p>

---

**plato is a forum.** Reddit-shaped (subs, threads, votes, mods). Every sub is its own universe — the mod is its owner, the operator is a facilitator who runs the lights, not a referee for sub-level disputes. Every mod action lands in a public log; the community can reverse soft removals via votes; if a mod goes rogue, you fork the sub. People leave the mod, not the platform.

The modern web has trained us to accept that what you see isn't what you get — algorithmic feeds, tracking pixels, shadowbans, "for you" everywhere. plato runs upstream: **what you see is what you get.** Chronological feed, public modlog, posts as plain markdown on disk. The visible truth is the only truth.

---

## What plato gives you

- **Plain text.** Markdown for posts, hyperlinks for everything else. No image / video / file hosting. The forum loads on any device, on any connection, in any decade.
- **Magic-link sign-in, no identity lock.** Click an emailed link → you're in. No password, no profile, no captcha, no second factor. The moment the link is sent, the email is forgotten — only a one-way fingerprint, scoped to this site, remains. Same email on two plato sites = two different pseudonyms.
- **Mods own their sub, members hold them accountable.** Every action — soft removal (fold-behind-a-chip, body still readable), hard removal (stub, reason required), ban, transfer — lands in a public log per sub. The audit trail is the social pressure. Members have symmetric levers: flag a target → 3 distinct flaggers auto-collapse it for review; upvote a soft-removed target → community auto-lifts it once the threshold is met. The mod doesn't have to be convinced; the community overrules.
- **Subs that go quiet go read-only, not zombie.** If a mod steps down with no co-mods, or if no mod has been active in a sub for 30 days (with a 28-day warning banner before that), the sub becomes read-only — content stays viewable, no new posts. Any current mod can flip it back. The operator does NOT assign new mods or override sub state; communities reactivate themselves or members migrate by creating a successor sub. This is plato's load-bearing defense against authority-coercion: a "lawful order to install a chosen mod" has no admin path in plato to attach to.
- **One dashboard for mods, one public log for everyone.** `/modlog` with three modes — open (pending flags, expand any row to decide inline), inbox (deduped current state), audit (every event flat). The audit mode is **public** — instance-wide, no login required, linked from the footer of every page. open / inbox stay mod-only. Per-sub `/sub/<name>/modlog` is also public.
- **RSSvp.** Three pull-only feed tiers, no email digests, no push, no app: every sub publishes `/sub/<name>/rss` (public Atom); each logged-in user gets two token-gated personal feeds at `/u/<token>/subs.rss` (everything across the subs they follow) and `/u/<token>/rss` (the above plus replies + mod actions on their own content) — token shown on `/memlog` with a regenerate button. Drop the URLs into [NetNewsWire](https://netnewswire.com), [Miniflux](https://miniflux.app), [FreshRSS](https://freshrss.org), or any reader. No notification system to fight, no app to install, no algorithm. **Plato will never email you about activity** — magic-link login is the only outbound mail, deliberately.
- **Interoperable from day one.** Posts are plain markdown files on disk; the database is an index, regenerable. **Personal archive** — request your own contribution as a signed `.tar.gz` from `/memlog`; no tenure gate, your data is yours from day one. **Sub archive** — mods (or any 60-day continuous subscriber) can request a sub's full history from `/sub/<name>/manage`; downloadable as a signed `.tar.gz`, importable into any other plato instance via URL paste. Both archive kinds bundle a self-contained no-JS `index.html` static reader — openable from disk in any browser; above 100 items the reader auto-paginates with kind + per-year chips. Plain markdown bodies, JSON metadata, Ed25519 signature, optional OpenTimestamps proof — readable with `cat`, verifiable with `ots`, no plato install required.
- **You pick the feed.** Home page top-nav: Posts / Comments tabs, sort by new / old / top / hot, filter by 24h / week / all. `/subs` lists every sub at a glance. Each sub keeps its own color in the feed so you can scan-and-skim. No algorithm decides what you see.
- **Runs on a $5 VPS.** One process, one SQLite file, one HTTP port. Backups = two `cp` commands. No build step, no frontend framework. Apache 2.0, fork without asking.

---

## What plato will never do

Decisions, not roadmap items:

- Ads, analytics, tracking pixels, third-party JavaScript.
- Algorithmic feeds.
- Karma, follower counts, post counts, leaderboards, "online now" badges.
- Real names, phone numbers, photos, locations.
- Image / video / file uploads.
- Tags, hashtags.
- Private subs, DMs, hidden side-channels.
- Password auth, OAuth, SSO, federation.

---

## Closest cousin: Lemmy

[Lemmy](https://join-lemmy.org) is the open-source Reddit clone most often suggested. Same shape, different bet:

| | Lemmy | plato |
|---|---|---|
| To run it | 5 services + database server, container setup | One program, one file, two commands on a cheap VPS |
| Sign in | Username + password (recovery, 2FA, CAPTCHA) | Click an emailed link, address forgotten |
| Privacy of your email | Kept on file, same identity across sites | One-way fingerprint, different pseudonym per site |
| Federation + image hosting | Yes (cross-server protocol, server caches strangers' images) | No — one site, links only |
| If the operator goes bad | Move to another federated instance | Fork the code + your archive, run your own |

Other forum software ([NodeBB](https://nodebb.org), [Discourse](https://www.discourse.org), [phpBB](https://www.phpbb.com), Discuz!, vBulletin) is bbforum-shaped (categories and topics), runs heavier stacks, and inherits a 25-year-old auth pattern (account row + password + email-on-record). plato keeps the self-host ethics of that era and the interaction model of Reddit's small-subs era. None of the bloat either accumulated.

---

## For operators

- **Stack**: Node.js ≥ 22.5, SQLite (single file), no build step, ~5 runtime deps.
- **Install**: `git clone && npm install && npm run migrate && npm start` — one HTTP port, default 8080.
- **Backup**: `cp` the SQLite file + the `posts/` directory.
- **Mail**: dev → [Mailpit](https://github.com/axllent/mailpit) on port 1025; prod → see the [knowless OPS guide](https://github.com/hamr0/knowless/blob/main/OPS.md).
- **Spam knobs**: tighten via `config.json` (rate limits, link cap, regex patterns, URLhaus). Floors are PRD-locked — operators tighten, never loosen.
- **Per-sub settings**: owner sets auto-uncollapse thresholds at `/sub/create`. Spam knobs are forum-wide on purpose.
- **Cron jobs**: hourly URLhaus refresh, daily full-state backup (7-day retention), daily stats snapshot, weekly stats digest by email, quarterly disposable-domains refresh — all autoconfig from `config.json` `operator.{email,service}`. See [cron-jobs.md](docs/02-features/cron-jobs.md).
- **Privacy-led discoverability**: declarative head tags (description, canonical, OpenGraph, Twitter card), `/robots.txt`, `/sitemap.xml`. No analytics, no tracking pixels, no third-party JS, no cookie banner. The audit checklist for keeping it that way is in [privacy-seo.md](docs/04-process/privacy-seo.md).

---

## Try it

**Fastest path — Docker eval image (one command):**

```bash
docker run --rm -p 8080:8080 ghcr.io/hamr0/plato:latest
```

Open `http://localhost:8080`. Click **log in**, enter any email, then watch `docker logs` for the magic-link URL — paste it into your browser. The yellow strip at the top of every page reminds you this is an evaluation image, not a production deploy. Pass `-v plato-data:/app/data` if you want forum data to survive container restarts.

**Production-shape path** (recommended for any real deployment — see [operator-guide §Why no docker for production](docs/02-features/operator-guide.md#why-no-docker-for-production)):

```bash
git clone https://github.com/hamr0/plato
cd plato
npm install
cp .env.example .env

# generate a one-time secret for this instance
SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") \
  && sed -i '/^KNOWLESS_SECRET=$/d' .env \
  && echo "KNOWLESS_SECRET=$SECRET" >> .env

npm run migrate
npm start
```

Open `http://localhost:8080` and post.

---

## Documentation

- [Operator Guide](docs/02-features/operator-guide.md) — running and customizing your instance.
- [Cron jobs](docs/02-features/cron-jobs.md) — URLhaus + disposable-domains refresh, autoconfig from `config.json`.
- [Integration Guide](docs/02-features/plato.context.md) — wiring plato into a project.
- [PRD](docs/01-product/prd-open-web-revival.md) — spec + rationale for every locked-in choice.
- [Build plan](docs/01-product/build-plan.md) — milestone roadmap.
- [Changelog](CHANGELOG.md) — what has shipped.

## License

Apache 2.0. Fork without asking.
