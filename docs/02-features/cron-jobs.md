# Cron jobs

Plato itself is a single Node process. A handful of maintenance tasks run outside the process via system cron. Two kinds:

1. **plato's own scripts** — URLhaus blocklist refresh, disposable-domains refresh, the daily sub-inactivity/draft-prune sweep. These are plato-specific and ship in `bin/` / `scripts/`.
2. **[pulselog](https://github.com/hamr0/pulselog)** — the external watcher (the outside sibling to flightlog, which records errors from *inside* the app). One dependency, three modes: **health** (is it up), **digest** (how's it trending), **backup** (is it safe). It replaces the old bespoke `health-watch.sh` / `stats.js` daily + `stats-weekly.js` / `backup.sh`. **On by default** with safe defaults; one config field turns it off.

They're optional in the sense that plato boots and serves traffic without any of them, but skipping them means stale defenses, no alerting, and lost data on a drive failure.

## Operator config — one block, both kinds read it

Everything operator-specific lives in `config.json`'s `operator` block; the forum process never reads it.

```jsonc
{
  "operator": {
    "email": "you@example.com",   // alerts + digest go here; unset → pulselog logs only, no mail
    "service": "plato",            // systemd unit name (health `service` check; restart-on-change)
    "monitoring": true,            // OFF SWITCH: false → no pulselog config generated, skip its timers
    "backupKeepLast": 7,           // backup archives to retain (default 7; 1–365). Small disk → lower
    "diskMaxPercent": 90           // disk-usage % that trips the health alert (default 90; 50–99)
  }
}
```

pulselog reads its **own** `pulselog.config.json`, which plato **generates from the block above** so the email / base URL / service name live in one place:

```bash
npm run gen-pulselog        # node --env-file=.env bin/gen-pulselog-config.js  →  writes pulselog.config.json
```

Re-run it whenever `config.json` changes. `pulselog.config.json` is gitignored (box-authored, like `config.json`). What flows in: `operator.email` → all three modes' mail (unset → log-only, no send); `operator.service` → the health `service`-unit check and the digest's app label; plato's DB / `posts/` / `config.json` / `spam-patterns.txt` paths → the backup sources. (TLS-cert expiry is **not** a pulselog check — renewal is `certbot.timer` and the daily `bin/check-cert.sh` is the alarm if it stalls; see the jobs table below.)

Mail uses the system `mail`/`sendmail` — the same binary magic-link mail flows through (postfix on a postfix box), so cron alerts inherit the same SPF/DKIM/DMARC posture. See [`deploy-guide.md`](deploy-guide.md) §5.

## The jobs

| Cadence | Command | What it does |
|---|---|---|
| Every 5 min | `pulselog --config pulselog.config.json` | **health** — probes localhost `/healthz`, disk, backup freshness, the `plato.service` unit. **Silent on green**; one summary email when something breaks (with the last 20 flightlog error lines pasted in). Exits 0 even on a health failure — the alert is the signal. (TLS-cert expiry is *not* here — it's slow-moving and a 5-min cadence would re-email for days; `bin/check-cert.sh` covers it daily.) |
| Weekly Mon @ 06:00 UTC | `pulselog --digest --config pulselog.config.json` | **digest** — runs `bin/stats.js --metrics-json` for `{users, subs, posts, comments, votes}`, appends one snapshot to its history (`data/logs/stats.jsonl`), and emails a week-over-week table plus a 7-day flightlog error rollup (grouped by `proc`). |
| Daily @ 04:30 UTC | `pulselog --backup --config pulselog.config.json` | **backup** — `VACUUM INTO` dumps of `forum.db` + `knowless.db` (WAL-safe, in-process `node:sqlite`), plus `posts/` + `config.json` + `spam-patterns.txt`, tarred to `data/backups/plato-backup-<stamp>.tar.gz` (`0600`). Keeps newest 7. **Exits 1 loud on failure** (a missing backup must not be silent). |
| Hourly @ :00 | `node bin/refresh-urlhaus.js` | Pulls the [URLhaus](https://urlhaus.abuse.ch/) malicious-URL feed → `data/urlhaus.txt`. Posts/comments linking to a blocked host auto-collapse + flag with `blocked-url: <host>`. |
| Daily @ 05:15 UTC | `node bin/check-sub-inactivity.js` | (1) Auto-disables active subs whose mods have been silent >30 days (public `auto_disable_inactivity` modlog row). (2) Prunes drafts older than 24h. `--dry-run` previews. |
| Quarterly, Jan/Apr/Jul/Oct 1st @ 06:00 UTC | `scripts/cron-refresh-disposable.sh` | Refreshes `disposable-domains.txt` from upstream, restarts the service if the snapshot changed, mails the operator. |

### Counter definitions (digest)

- **users** — `knowless.db.handles` row count: anyone who ever requested a magic link, lurkers included. The largest honest definition of the install base.
- **subs** — `forum.db.subs` row count.
- **posts**, **comments** — `forum.db` row counts excluding `removed_at IS NOT NULL`.
- **votes** — `forum.db.votes` row count (cast votes).

### Sample digest

```
your-forum weekly stats — 2026-W19 → 2026-W22
weeks in log: 4

week     |   users    Δ |    subs    Δ |   posts    Δ | comments    Δ |   votes    Δ
------------------------------------------------------------------------------------
2026-W22 |      35   +2 |      12      |      57   +2 |      77    +5 |     221  +18
2026-W21 |      33   +2 |      12   +1 |      55   +7 |      72   +12 |     203  +20
…
flightlog (last 7d): 31 errors. top: server×22, import-queue×7.   ≥flag: server
```

Δ is week-over-week; blank when zero or no prior week.

## Deployment

Once per instance, after `npm ci --omit=dev` + `npm run migrate` + first start. Replace `/opt/plato` with your install path.

### 1. Set the operator block (above) and generate the pulselog config

```bash
cd /opt/plato
sudo -u plato -H npm run gen-pulselog      # writes pulselog.config.json from config.json
```

To run **without** monitoring, set `"monitoring": false` and skip steps 1's generate + the three pulselog crontab lines below.

### 2. Install the crontab fragment

Add to **root crontab** (`sudo crontab -e`):

```
# plato — see docs/02-features/cron-jobs.md

# pulselog health: every 5 min, silent on green, emails on break
*/5 * * * *         cd /opt/plato && node_modules/.bin/pulselog --config pulselog.config.json >> /var/log/plato-health.log 2>&1

# pulselog backup: daily 04:30 UTC (forum.db + knowless.db + posts/), 7 newest kept
30 4 * * *          cd /opt/plato && node_modules/.bin/pulselog --backup --config pulselog.config.json >> /var/log/plato-backup.log 2>&1

# pulselog digest: weekly Mon 06:00 UTC, stats + flightlog rollup to operator.email
0 6 * * 1           cd /opt/plato && node_modules/.bin/pulselog --digest --config pulselog.config.json >> /var/log/plato-stats.log 2>&1

# Hourly: URLhaus malicious-URL feed
0 * * * *           cd /opt/plato && node bin/refresh-urlhaus.js >> /var/log/plato-urlhaus.log 2>&1

# Daily 05:15 UTC: sub inactivity sweep + draft prune
15 5 * * *          cd /opt/plato && node bin/check-sub-inactivity.js >> /var/log/plato-inactivity.log 2>&1

# Quarterly Jan/Apr/Jul/Oct 1st 06:00 UTC: disposable-domains refresh
0 6 1 1,4,7,10 *    /opt/plato/scripts/cron-refresh-disposable.sh
```

### 3. Verify each job manually

From the install dir — if it fails here, it'll fail under cron too:

```bash
node_modules/.bin/pulselog --backup --config pulselog.config.json   # writes data/backups/*.tar.gz
ls -lh data/backups/
node_modules/.bin/pulselog --digest --dry-run --config pulselog.config.json   # renders the email, no send/append
node_modules/.bin/pulselog --config pulselog.config.json            # health: silent if all green; logs data/logs/health.jsonl
node bin/refresh-urlhaus.js                                          # writes data/urlhaus.txt
node bin/check-sub-inactivity.js --dry-run                          # preview disables/prunes
```

### 4. Confirm mail delivery

The first health break or weekly digest is when you find out whether `mail`/`sendmail` works. Preflight:

```bash
echo 'plato cron preflight' | /usr/sbin/sendmail -t <<EOF
To: you@example.com
Subject: plato preflight
plato preflight from $(hostname)
EOF
```

No MTA on the box? Add a sendmail shim (e.g. `msmtp` + `msmtp-mta`) — see pulselog's `msmtp → Gmail` recipe in its `pulselog.context.md`. Until then, pulselog logs the JSONL line and sends nothing.

## Why these aren't in-process

Plato's design rule is "one process, one DB, one port." Pulling external feeds or running backups inside the request loop would turn an upstream outage into latency or 5xxs in the forum. Cron isolates that surface — and pulselog watching from *outside* the process is the whole point: a probe of `/healthz` catches a hung process that an in-process check never could.

## The shared JSONL dialect (flightlog + pulselog)

Both tools write one JSON line per event in the same core shape (`ts`, `kind`, …), each to its **own** file under `data/logs/`:

| File | Writer | `kind` |
|---|---|---|
| `errors.jsonl` | flightlog (in-process) | `uncaught` / `unhandledRejection` / `manual` |
| `health.jsonl` | pulselog health | `health` |
| `stats.jsonl` | pulselog digest | `stats` |
| `backup.jsonl` | pulselog backup | `backup` |

Compose them at read time:

```sh
jq -s 'sort_by(.ts)' data/logs/*.jsonl              # one timeline across all signals
jq 'select(.kind=="backup" and .status=="fail")' data/logs/backup.jsonl
```

All are created `0600` and self-bound (`maxBytes` rotation for health; append-only-but-tiny for stats/backup history). No rotation to configure.

## Rotating the operator-redirected cron logs

The crontab lines redirect stdout/stderr to `/var/log/plato-*.log`. plato doesn't rotate those — that's `logrotate`'s job. Drop this at `/etc/logrotate.d/plato`:

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

The pulselog/flightlog JSONLs under `data/logs/` are **not** these files — they self-manage; leave them out of logrotate.

## Disk pressure

Backups are the only disk-growth risk. ~200KB/archive for a small instance × 7 = ~1.4MB; ~50MB/archive busy × 7 = ~350MB. Tighten retention via **`operator.backupKeepLast`** in `config.json` (default 7, range 1–365), then re-run `npm run gen-pulselog`. Set it there rather than hand-editing the generated `pulselog.config.json` — the generated file is overwritten wholesale on the next `gen-pulselog`, so a direct edit silently reverts the next time `config.json` changes. The stats/backup history JSONLs grow ~one line/week — negligible.
