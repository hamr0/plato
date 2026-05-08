# plato deploy guide

A single, opinionated path from a fresh AlmaLinux 9 VPS to a running plato instance with TLS, mail, monitoring, and backups. No "pick one of three" forks; every choice has been made for you.

If you want to know *why* a choice was made, see the cross-references; they all point at [`operator-guide.md`](operator-guide.md) or [`plato.context.md`](plato.context.md).

## Stack, in one breath

- **OS**: AlmaLinux 9 (RHEL-equivalent). Packages via `dnf`, services via `systemctl`, firewall via `firewalld`, SELinux enforcing.
- **Runtime**: Node ≥ 22.5 from NodeSource. SQLite 3 from the distro repo.
- **Reverse proxy + TLS**: nginx + certbot (`certbot.timer` auto-renews twice daily).
- **Outbound mail**: postfix + opendkim. knowless connects to `localhost:25`; postfix delivers direct to recipient mail servers, opendkim signs every outbound message with your domain's DKIM key. SPF, DKIM, and DMARC live as TXT records at your registrar. **No vendor SMTP relay.** Your domain, your IP, your reputation.
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
                   ├──► knowless SMTP client → localhost:25
                   │                              │
                   │                              ▼
                   │                       postfix (smtpd_milters → opendkim)
                   │                              │  DKIM-signs message
                   │                              ▼
                   │                       direct delivery to recipient MX
                   │                              │
                   │                              ▼
                   │                          user inbox
                   │
                   └──► GET /healthz  (consumed by bin/health-watch.sh cron)

   /etc/cron.d/plato (root) ──► bin/{backup,health-watch,check-cert,refresh-urlhaus,stats,...}
                                        │  on alert
                                        └──► /usr/sbin/sendmail (= postfix) ──► same path ──► operator inbox
```

Two consequences worth internalizing:

1. **No vendor SMTP relay anywhere.** plato's `.env` has no SMTP password. postfix's `main.cf` has no relay host. Outbound mail goes direct to recipient MX servers from your VPS IP, signed with your DKIM key. Recipient deliverability depends on your domain's reputation, your IP's PTR record, and your SPF/DKIM/DMARC posture — see Step 5.
2. **One MTA = the entire mailer.** Magic links, cert-expiry alerts, weekly stats digests, backup failures all flow through the same postfix queue and inherit the same opendkim signing. One config to maintain, one set of logs to read (`/var/log/maillog` or `journalctl -u postfix`).

## Prerequisites

Before you start:

- [ ] AlmaLinux 9 VPS with public IPv4. 1 GB RAM, 25 GB disk, 1 vCPU is plenty for a hobby forum. Hetzner CX11 / DigitalOcean basic / OVH VPS Starter — any will do.
- [ ] Domain you control with DNS access (for the `A` record AND for SPF/DKIM/DMARC TXT records). **Point an `A` record at the VPS IP before step 11**; certbot needs to resolve `$DOMAIN` to the VPS to issue the cert.
- [ ] **VPS provider doesn't block port 25 outbound.** Most provider's anti-spam policy blocks it on new accounts; some unblock on request, some never do. Check before you commit:
  - **Hetzner, OVH, Linode, Vultr** — usually need a support ticket to unblock 25 outbound. Approve within hours, free.
  - **DigitalOcean** — historically restrictive; you may need to use a different provider.
  - **AWS EC2** — blocked by default; request limit removal via the form.
  - Test from the VPS itself: `nc -zv gmail-smtp-in.l.google.com 25` should connect.
- [ ] **PTR (reverse DNS) record** at your VPS provider's control panel set to `$DOMAIN`. Recipients (especially Gmail) reject mail when forward-confirmed reverse DNS doesn't match the helo name. This is a 1-line config at the provider, not at your registrar.
- [ ] SSH access to the VPS as root or a sudoer.

**If your VPS provider won't unblock port 25**: postfix can't deliver direct, and this guide's mail story doesn't work as-is. You either pick a different provider, or step off the supported path and configure postfix as a relay client (smarthost) — that's a vendor-coupled setup plato deliberately doesn't document. See [knowless OPS.md §5](https://github.com/hamr0/knowless/blob/main/OPS.md) for the canonical mailer reference.

Set these once in your shell so the rest of the guide is copy-paste:

```bash
export DOMAIN=forum.example.com
export ADMIN_EMAIL=you@example.com   # used by certbot + as cron alert recipient
export PLATO_PORT=8080               # plato's listener; pick another (e.g. 8090) if 8080 is taken
```

If something on the box already binds 8080 (AdGuard, another web app, a docker container), check first and adjust:

```bash
sudo ss -tlnp 'sport = :8080'        # what's there?
# If non-empty, set PLATO_PORT=8090 (or any free port). bootstrap.sh
# threads this through both /etc/nginx/conf.d/plato.conf (proxy_pass)
# and you'll mirror it as PORT=8090 in plato's .env.
```

## Step 1 — Base system + Node + nginx + postfix + opendkim

**AlmaLinux 9 / RHEL 9 (needs EPEL for opendkim):**

```bash
dnf -y update
dnf -y install epel-release
dnf -y install \
  nginx certbot python3-certbot-nginx \
  sqlite git jq tar firewalld policycoreutils-python-utils \
  postfix opendkim opendkim-tools \
  vim curl

