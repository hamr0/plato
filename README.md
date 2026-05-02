<p align="center">
  <img src="src/web/static/favicon.svg" alt="" width="64" height="64">
</p>

<h1 align="center">plato</h1>

<p align="center"><em>"opinion is the medium between knowledge and ignorance."</em></p>

---

**plato is a forum.** A community-owned discussion site, shaped like the best parts of Reddit — sub-communities, threaded conversations, upvotes — without the parts that broke discourse.

No ads. No algorithm. No tracking. No karma. No follower count. No real-name pressure. No image-and-video arms race. No company that owns your conversations and changes the rules every quarter.

A forum that loads in a heartbeat, looks like a tool not a product, lets you walk away with everything you wrote, and can be replaced by the next operator the day yours stops listening.

---

## Why this exists

The internet had forums that lasted decades. Mailing lists, phpBB boards, Usenet, early Reddit. Then everything moved to platforms that needed your attention to stay alive, and slowly the conversations got worse. Recommendation feeds replaced friends. Karma replaced thinking. Followers replaced trust. Real names replaced honesty.

plato is the bet that the structural defaults were what mattered all along.

---

## What you get

### Sign in without giving your email

You enter your email, plato sends you a one-time link. The moment that link goes out, plato forgets your address. What's stored is a one-way hash that yields a *different* identity on every plato site — useless to anyone who steals the database, useless for cross-site tracking, useless to a government request.

