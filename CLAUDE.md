# Working on plato

Project instructions for Claude Code sessions. Start here.

## What plato is

A Reddit-shaped, single-binary, single-database forum. One Node process, one SQLite file, one HTTP port. Magic-link auth (no passwords, plaintext email never stored). Markdown posts on disk; the DB is an index. Apache 2.0; designed to be forked.

Read [`README.md`](README.md) for the user-facing pitch and [`docs/02-features/plato.context.md`](docs/02-features/plato.context.md) for the developer integration guide. The full spec lives in [`docs/01-product/prd-open-web-revival.md`](docs/01-product/prd-open-web-revival.md). Milestones in [`docs/01-product/build-plan.md`](docs/01-product/build-plan.md).

## How to do work here

- **Tests pass before saying done.** `npm test` runs the full suite (~298 tests, ~3s). Don't claim a feature is shipped without a green run.
- **`npm run dev` for local testing, `npm start` for prod-shape.** Dev script stacks `.env` + `.env.dev` so dev-only knobs (magic-link stderr fallback, raised per-IP caps) override base config. `.env.dev` is committed; `.env` is gitignored. New dev tunables go in `.env.dev`, never in `.env`. See PRD §Authentication Flow → Dev/prod env split.
- **No new emojis.** The visual language is terminal-honest. Emojis don't belong in code, comments, file names, or UI strings unless the user explicitly asks.
- **No new markdown docs unless asked.** Update existing docs (CHANGELOG, PRD, operator-guide, plato.context) when shipping; don't spawn new ones.
- **Read the PRD before changing locked behavior.** Items in the operator-guide's "Locked" section and PRD's "Permanently out" section are load-bearing. Changing one of those is a fork, not a feature.
- **Edit existing files; don't fragment the codebase.** Single `src/web/app.js` is the route handler by design. Don't split it into a router framework.
- **Work in user-named milestones.** M1–M4 shipped; M5 mod surface + defenses shipped. Future tasks live in `build-plan.md`. Match the milestone naming the user uses (e.g. "M5/B1" for the first item in the M5 defenses arc).

## Architectural rules

These are decisions, not preferences. Each one has been re-litigated; please don't suggest reverting them mid-task.

- **One process, one SQLite file, no clustering.** Hobby-scale by design.
- **No build step.** Vanilla JS, vanilla CSS, hand-written HTML via the `html\`\`` tagged template. No bundler, no transpiler.
- **Every form works without JS.** JS-layered enhancements are fine (in-place comment insertion, loading-dots wave) but the no-JS path must function.
- **Every color is a `--*` CSS variable on `:root`.** Forks need to rebrand without grepping. New CSS adds variables, not hex literals.
- **HMAC-derived handles.** Identity is per-forum; same email yields different pseudonym IDs across instances. Don't store the email plaintext anywhere.
- **Markdown only, raw HTML escaped, image markdown rewritten as a link.** XSS surface is small and tested; don't enlarge it.
- **Two-tier mod (soft / hard) + public modlog.** The combo is the trust model. Removing any of the three legs breaks the design.
- **No DMs, no private subs, no uploads, no tags, no algorithmic feed, no NSFW age verification.** Each is a deliberate refusal — see operator-guide for the reasoning.

## Spam-defense floor model (M5)

All forum-wide spam knobs (rate limits, link cap, regex patterns, URLhaus) live in `config.json` at the project root. Every value has a PRD-locked floor — operators can tighten via override but the resolver throws at boot if a value exceeds the floor. **Per-sub overrides for spam are intentionally not supported.** Sub owners only control auto-uncollapse thresholds via `/sub/create`.

When adding a new spam knob:
1. Define a frozen `*_FLOOR` constant in the relevant content module.
2. Add a `resolve*Config(overrides)` validator that mirrors `resolveRateLimitConfig`.
3. Thread the resolved config through `createApp`'s closure into the handlers that need it.
4. Add operator config wiring in `bin/server.js`.
5. Tests for: floor preserved when no override, tightening allowed, loosening throws, bad type throws.

## Scope discipline

- **Don't add features beyond what the task requires.** A bug fix doesn't need surrounding cleanup; a one-shot operation doesn't need a helper. No half-finished implementations.
- **Don't add error handling for impossible scenarios.** Trust internal code and framework guarantees. Validate at system boundaries (HTTP input, external feeds), not internal calls.
- **Don't add backwards-compat shims for code that isn't shipped yet.** Plato is pre-v1; rename freely.
- **Default to no comments.** Add one only when the *why* is non-obvious (a hidden constraint, a workaround, behavior that would surprise a reader). Don't explain *what* well-named identifiers already say.

## When in doubt

- Check the PRD section relevant to the change.
- Run `npm test` and read failures, don't suppress them.
- If a task touches the unified `/modlog` surface, re-read `docs/01-product/m5-mod-surface-spec.md` first.
- If you're about to add a new column or table, run by the user — schema changes are sticky.