# Node 22 from NodeSource (RHEL ships an older module by default)
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
dnf -y install nodejs
```

**Fedora 38+ (Server / Cloud / Workstation):**

```bash
dnf -y update
dnf -y install \
  nginx certbot python3-certbot-nginx \
  sqlite git jq tar firewalld policycoreutils-python-utils \
  postfix opendkim opendkim-tools \
  vim curl

# Fedora's nodejs in the distro repo is usually current enough; check:
node --version    # need ≥ 22.5
# If it's older, use NodeSource:
#   curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
#   dnf -y install nodejs
```

`postfix` provides `/usr/sbin/sendmail` automatically (via `alternatives --set mta`). No second package needed for the sendmail interface that cron mail uses.

**Sanity (both distros):**

```bash
node --version            # v22.5+ required (--env-file flag)
sqlite3 --version         # any 3.x
which sendmail            # → /usr/sbin/sendmail
ls -l /usr/sbin/sendmail  # should resolve to postfix's sendmail
postconf mail_version     # postfix version
opendkim-genkey -V        # opendkim is installed
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

## Step 5 — Configure postfix + opendkim + DNS

This is the most involved step in the guide; it has to be, because mail deliverability is the most fragile part of running a hobby forum. Skipping or half-doing it sends every magic link to spam. The shape:

1. Configure postfix to deliver direct, advertise the right hostname
2. Generate an opendkim signing key, wire it as a postfix milter
3. Publish three TXT records at your registrar (SPF, DKIM, DMARC)
4. Confirm PTR (rDNS) at your VPS provider
5. Smoke test against an external recipient

