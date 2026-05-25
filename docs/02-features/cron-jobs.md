# Cron jobs

Plato itself is a single Node process. A handful of operator-facing maintenance tasks run outside the process via system cron — backups, blocklist refresh, malicious-URL feed pull, and a weekly stats digest. They're optional in the sense that plato boots and serves traffic without them, but skipping them means stale defenses and lost data on a drive failure.

All cron jobs **autoconfig** from `config.json` and the script's own location. There are no operator edits inside any of the scripts; everything operator-specific reads from the `operator` block:

```jsonc
{
  "operator": {
    "email": "you@example.com",
    "service": "plato"
  }
}
```

- `email` — where success/failure / digest reports are sent. If unset, scripts print to stderr (cron's default mailer or `journalctl` surfaces it).
- `service` — the systemd unit name to `systemctl restart` when a snapshot changes. Defaults to `plato`.

Mail uses `/usr/sbin/sendmail -t` — same binary that magic-link mail flows through (postfix, on a postfix box). One MTA, one DKIM signing path, one queue. Cron alerts inherit the same SPF/DKIM/DMARC posture as user-facing mail. See [`deploy-guide.md`](deploy-guide.md) §5 for postfix + opendkim + DNS setup.

## The jobs

| Cadence | Script | What it does |
|---|---|---|
| Hourly @ :00 | `bin/refresh-urlhaus.js` | Pulls the [URLhaus](https://urlhaus.abuse.ch/) malicious-URL feed → `data/urlhaus.txt`. Posts/comments linking to a blocked host auto-collapse + flag with `blocked-url: <host>`. |
| Daily @ 04:30 UTC | `bin/backup.sh` | Tar-snapshots `forum.db` + `knowless.db` + `posts/` + `config.json` + `spam-patterns.txt` to `$BACKUP_DIR/plato-backup-<timestamp>.tar.gz`. Snapshots both databases with plato's bundled `node:sqlite` (`VACUUM INTO`, WAL-safe) — no system `sqlite3` CLI needed, so it works on any distro. Keeps the newest `BACKUP_KEEP` archives (default 7; drop to 4 if disk-tight). Exits non-zero on failure; the cron `MAILTO` surfaces it. |
| Daily @ 04:35 UTC | `bin/stats.js` | Appends one JSON line to `data/stats.log` with `{snapshot_at, users, subs, posts, comments}`. Append-only — never rewrites. `--dry-run` prints to stdout. |
| Weekly Mon @ 06:00 UTC | `bin/stats-weekly.js` | Reads `data/stats.log`, groups by ISO week, keeps the latest snapshot per week, takes the most recent 4 weeks, renders a fixed-width table with WoW deltas, mails to `operator.email`. `--dry-run` prints to stdout. |
| Quarterly, Jan/Apr/Jul/Oct 1st @ 06:00 UTC | `scripts/cron-refresh-disposable.sh` | Refreshes `disposable-domains.txt` from upstream (~5400 domains, MIT), restarts the service if the snapshot changed, mails the operator. |
| Daily @ 05:15 UTC | `bin/check-sub-inactivity.js` | Two daily housekeeping passes. (1) Walks every active sub; auto-disables any whose mods (owner + co-mods) have been silent for >30 days. Synthesizes a public modlog row (`action=auto_disable_inactivity`, `mod_handle=SYSTEM_HANDLE`). Subs with zero mods are skipped. (2) Prunes drafts older than 24h (`pruneOldDrafts`) — drafts only carry a post across the 15-min magic-link round-trip, so older rows (orphaned or finalized) are dead weight; the published posts they became are untouched. `--dry-run` lists what would be disabled / pruned without writing. |

### Counter definitions

- **users** — `knowless.db.handles` row count. Anyone who has ever requested a magic link, including never-posted lurkers. This is the largest definition of "users on this instance"; if you want "users who have actually posted," query `forum.db.handles` instead.
- **subs** — `forum.db.subs` row count.
- **posts**, **comments** — `forum.db` row counts excluding `removed_at IS NOT NULL`. Soft-removed and hard-removed rows both drop from the count.

### Sample weekly digest

```
plato weekly stats — 2026-W16 → 2026-W19
host: forum.example.com
snapshots in log: 28

week     |  users     Δ |  subs     Δ |  posts     Δ |  cmnts     Δ
-------------------------------------------------------------------
2026-W19 |     35    +2 |    12       |     57    +2 |     77    +5
2026-W18 |     33    +2 |    12    +1 |     55    +7 |     72   +12
2026-W17 |     31    +3 |    11    +1 |     48    +6 |     60    +9
2026-W16 |     28       |    10       |     42       |     51
```

Δ blank when zero or no prior week in the window.

## Deployment

This is the install you do **once per instance**, after `npm install` + `npm run migrate` + first `npm start`. Replace `/opt/plato` with your install path.

### 1. Set the operator block

```jsonc
// config.json
{
  "operator": {
    "email":   "you@example.com",
    "service": "plato"
  }
}
```

The forum process ignores this block — only cron tooling reads it. The forum will not restart itself; you can edit `operator.email` and the next cron run picks it up without touching plato.

### 2. Install the crontab fragment

Add to **root crontab** (`sudo crontab -e`). All five lines, exactly as shown:

```
# plato — see docs/02-features/cron-jobs.md

# Hourly: URLhaus malicious-URL feed
0 * * * *           cd /opt/plato && node bin/refresh-urlhaus.js >> /var/log/plato-urlhaus.log 2>&1

# Daily 04:30 UTC: full-state backup (forum.db + knowless.db + posts/), 7 newest kept
30 4 * * *          cd /opt/plato && bin/backup.sh >> /var/log/plato-backup.log 2>&1

# Daily 04:35 UTC: counter snapshot to data/stats.log
35 4 * * *          cd /opt/plato && node bin/stats.js >> /var/log/plato-stats.log 2>&1

# Weekly Mon 06:00 UTC: stats digest email to operator
0 6 * * 1           cd /opt/plato && node bin/stats-weekly.js >> /var/log/plato-stats.log 2>&1

# Quarterly Jan/Apr/Jul/Oct 1st 06:00 UTC: disposable-domains refresh
0 6 1 1,4,7,10 *    /opt/plato/scripts/cron-refresh-disposable.sh

# Daily 05:15 UTC: sub inactivity sweep — auto-disables subs whose mods
# have been silent for 30+ days (see plato.context.md §Sub state model).
15 5 * * *          cd /opt/plato && node bin/check-sub-inactivity.js >> /var/log/plato-inactivity.log 2>&1
```

### 3. Verify each job manually

You don't have to wait a quarter to know it works. From the install dir:

```bash
# URLhaus feed (writes data/urlhaus.txt)
node bin/refresh-urlhaus.js

# Backup (writes backups/plato-backup-<timestamp>.tar.gz)
bin/backup.sh
ls -lh backups/

# Stats snapshot (appends to data/stats.log)
node bin/stats.js
tail -1 data/stats.log

# Stats weekly digest (prints to stdout, no mail)
node bin/stats-weekly.js --dry-run

# Disposable-domains (rewrites disposable-domains.txt)
./scripts/refresh-disposable-domains.sh

# Sub inactivity sweep (writes auto_disable_inactivity modlog rows + disabled_at)
node bin/check-sub-inactivity.js --dry-run    # preview what would be disabled
node bin/check-sub-inactivity.js               # actually run
```

If any of these fails on a fresh install, the cron version will fail too — fix it now while you're watching, not at 04:30 next Monday.

### 4. Confirm mail delivery

The first cron-driven failure or weekly digest is when you discover whether `/usr/sbin/sendmail` is configured. To preflight:

```bash
echo 'plato cron preflight' | /usr/sbin/sendmail -t <<EOF
To: you@example.com
Subject: plato preflight
plato preflight from $(hostname)
EOF
```

If you don't get the email, fix `/usr/sbin/sendmail` before relying on cron alarms. On a postfix box (the recommended setup for plato), `/usr/sbin/sendmail` is provided by postfix itself, and the message inherits the same opendkim signing path as user-facing mail. Full walkthrough in [`deploy-guide.md`](deploy-guide.md) §5.

## Why these aren't in-process

Plato's design rule is "one process, one DB, one port." Pulling external feeds inside the request loop would turn an outage at the upstream (URLhaus, GitHub) into latency or 5xxs in the forum itself. Cron isolates that surface: if a feed is unreachable, the existing snapshot keeps working until the next successful pull, and the operator gets a failure email rather than user-facing errors.

It also keeps the security posture auditable. The disposable-domains snapshot lives in your git checkout. A remote list change can't silently expand the block surface — it only takes effect after a quarterly cron run + service restart, which the operator sees in their inbox.

## Why these cadences

- **Hourly** for URLhaus matches what the upstream feed publishes; faster wastes their bandwidth, slower means a malicious URL stays linkable longer than necessary.
- **Daily** for backups + stats snapshots is the lowest cadence that survives a same-day drive loss. Per-snapshot work is tiny (~hundreds of KB at 100 active users).
- **Weekly** for the stats digest is the fastest cadence at which week-over-week deltas mean anything. Daily digests would have noisy noise and train operators to ignore the email.
- **Quarterly** for disposable-domains because the upstream churns slowly — most domains stay on the list for years. 4 emails/year is the right operator-cognitive-load budget.

## What "restart on change" means

Only `cron-refresh-disposable.sh` issues a `systemctl restart`, and only when the snapshot's sha256 changed. Most quarterly runs are no-ops at the snapshot level (upstream may have updated nothing meaningful since last time) and skip the restart. URLhaus, backups, and stats never restart anything — URLhaus is re-read on each post submission, backups are read-only, stats only write to a separate log file.

## Mirroring snapshots back to git

When the disposable cron rewrites `disposable-domains.txt` on the VPS, the working copy diverges from `origin/main`. Drift is harmless (snapshot is append-mostly data), but if you want to keep `origin` honest, the operator email includes the exact `scp` + `git commit` recipe to mirror the change back from your laptop.

## Failure mode

The shell refresh script (`cron-refresh-disposable.sh`) `exit 0`s even on failure and mails the operator itself — the email *is* the signal. `bin/backup.sh` and the node jobs instead exit non-zero on failure, so the cron `MAILTO` (or `journalctl`) surfaces it. Either way a failed backup reaches you the same day, and a missing weekly digest is itself an alarm.

## Disk pressure

Backups are the only job with disk-growth risk. At ~700KB/archive for a small instance, 7 archives = ~5MB; at 50MB/archive for a busy one, 7 archives = ~350MB. If you're running tight on disk:

```bash
BACKUP_KEEP=4 /opt/plato/bin/backup.sh
```

…or set the env var in the crontab line itself:

```
30 4 * * * cd /opt/plato && BACKUP_KEEP=4 bin/backup.sh >> /var/log/plato-backup.log 2>&1
```

The stats log grows ~120 bytes/day forever; at 10 years it's still under 500KB. Not worth pruning.

## Rotating the operator-redirected cron logs

Each cron line in this guide redirects stdout/stderr to a file under `/var/log/plato-*.log`. Those grow over time. plato doesn't rotate them — that's `logrotate`'s job, and it's already on every VPS. Drop the following at `/etc/logrotate.d/plato`:

```
/var/log/plato*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

Daily rotation, 14-day retention, gzip-compressed. `copytruncate` means cron jobs don't have to be told to reopen their logs — the truncate happens in place.

`$BACKUP_DIR/health.log` (M8/B4) and `data/stats.log` (M8/B5) are written by plato itself, not by cron-shell-redirect, and stay small by design (one line per failure event / one line per day). No rotation needed.