This works because of [**knowless**](https://github.com/hamr0/knowless), an open-source library built specifically to do passwordless email auth without storing email. It's the same primitive any other plato-shaped project can drop in.

No password, no account recovery flow, no profile to fill, no second factor, no captcha. One field, one click, you're in.

### A moderation system that watches the moderators

Two tools, one is reversible by the community:

- **Soft removal** — folds the post behind a clickable chip; body still readable on click; reason optional; auto-lifts if the community upvotes it back.
- **Hard removal** — replaces the body with a stub; reason required; reversible only by another mod.

Every action lands in a public log per sub. No private mod chat decides what stays up — the audit trail is the social pressure.

Mods of multiple subs work from one unified inbox at `/modlog` with three modes: **open** (pending flags awaiting decision, expand any row to see the body, flag breakdown, and rule inline), **inbox** (deduped current state with a per-target event count), and **audit** (every event flat). Click any mod or user in any column to filter by them. The same audit table — minus pending data — is what `/sub/<name>/modlog` shows the public.

### Spam defenses that don't require an arms-race team

A small, transparent layer that stops the obvious bots without invasive surveillance:

- **Magic-link auth** raises the floor: every account costs a working inbox.
- **Account-age tiered rate limits**: new accounts post sparingly; established accounts post freely.
- **Per-post link cap**: 1 link for new accounts, 5 for trusted — keeps comment sections from becoming link farms.
- **Spam pattern file** (`spam-patterns.txt`): version-controlled regex set, operator appends per spam wave. Matching content auto-collapses pending mod review.
- **URLhaus integration**: hourly cron pulls the community-maintained malicious-URL list. Posts linking to known-bad hosts auto-flag.

Each knob has a PRD-locked floor. Operators can tighten via `config.json`, never loosen — the codebase is the safety net.

### Text only — and that's the whole point

Markdown for post bodies. Hyperlinks for everything else. plato does not host images, videos, files, embeds, or auto-played anything. Markdown image syntax becomes a plain link to wherever you parked the picture.

The result is a forum that loads instantly on any device, on any connection, in any decade, without depending on twelve content-delivery networks staying in business.

### You own what you write

- **Markdown source on disk.** Every post is a real file on real disk. The database is an index. Lose either, regenerate from the other.
- **One-command export.** Take your full history. Take a sub's archive. The format is plain markdown plus a JSON manifest — readable in any text editor.
- **Apache 2.0 license.** Fork the code, fork the archive, run your own. You don't need permission.

The word "interoperable" gets misused on most platforms. On plato it's the architecture: every artifact is a plain file, every protocol is one a 25-year-old mail server understands.

### Stay current with RSS, the way the web was meant to

Every sub publishes a feed at `/sub/<name>/feed.xml`. **If you want to stay up to date with a sub, point any RSS reader at it** — [NetNewsWire](https://netnewswire.com), [Miniflux](https://miniflux.app), [FreshRSS](https://freshrss.org), [Reeder](https://reederapp.com), or whatever you already use — and posts arrive in your reader alongside blogs, newsletters, and other feeds. No notification system to fight with. No app to install. No account. RSS is the open-web pattern for staying current; plato wires into it by default rather than building yet another in-app feed.

### Lightweight, on purpose

One process, one database file, one HTTP port. Runs on a $5 VPS. Backups are two `cp` commands. No frontend framework, no build step, no client-side JavaScript in the basic path. The whole thing fits on a thumb drive.

### Retro, on purpose

Monospace font. Dark by default. Terminal-honest. Three-blue-dot logo that doubles as the loading animation. The visual language says: this is infrastructure, not a product designed to extract your time.

---

## What plato will never do

These are decisions, not roadmap items.

- Show ads. Run analytics. Drop tracking pixels. Embed third-party JavaScript.
- Personalize your feed by what an algorithm thinks you want.
- Show karma scores, follower counts, post counts, "online now" badges, leaderboards, or any other status game.
- Ask for your real name, phone number, photo, location, or anything identifying.
- Host images, videos, or files you upload.
- Add tags, hashtags, or anything that grows into spam-bait.
- Allow private subs, DMs, or hidden side-channels that bypass the public mod log.
- Add password auth, OAuth, SSO, or anything other than the magic link.

Each refusal maps to an illusion modern platforms sell — interoperability you can't actually use, privacy that's a settings toggle hiding a tracker, control that ends at the suspension button, ownership of content the platform can revoke. plato gives you the structural property instead.

---

## Where plato sits

plato is a Reddit-shaped forum built like a phpBB-era forum should have been: one binary, one SQLite file, plain markdown on disk, fork without asking. **The interaction model of Reddit's small-subs era** — subs, threaded comments, upvotes, mods answerable to a public log — **assembled with the operational discipline of the self-host PHP forum era** — one process, plain files, no plugin marketplace — **minus the bloat both eras accumulated**: Reddit's algorithmic-feed/karma/ads layer, and the PHP era's bbcode-and-avatar-upload-and-monetization-plugin sprawl.

### Closest neighbour: Lemmy

[Lemmy](https://join-lemmy.org) is the FOSS Reddit clone most open-web folks reach for. plato is in that conversation but a different bet:

| | Lemmy | plato |
|---|---|---|
| Stack | Rust + Postgres + Pictrs image server | Node 22 + SQLite, one process |
| Install | Docker compose, ~5 services | `git clone && npm start` on a $5 VPS |
| Federation | ActivityPub across instances | None — one site, one operator |
| Image / video | Hosted via Pictrs | Link out, never hosted |
| Identity | Username + password | Pseudonym from a one-time email link; email forgotten |
| Mod transparency | Visible to instance admins | Public log per sub, for everyone, with community auto-override on votes |
| Backup | `pg_dump` + Pictrs volume | `cp` two paths |
| When the operator goes dark | Migrate to another instance via federation | `git clone`, fork the archive, keep your markdown |

Lemmy is the right pick if you want a federated alternative to Reddit at the network level. plato is the right pick if you want one small forum that runs forever, on one box, with every mod action visible to every user, and an operator nobody can capture.

### In the broader self-hostable forum landscape

| Tool | Shape | Stack | What plato kept | What plato refused |
|---|---|---|---|---|
| Reddit (closed) | subs + votes + threaded + mods | private | interaction model | algorithm, karma, ads, follower graph |
| [Lemmy](https://join-lemmy.org) | Reddit, federated | Rust + PG + Pictrs | the FOSS shape | federation overhead, image hosting |
| [NodeBB](https://nodebb.org) | bbforum (categories / topics) | Node + Mongo/PG + Redis | none — bbforum shape isn't ours | plugin marketplace, theme system, multi-DB |
| [Discourse](https://www.discourse.org) | opinionated discussion | Ruby + PG + Redis + Sidekiq | public-modlog instinct | heavy stack, server requirements |
| [phpBB](https://www.phpbb.com) / Discuz! / vBulletin | bbforum, classic PHP era | PHP + MySQL | self-host ethos, plain-files philosophy | bbcode, avatar uploads, plugin sprawl, monetization plugins |

The lineage plato claims: **the structural defaults of Reddit's small-subs era, the self-host ethics of phpBB's golden era, none of the bloat either accumulated.**

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

Open http://localhost:8080 and post.

For magic-link emails in development, [Mailpit](https://github.com/axllent/mailpit) on port 1025 is the easiest setup — it catches every outgoing mail and shows it in a browser. For production, follow the [knowless OPS guide](https://github.com/hamr0/knowless/blob/main/OPS.md).

---

## Documentation

- [Operator Guide](docs/02-features/operator-guide.md) — running and customizing your instance.
- [Integration Guide](docs/02-features/plato.context.md) — for developers and AI assistants wiring plato into a project.
- [Open-web revival PRD](docs/01-product/prd-open-web-revival.md) — the spec, design decisions, and rationale for every locked-in choice.
- [Build plan](docs/01-product/build-plan.md) — milestone roadmap.
- [Changelog](CHANGELOG.md) — what has shipped.

## License

Apache 2.0. Fork without asking.