**Canonical reference for this entire stack:** [knowless OPS.md §5](https://github.com/hamr0/knowless/blob/main/OPS.md#5-spf-dkim-ptr) — that's the source of the recipe below; if anything here drifts, OPS.md wins.

### 5.1 postfix `main.cf`

```bash
# Tell postfix who it is. inet_interfaces=loopback-only means it accepts
# submissions ONLY from localhost (knowless + cron); it still delivers
# outbound to the world. mynetworks scoped to 127.0.0.1 prevents open-relay.
postconf -e "myhostname = $DOMAIN"
postconf -e "mydomain = $DOMAIN"
postconf -e "myorigin = \$mydomain"
postconf -e "inet_interfaces = loopback-only"
postconf -e "inet_protocols = ipv4"
postconf -e "mynetworks = 127.0.0.0/8 [::1]/128"
postconf -e "smtp_tls_security_level = may"
postconf -e "smtp_tls_loglevel = 1"

# Helo/banner that recipients see. Must match PTR record.
postconf -e "smtpd_banner = \$myhostname ESMTP"

systemctl enable --now postfix
```

`inet_interfaces = loopback-only` is the security-critical line: knowless and cron both connect via `localhost:25`, so external network access to postfix's listener is unnecessary and forbidden.

### 5.2 opendkim signing key

```bash
# Generate a 2048-bit DKIM keypair in /etc/opendkim/keys/$DOMAIN/
mkdir -p /etc/opendkim/keys/$DOMAIN
cd /etc/opendkim/keys/$DOMAIN
opendkim-genkey -b 2048 -d $DOMAIN -s default
chown -R opendkim:opendkim /etc/opendkim/keys
chmod 600 /etc/opendkim/keys/$DOMAIN/default.private
```

This drops `default.private` (the key opendkim signs with) and `default.txt` (the DNS record you'll publish). The selector `default` is conventional; pick another name if you'll rotate keys.

### 5.3 opendkim configuration

Edit `/etc/opendkim.conf`:

```bash
# Keep it minimal; defaults handle the rest.
sed -i 's|^Mode.*|Mode sv|'                                   /etc/opendkim.conf
sed -i 's|^#KeyFile.*|KeyFile /etc/opendkim/keys/default.private|' /etc/opendkim.conf
sed -i 's|^Selector.*|Selector default|'                      /etc/opendkim.conf

# Switch from single-key to KeyTable so multi-domain stays open.
cat >> /etc/opendkim.conf <<EOF
KeyTable        refile:/etc/opendkim/KeyTable
SigningTable    refile:/etc/opendkim/SigningTable
ExternalIgnoreList /etc/opendkim/TrustedHosts
InternalHosts   /etc/opendkim/TrustedHosts
EOF
```

Populate the tables:

```bash
echo "default._domainkey.$DOMAIN $DOMAIN:default:/etc/opendkim/keys/$DOMAIN/default.private" \
  > /etc/opendkim/KeyTable

echo "*@$DOMAIN default._domainkey.$DOMAIN" \
  > /etc/opendkim/SigningTable

cat > /etc/opendkim/TrustedHosts <<EOF
127.0.0.1
localhost
$DOMAIN
EOF

chown -R opendkim:opendkim /etc/opendkim
chmod 644 /etc/opendkim/{KeyTable,SigningTable,TrustedHosts}

systemctl enable --now opendkim
```

### 5.4 Wire opendkim into postfix as a milter

```bash
postconf -e "milter_default_action = accept"
postconf -e "milter_protocol = 6"
postconf -e "smtpd_milters = inet:127.0.0.1:8891"
postconf -e "non_smtpd_milters = inet:127.0.0.1:8891"

systemctl restart postfix
```

`non_smtpd_milters` is the line that catches mail submitted via `/usr/sbin/sendmail` (knowless's path AND cron's path) — without it, only mail received over network SMTP gets signed, and your magic links go out unsigned.

### 5.5 DNS records (paste at your registrar)

Three TXT records. Replace `$DOMAIN` with your actual domain.

**a) SPF** — authorizes your VPS IP to send mail for the domain.

```
Type:  TXT
Host:  $DOMAIN  (or @)
Value: v=spf1 mx a -all
```

`mx a -all`: allow sending from any A or MX of the domain (your VPS IP via the A record), reject all others. `-all` is hard-fail; recipients reject mail from unauthorized IPs.

**b) DKIM** — public key opendkim uses to sign mail. The value is in `/etc/opendkim/keys/$DOMAIN/default.txt`.

```bash
cat /etc/opendkim/keys/$DOMAIN/default.txt
# Output looks like:
# default._domainkey  IN  TXT  ( "v=DKIM1; k=rsa; "
#   "p=MIIBIjANBgkqhkiG9w0B...." )
```

Paste at your registrar:

```
Type:  TXT
Host:  default._domainkey.$DOMAIN  (or just "default._domainkey")
Value: v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0B... (everything inside the quotes, joined)
```

Most registrars handle the line-folding inside parentheses automatically when you paste. If yours doesn't, strip newlines and inner quotes — it must be a single TXT value.

**c) DMARC** — tells recipients what to do when SPF or DKIM fail.

```
Type:  TXT
Host:  _dmarc.$DOMAIN
Value: v=DMARC1; p=quarantine; rua=mailto:postmaster@$DOMAIN; ruf=mailto:postmaster@$DOMAIN; pct=100
```

