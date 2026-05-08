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

- **Plain text, loads anywhere.** Markdown for posts, hyperlinks for everything else.
  No image / video hosting; image markdown becomes a clickable link. Renders on any device, any connection, any decade.

- **Magic-link sign-in, no identity lock.** Click an emailed link, you're in — no password, no profile, no captcha.
  Email is hashed on receipt and never stored; only a one-way fingerprint scoped to this site remains.
  Same email on two plato instances = two unrelated pseudonyms.

- **Public modlog, symmetric community recourse.** Every mod action — soft removal, hard removal, ban, transfer — lands in `/sub/<name>/modlog` for everyone to see.
  Members aren't passive: 3 distinct flags auto-collapse a target for review; enough upvotes after a soft removal auto-lifts it. The mod doesn't have to be convinced — the community can overrule.

- **Subs that go quiet go read-only, not zombie.** No mod activity for 30 days (with a 28-day warning banner) → sub becomes read-only. Any current mod flips it back.
  The operator never assigns mods or unfreezes a sub. Communities reactivate themselves or fork a successor.
  Net effect: a "lawful order to install a chosen mod" has no admin path to attach to.

- **One mod dashboard, one public audit.** `/modlog` has three modes: *open* (pending flags, decide inline), *inbox* (current state), *audit* (every event flat, instance-wide, public, no login).
  Per-sub `/sub/<name>/modlog` is public too. Audit by default beats trust by default.

- **RSSvp — feeds, not notifications.** Every sub publishes `/sub/<name>/rss`; each logged-in user gets two token-gated personal feeds (`/u/<token>/subs.rss` for subs they follow; `/u/<token>/rss` adds replies + mod actions on their content).
  Drop the URLs into [NetNewsWire](https://netnewswire.com) / [Miniflux](https://miniflux.app) / [FreshRSS](https://freshrss.org). No app, no push, no algorithm.
  **Plato will never email you about activity** — magic-link login is the only outbound mail, deliberately.

- **Your data is yours from day one.** Posts are plain `.md` files on disk; the database is an index, regenerable.
  Request a personal archive from `/memlog` (no tenure gate) or a full sub archive from `/sub/<name>/manage` (mod or 60-day subscriber). Both are signed `.tar.gz` with markdown + JSON + an Ed25519 sig + optional OpenTimestamps proof — readable with `cat`, verifiable with `ots`, no plato install required.
  Sub archives import into any other plato instance via URL paste.

- **You pick the feed.** Home: Posts / Comments tabs, sort by new / old / top / hot, filter by 24h / week / all.
  Each sub keeps its own color so feeds are scannable.
  No algorithm decides what you see — there isn't one to game.

- **Runs on a $20/year VPS.** One Node process, one SQLite file, one HTTP port. No build step, no frontend framework, no clustering.
  Tested on RackNerd (~$20/year KVM, port 25 + PTR via support ticket); Hetzner / OVH / Linode / Vultr also work. Backup = `sqlite3 .backup` + `tar`; healthcheck = `curl /healthz`. Apache 2.0, fork without asking.

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

For deploying to a real VPS (AlmaLinux + nginx + Let's Encrypt + postfix + opendkim + systemd + cron, end-to-end with SPF/DKIM/DMARC walkthrough and troubleshooting), follow the **[Deploy Guide](docs/02-features/deploy-guide.md)** — single opinionated path, every choice made.

---

## Documentation

- [Deploy Guide](docs/02-features/deploy-guide.md) — fresh VPS to running plato, one path, all choices made.
- [Operator Guide](docs/02-features/operator-guide.md) — running and customizing your instance.
- [Cron jobs](docs/02-features/cron-jobs.md) — URLhaus + disposable-domains refresh, autoconfig from `config.json`.
- [Integration Guide](docs/02-features/plato.context.md) — wiring plato into a project.
- [PRD](docs/01-product/prd-open-web-revival.md) — spec + rationale for every locked-in choice.
- [Build plan](docs/01-product/build-plan.md) — milestone roadmap.
- [Changelog](CHANGELOG.md) — what has shipped.

## License

Apache 2.0. Fork without asking.
