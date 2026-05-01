<p align="center">
  <img src="src/web/static/favicon.svg" alt="" width="64" height="64">
</p>

<h1 align="center">plato</h1>

<p align="center"><em>"opinion is the medium between knowledge and ignorance."</em></p>

---

**A forum that lives at one URL.** Reddit-shaped community platform, owned by its members. Magic-link to post, no passwords, no email collected. Pseudonymous by default. If a moderator goes bad, fork the archive and run it elsewhere.

phpBB-era discourse with 2026 expectations: passwordless auth, deterministic pseudonyms, text-first content, no algorithmic feed, exit-via-fork as the real check on power.

## Why

Social media corrupted attention, manufactured followers, and turned discourse into surveillance. The protocols that ran the open web still work. What died was the on-ramp and the defaults. plato rebuilds the on-ramp.

## What it does

- Sub-communities (subs), posts, hierarchical comments, upvote and downvote.
- Magic-link login. No password. No personally identifiable information stored — only an HMAC of your email, which the server forgets the moment the link is sent.
- Auto-generated two-word pseudonyms and small identicon avatars, deterministic from your handle. No uploads, no profile photos.
- Moderator tools per sub: collapse, remove, ban. Every moderator action is recorded in a public mod log.
- Per-sub RSS feeds.
- Opt-in email digests or [ntfy](https://ntfy.sh) push notifications per sub. Off by default.
- One-command export of any sub or any user's history. Fork and run elsewhere whenever you want.

## What it deliberately does not do

- Host media. Images, videos, files — link to them on the host of your choice. plato never holds a single byte.
- Render preview cards, embeds, or auto-played video.
- Algorithmic feed. Chronological, reverse-chronological, or user-defined sorts only.
- Show karma, follower counts, post counts, "online now" badges, leaderboards, or any other status game.
- Direct messages.
- Ask for your real name, phone number, photo, or anything else identifying.

## Status

In active development. M1 (foundation, identity, post lifecycle), M2 (multi-tenant subs), M3 (hierarchical comments, upvote/downvote, hot/new/top/old sort) and **M4 (two-tier moderation, flag system, public mod log, community auto-uncollapse with per-sub thresholds)** have shipped. Magic-link works end-to-end, posts and comments render with deterministic pseudonyms and identicons, and all writes go through `npm test` (245 tests). See the [build plan](docs/01-product/build-plan.md) for what's queued next (M5 spam defenses + per-sub flairs).

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

## Documentation

- [Forum PRD](docs/01-product/prd-forum.md) — the spec
- [Build plan](docs/01-product/build-plan.md) — milestone roadmap and locked decisions
- [Visual reference](docs/design/) — three aesthetic samples explored before locking the terminal style
- [Changelog](CHANGELOG.md) — what has been built

## Built on

- [knowless](https://github.com/hamr0/knowless) — passwordless email auth
- [marked](https://marked.js.org), [unique-names-generator](https://github.com/andreasonny83/unique-names-generator), [dicebear](https://www.dicebear.com)
- Node.js stdlib: `node:http`, `node:sqlite`, `node:test`

No frontend framework. No template engine. No client-side JavaScript in the v1 path.