Start with `p=quarantine` while you're verifying delivery; tighten to `p=reject` once you've confirmed mail flows clean for a few days. `rua`/`ruf` are aggregate / forensic report destinations; the inbox at `postmaster@$DOMAIN` doesn't have to exist for DMARC itself to work but reports drop on the floor without it.

### 5.6 PTR (reverse DNS)

This isn't a registrar-side record — it lives at your VPS provider's control panel. Set the PTR for your VPS IPv4 to `$DOMAIN`. Verify:

```bash
dig +short -x $(curl -s4 ifconfig.me)
# Must return: $DOMAIN.
```

If this doesn't match `myhostname` in postfix's `main.cf`, Gmail rejects with `550-5.7.1 Messages missing a valid Reverse DNS`.

### 5.7 Smoke test, before plato exists

```bash
# Wait ~5 min for DNS to propagate. Then verify each record:
dig +short TXT $DOMAIN | grep spf1
dig +short TXT default._domainkey.$DOMAIN | head -1
dig +short TXT _dmarc.$DOMAIN

# Send a test message via postfix's sendmail interface.
sendmail -f $ADMIN_EMAIL $ADMIN_EMAIL <<EOF
Subject: postfix preflight from $(hostname)

If you see this in the inbox (not spam), postfix + opendkim + DNS work.
EOF

# Watch the queue + log:
mailq                              # should be empty within seconds
tail -50 /var/log/maillog          # look for "DKIM-Signature" and "status=sent"
```

Open the message in Gmail/Fastmail. Click "Show original" / view headers. Look for:

- `Authentication-Results: ... spf=pass smtp.mailfrom=$DOMAIN` ← SPF works
- `Authentication-Results: ... dkim=pass header.i=@$DOMAIN` ← opendkim signing + DNS DKIM record both work
- `Authentication-Results: ... dmarc=pass`               ← DMARC alignment

All three must be `pass`. If any is `fail` or `none`, **fix it now** — once plato is sending magic links, every silent failure is a user who can't log in.

Common fixes:

- `spf=fail` → A record at `$DOMAIN` doesn't include the VPS IP, or SPF TXT mistyped.
- `dkim=none` → DNS DKIM record hasn't propagated; `dig` it again.
- `dkim=fail` → opendkim's `KeyFile` doesn't match the published public key; regenerate.
- Mail goes to spam despite all three pass → PTR doesn't match `myhostname`; fix at VPS provider.

Once this preflight clears, every plato mail flows through here.

## Step 6 — Clone plato

`useradd --create-home` may have seeded `/opt/plato` with shell rc files, so `git clone … .` would refuse on a non-empty target. Clone to a temp path, copy in, fix ownership:

```bash
sudo -u plato -H git clone https://github.com/hamr0/plato.git /tmp/plato-src
sudo cp -a /tmp/plato-src/. /opt/plato/
sudo cp -a /tmp/plato-src/.git /opt/plato/
sudo chown -R plato:plato /opt/plato
sudo rm -rf /tmp/plato-src

sudo -u plato -H bash -c 'cd /opt/plato && npm ci --omit=dev'
```

`--omit=dev` skips test-only deps; the runtime tree stays small (knowless, marked, dicebear, unique-names-generator).

## Step 7 — Generate the secret + write `.env`

The `KNOWLESS_SECRET` is the **only** plato secret. Identity hashes derive from it; if it changes after launch, every user looks like a new account. **Generate it once. Back it up. Never rotate.**

Use the helper script — pasting `node -e "..."` from memory is fragile across terminal-paste boundaries:

```bash
SECRET=$(sudo -u plato /opt/plato/bin/gen-secret.sh)
echo "secret length: ${#SECRET}"   # expect: 64

sudo tee /opt/plato/.env > /dev/null <<ENV
KNOWLESS_SECRET=$SECRET
KNOWLESS_BASE_URL=https://$DOMAIN
KNOWLESS_FROM=auth@$DOMAIN
KNOWLESS_SMTP_HOST=localhost
KNOWLESS_SMTP_PORT=25
PORT=$PLATO_PORT
DB_PATH=/opt/plato/forum.db
ENV

sudo chown plato:plato /opt/plato/.env
sudo chmod 600 /opt/plato/.env
```

