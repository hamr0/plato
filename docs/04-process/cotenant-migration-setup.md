# Migrating a live plato instance onto a co-tenant box

A runbook, drawn from consolidating the reference instance (terribic.com) off
its own VPS onto a box that was **already serving another site** — to cut
hosting cost without losing anything (inactive users, modlog history, drafts,
posts) and without disrupting the neighbour. It generalises to any "move plato
next to an existing app on one cheap box" migration.

> The mechanical co-tenant install (flags, nginx, additive DKIM) lives in the
> deploy guide: [Appendix: Co-tenant deploy](../02-features/deploy-guide.md#appendix-co-tenant-deploy-sharing-a-box-with-another-app).
> This doc is the **end-to-end migration arc** (prep → cutover → verify) plus
> the gotchas that actually bit us.

## The one rule: additive only

The target box already runs another app's nginx and inbound postfix. Two
main-guide steps are destructive if run verbatim:

- **Deploy-guide §5 (postfix `main.cf`)** sets `inet_interfaces=loopback-only`
  and rewrites `mydestination` / `virtual_transport` — that **severs the
  neighbour's inbound mail**.
- **`bootstrap.sh`** (default mode) writes its own nginx vhost — which
  collides with a hand-rolled one (duplicate `server_name`).

So run `bootstrap.sh --co-tenant` (skips the nginx vhost and the mail probe),
and do mail **additively**: append a DKIM `SigningTable`/`KeyTable` line for
your domain and never touch `main.cf` or `opendkim.conf`. Everything else —
the `plato` user, `/opt/plato`, systemd unit, cron, logrotate — is identical
to a fresh deploy.

## Phase 1 — stand plato up on the target (nothing public yet)

No downtime: the live instance keeps serving from the old box throughout.

1. **Co-tenant install:** `sudo … bootstrap.sh --co-tenant`, then the additive
   nginx + opendkim steps from the deploy-guide appendix.
2. **`.env`:** standard production shape, but `KNOWLESS_FROM` **must be the
   bare address** (`auth@your-domain`) — knowless ≥ 1.1.9 refuses a
   display-format sender at boot. The friendly display name comes from
   `branding.forumName` in `config.json`. (See Gotchas.)
3. **Reuse the same `KNOWLESS_SECRET`** from the old box — it HMAC-derives
   every user's pseudonymous handle. A new secret silently breaks every
   identity. Carry it across out-of-band (your password manager), never in git.
4. **Stage TLS:** copy the current cert from the old box for a zero-gap
   cutover, or plan to issue a fresh one at cutover.
5. **Smoke-test** against the target via a host override (`curl --resolve
   your-domain:443:127.0.0.1 …`) before any DNS change: `/healthz`, home, a
   post, the modlog — and confirm the neighbour's `/health` still answers.

## Phase 2 — cutover (the only downtime is DNS propagation)

Order matters; it avoids split-brain writes:

1. **Stop plato on the old box** — freezes writes.
2. **Final DB copy, WAL-safe:** snapshot `forum.db` **and** `knowless.db` with
   plato's bundled `node:sqlite` (`VACUUM INTO`, via `bin/db-snapshot.mjs`) or
   `sqlite3 .backup` — never a raw `cp` (it races the WAL). rsync `posts/` and
   `data/`. Re-verify row counts and `PRAGMA integrity_check` on the target.
3. **Flip DNS** — the A record(s) for your domain → the shared box's IP.
4. **Issue the LE cert** on the target: `certbot --nginx -d your-domain`
   (additive — the neighbour's vhost and cert are untouched).
5. **Verify live:** `/healthz` over real DNS; browse; do a **real magic-link
   login** and confirm the mail passes SPF + DKIM + DMARC from the new IP;
   confirm the neighbour is still up.
6. Leave the old box **stopped-but-intact** as a rollback for a few days (flip
   DNS back if needed), then decommission.

Only the DNS A record changes. SPF (`v=spf1 … a …` follows the A record), DKIM
(reuse the key), and DMARC stay as they are.

## Gotchas (these bit us)

- **Bare `KNOWLESS_FROM`.** The old deploy recipe used a display-format sender
  (`Name <auth@domain>`). knowless < 1.1.9 accepted it by accident but emitted
  a malformed Message-ID (`<uuid@domain>>` — a doubled `>`, from deriving the
  domain by `split('@').pop()`); knowless ≥ 1.1.9 **rejects it at boot**. Keep
  `KNOWLESS_FROM` bare; the display name rides in `branding.forumName`. If you
  see a doubled `>` in your maillog, that's the symptom.
- **Verify DBs with `node:sqlite`, not the system `sqlite3` CLI.** RHEL-family
  distros ship a CLI older than 3.37, which **cannot open plato's `STRICT`
  schema**. plato runs on `node:sqlite`, so verify (and back up) the same way —
  the system CLI will either error or silently misbehave.
- **Per-tenant ops mail.** The weekly digest and health-watch alerts default to
  the system hostname — which on a shared box is the *box* name, not your
  forum. Set `branding.forumName` (digest) and pass `DOMAIN=your-domain` to the
  health-watch cron line, so each tenant's operational mail comes from, and
  identifies as, its own domain.
- **uid hygiene.** Run every `git` / `npm` / `migrate` as `sudo -u plato -H`.
  Mixing root- and plato-owned files in `/opt/plato` causes
  `insufficient permission for adding an object to repository database` later;
  the recovery is `chown -R plato:plato /opt/plato`.

## See also

- [`deploy-guide.md` → Appendix: Co-tenant deploy](../02-features/deploy-guide.md#appendix-co-tenant-deploy-sharing-a-box-with-another-app) — the mechanical install steps.
- [`operator-guide.md`](../02-features/operator-guide.md) — config knobs and locked decisions.
