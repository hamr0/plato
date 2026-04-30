# plato-forum

Phase 2 of the plato forum. Built per `docs/01-product/build-plan.md` (in the `plato/` repo, sibling).

This is the M1 skeleton: boots, serves a stylesheet, has the `html\`\`` templating helper with passing tests. Nothing else works yet — features land per the milestone plan.

## Run

```bash
cp .env.example .env
# generate KNOWLESS_SECRET (zsh-safe)
SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") \
  && sed -i '/^KNOWLESS_SECRET=$/d' .env \
  && echo "KNOWLESS_SECRET=$SECRET" >> .env

npm run migrate    # idempotent, safe to re-run
npm start          # http://localhost:8080
```

## Test

```bash
npm test
```

Runs `node --test test/`. Should be green out of the box.

## Layout

```
plato-forum/
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
        style.css     # terminal aesthetic — see plato/forum-poc-archived/samples/1-terminal.html
    db/
      migrations/
        001_initial.sql   # placeholder; M1 fills in
  test/
    unit/             # pure-function tests (templates, schema, parsers)
    integration/      # end-to-end against in-memory sqlite + real knowless
```

## What's locked

See `docs/01-product/build-plan.md` §Locked Decisions in the `plato/` repo. Short version:

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