> **Homeserver / self-signed test note.** This guide assumes a public VPS with port 25 outbound and DNS at a registrar. On a residential homeserver (port 25 blocked by ISP, no public domain pointing at it), the postfix path won't deliver mail. Use plato in dev mode with `KNOWLESS_DEV_LOG_LINKS=true` (see `.env.dev`) — magic links print to stderr, you click them out of the log, you validate the auth flow without real mail. See the [Self-signed mode](#self-signed-mode-homeserver--lan-testing) appendix.

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
sudo DOMAIN=$DOMAIN ADMIN_EMAIL=$ADMIN_EMAIL PLATO_PORT=$PLATO_PORT \
  /opt/plato/deploy/bootstrap.sh
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

# nginx site (only ${DOMAIN} + ${PLATO_PORT} substitute — nginx's own $host etc. preserved)
DOMAIN=$DOMAIN PLATO_PORT=$PLATO_PORT \
  envsubst '${DOMAIN} ${PLATO_PORT}' \
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
| Tail mail logs | `tail -f /var/log/maillog` (or `journalctl -u postfix -f`) |
| Inspect mail queue | `mailq` (deferred mail) / `postqueue -f` (force flush) |
| Check health | `curl -sS https://$DOMAIN/healthz \| jq .` |
| Pre-start sanity check | `sudo -u plato bash -c 'cd /opt/plato && bin/preflight.sh'` |
| Cert expiry probe | `cd /opt/plato && DOMAIN=$DOMAIN bin/check-cert.sh` |
| Run a backup now | `sudo -u plato BACKUP_DIR=/var/lib/plato-backups /opt/plato/bin/backup.sh` |
| Re-render system files | `sudo DOMAIN=$DOMAIN ADMIN_EMAIL=$ADMIN_EMAIL PLATO_PORT=$PLATO_PORT /opt/plato/deploy/bootstrap.sh` |
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
| `/etc/postfix/main.cf` | root | postfix config (myhostname, milter wiring) |
| `/etc/opendkim.conf` | root | opendkim config |
| `/etc/opendkim/keys/$DOMAIN/default.private` | opendkim (mode 600) | DKIM signing key — back this up |
| `/etc/systemd/system/plato.service` | root | systemd unit |
| `/etc/nginx/conf.d/plato.conf` | root | nginx site (certbot edits this in place) |
| `/etc/cron.d/plato` | root | cron block |
| `/etc/logrotate.d/plato` | root | log rotation |
| `/etc/letsencrypt/live/$DOMAIN/` | root | TLS cert + key |
| `/var/lib/plato-backups/` | plato | tarballs, 7-day retention |
| `/var/log/plato*.log` | mixed | redirected stdout/stderr from plato + crons |
| `/var/log/maillog` | root | postfix + opendkim outbound delivery log |

### Backups, in plain English

`bin/backup.sh` writes one `plato-backup-<date>.tar.gz` per night to `/var/lib/plato-backups/`, keeping the newest 7 (default `BACKUP_KEEP=7`). It uses SQLite's online `.backup` API so you don't have to stop the server. Inside the tarball: `forum.db`, `knowless.db`, `posts/`, `exports/`, `config.json`, `spam-patterns.txt`, `data/urlhaus.txt`, `disposable-domains.txt`.

To rotate copies off the host, edit the commented `rsync` stanza at the bottom of `bin/backup.sh` to point at your laptop or an offsite machine. We don't bake key management into plato.

To restore: stop the server, untar, copy `forum.db` + `posts/` over the live ones, restart. **The `KNOWLESS_SECRET` in your restored `.env` must match the value at the time of backup** — otherwise every user's identity hash shifts and they look like new accounts.

---

## Troubleshooting

### Magic link doesn't arrive

