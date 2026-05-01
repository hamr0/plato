<p align="center">
  <img src="src/web/static/favicon.svg" alt="" width="64" height="64">
</p>

<h1 align="center">plato</h1>

<p align="center"><em>"opinion is the medium between knowledge and ignorance."</em></p>

---

**plato is a forum.** One URL, one operator, one SQLite file. Reddit-shaped community discussion — subs, hierarchical comments, upvotes — without the parts of Reddit that broke discourse: no algorithm, no karma, no follower counts, no ads, no surveillance. The reader can leave at any time with a one-command export. The operator can be replaced at any time by anyone forking the archive.

This is what a community-owned forum looks like when you start over and refuse the patterns the last fifteen years taught everyone to copy.

---

## The headline features

### No email. No ads. No tracking.

You sign in with a magic link. The server takes your email, sends one message, and immediately discards the plaintext. What it stores is an HMAC — a one-way hash that's useless to anyone who steals the database, and that yields a *different* identity on every plato instance. There is no advertising, no third-party JavaScript, no tracking pixel, no analytics service, no telemetry of any kind. Server logs are the only record, and they live on the operator's machine.

### Checks and balances on moderation

Moderators have two tools, and one is reversible by the community.

- **Soft removal.** A mod can collapse a post or comment behind a `[+] [collapsed by mod]` chip. The body is still readable to anyone who clicks. Reason is optional. The action is logged. **If the soft-removed item accumulates enough net upvotes after the collapse — 50 for posts, 20 for comments by default — the system auto-lifts the collapse and writes "community overruled" to the public log.** No appeal queue, no mod confrontation, no email. The community simply outvotes the call. Soft moderation is the default tool, and capricious soft moderation gets reversed by readers.
- **Hard removal.** A mod can replace the body with a `[− removed by mod]` stub. Reason is *required*. Cannot be auto-reverted by votes — this is for content the mod has decided no one should see (harassment, doxxing, illegal). Reversible only by another mod, and the reversal is itself logged.

Every moderator action — soft, hard, ban, system override — appears in `/sub/<name>/modlog`, public to anyone visiting the URL. There is no private mod chat that determines what stays up. The audit trail is the social pressure that keeps mods honest.

### Comments only. Text only.

Markdown for post bodies. Hyperlinks render as links. That's the whole content model. plato hosts no images, no videos, no files, no embeds, no preview cards, no auto-played anything. Markdown image syntax is rewritten as a plain link to whatever host you picked. The site never holds a single byte of media; you can read it on a 1995 modem.

### Lightweight

One Node process. One SQLite file. One HTTP port. No frontend framework, no template engine, no build step, no client-side JavaScript in the v1 path. The whole forum runs on a $5 VPS and serves tens of thousands of daily-active users without breaking a sweat. Backups are `cp forum.db forum.db.bak` and `rsync` of the `posts/` folder.

### Retro

Terminal-honest aesthetic — monospace font, dark by default, three-blue-dot logo doubling as the loading animation, clean lines, no skeumorphism, no glassmorphism, no rounded-corner-app-store-icon energy. The look says: this is a piece of infrastructure, not a product extracting your time.

### Interoperable from day one

- **RSS per sub.** Drop the URL into any feed reader.
- **Markdown source on disk.** Posts live as `posts/<date>-<id>.md` files with frontmatter. The database is an index regenerable from the file tree. Lose the DB, regenerate. Lose the disk, restore from backup. The source-of-truth is plain files.
- **One-command export.** A user can take their full history. A community can take its archive. Apache 2.0 license — fork without asking.
- **Magic-link via standard SMTP.** Operate it on whatever mail infrastructure you already trust. No vendor.

The "interoperable" word, on most modern platforms, is marketing. On plato it's the literal architecture: every artifact is a plain file, every protocol is one a 25-year-old MTA understands.

---

## What it deliberately does not do

These aren't on the roadmap. They're decisions.

- **No algorithmic feed.** Hot, new, top, old. Same shape for every visitor. No personalization, no engagement optimization, no "you might also like." You see what's recent and what's voted up, and that's the entire ranking surface.
- **No karma, no follower counts, no post counts, no "online now" badges, no leaderboards.** Nothing to grind. Pseudonyms come from a deterministic two-word generator; identicons are auto-rendered. There's no profile to fill, no badge to chase, no number that goes up next to your name.
- **No DMs.** The forum is the venue. Private channels happen elsewhere.
- **No ask for your real name, phone, photo, location, or anything identifying.** None of it. Ever.
- **No image or video uploads.** Markdown image syntax becomes a plain link. plato hosts text.
- **No tags or hashtags.** Per-sub flairs (closed list, owner-curated) ship in M5 — no taxonomy chaos, no hashtag-spam vector.
- **No private subs.** Different product, different security model. Not on the roadmap.
- **No password auth, no OAuth, no SSO.** Magic link is the only path. The auth surface is one form field.
- **No NSFW age verification.** That's an operator-layer concern. M5 adds a per-sub NSFW banner; that's the extent of plato's involvement.
- **No federation.** Forking is the answer to "what if the operator goes bad." Not ActivityPub.

