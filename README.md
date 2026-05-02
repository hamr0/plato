<p align="center">
  <img src="src/web/static/favicon.svg" alt="" width="64" height="64">
</p>

<h1 align="center">plato</h1>

<p align="center"><em>"opinion is the medium between knowledge and ignorance."</em></p>

---

**plato is a forum.** Reddit-shaped (subs, threaded comments, upvotes, mods). Without ads, algorithm, tracking, karma, follower counts, real-name pressure, image hosting, or a company that changes the rules. Loads instantly. You can walk away with everything you wrote.

---

## Why this exists

Forums used to last decades — phpBB, Usenet, mailing lists, early Reddit. Then platforms started needing your attention to survive: recommendation feeds replaced friends, karma replaced thinking, followers replaced trust. plato is the bet that the structural defaults were what mattered.

---

## What you get

### Sign in without giving your email

- Enter email → click the link → you're in.
- The moment the link goes out, plato forgets your address. Only a one-way fingerprint stays.
- Same email on two plato sites = two different pseudonyms. Cross-site tracking is impossible by construction.
- No password, no recovery flow, no profile, no 2FA, no CAPTCHA.

Powered by [**knowless**](https://github.com/hamr0/knowless), an open-source library for passwordless auth without storing email.

### A moderation system that watches the moderators

- **Soft removal** — fold-behind-a-chip; body readable on click; reason optional; community can lift it via upvotes.
- **Hard removal** — body replaced with stub; reason required; only another mod can reverse.
- **Public log per sub.** Every mod action visible to everyone — the audit trail is the social pressure.
- **Unified `/modlog` for mods** — three modes (open / inbox / audit), click-to-filter on any mod or user, expand any row inline.

### Spam defenses without an arms-race team

- **Magic-link auth** — every account costs a working inbox.
- **Account-age tiered rate limits** — new accounts post sparingly, established accounts post freely.
- **Per-post link cap** — 1 link for new accounts, 5 for trusted.
- **Spam pattern file** (`spam-patterns.txt`) — operator appends regex per spam wave; matches auto-collapse for review.
- **URLhaus integration** — hourly cron pulls the malicious-URL list; matching posts auto-flag.

Each knob has a hardcoded floor. Operators tighten, never loosen.

### Text only

- Markdown post bodies. Hyperlinks for everything else.
- No image hosting, no video, no embeds, no auto-play.
- Markdown image syntax becomes a plain link.
- Loads instantly on any device, on any connection.

### You own what you write

- **Markdown on disk** — every post is a real file. The database is an index, regenerable.
- **One-command export** — full history or a sub's archive, plain markdown + JSON manifest.
- **Apache 2.0** — fork without asking.

### Stay current with RSS

Every sub publishes `/sub/<name>/feed.xml`. Point [NetNewsWire](https://netnewswire.com), [Miniflux](https://miniflux.app), [FreshRSS](https://freshrss.org), [Reeder](https://reederapp.com), or whatever you use. No notification system, no app, no account.

### Lightweight, on purpose

- One process, one database file, one HTTP port.
- Runs on a $5 VPS. Backups = two `cp` commands.
- No build step, no frontend framework, no client-side JS in the basic path.

### Retro, on purpose

Monospace font. Dark by default. Terminal-honest. Three-blue-dot logo doubles as the loading animation. Looks like a tool, not a product.

---

## What plato will never do

Decisions, not roadmap items:

- Ads, analytics, tracking pixels, third-party JavaScript.
- Algorithmic feeds.
- Karma, follower counts, post counts, "online now" badges, leaderboards.
- Real names, phone numbers, photos, locations.
- Image / video / file uploads.
- Tags, hashtags.
- Private subs, DMs, hidden side-channels.
- Password auth, OAuth, SSO.

---

## Where plato sits

Reddit-shaped (subs, threads, votes, public-modlog mods). Classic-forum-built (one program, one file, fork without asking). None of the bloat either accumulated.

### Closest cousin: Lemmy

| | Lemmy | plato |
|---|---|---|
| To run it | 5 services + database server, container setup | One program, one file, two commands on a cheap VPS |
| Sign in | Username + password (recovery, 2FA, CAPTCHA) | Click an emailed link, your address is forgotten |
| Privacy of your email | Kept on file, same identity across sites | One-way fingerprint, different pseudonym per site |
| Talks to other sites + hosts strangers' images | Yes (federation) | No — one site, links only |
| If the operator goes bad | Move to another federated instance | Fork the code + your archive, run your own |

**Federation** — many Lemmy sites talking to each other so users on one can read and comment on another. plato refuses it:

- Your server caches strangers' images and posts → you become legally responsible for them.
- Federation needs heavy backend plumbing → kills the "runs on a cheap VPS" promise.
- Plato's answer to "you can leave" is fork-the-archive, not cross-server protocol. Same exit, none of the weight.

### The broader landscape

| Tool | What it is | What plato kept | What plato refused |
|---|---|---|---|
| Reddit (closed) | The interaction model — subs, votes, threads, mods | The shape | Algorithm, karma, ads, follower count |
| [Lemmy](https://join-lemmy.org) | Open-source Reddit, federated | The open-source spirit | Federation overhead, image hosting |
| [NodeBB](https://nodebb.org) | Modern Node forum, old-style (categories + topics) | Nothing — different shape | Plugin marketplace, theme system |
| [Discourse](https://www.discourse.org) | Modern Ruby discussion forum | The public-modlog instinct | Heavy server requirements |
| [phpBB](https://www.phpbb.com) / Discuz! / vBulletin | Classic PHP forums | Self-host ethos, plain-files philosophy | BBCode, avatar uploads, plugin sprawl, paid extensions |

**Lineage**: Reddit's small-subs interaction model + phpBB's self-host ethics — bloat from both.

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

- **Dev mail**: [Mailpit](https://github.com/axllent/mailpit) on port 1025 catches every outgoing email.
- **Production mail**: see the [knowless OPS guide](https://github.com/hamr0/knowless/blob/main/OPS.md).

---

## Documentation

- [Operator Guide](docs/02-features/operator-guide.md) — running and customizing your instance.
- [Integration Guide](docs/02-features/plato.context.md) — for developers and AI assistants wiring plato into a project.
- [Open-web revival PRD](docs/01-product/prd-open-web-revival.md) — the spec, design decisions, and rationale for every locked-in choice.
- [Build plan](docs/01-product/build-plan.md) — milestone roadmap.
- [Changelog](CHANGELOG.md) — what has shipped.

## License

Apache 2.0. Fork without asking.