```bash
# 1. Did plato try to send it?
journalctl -u plato -n 50 | grep -iE "mail|knowless|plato mail"
# Look for [plato mail.fail] (knowless onTransportFailure hook) — message
# carries the SMTP-level reason. Sibling [plato mail.submit] lines confirm
# successful submissions.

# 2. Did postfix accept and deliver?
tail -100 /var/log/maillog
mailq                              # any deferred mail?

# 3. Inspect a specific queued message:
postqueue -p                       # list queue IDs
postcat -q <queue-id>              # show the message + headers

# 4. Is the sendmail interface itself broken?
echo "Subject: test from $(hostname)" | sendmail -f $ADMIN_EMAIL $ADMIN_EMAIL
echo "exit: $?"
tail -10 /var/log/maillog
```

Common causes:

- **`status=deferred ... Connection refused`**: postfix can't reach the recipient's MX. Usually port 25 outbound is blocked by your VPS provider — open a support ticket, or pick a different provider.
- **`status=bounced ... Reverse DNS check failed`**: PTR record at the VPS provider doesn't match `myhostname` in postfix's `main.cf`. Set the PTR.
- **Mail goes to spam, headers show `dkim=fail`**: the DKIM TXT record at the registrar doesn't match the public key opendkim is signing with. Re-publish from `cat /etc/opendkim/keys/$DOMAIN/default.txt` (and watch out for line-folding; it must be a single TXT value).
- **Mail goes to spam, headers show `dmarc=fail (alignment)`**: `KNOWLESS_FROM` domain doesn't match the SPF/DKIM domain. They must agree. If `KNOWLESS_FROM=auth@$DOMAIN`, then SPF must authorize `$DOMAIN` and DKIM must sign as `$DOMAIN` — easy when you set them all consistently per Step 5.
- **`opendkim: ... no signing table match`**: SigningTable doesn't include the From address. Edit `/etc/opendkim/SigningTable`, restart opendkim.
- **No `DKIM-Signature` header at all**: `non_smtpd_milters` isn't set in `main.cf`, so locally-submitted mail (knowless's path) bypasses opendkim. Re-run the postconf line in 5.4.

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

`MAILTO=${ADMIN_EMAIL}` in `/etc/cron.d/plato` delivers via postfix's sendmail interface (same path as magic-link mail). Verify:

```bash
echo "Subject: cron preflight" | sendmail -f $ADMIN_EMAIL $ADMIN_EMAIL
echo "exit: $?"
tail -20 /var/log/maillog
```

If that fails, postfix is broken — go back to step 5. If only cron's mail fails (but magic-link mail works), check `/etc/cron.d/plato`'s `MAILTO=` line.

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

# Most plato + nginx + postfix scenarios are covered by:
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

- [ ] `/etc/opendkim/keys/$DOMAIN/default.private` is mode 600, owned opendkim. **Back this up** — losing it means re-rotating DKIM at the registrar before mail can sign again.
- [ ] postfix `inet_interfaces = loopback-only` (verify: `postconf inet_interfaces`).
- [ ] `/opt/plato/.env` is mode 600, owned plato:plato.
- [ ] firewalld allows only 22/80/443 (`firewall-cmd --list-services`).
- [ ] SSH login as root is disabled (`PermitRootLogin no` in `/etc/ssh/sshd_config`); you log in as a sudoer with a key.
- [ ] `KNOWLESS_SECRET` is backed up somewhere you trust (password manager, encrypted USB). Losing it ≈ losing every user.
- [ ] `git remote -v` in `/opt/plato` matches the upstream you intended.
- [ ] The first signed-in user on the live site is *you* — that establishes you as the de-facto admin in the modlog.

## What this guide intentionally doesn't do