Each item on the list is a place where a current platform sells you the *illusion* — interoperability you can't actually use, privacy that's a settings page hiding a tracker, control that ends at the suspension button, ownership of content the platform can revoke. plato refuses each illusion by giving you the structural property instead: actual files, actual export, actual fork rights, actual no-tracking, actual public moderation log.

---

## The shape of plato vs Reddit

| | Reddit | plato |
|---|---|---|
| Owner | Public company | One operator (you can fork) |
| Sign-up | Email + password | Magic link, plaintext email forgotten |
| Identity | Real name optional, persistent username | Pseudonym derived from email HMAC |
| Karma | Yes, central status game | None |
| Follower / friend graph | Yes | None |
| Algorithmic feed | Yes (default) | None |
| Image/video hosting | Yes | None — link out |
| Mod actions | Mostly invisible | Public log per sub |
| Soft-removal community override | None | Yes — auto at per-sub threshold |
| Ads | Yes | None |
| Tracking | Yes (extensive) | None |
| Export | Limited, slow | One command, full archive |
| Where data lives | Their servers | Your SQLite + markdown files |
| What happens if the operator goes bad | You leave the platform | You fork the archive |

The bet: a forum that gets these defaults right outlasts any forum that doesn't, because defaults are what determine whether discourse decays.

---

## Status

In active development. **M1–M4 shipped.** Magic-link auth works end-to-end. Subs, posts, hierarchical comments, vote-weighted by account age, hot/new/top/old sort. Two-tier moderation with a public log per sub. Community auto-uncollapse on cumulative votes. 245 tests, all green on every commit.

**M5 next:** spam defenses (per-sub rate limits, link cap with URLhaus, regex patterns), per-sub flairs (closed-list, owner-curated), per-sub NSFW banner, "my mod decisions" mod-self-review panel.

See the [build plan](docs/01-product/build-plan.md) and the [Open-web revival PRD](docs/01-product/prd-open-web-revival.md) for the full roadmap and the rationale behind every locked-in decision.

---

## Try it locally

```bash
git clone https://github.com/hamr0/plato
cd plato
npm install
cp .env.example .env

# generate a knowless secret (zsh-safe)
SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") \
  && sed -i '/^KNOWLESS_SECRET=$/d' .env \
  && echo "KNOWLESS_SECRET=$SECRET" >> .env

npm run migrate
npm start
```

Then open http://localhost:8080.

Magic-link emails go through your local SMTP. For development, the easiest setup is [Mailpit](https://github.com/axllent/mailpit) on port 1025 — captures all outgoing mail in a web UI at http://localhost:8025. For production, use Postfix per the [knowless OPS guide](https://github.com/hamr0/knowless/blob/main/OPS.md).

---

## Documentation

- [Operator Guide](docs/02-features/operator-guide.md) — for humans running, customizing, or forking a plato instance. Forkable vs tunable vs locked, day-to-day ops, moderation philosophy, FAQ.
- [Integration Guide](docs/02-features/plato.context.md) — for AI assistants and developers wiring plato. Routes, settings, recipes, forking checklist.
- [Forum PRD](docs/01-product/prd-forum.md) — the spec.
- [Open-web revival PRD](docs/01-product/prd-open-web-revival.md) — design decisions and rationale for every locked-in choice.
- [Build plan](docs/01-product/build-plan.md) — milestone roadmap.
- [Visual reference](docs/design/) — aesthetic samples explored before locking the terminal style.
- [Changelog](CHANGELOG.md) — what has been built.

## Built on

- [knowless](https://github.com/hamr0/knowless) — passwordless email auth
- [marked](https://marked.js.org), [unique-names-generator](https://github.com/andreasonny83/unique-names-generator), [dicebear](https://www.dicebear.com)
- Node.js stdlib: `node:http`, `node:sqlite`, `node:test`

No frontend framework. No template engine. No client-side JavaScript in the v1 path.

## License

Apache 2.0. Fork without asking.
