<p align="center">
  <img src="src/web/static/favicon.svg" alt="" width="64" height="64">
</p>

<h1 align="center">plato</h1>

<p align="center"><em>"opinion is the medium between knowledge and ignorance."</em></p>

---

**plato is a forum.** Reddit-shaped (subs, threads, votes, mods), built like forums used to be: a single program on a cheap server, plain files on disk, fork it the day the operator stops listening.

---

## What plato gives you

- **Plain text.** Markdown for posts, hyperlinks for everything else. No image / video / file hosting. The forum loads on any device, on any connection, in any decade.
- **Magic-link sign-in, no identity lock.** Click an emailed link → you're in. No password, no profile, no captcha, no second factor. The moment the link is sent, the email is forgotten — only a one-way fingerprint, scoped to this site, remains. Same email on two plato sites = two different pseudonyms.
- **Public moderation log per sub.** Every soft removal (fold-behind-a-chip, body still readable, community can lift it via upvotes) and every hard removal (stub, reason required, mod-only reverse) is visible to everyone. The audit trail is the social pressure.
- **One dashboard for mods.** `/modlog` with three modes — open (pending flags, expand any row to decide inline), inbox (deduped current state), audit (every event flat). Click any mod or user to filter. Same audit shape is what the public sees at `/sub/<name>/modlog`.
- **Checks and balances on mods.** Soft removals auto-revert when the community accumulates enough net upvotes since the collapse. Mods can soft-remove anything; the community has a recourse that doesn't require confrontation.
- **RSS as it was meant to be.** Every sub publishes `/sub/<name>/feed.xml`. You pick what you follow with [NetNewsWire](https://netnewswire.com), [Miniflux](https://miniflux.app), [FreshRSS](https://freshrss.org), or whatever you use. No notification system to fight, no app to install, no algorithm.
- **Interoperable from day one.** Posts are plain markdown files on disk. The database is an index, regenerable. One-command export = full history or a sub's archive, readable in any text editor.
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

---

## Try it

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
- [Integration Guide](docs/02-features/plato.context.md) — wiring plato into a project.
- [PRD](docs/01-product/prd-open-web-revival.md) — spec + rationale for every locked-in choice.
- [Build plan](docs/01-product/build-plan.md) — milestone roadmap.
- [Changelog](CHANGELOG.md) — what has shipped.

## License

Apache 2.0. Fork without asking.