- **Configure fail2ban / SSH brute-force protection.** That's a host-hardening concern unrelated to plato; pick your own SSH-hardening playbook (most distros' default policies are already fine for a 1-VPS hobby setup behind a private SSH key).
- **Set up monitoring beyond `/healthz`.** A monthly $0 ping from UptimeRobot or BetterStack on the public URL is plenty for a hobby forum. The `/healthz` endpoint is what they should hit.
- **Use a vendor SMTP relay** (Mailgun / Postmark / SES). knowless deliberately doesn't bless this — see [knowless PRD §16.2 "one mail purpose"](https://github.com/hamr0/knowless/blob/main/PRD.md). On a VPS that allows outbound :25, postfix delivering direct is cleaner: no third-party trust, no cred rotation, no vendor lock-in. If your provider blocks :25 and won't unblock, you've stepped off the supported path — `transportOverride` exists in knowless as an escape hatch but isn't documented as a path the project supports.
- **Configure fail2ban for postfix.** Postfix on `loopback-only` interfaces isn't an attack surface from outside the box, so the standard postfix fail2ban jails don't apply. If you change `inet_interfaces` to listen on the public IP (don't), then yes.

## Self-signed mode (homeserver / LAN testing)

For deploys where certbot can't help — private hostnames (`homelab`, `federver`), RFC1918 IPs, split-horizon DNS, a developer laptop, internal staging — plato ships a self-signed alternative. Two artifacts:

- `deploy/gen-selfsigned-cert.sh` — wraps `openssl req -x509` to drop a key + cert at the canonical Fedora/RHEL paths (`/etc/pki/tls/{certs,private}/plato.{crt,key}`).
- `deploy/plato.nginx-selfsigned.template` — replaces the certbot-managed config; listens on 80 (redirect → 443) and 443 ssl, proxy_pass to `${PLATO_PORT}`.

Use this **instead of** Step 11. Steps 1–10 + 12–13 work unchanged.

```bash
# Generate the cert + key. CN must match what you'll connect to in the
# browser (your hostname). Subject Alt Names cover localhost + 127.0.0.1
# so curl from the box itself works without -k.
sudo CN=$DOMAIN /opt/plato/deploy/gen-selfsigned-cert.sh

# Render the SSL nginx config and replace bootstrap's HTTP-only one.
DOMAIN=$DOMAIN PLATO_PORT=$PLATO_PORT \
  envsubst '${DOMAIN} ${PLATO_PORT}' \
  < /opt/plato/deploy/plato.nginx-selfsigned.template \
  | sudo tee /etc/nginx/conf.d/plato.conf > /dev/null

sudo nginx -t                         # syntax check
sudo systemctl enable --now nginx
sudo systemctl reload nginx           # if already running

# Smoke. -k accepts the self-signed cert.
curl -sSk https://$DOMAIN/healthz | jq .
```

Browsers will warn about the self-signed cert. Accept the warning — you generated it. Importing the cert into your trust store is doable but out of scope for this guide.

### Mail on a homeserver

Most residential ISPs block port 25 outbound, so postfix on a homeserver can't deliver direct. **Don't try to make production mail work in this environment.** Instead, run plato in dev mode for the auth-flow smoke:

```bash
# In /opt/plato/.env, set:
KNOWLESS_DEV_LOG_LINKS=true        # print magic links to stderr
KNOWLESS_COOKIE_SECURE=false       # cookies work over self-signed HTTPS

# Restart plato, then POST /login. The magic link appears in journalctl:
journalctl -u plato -f | grep '\[knowless dev:'
```

Click the link from the log. Validate the auth flow, sub creation, post writing, modlog. **Real mail delivery (DKIM-signed outbound, SPF/DMARC checks) gets validated on the VPS, not here.** Carrying postfix from homeserver to VPS doesn't help — you'll redo `myhostname`, the DKIM key, and the DNS records anyway.

When you migrate homeserver → VPS, you swap nginx config + cert source + redo Step 5 against your real domain; everything else (`/etc/cron.d/plato`, systemd unit, `KNOWLESS_SECRET`, `config.json`) carries over. To remove the self-signed bits during teardown, `deploy/teardown.sh` already covers `/etc/pki/tls/{certs,private}/plato.{crt,key}` (interactive prompt; pass `--yes-data` to skip).

## Where to read next

- [`operator-guide.md`](operator-guide.md) — full operator reference: every config knob, every cron job, every threshold, every locked decision.
- [`cron-jobs.md`](cron-jobs.md) — per-cron deep dive: what runs, what mails, what restarts.
- [`plato.context.md`](plato.context.md) — developer integration view: routes, schema, sub state model.
- [`m5-mod-surface-spec.md`](../01-product/m5-mod-surface-spec.md) — moderation surface architecture (read this before changing modlog code).
