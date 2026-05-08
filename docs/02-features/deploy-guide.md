# plato deploy guide

A single, opinionated path from a fresh AlmaLinux 9 VPS to a running plato instance with TLS, mail, monitoring, and backups. No "pick one of three" forks; every choice has been made for you.

If you want to know *why* a choice was made, see the cross-references; they all point at [`operator-guide.md`](operator-guide.md) or [`plato.context.md`](plato.context.md).

## Stack, in one breath

- **OS**: AlmaLinux 9 (RHEL-equivalent). Packages via `dnf`, services via `systemctl`, firewall via `firewalld`, SELinux enforcing.
- **Runtime**: Node ≥ 22.5 from NodeSource. SQLite 3 from the distro repo.
- **Reverse proxy + TLS**: nginx + certbot (`certbot.timer` auto-renews twice daily).
- **Outbound mail**: msmtp + msmtp-mta. plato pipes to `/usr/sbin/sendmail`; msmtp does the auth + TLS hop to your relay (an email account you already own).
- **Process supervision**: systemd, single unit file, `Restart=on-failure`.
- **Cron**: `/etc/cron.d/plato` (one file, root-owned, removable in one delete).
- **Log rotation**: `/etc/logrotate.d/plato`, daily, 14-day retention, gzip.
- **No Docker.** See [operator-guide §Why no docker for production](operator-guide.md#why-no-docker-for-production).

## What runs where

```
   internet ──→  nginx :443  (TLS terminates here; cert in /etc/letsencrypt/live/$DOMAIN/)
                   │
                   │  proxy_pass http://127.0.0.1:8080
                   ▼
                 plato  (node, systemd unit, runs as user `plato`)
                   │
                   ├──► forum.db, knowless.db, posts/, exports/   (in /opt/plato, owned by plato)
                   │
                   ├──► nodemailer sendmail transport
                   │       │  spawn /usr/sbin/sendmail (msmtp symlink)
                   │       ▼
                   │     msmtp ──TLS+auth──► relay (gmail/fastmail/proton)
                   │                              │
                   │                              ▼
                   │                          user inbox
                   │
                   └──► GET /healthz  (consumed by bin/health-watch.sh cron)

   /etc/cron.d/plato (root) ──► bin/{backup,health-watch,check-cert,refresh-urlhaus,stats,...}
                                        │  on alert
                                        └──► /usr/sbin/sendmail ──► relay ──► operator inbox
```

Two consequences worth internalizing:

1. **plato never holds SMTP relay credentials.** Magic-link mail and cron alerts both flow through `/usr/sbin/sendmail`; the relay password lives in `/etc/msmtprc` (mode 600, root only) and nowhere else. plato's `.env` has no SMTP password.
2. **One config = the entire mailer.** Whatever `/etc/msmtprc` points at delivers everything: magic links, /healthz alerts, cert-expiry warnings, weekly stats digests, backup failures.

## Prerequisites

Before you start:

- [ ] AlmaLinux 9 VPS with public IPv4. 1 GB RAM, 25 GB disk, 1 vCPU is plenty for a hobby forum. Hetzner CX11 / DigitalOcean basic / OVH VPS Starter — any will do.
- [ ] Domain you control with DNS access. **Point an `A` record at the VPS IP before step 11**; certbot needs to resolve `$DOMAIN` to the VPS to issue the cert.
- [ ] An email account you can use as a mail relay, with the SMTP creds for it. The cleanest options:
  - **Gmail (free)** — turn on 2FA, generate an [App Password](https://myaccount.google.com/apppasswords). Host: `smtp.gmail.com`, port 587, user: your full email, pass: 16-char App Password.
  - **Fastmail** — any plan, generate an [App Password](https://app.fastmail.com/settings/security/devicekeys). Host: `smtp.fastmail.com`, port 587.
  - **Proton Mail** — install Proton Bridge on a machine in your network (or a sidecar VM) and point msmtp at the bridge's SMTP listener.
- [ ] SSH access to the VPS as root or a sudoer.

Set these once in your shell so the rest of the guide is copy-paste:

```bash
export DOMAIN=forum.example.com
export ADMIN_EMAIL=you@example.com   # used by certbot + as cron alert recipient
```

## Step 1 — Base system + Node + nginx + msmtp

```bash
# As root on the VPS.
dnf -y update
dnf -y install epel-release
dnf -y install \
  nginx certbot python3-certbot-nginx \
  sqlite git jq tar firewalld policycoreutils-python-utils \
  msmtp msmtp-mta mailx \
  vim curl

# Node 22 from NodeSource
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf -y install nodejs

# Sanity
node --version       # v22.x
sqlite3 --version    # 3.x
which sendmail       # /usr/sbin/sendmail (provided by msmtp-mta)
```

## Step 2 — Firewall

```bash
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
firewall-cmd --list-services       # expect: ssh http https
```

## Step 3 — SELinux (the easy-to-miss step)

AlmaLinux runs SELinux in enforcing mode. nginx by default cannot proxy to backends on `localhost` — you'll get 502s and waste an hour.

```bash
setsebool -P httpd_can_network_connect 1
```

That's it. Verify:

```bash
getsebool httpd_can_network_connect    # → on
```

## Step 4 — Create the `plato` user and directory

plato runs as a non-root, non-login system user. systemd starts it; nothing logs in interactively.

```bash
useradd --system --create-home --home-dir /opt/plato --shell /sbin/nologin plato
ls -ld /opt/plato     # drwx------ plato plato
```

## Step 5 — Configure msmtp

This is the only place SMTP credentials live on the box.

`deploy/msmtprc.example` ships with three commented account blocks (Gmail App Password / Fastmail / Proton Bridge) plus a generic STARTTLS block. Pick one, fill in your relay creds, install:

```bash
cp /opt/plato/deploy/msmtprc.example /etc/msmtprc
$EDITOR /etc/msmtprc                 # uncomment + fill in your block
chown root:root /etc/msmtprc
chmod 600 /etc/msmtprc                # msmtp REFUSES non-600 creds

# Pre-create msmtp's log file with sane perms.
touch /var/log/msmtp.log
chown root:root /var/log/msmtp.log
chmod 640 /var/log/msmtp.log
```

(If you haven't cloned plato yet — see step 6 — you can pull `msmtprc.example` straight from `https://raw.githubusercontent.com/hamr0/plato/main/deploy/msmtprc.example` instead.)

**Smoke test now, before plato exists**:

```bash
echo -e "Subject: msmtp preflight from $(hostname)\n\nIf you see this, /etc/msmtprc works." \
  | sendmail $ADMIN_EMAIL
```

Check the inbox. If it doesn't arrive, fix this *before* moving on — every plato mail flows through here.

If `sendmail` exits non-zero, look at `/var/log/msmtp.log` for the SMTP-level reason (auth failure, DNS, certificate). Common fixes are in the [Troubleshooting](#troubleshooting) section.

## Step 6 — Clone plato

```bash
sudo -u plato -H bash <<'EOF'
cd /opt/plato
git clone https://github.com/hamr0/plato.git .
npm ci --omit=dev
EOF
```

`--omit=dev` skips test-only deps; the runtime tree stays small (knowless, marked, dicebear, unique-names-generator).

## Step 7 — Generate the secret + write `.env`

The `KNOWLESS_SECRET` is the **only** plato secret. Identity hashes derive from it; if it changes after launch, every user looks like a new account. **Generate it once. Back it up. Never rotate.**

```bash
sudo -u plato -H bash <<EOF
cd /opt/plato
SECRET=\$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")

cat > /opt/plato/.env <<ENV
KNOWLESS_SECRET=\$SECRET

KNOWLESS_BASE_URL=https://${DOMAIN}
KNOWLESS_FROM=auth@${DOMAIN}

# Magic-link mail and cron alerts both pipe through this binary.
# Relay creds live in /etc/msmtprc, never here.
PLATO_SENDMAIL_PATH=/usr/sbin/sendmail

PORT=8080
DB_PATH=/opt/plato/forum.db
ENV

chmod 600 /opt/plato/.env
EOF
```

## Step 8 — Write `config.json`

```bash
sudo -u plato -H tee /opt/plato/config.json > /dev/null <<EOF
{
  "branding": {
    "forumName": "your-forum-name",
    "tagline": "your tagline",
    "hostedBy": "@you",
    "feedbackEmail": "${ADMIN_EMAIL}",
    "baseUrl": "https://${DOMAIN}"
  },
  "operator": {
    "email": "${ADMIN_EMAIL}",
    "service": "plato"
  }
}
EOF
```

Edit `forumName` / `tagline` / `hostedBy` to taste. `baseUrl` is required for archive exports to embed working backlinks. `operator.email` is the recipient for every cron alert (failures, weekly stats digest, cert expiry).

## Step 9 — Run migrations + preflight

```bash
sudo -u plato -H bash -c "cd /opt/plato && node --env-file=.env bin/migrate.js"

# Sanity check: every prerequisite plato needs to start cleanly. Reports
# OK / WARN / FAIL per check; exits 1 on any FAIL. Runs in <1 second.
sudo -u plato -H bash -c "cd /opt/plato && bin/preflight.sh"
```

Both are idempotent. Re-run on every plato update.

## Step 10 — bootstrap.sh: install systemd + nginx + cron + logrotate

`deploy/bootstrap.sh` is the mechanical-only installer — it writes the system files that have only one right answer. It does **not** install packages, write secrets, or run certbot; you've already done those.

```bash
sudo DOMAIN=$DOMAIN ADMIN_EMAIL=$ADMIN_EMAIL /opt/plato/deploy/bootstrap.sh
```

Output (abridged):
```
[bootstrap] writing /etc/systemd/system/plato.service
[bootstrap] writing /etc/nginx/conf.d/plato.conf
[bootstrap] writing /etc/cron.d/plato
[bootstrap] writing /etc/logrotate.d/plato
[bootstrap] SELinux enforcing — setting httpd_can_network_connect
[bootstrap] done.
```

Re-runnable. If you edit a template under `deploy/` (e.g. add a custom systemd directive) and re-run bootstrap, the installed file is re-rendered. **It will not touch `/opt/plato`'s contents.**

If you want to do this by hand instead (or audit what bootstrap is about to do), each template renders standalone:

```bash
# systemd unit
INSTALL_DIR=/opt/plato PLATO_USER=plato \
  envsubst '${INSTALL_DIR} ${PLATO_USER}' \
  < /opt/plato/deploy/plato.service.template \
  | sudo tee /etc/systemd/system/plato.service > /dev/null

# nginx site (only ${DOMAIN} substitutes — nginx's own $host etc. preserved)
DOMAIN=$DOMAIN \
  envsubst '${DOMAIN}' \
  < /opt/plato/deploy/plato.nginx.template \
  | sudo tee /etc/nginx/conf.d/plato.conf > /dev/null

# cron block
INSTALL_DIR=/opt/plato ADMIN_EMAIL=$ADMIN_EMAIL DOMAIN=$DOMAIN BACKUP_DIR=/var/lib/plato-backups \
  envsubst '${INSTALL_DIR} ${ADMIN_EMAIL} ${DOMAIN} ${BACKUP_DIR}' \
  < /opt/plato/deploy/plato.cron \
  | sudo tee /etc/cron.d/plato > /dev/null

# logrotate (no substitution needed)
sudo cp /opt/plato/deploy/plato.logrotate /etc/logrotate.d/plato

sudo systemctl daemon-reload
```

After bootstrap (either path):

```bash
sudo systemctl enable --now plato
sudo systemctl status plato --no-pager
# Expect: Active: active (running)
```

If status is `failed`, `journalctl -u plato -n 50` shows why.

## Step 11 — DNS preflight, then nginx + certbot

`bootstrap.sh` already dropped `/etc/nginx/conf.d/plato.conf` for you in step 10. Before issuing a cert, **make sure `$DOMAIN` resolves to the VPS IP** — otherwise certbot's HTTP-01 challenge will fail:

```bash
dig +short $DOMAIN          # must return your VPS IP
```

Start nginx and smoke-test plain HTTP:

```bash
nginx -t                    # syntax check
systemctl enable --now nginx
curl -sS http://${DOMAIN}/healthz | jq .
# Expect: { "ok": true, "version": "...", ... }
```

Now issue the cert:

```bash
certbot --nginx -d $DOMAIN -m $ADMIN_EMAIL --agree-tos -n --redirect
```

Flags:
- `--nginx` — modifies `plato.conf` in place to add SSL + redirect 80→443.
- `-n` — non-interactive.
- `--redirect` — force HTTPS.
- `-m` — recipient for ACME expiry warnings (Let's Encrypt also emails this address, separately from our `bin/check-cert.sh`).

Verify TLS:

```bash
curl -sS https://${DOMAIN}/healthz | jq .
```

Renewal is auto: `systemctl status certbot.timer` runs twice daily, silent on success.

## Step 12 — Cron + logrotate

`bootstrap.sh` already installed both in step 10. Verify:

```bash
cat /etc/cron.d/plato | head -20         # MAILTO + first few jobs
ls -l /etc/logrotate.d/plato
logrotate -d /etc/logrotate.d/plato      # dry-run, no errors expected
```

The cron block runs ~9 jobs covering URLhaus refresh, daily backups (7-day retention), TLS cert-expiry check, daily counter snapshot, weekly stats digest, quarterly disposable-domains refresh, sub-inactivity sweep, archive export/import queues, and the every-5-min `/healthz` watcher. Per-job detail lives in [`cron-jobs.md`](cron-jobs.md). Tweak cadences by editing `deploy/plato.cron` and re-running bootstrap.

## Step 13 — Final smoke

```bash
# 1. plato is running and writable
curl -sS https://${DOMAIN}/healthz | jq '{ok, db_writable, exports_dir_writable, last_migration}'

# 2. Magic-link mail works end-to-end
curl -sS -X POST https://${DOMAIN}/login \
  -d "email=${ADMIN_EMAIL}" \
  -H "Content-Type: application/x-www-form-urlencoded" -i | head -5
# Check $ADMIN_EMAIL inbox; the magic link should arrive within seconds.

# 3. Cron is loaded
crontab -l 2>/dev/null    # nothing (we use /etc/cron.d/plato instead)
ls -l /etc/cron.d/plato   # should exist, mode 644
```

If all three pass, you're deployed. Visit `https://${DOMAIN}`, click the magic link from your inbox, create the first sub.

---

## Routine operations

| Task | Command |
|---|---|
| Restart plato | `systemctl restart plato` |
| Tail plato logs | `journalctl -u plato -f` or `tail -f /var/log/plato.log` |
| Tail mail logs | `tail -f /var/log/msmtp.log` |
| Check health | `curl -sS https://$DOMAIN/healthz \| jq .` |
| Pre-start sanity check | `sudo -u plato bash -c 'cd /opt/plato && bin/preflight.sh'` |
| Cert expiry probe | `cd /opt/plato && DOMAIN=$DOMAIN bin/check-cert.sh` |
| Run a backup now | `sudo -u plato BACKUP_DIR=/var/lib/plato-backups /opt/plato/bin/backup.sh` |
| Re-render system files | `sudo DOMAIN=$DOMAIN ADMIN_EMAIL=$ADMIN_EMAIL /opt/plato/deploy/bootstrap.sh` |
| Update plato | see [Updating plato](#updating-plato) |
| Read modlog | `https://$DOMAIN/modlog` (publicly visible) |

### Updating plato

```bash
sudo -u plato -H bash <<'EOF'
cd /opt/plato
git fetch origin
git checkout v0.X.Y           # pin to a tag, not main
npm ci --omit=dev
node --env-file=.env bin/migrate.js
EOF
systemctl restart plato
curl -sS https://${DOMAIN}/healthz | jq .ok    # expect: true
```

If you skipped a major version, read `CHANGELOG.md` between the two tags first — migrations are forward-compatible but config knobs may have moved.

### What's where on disk

| Path | Owner | What |
|---|---|---|
| `/opt/plato/` | plato | source, db, posts/, exports/ |
| `/opt/plato/.env` | plato (mode 600) | KNOWLESS_SECRET, paths |
| `/opt/plato/config.json` | plato | branding + operator block |
| `/etc/msmtprc` | root (mode 600) | mail relay creds |
| `/etc/systemd/system/plato.service` | root | systemd unit |
| `/etc/nginx/conf.d/plato.conf` | root | nginx site (certbot edits this in place) |
| `/etc/cron.d/plato` | root | cron block |
| `/etc/logrotate.d/plato` | root | log rotation |
| `/etc/letsencrypt/live/$DOMAIN/` | root | TLS cert + key |
| `/var/lib/plato-backups/` | plato | tarballs, 7-day retention |
| `/var/log/plato*.log` | mixed | redirected stdout/stderr from plato + crons |
| `/var/log/msmtp.log` | root | every outbound SMTP attempt |

### Backups, in plain English

`bin/backup.sh` writes one `plato-backup-<date>.tar.gz` per night to `/var/lib/plato-backups/`, keeping the newest 7 (default `BACKUP_KEEP=7`). It uses SQLite's online `.backup` API so you don't have to stop the server. Inside the tarball: `forum.db`, `knowless.db`, `posts/`, `exports/`, `config.json`, `spam-patterns.txt`, `data/urlhaus.txt`, `disposable-domains.txt`.

To rotate copies off the host, edit the commented `rsync` stanza at the bottom of `bin/backup.sh` to point at your laptop or an offsite machine. We don't bake key management into plato.

To restore: stop the server, untar, copy `forum.db` + `posts/` over the live ones, restart. **The `KNOWLESS_SECRET` in your restored `.env` must match the value at the time of backup** — otherwise every user's identity hash shifts and they look like new accounts.

---

## Troubleshooting

### Magic link doesn't arrive

```bash
# 1. Did plato try to send it?
journalctl -u plato -n 50 | grep -iE "mail|knowless"
# Look for [knowless] mail submit failed: ... — that's the SMTP-level reason.

# 2. Did msmtp see the attempt?
tail -50 /var/log/msmtp.log

# 3. Is sendmail itself broken?
echo "Subject: test\n\nbody" | sendmail $ADMIN_EMAIL
echo "exit: $?"   # 0 = queued OK, non-zero = msmtp rejected
```

Common causes:

- **gmail "Less secure app access" error**: gmail no longer allows password auth on the main account password — you must use a 16-char App Password, and 2FA must be on for the account.
- **Wrong port**: STARTTLS on 587 requires `tls on; tls_starttls on`. Implicit TLS on 465 requires `tls on; tls_starttls off`.
- **Cert verification failure**: `tls_trust_file` must point at a real CA bundle. On AlmaLinux: `/etc/pki/tls/certs/ca-bundle.crt`.
- **Relay refuses to send `From:`**: the relay's "from" address must match (or be authorized as) the authenticated user. If `KNOWLESS_FROM=auth@yourdomain.com` and you authenticate as `you@gmail.com`, gmail rewrites the From and may add a "via" header. To stop that, point `KNOWLESS_FROM` at the same address you authenticate as.

### `/healthz` returns 502

nginx can't reach the backend. In order:

```bash
systemctl status plato                    # is plato up?
ss -tlnp | grep 8080                      # is plato actually listening?
getsebool httpd_can_network_connect       # did you do step 3?
```

The third one is the most-common 502 cause on AlmaLinux. Re-run `setsebool -P httpd_can_network_connect 1`.

### `/healthz` returns 503

plato is up but a writability check failed. Look at the JSON:

```bash
curl -sS https://${DOMAIN}/healthz | jq .
```

If `db_writable: false` — usually the SQLite file is on a read-only mount, or `/opt/plato` lost its `plato:plato` ownership. `chown -R plato:plato /opt/plato`, restart.

If `exports_dir_writable: false` — same fix scoped to `/opt/plato/exports`.

### certbot --nginx fails

Most common: DNS hasn't propagated yet, or you set the A record after running certbot. Fix:

```bash
dig +short $DOMAIN     # must return VPS IP, no other answers
certbot --nginx -d $DOMAIN -m $ADMIN_EMAIL --agree-tos -n --redirect
```

If you exhaust the Let's Encrypt rate limit (5 issuances per domain per week), wait or use the staging endpoint to debug: `--server https://acme-staging-v02.api.letsencrypt.org/directory`.

### Cert renewal fails silently

You have two layers of safety net:

- **`bin/check-cert.sh`** runs daily from cron (line in `/etc/cron.d/plato`). Silent ≥ 14 days; daily email when remaining drops below 14; `URGENT` subject prefix below 3. Recipient is `HEALTH_ALERT_EMAIL` env then `config.json:operator.email`.
- **Let's Encrypt itself emails** the ACME-registered address (the one you passed `-m`) when a cert is < 20 days from expiry. This is independent of plato's cron.

If both stay silent and the cert still expires, the renewal layer itself is broken. Investigate:

```bash
systemctl status certbot.timer
journalctl -u certbot -n 200
certbot renew --dry-run            # would today's renewal succeed?
```

You can also run `bin/check-cert.sh` interactively to confirm it's parsing the cert correctly:

```bash
DOMAIN=$DOMAIN BACKUP_DIR=/var/lib/plato-backups /opt/plato/bin/check-cert.sh
echo "exit=$?"
tail -1 /var/lib/plato-backups/health.log
```

### Cron alerts not arriving

`MAILTO=${ADMIN_EMAIL}` in `/etc/cron.d/plato` only delivers if the system has a working `sendmail`. Verify:

```bash
echo "test" | mail -s "cron preflight" $ADMIN_EMAIL
echo "exit: $?"
```

If that fails, msmtp/msmtp-mta is misconfigured — go back to step 5.

### plato won't start

```bash
journalctl -u plato -n 100 --no-pager
```

Three things to look for:

1. **`auth: KNOWLESS_SECRET is required`** — `.env` is missing or unreadable by the `plato` user. Check `ls -l /opt/plato/.env` (must be 600 plato:plato).
2. **`Error: ENOENT: no such file or directory, open '.../forum.db'`** — you skipped step 9. Run migrations.
3. **`Error: listen EADDRINUSE`** — another process holds :8080. `ss -tlnp | grep 8080` to find it. Usually a previous test instance.

### "Why is everyone signed out / new identities everywhere"

You changed `KNOWLESS_SECRET`. Restore the previous value from a backup `.env`. Identity is HMAC-derived from this secret — there is no recovery path other than restoring the prior value.

### SELinux blocks something I added

```bash
# Look for AVC denials in the audit log:
ausearch -m avc -ts recent

# Most plato + nginx + msmtp scenarios are covered by:
setsebool -P httpd_can_network_connect 1
```

If you've added a non-standard path (e.g. moved `/opt/plato` somewhere else), label it correctly:

```bash
semanage fcontext -a -t httpd_sys_content_t "/your/new/path(/.*)?"
restorecon -R /your/new/path
```

---

## Security checklist

Before you announce the URL:

- [ ] `/etc/msmtprc` is mode 600, owned root.
- [ ] `/opt/plato/.env` is mode 600, owned plato:plato.
- [ ] firewalld allows only 22/80/443 (`firewall-cmd --list-services`).
- [ ] SSH login as root is disabled (`PermitRootLogin no` in `/etc/ssh/sshd_config`); you log in as a sudoer with a key.
- [ ] `KNOWLESS_SECRET` is backed up somewhere you trust (password manager, encrypted USB). Losing it ≈ losing every user.
- [ ] `git remote -v` in `/opt/plato` matches the upstream you intended.
- [ ] The first signed-in user on the live site is *you* — that establishes you as the de-facto admin in the modlog.

## What this guide intentionally doesn't do

- **Configure fail2ban / SSH brute-force protection.** That's a host-hardening concern unrelated to plato; pick your own SSH-hardening playbook (most distros' default policies are already fine for a 1-VPS hobby setup behind a private SSH key).
- **Set up monitoring beyond `/healthz`.** A monthly $0 ping from UptimeRobot or BetterStack on the public URL is plenty for a hobby forum. The `/healthz` endpoint is what they should hit.
- **Run a self-hosted MTA.** Outbound port 25 is blocked by most VPS providers and IP reputation matters; the msmtp + relay setup is the realistic OSS path. See [`operator-guide.md`](operator-guide.md) for the long-form reasoning.

## Where to read next

- [`operator-guide.md`](operator-guide.md) — full operator reference: every config knob, every cron job, every threshold, every locked decision.
- [`cron-jobs.md`](cron-jobs.md) — per-cron deep dive: what runs, what mails, what restarts.
- [`plato.context.md`](plato.context.md) — developer integration view: routes, schema, sub state model.
- [`m5-mod-surface-spec.md`](../01-product/m5-mod-surface-spec.md) — moderation surface architecture (read this before changing modlog code).
