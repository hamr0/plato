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

### Text only — and that's the whole point

Markdown for post bodies. Hyperlinks for everything else. plato does not host images, videos, files, embeds, or auto-played anything. Markdown image syntax becomes a plain link to wherever you parked the picture.

The result is a forum that loads instantly on any device, on any connection, in any decade, without depending on twelve content-delivery networks staying in business.

### You own what you write

- **Markdown source on disk.** Every post is a real file on real disk. The database is an index. Lose either, regenerate from the other.
- **One-command export.** Take your full history. Take a sub's archive. The format is plain markdown plus a JSON manifest — readable in any text editor.
- **Per-sub RSS feeds.** Drop the URL into any reader. Subscribe without an account.
- **Apache 2.0 license.** Fork the code, fork the archive, run your own. You don't need permission.

The word "interoperable" gets misused on most platforms. On plato it's the architecture: every artifact is a plain file, every protocol is one a 25-year-old mail server understands.

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

## The shape of plato vs Reddit

| | Reddit | plato |
|---|---|---|
| Owner | Public company | One operator (forkable) |
| Sign-up | Email + password | One-time link, email forgotten |
| Identity | Persistent username | Pseudonym derived from your email |
| Karma | Yes | None |
| Follower graph | Yes | None |
| Algorithmic feed | Yes (default) | None |
| Image / video hosting | Yes | None — link out |
| Mod actions | Mostly invisible | Public log per sub |
| Community override of mod | None | Yes — auto, on cumulative votes |
| Ads | Yes | None |
| Tracking | Yes | None |
| Export | Limited | One command, full archive |
| Where data lives | Their servers | Plain files, your machine |
| When the operator goes bad | You leave the platform | You fork the archive |

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
