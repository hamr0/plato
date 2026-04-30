# plato

A forum that lives at one URL. Magic-link to post (no password, no PII). Pseudonyms and identicons by default. Search and read on the web. Owner moderates; mod actions are public; if it goes bad, fork the archive.

phpBB-era discourse, 2026 substrate. Implementation of the [plato forum PRD](docs/01-product/prd-forum.md).

This is the M1 foundation: boots, serves a stylesheet, has the `html\`\`` templating helper, schema migrations, knowless library wiring, identity layer (pseudonym + identicon). Content + integration land in subsequent commits per the [build plan](docs/01-product/build-plan.md).

## Run

```bash
cp .env.example .env
# generate KNOWLESS_SECRET (zsh-safe)
SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") \
  && sed -i '/^KNOWLESS_SECRET=$/d' .env \
  && echo "KNOWLESS_SECRET=$SECRET" >> .env

npm install
npm run migrate    # idempotent, safe to re-run
npm start          # http://localhost:8080
```

## Test

```bash
npm test
```

Runs `node --test 'test/**/*.test.js'`. 44/44 green at M1 foundation + auth + identity.

## Layout

```
plato/
  bin/
    server.js         # http entry point
    migrate.js        # apply src/db/migrations/*.sql idempotently
  src/
    auth/             # knowless wiring (M1)
    content/          # post + draft + markdown storage (M1)
    identity/         # pseudonym + identicon (M1)
    web/
      templates.js    # html`` + escapeHTML + raw — server-side rendering primitive
      static.js       # /static/* handler
      static/
        style.css     # terminal aesthetic — see docs/design/1-terminal.html
    db/
      migrations/
        001_initial.sql   # M1 schema (handles, posts, drafts)
  test/
    unit/             # pure-function tests (templates, avatars, parsers)
    integration/      # end-to-end against in-memory sqlite + real knowless
  docs/
    01-product/       # PRDs, build plan
    design/           # visual reference samples
```

## What's locked

See [docs/01-product/build-plan.md §Locked Decisions](docs/01-product/build-plan.md). Short version:

- Visual: terminal aesthetic, 720px column, JetBrains Mono, charcoal background
- Rendering: `html\`\`` tagged template + `raw()` opt-out, server-side only, no client JS in v1
- Tests: `node:test` stdlib, no Vitest
- Auth: knowless library mode (single Node process; PRD's standalone+Caddy is a Phase 8 production option)
- Media: plain markdown body + 16×16 favicon hints on outbound links. No previews, no embeds, ever.

## Milestone plan (high level)

- **M1** Foundation — clean repo, schema, knowless, one user posts to one hardcoded sub
- **M2** Multi-tenant content — sub creation, front page, sub pages
- **M3** Discussion — comments, voting, sorting
- **M4** Moderation — collapse/remove, flag system, public mod log
- **M5** Spam defenses — rules 7-16, favicon cache, URLhaus integration
- **M6** Subscriptions + notifications — sub subscribe, my-subs, email digest, ntfy, RSS
- **M7** Identity + export/import — per-sub + per-user export, archive signing, fork flow
- **M8** Production polish — docker-compose, search, dark mode, mobile, deploy guide

Each milestone ~2 weeks. ~3-4 months total to v1.
