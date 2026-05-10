# plato deploy guide

A single, opinionated path from a fresh Ubuntu 24.04 VPS to a running plato instance with TLS, mail, monitoring, and backups. No "pick one of three" forks; every choice has been made for you.

If you want to know *why* a choice was made, see the cross-references; they all point at [`operator-guide.md`](operator-guide.md) or [`plato.context.md`](plato.context.md).

**Distro support.** Primary path: **Ubuntu 24.04 LTS** (also works on Debian 12). The guide also includes parallel **AlmaLinux 9 / RHEL 9** blocks at the three steps that differ (1, 2, 3). Everything from Step 4 onward is distro-agnostic.

## Stack, in one breath

- **OS**: Ubuntu 24.04 LTS (apt + ufw + AppArmor) on the primary path; AlmaLinux 9 / RHEL 9 (dnf + firewalld + SELinux) supported via parallel blocks in Steps 1–3.
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
2. **One MTA = the entire mailer.** Magic links, cert-expiry alerts, weekly stats digests, backup failures all flow through the same postfix queue and inherit the same opendkim signing. One config to maintain, one set of logs to read (`/var/log/mail.log` on Ubuntu/Debian, `/var/log/maillog` on RHEL family — or `journalctl -u postfix` on any).

## Prerequisites

Before you start:

- [ ] Ubuntu 24.04 LTS VPS with public IPv4 (or AlmaLinux 9; the guide branches at Steps 1–3). 1 GB RAM, 25 GB disk, 1 vCPU is plenty for a hobby forum. Budget: **RackNerd ~$20/year** (KVM, full control, port 25 + PTR available via support ticket — what plato is tested on). Mid-tier: Hetzner CX11 (€4.50/mo, EU). Higher-touch: DigitalOcean / Linode / OVH / Vultr — all work, but check the port-25 row below before committing.
- [ ] Domain you control with DNS access (for the `A` record AND for SPF/DKIM/DMARC TXT records). **Point an `A` record at the VPS IP before step 11**; certbot needs to resolve `$DOMAIN` to the VPS to issue the cert.
- [ ] **VPS provider doesn't block port 25 outbound.** Most providers' anti-spam policy blocks it on new accounts; some unblock on request, some never do. Check before you commit:
  - **RackNerd** — blocked by default, unblocked on request via a 1-paragraph support ticket. Approves in hours, free. The port-25 + PTR tickets can go in together; there's a paste-ready template in [operator-guide.md § Hosting](operator-guide.md#hosting--budget-vps-recommendation).
  - **Hetzner, OVH, Linode, Vultr** — same shape, support ticket to unblock 25. Hours, free.
  - **DigitalOcean** — historically restrictive; you may need to use a different provider.
  - **AWS EC2** — blocked by default; request limit removal via the form.
  - Test from the VPS itself: `nc -zv gmail-smtp-in.l.google.com 25` should connect.
- [ ] **PTR (reverse DNS) record** at your VPS provider's control panel set to `$DOMAIN`. Recipients (especially Gmail) reject mail when forward-confirmed reverse DNS doesn't match the helo name. This is a 1-line config at the provider, not at your registrar.
- [ ] SSH access to the VPS as root or a sudoer.

**If your VPS provider won't unblock port 25**: postfix can't deliver direct, and this guide's mail story doesn't work as-is. You either pick a different provider, or step off the supported path and configure postfix as a relay client (smarthost) — that's a vendor-coupled setup plato deliberately doesn't document. See [knowless OPS.md §5](https://github.com/hamr0/knowless/blob/main/OPS.md) for the canonical mailer reference.

Set these once on the VPS, persisted to `/root/.bashrc` so they survive SSH reconnects (otherwise every reconnect drops them and the rest of the guide silently produces malformed configs):

```bash
cat >> /root/.bashrc <<'EOF'

# plato deploy session vars
export DOMAIN=forum.example.com
export ADMIN_EMAIL=you@example.com   # used by certbot + as cron alert recipient
export PLATO_PORT=8080               # plato's listener; pick another (e.g. 8090) if 8080 is taken
export FORUM_NAME=your-forum-name    # display name in mail "From:" header (e.g. "terribic <auth@terribic.com>")
EOF

source /root/.bashrc

# Sanity:
echo "DOMAIN=$DOMAIN ADMIN=$ADMIN_EMAIL PORT=$PLATO_PORT FORUM_NAME=$FORUM_NAME"
```

Editing the values later: re-run `vim /root/.bashrc` and `source /root/.bashrc`. They're plain `export` lines.

If something on the box already binds 8080 (AdGuard, another web app, a docker container), check first and adjust:

```bash
sudo ss -tlnp 'sport = :8080'        # what's there?
# If non-empty, set PLATO_PORT=8090 (or any free port). bootstrap.sh
# threads this through both /etc/nginx/conf.d/plato.conf (proxy_pass)
# and you'll mirror it as PORT=8090 in plato's .env.
```

## Step 0 — SSH hardening

Before any plato setup. Most budget VPS providers (RackNerd, OVH, Hetzner cloud) deliver `root` + password authentication by default — credential-stuffing bots scan public IPv4 ranges constantly, so leaving password auth on while you set up TLS and mail is a bad way to start.

**On your laptop**, generate a key (skip if you already have `~/.ssh/id_ed25519`) and copy it to the VPS:

```bash
ssh-keygen -t ed25519 -C "$(whoami)@$(hostname)"

# Copy the pubkey to the VPS — you'll be prompted for the root password
# one last time:
ssh-copy-id root@<VPS_IP>

# Verify key auth works WITHOUT a password prompt:
ssh root@<VPS_IP> 'whoami'    # should print: root
```

If `ssh-copy-id` isn't available (older macOS without Homebrew), do it manually:

```bash
# On laptop:
cat ~/.ssh/id_ed25519.pub
# Copy the output, then on the VPS:
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<paste-pubkey-here>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**On the VPS**, disable password auth and harden `sshd`:

```bash
# Distro-agnostic. PasswordAuthentication=no is the line that matters;
# the rest is defense-in-depth.
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/'   /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/'  /etc/ssh/sshd_config
sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/'      /etc/ssh/sshd_config

# Ubuntu/Debian split sshd config across drop-ins; check none of them
# re-enable password auth:
grep -rE "^[^#]*PasswordAuthentication" /etc/ssh/sshd_config.d/ 2>/dev/null

# Common case on Ubuntu cloud images: /etc/ssh/sshd_config.d/50-cloud-init.conf
# ships with `PasswordAuthentication yes` and OVERRIDES the main config above
# (drop-ins win). If grep printed that line, flip it too:
[ -f /etc/ssh/sshd_config.d/50-cloud-init.conf ] && \
  sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config.d/50-cloud-init.conf

# Reload sshd. The unit name differs by distro; this handles both:
systemctl reload ssh 2>/dev/null || systemctl reload sshd
```

**Verify in a SECOND terminal** (keep the first ssh session open as a safety net in case you locked yourself out):

```bash
ssh root@<VPS_IP>                              # should land in, no password prompt
ssh -o PubkeyAuthentication=no root@<VPS_IP>   # should be: 'Permission denied (publickey).'
```

If both pass, password auth is off and only your private key works. Close the first session.

> **Back up your SSH private key now.** With password auth off, this key is the only way back in. If your laptop dies and `~/.ssh/id_ed25519` isn't somewhere else, you're locked out and will have to use the provider's console reset. Stash the private key in a password manager (`pass`, 1Password, Bitwarden) or on an encrypted USB. Convention: under `plato/vps/<domain>` if you use `pass`. Treat it the same as you'll treat `KNOWLESS_SECRET` later.

**Rename the host (optional but recommended).** Most VPS providers ship a placeholder hostname (`racknerd-XXXXX`, `vmi123456`, `ubuntu-2gb-...`). Rename it to your domain so the shell prompt is readable and `hostname -f` matches what postfix will advertise:

```bash
hostnamectl set-hostname $DOMAIN
hostname -f      # → $DOMAIN
```

The static hostname is set immediately; the shell prompt updates on next login. Ubuntu's default `PS1` shows `\h` (everything before the first dot), so a hostname of `forum.example.com` displays as `root@forum`.

> **Re-exporting env vars after re-login.** The `DOMAIN` / `ADMIN_EMAIL` / `PLATO_PORT` you set in Prerequisites only live in the original shell. After ssh'ing back in for verification, re-run the three `export` lines. The rest of the guide assumes they're set in the current session.

## Step 1 — Base system + Node + nginx + postfix + opendkim

**From this step onward, every command runs on the VPS** (`ssh root@<VPS_IP>`), not your laptop. After each ssh re-login, re-run the three `export DOMAIN=… ADMIN_EMAIL=… PLATO_PORT=…` lines from Prerequisites — they don't survive a session disconnect. If `apt` returns `command not found`, you're on a non-Debian laptop; ssh into the VPS first.

**Ubuntu 24.04 / Debian 12 (apt — primary path):**

Pre-seed `postfix` to skip its interactive setup dialog, then install everything in one shot:

```bash
# NEEDRESTART_MODE=a stops needrestart from hanging the upgrade with an
# interactive "which services to restart?" menu (Ubuntu 24.04 default).
# DEBIAN_FRONTEND=noninteractive keeps any package's debconf prompts silent.
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

apt -y update && apt -y upgrade

echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
echo "postfix postfix/mailname string $DOMAIN"               | debconf-set-selections

apt -y install \
  nginx certbot python3-certbot-nginx \
  sqlite3 git jq tar ufw \
  postfix opendkim opendkim-tools \
  vim curl ca-certificates gnupg

# Node 22 from NodeSource (Ubuntu's apt repo lags by 1–2 majors)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
```

**AlmaLinux 9 / RHEL 9 (dnf — needs EPEL for opendkim):**

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

**Fedora 38+ (dnf — homeserver path):**

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

`postfix` provides `/usr/sbin/sendmail` automatically on every distro — via `update-alternatives` on Debian/Ubuntu, `alternatives --set mta` on RHEL family. No second package needed for the sendmail interface that cron mail uses.

**Sanity (any distro):**

```bash
node --version            # v22.5+ required (--env-file flag)
sqlite3 --version         # any 3.x
which sendmail            # → /usr/sbin/sendmail
ls -l /usr/sbin/sendmail  # should resolve to postfix's sendmail
postconf mail_version     # postfix version
opendkim-genkey -V        # opendkim is installed
```

## Step 2 — Firewall

**Ubuntu / Debian (ufw — primary path):**

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'         # opens 80 + 443
ufw --force enable
ufw status verbose             # expect: 22, 80/tcp, 443/tcp ALLOW IN; defaults deny
```

**AlmaLinux / RHEL / Fedora (firewalld):**

```bash
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
firewall-cmd --list-services    # expect: ssh http https
```

## Step 3 — Mandatory access control (the easy-to-miss step)

**Ubuntu / Debian (AppArmor — primary path):**

Ubuntu ships AppArmor enabled, but the `nginx` package doesn't install an enforced profile by default — proxying to a localhost backend works out of the box. Sanity-check anyway so you know what you're looking at:

```bash
aa-status | grep nginx || echo "nginx unconfined under AppArmor — OK"
```

If you ever add a custom AppArmor profile for nginx, make sure it allows outbound TCP to `127.0.0.1`. Off the default install, nothing to do here.

**AlmaLinux / RHEL / Fedora (SELinux):**

SELinux runs in enforcing mode by default. nginx is forbidden from proxying to backends on `localhost` until you flip a boolean — you'll get 502s and waste an hour:

```bash
setsebool -P httpd_can_network_connect 1
getsebool httpd_can_network_connect    # → on
```

## Step 4 — Create the `plato` user and directory

plato runs as a non-root, non-login system user. systemd starts it; nothing logs in interactively.

```bash
useradd --system --create-home --home-dir /opt/plato --shell /sbin/nologin plato
ls -ld /opt/plato
# Expect: drwxr-x--- N plato plato ... /opt/plato (Ubuntu's HOME_MODE=0750
# default; equally secure for our purposes since group plato only contains
# the plato user).
```

## Step 5 — Configure postfix + opendkim + DNS

> **Verify session env first.** Step 5 is the longest sub-step block in this guide and almost every command depends on `$DOMAIN`. If you reconnected to the VPS since Prerequisites, the export is gone and you'll silently produce malformed configs (empty domain in `KeyTable`, keys generated in the wrong directory). Sanity:
>
> ```bash
> [ -n "$DOMAIN" ] && [ -n "$ADMIN_EMAIL" ] && echo "env OK: $DOMAIN / $ADMIN_EMAIL" \
>   || echo "MISSING ENV — re-run the export lines from Prerequisites"
> ```

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
systemctl status postfix --no-pager | head -3
# Expect: Active: active (running)
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

> **Back up `default.private` now.** It's the second sensitive key in this deploy (the SSH key was the first; `KNOWLESS_SECRET` is the third). If you lose it, you can't recover — you have to generate a new keypair, publish a new DKIM TXT record, and wait for propagation before mail signs again. Stash it in your password manager alongside the SSH key:
>
> ```bash
> # On your laptop, with the file scp'd down:
> scp root@<VPS_IP>:/etc/opendkim/keys/$DOMAIN/default.private /tmp/dkim.private
> pass insert -m plato/vps/$DOMAIN/dkim-default-private < /tmp/dkim.private
> shred -u /tmp/dkim.private    # don't leave it on the laptop disk
> ```

### 5.3 opendkim configuration

Edit `/etc/opendkim.conf`:

```bash
# Keep it minimal; defaults handle the rest.
sed -i 's|^Mode.*|Mode sv|'                                   /etc/opendkim.conf
sed -i 's|^#KeyFile.*|KeyFile /etc/opendkim/keys/default.private|' /etc/opendkim.conf
sed -i 's|^Selector.*|Selector default|'                      /etc/opendkim.conf

# Switch from single-key to KeyTable + listen on 127.0.0.1:8891 so postfix's
# milter (wired in 5.4) can reach opendkim. Ubuntu's package default is a
# UNIX socket, which postfix's `inet:` milter URI can't use.
cat >> /etc/opendkim.conf <<EOF
KeyTable        refile:/etc/opendkim/KeyTable
SigningTable    refile:/etc/opendkim/SigningTable
ExternalIgnoreList /etc/opendkim/TrustedHosts
InternalHosts   /etc/opendkim/TrustedHosts
Socket          inet:8891@localhost
EOF

# Ubuntu's /etc/default/opendkim ships a SOCKET= line that, if uncommented,
# overrides whatever opendkim.conf says. Make sure it's commented out:
if [ -f /etc/default/opendkim ]; then
  sed -i 's|^SOCKET=|#SOCKET=|' /etc/default/opendkim
fi

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

# `enable --now` is a no-op when the service is already running from the
# package install in Step 1, so use `restart` to pick up the new config:
systemctl enable opendkim
systemctl restart opendkim
sleep 1
systemctl status opendkim --no-pager | head -3
# Expect: Active: active (running) — start time within the last few seconds.

ss -lnt | grep ':8891'
# Expect: a LISTEN line on 127.0.0.1:8891 (the milter socket).
```

### 5.4 Wire opendkim into postfix as a milter

```bash
postconf -e "milter_default_action = accept"
postconf -e "milter_protocol = 6"
postconf -e "smtpd_milters = inet:127.0.0.1:8891"
postconf -e "non_smtpd_milters = inet:127.0.0.1:8891"

systemctl restart postfix
ss -lnt | grep ':8891'
# Expect: a LISTEN line for 127.0.0.1:8891 (opendkim's milter port).
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

> **While you're at the registrar — optional MX for Step 14.** If you plan to enable inbound aliases (`abuse@`, `postmaster@`, `feedback@`) per Step 14, add the MX record now too — saves a second registrar trip. One MX record at the apex with priority 10 pointing to `$DOMAIN.` (trailing dot, fully qualified). It's harmless to publish before postfix is reconfigured for inbound — mail will retry until you flip the switch in Step 14.

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
tail -50 /var/log/mail.log          # look for "DKIM-Signature" and "status=sent"
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

> **Operator polish (inbound aliases, reputation monitoring) is in Steps 14 + 15** — after plato is running. Get the forum live first.

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

> **Back up the secret to your password manager** alongside the SSH and DKIM keys. Convention if you use `pass`:
>
> ```bash
> # After generating in the next block, on your laptop:
> ssh root@<VPS_IP> 'cat /opt/plato/.env' | grep '^KNOWLESS_SECRET=' \
>   | cut -d= -f2- | pass insert -m plato/vps/$DOMAIN/knowless-secret
> ```
>
> A laptop with `pass plato/vps/$DOMAIN/{ssh,dkim,knowless}-*` is everything you need to recover the deploy after a VPS loss.

Use the helper script — pasting `node -e "..."` from memory is fragile across terminal-paste boundaries:

```bash
SECRET=$(sudo -u plato /opt/plato/bin/gen-secret.sh)
echo "secret length: ${#SECRET}"   # expect: 64

sudo tee /opt/plato/.env > /dev/null <<ENV
KNOWLESS_SECRET=$SECRET
KNOWLESS_BASE_URL=https://$DOMAIN
KNOWLESS_FROM=$FORUM_NAME <auth@$DOMAIN>
KNOWLESS_SMTP_HOST=localhost
KNOWLESS_SMTP_PORT=25
PORT=$PLATO_PORT
DB_PATH=/opt/plato/forum.db
ENV

sudo chown plato:plato /opt/plato/.env
sudo chmod 600 /opt/plato/.env
```

`KNOWLESS_FROM=$FORUM_NAME <auth@$DOMAIN>` produces e.g. `terribic <auth@terribic.com>` — the standard `Name <address>` format that mail libraries and recipients understand. Recipients see the friendly "terribic" instead of just the email address; SPF/DKIM/DMARC alignment still works (the `<address>` part is what matters for auth).

> **Homeserver / self-signed test note.** This guide assumes a public VPS with port 25 outbound and DNS at a registrar. On a residential homeserver (port 25 blocked by ISP, no public domain pointing at it), the postfix path won't deliver mail. Use plato in dev mode with `KNOWLESS_DEV_LOG_LINKS=true` (see `.env.dev`) — magic links print to stderr, you click them out of the log, you validate the auth flow without real mail. See the [Self-signed mode](#self-signed-mode-homeserver--lan-testing) appendix.

## Step 8 — Write `config.json`

`config.json` is the **forum-shape config** — what this instance *is*, as distinct from `.env` which holds secrets and process-level knobs. The split:

| File | Mode | Contents | Why separate |
|---|---|---|---|
| `.env` | 600 plato:plato | `KNOWLESS_SECRET`, ports, paths, SMTP host/port | secret-bearing → must be 600; one wrong shell-history command leaks the master HMAC key |
| `config.json` | 644 plato:plato | branding, operator alert email, rate-limit overrides, baseUrl for archives | no secrets → editable by branding/admin tooling, JSON-friendly for forks, version-controllable in your private ops repo |

Operators tweak branding *all the time*. They should never have to open the file with `KNOWLESS_SECRET` in it to do that.

Drop the file with sane defaults — every field below is required for either runtime correctness or operator-alert delivery. You can edit it anytime after launch and `systemctl restart plato`:

```bash
sudo -u plato -H tee /opt/plato/config.json > /dev/null <<EOF
{
  "branding": {
    "forumName": "your-forum-name",
    "tagline": "",
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

**Field walkthrough** (edit later, but ship with these defaults to get up and running):

- `branding.forumName` — header text + page title. Your forum's name.
- `branding.tagline` — sub-header text on the home page, immediately below `forumName`. Optional — set to `""` to omit. Examples: `"experiments in the open web"`, `"a small reading-room"`, `"terrible or terrific"`. Short and on-brand reads better than a sentence.
- `branding.hostedBy` — footer attribution. Convention: `@yourhandle` (your personal handle, not the forum's).
- `branding.feedbackEmail` — surfaced on `/about`. Where users send concerns; usually `$ADMIN_EMAIL`.
- `branding.baseUrl` — **required** for archive exports to embed working backlinks. Set to your `https://$DOMAIN`.
- `operator.email` — recipient for every cron alert (backup failures, weekly stats digest, cert expiry, /healthz failures). Usually `$ADMIN_EMAIL`.
- `operator.service` — systemd unit name to `systemctl restart` when a snapshot changes (disposable-domains refresh, etc.). Defaults to `plato`.

**Optional sections you can add later** (all have working defaults if absent):

- `rateLimits` — per-IP limits for login, post, comment, sub-create. See `operator-guide.md §Rate limits`.
- `linkCaps` — max links per post / comment, with floor enforcement. `operator-guide.md §Link cap`.
- `urlDisplayMax` — character count after which inline URLs collapse to the host. Default 56.
- `feedPageSize` — posts per home/sub feed page. Default 20.

Skip those for now — get plato up first, customize after.

**Verify it parses**:

```bash
node -e 'JSON.parse(require("fs").readFileSync("/opt/plato/config.json"))' && echo "config.json: OK"
# Expect: config.json: OK
```

## Step 9 — bootstrap.sh: install systemd + nginx + cron + logrotate

`deploy/bootstrap.sh` is the mechanical-only installer — it writes the system files that have only one right answer (systemd unit, nginx site, cron block, logrotate). It also creates the runtime directories plato writes to (`posts/`, `exports/`, `data/`) with the right ownership. It does **not** install packages, write secrets, or run certbot; you've already done those.

Run it before migrations + preflight, because preflight checks the runtime directories that bootstrap creates:

```bash
sudo DOMAIN=$DOMAIN ADMIN_EMAIL=$ADMIN_EMAIL PLATO_PORT=$PLATO_PORT \
  /opt/plato/deploy/bootstrap.sh
```

Expected output:
```
[bootstrap] domain=$DOMAIN admin=$ADMIN_EMAIL install=/opt/plato user=plato port=$PLATO_PORT
[bootstrap] user plato already exists       (or: creating system user plato)
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

## Step 10 — Run migrations + preflight, then start plato

`bootstrap.sh` created `posts/`, `exports/`, `data/` with `plato:plato` ownership in step 9 — that's why preflight runs *after* bootstrap, not before. Now create the SQLite schema and verify every prerequisite plato needs is in place:

```bash
sudo -u plato -H bash -c "cd /opt/plato && node --env-file=.env bin/migrate.js"
# Expect: 'applied N migration(s)' (currently 23). Idempotent — re-runs on
# every plato update; only runs the new migrations.

sudo -u plato -H bash -c "cd /opt/plato && bin/preflight.sh"
# Expect: ~10 OK lines, no FAIL. WARNs are tolerable — they flag dev-mode
# values (KNOWLESS_SMTP_PORT=1025) or missing optional pieces (postfix
# when you haven't done step 5 yet).
```

Any FAIL is a real problem; fix before continuing. Common ones:

- `FAIL .env not present at /opt/plato/.env` → step 7 didn't run as the right user.
- `FAIL KNOWLESS_SECRET is empty` → `bin/gen-secret.sh` was piped wrong; re-run step 7.
- `FAIL POSTS_DIR / EXPORTS_DIR does not exist` → bootstrap (step 9) didn't run, or didn't run as root.

Once preflight clears, start plato:

```bash
sudo systemctl enable --now plato
sudo systemctl status plato --no-pager | head -10
# Expect: Active: active (running) since ...
#         Main PID: NNNNN (node)
```

If status is `failed`, app-level errors went to `/var/log/plato.log`, *not* the journal — the systemd unit redirects plato's stdout/stderr there:

```bash
sudo tail -50 /var/log/plato.log     # plato's own console.log/error output
sudo journalctl -u plato -n 20       # systemd-level lifecycle messages only
```

The split is intentional: plato's mail-outcome hooks (`[plato mail.submit]` / `[plato mail.fail]` / `[plato mail.suppressed]`) and knowless's own log lines all end up in `/var/log/plato.log` for grep-friendly observability. journalctl only shows "started/stopped" systemd events.

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

> **If you get Ubuntu's stock 404 page instead of plato's healthz response**, the cause is `/etc/nginx/sites-enabled/default` — Ubuntu enables a catchall site (`server_name _; listen 80 default_server;`) that can intercept requests in some configurations. On a single-tenant VPS where plato is the only thing on :80, disable it:
>
> ```bash
> rm /etc/nginx/sites-enabled/default
> nginx -t && systemctl reload nginx
> curl -sS http://${DOMAIN}/healthz | jq .   # now expect plato's JSON response
> ```

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

## Step 14 — Inbound aliases (optional but recommended)

plato's mail design is outbound-only by default — postfix listens on loopback only, no MX record, no incoming. But two RFC 2142 addresses (`abuse@` and `postmaster@`) are expected for any SMTP-sending domain, and a `feedback@` address is what you'll surface on `/about` via `branding.feedbackEmail`. This step adds a small inbound forwarding surface so those addresses land in your real inbox.

**What you're adding:** postfix accepts mail for a fixed set of aliases at `$DOMAIN`, forwards each to your real inbox via `virtual_alias_maps`. No mailboxes on the VPS. Mail to any other `@$DOMAIN` address (e.g. `random@$DOMAIN`) is rejected with `550 user unknown` — strict, intentional.

**Recommended alias set** (each forwards to the same `$ADMIN_EMAIL` inbox; pick a subset):

| Alias | Purpose | Why include |
|---|---|---|
| `abuse@` | Abuse reports | **RFC 2142 — required** for any SMTP-sending domain |
| `postmaster@` | Mail issues + DMARC `rua`/`ruf` reports | **RFC 2142 — required**; receives DMARC aggregate reports |
| `feedback@` | Public feedback | Surfaced on `/about` via `branding.feedbackEmail` |
| `security@` | Security disclosures | Modern best practice (referenced by `security.txt`) |
| `support@` | Generic support | Optional; useful if you'll publicize one |
| `webmaster@` | Generic technical contact | RFC 2142 historical; optional |

**Tradeoffs:**

- **Spam.** Opening :25 inbound means `abuse@`/`postmaster@` will get spam alongside real mail. For low-volume operator inboxes this is tolerable. If it becomes a problem, layer postscreen + DNSBL (out of scope here).
- **SPF on forwards.** Mail forwarded from `random@somewhere` to your real inbox sees `$DOMAIN` as the sending IP at receive time, but the `From:` header still says `random@somewhere`. Some recipient mail systems fail this on SPF. SRS (sender-rewriting scheme) fixes it but is non-trivial; for low-volume aliases skip it.

### 14.1 Open inbound port 25

```bash
ufw allow 25/tcp comment 'inbound SMTP for forwarding aliases'
ufw status verbose | grep 25
```

### 14.2 MX record at your registrar

| Field | Value |
|---|---|
| Type | MX |
| Host | (apex; empty in Route 53) |
| Priority | 10 |
| Value | `$DOMAIN.` (note trailing dot — fully qualified) |
| TTL | 300 |

Verify after ~1 min:

```bash
dig +short MX $DOMAIN
# Expect: 10 $DOMAIN.
```

### 14.3 postfix reconfig

```bash
postconf -e "inet_interfaces = all"
postconf -e "mydestination = localhost"
postconf -e "virtual_alias_domains = \$mydomain"
postconf -e "virtual_alias_maps = hash:/etc/postfix/virtual"
```

`mydestination = localhost` (NOT `$myhostname` or `$mydomain`) means postfix won't accept mail destined for `random@$DOMAIN` as local — only the explicit aliases below get delivered.

### 14.4 Alias map

```bash
cat > /etc/postfix/virtual <<EOF
abuse@$DOMAIN       $ADMIN_EMAIL
postmaster@$DOMAIN  $ADMIN_EMAIL
feedback@$DOMAIN    $ADMIN_EMAIL
security@$DOMAIN    $ADMIN_EMAIL
EOF

postmap /etc/postfix/virtual
ls -l /etc/postfix/virtual /etc/postfix/virtual.db   # both should exist
systemctl restart postfix
```

Re-run `postmap /etc/postfix/virtual` any time you edit the source file (it regenerates `virtual.db`).

### 14.5 Test the round-trip

From an external mailbox (your phone's gmail, a different account, etc.), send a message **to `abuse@$DOMAIN`**. Within ~30s:

- Check your real inbox (`$ADMIN_EMAIL`) — message should arrive
- Confirm postfix logs show the inbound + forward:

```bash
tail -30 /var/log/mail.log
# Expect: a postfix/smtpd line with `connect from <sender>`, then
# postfix/smtp showing forward to gmail-smtp-in with status=sent.
```

If the message bounces with `550 user unknown`, `postmap /etc/postfix/virtual` didn't run or `virtual_alias_maps` isn't set. If nothing arrives at all, MX record hasn't propagated or ufw isn't allowing :25.

## Step 15 — Sender reputation monitoring (optional, free)

Both Google and Microsoft offer free dashboards that show how their networks see your domain — complaint rates, authentication pass rates, IP reputation, spam-trap hits. Worth signing up for both before you start sending real magic links to users on those networks.

| Service | What it shows | Signup |
|---|---|---|
| **Google Postmaster Tools** | Per-domain reputation, IP reputation, SPF/DKIM/DMARC pass rates, spam complaint rate, encryption rate, delivery errors | https://postmaster.google.com/ — verify your domain via a TXT record |
| **Microsoft SNDS** (Smart Network Data Services) | Per-IP data for Outlook/Hotmail/Live: spam-trap hits, complaint rates, recipient-rejection rates | https://sendersupport.olc.protection.outlook.com/snds/ — sign up with your VPS IP |
| **Microsoft JMRP** (Junk Mail Reporting Program) | Forwards every Outlook/Hotmail user-reported spam complaint about your domain to a feedback address (sign up at the same SNDS portal — separate enrollment within it) | Same portal as SNDS, separate enrollment |

Both are read-only — you can't change anything, only monitor. The value is early warning: when reputation starts trending bad (e.g., one user complains), you see it in days rather than discovering it because Gmail has been silently sending your magic links to spam for a week.

---

## Routine operations

| Task | Command |
|---|---|
| Restart plato | `systemctl restart plato` |
| Tail plato app output | `tail -f /var/log/plato.log` (mail hooks, knowless lines, request errors) |
| Tail plato systemd events | `journalctl -u plato -f` (start/stop/crash; not app output) |
| Tail mail logs | `tail -f /var/log/mail.log` (or `journalctl -u postfix -f`) |
| Inspect mail queue | `mailq` (deferred mail) / `postqueue -f` (force flush) |
| Check health | `curl -sS https://$DOMAIN/healthz \| jq .` |
| Pre-start sanity check | `sudo -u plato bash -c 'cd /opt/plato && bin/preflight.sh'` |
| Cert expiry probe | `cd /opt/plato && DOMAIN=$DOMAIN bin/check-cert.sh` |
| Run a backup now | `sudo -u plato BACKUP_DIR=/var/lib/plato-backups /opt/plato/bin/backup.sh` |
| Re-render system files | `sudo DOMAIN=$DOMAIN ADMIN_EMAIL=$ADMIN_EMAIL PLATO_PORT=$PLATO_PORT /opt/plato/deploy/bootstrap.sh` |
| Update plato | see [Updating plato](#updating-plato) |
| Read modlog | `https://$DOMAIN/modlog` (publicly visible) |

### Updating plato

For production deploys tracking `main` (e.g. early-stage or pre-v1):

```bash
# 1. Pull the latest source as the plato user:
sudo -u plato -H bash -c 'cd /opt/plato && git pull origin main'

# 2. Refresh dependencies if package.json changed (cheap if it didn't):
sudo -u plato -H bash -c 'cd /opt/plato && npm ci --omit=dev'

# 3. Apply any new migrations (idempotent — safe even if there are none):
sudo -u plato -H bash -c 'cd /opt/plato && node --env-file=.env bin/migrate.js'

# 4. Restart the service:
sudo systemctl restart plato

# 5. Verify the new version is live (three independent checks):
sudo -u plato -H bash -c 'cd /opt/plato && git log -1 --oneline'      # commit on disk
curl -sS https://${DOMAIN}/healthz | jq '{ok, version, last_migration}'    # version served
sudo tail -10 /var/log/plato.log | grep "plato v"                     # version logged at startup
# (journalctl -u plato shows lifecycle events; plato's own console.log
#  is redirected to /var/log/plato.log by the systemd unit — that's
#  where the startup banner lands.)
```

The footer of every page also shows `v<version>` next to the modlog link — eyeball check after refreshing the browser.

**Pinning to a tag for stable deploys** (recommended once plato has tagged releases):

```bash
sudo -u plato -H bash -c 'cd /opt/plato && git fetch origin && git checkout v0.X.Y'
# then steps 2–5 above
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
| `/var/log/mail.log` | root | postfix + opendkim outbound delivery log |

### Backups, in plain English

`bin/backup.sh` writes one `plato-backup-<date>.tar.gz` per night to `/var/lib/plato-backups/`, keeping the newest 7 (default `BACKUP_KEEP=7`). It uses SQLite's online `.backup` API so you don't have to stop the server. Inside the tarball: `forum.db`, `knowless.db`, `posts/`, `exports/`, `config.json`, `spam-patterns.txt`, `data/urlhaus.txt`, `disposable-domains.txt`.

To rotate copies off the host, edit the commented `rsync` stanza at the bottom of `bin/backup.sh` to point at your laptop or an offsite machine. We don't bake key management into plato.

To restore: stop the server, untar, copy `forum.db` + `posts/` over the live ones, restart. **The `KNOWLESS_SECRET` in your restored `.env` must match the value at the time of backup** — otherwise every user's identity hash shifts and they look like new accounts.

---

## Troubleshooting

### Magic link doesn't arrive

```bash
# 1. Did plato try to send it?
sudo tail -100 /var/log/plato.log | grep -iE "mail|knowless"
# Look for [plato mail.fail] (knowless onTransportFailure hook) — message
# carries the SMTP-level reason. Sibling [plato mail.submit] lines confirm
# successful submissions. [plato mail.suppressed] lines are the heartbeat
# for sham/rate-limited windows.
#
# (NOTE: this is in /var/log/plato.log, not journalctl — plato's
# console output is redirected there by the systemd unit. journalctl -u
# plato only shows lifecycle events.)

# 2. Did postfix accept and deliver?
tail -100 /var/log/mail.log
mailq                              # any deferred mail?

# 3. Inspect a specific queued message:
postqueue -p                       # list queue IDs
postcat -q <queue-id>              # show the message + headers

# 4. Is the sendmail interface itself broken?
echo "Subject: test from $(hostname)" | sendmail -f $ADMIN_EMAIL $ADMIN_EMAIL
echo "exit: $?"
tail -10 /var/log/mail.log
```

Common causes:

- **`status=deferred ... Connection refused`**: postfix can't reach the recipient's MX. Usually port 25 outbound is blocked by your VPS provider — open a support ticket, or pick a different provider.
- **`status=bounced ... Reverse DNS check failed`**: PTR record at the VPS provider doesn't match `myhostname` in postfix's `main.cf`. Set the PTR.
- **Mail goes to spam, headers show `dkim=fail`**: the DKIM TXT record at the registrar doesn't match the public key opendkim is signing with. Re-publish from `cat /etc/opendkim/keys/$DOMAIN/default.txt` (and watch out for line-folding; it must be a single TXT value).
- **Mail goes to spam, headers show `dmarc=fail (alignment)`**: `KNOWLESS_FROM` domain doesn't match the SPF/DKIM domain. They must agree. If `KNOWLESS_FROM=auth@$DOMAIN`, then SPF must authorize `$DOMAIN` and DKIM must sign as `$DOMAIN` — easy when you set them all consistently per Step 5.
- **`opendkim: ... no signing table match`**: SigningTable doesn't include the From address. Edit `/etc/opendkim/SigningTable`, restart opendkim.
- **No `DKIM-Signature` header at all**: `non_smtpd_milters` isn't set in `main.cf`, so locally-submitted mail (knowless's path) bypasses opendkim. Re-run the postconf line in 5.4.

### `/healthz` returns 404 (or curl -I returns 404 but curl works fine)

Pre-0.11.1 the `/healthz` route only matched `GET`, so any monitor or `curl -I` doing a `HEAD` request fell through to the catch-all 404. Same gotcha applied to `/static/*` (link-preview validators that probe `og.png` with HEAD before fetching). Fixed in 0.11.1; both routes now answer GET and HEAD. If you see this on a deployed instance, you're on a release < 0.11.1 — pull main and restart.

### `/healthz` returns 502

nginx can't reach the backend. In order:

```bash
systemctl status plato                    # is plato up?
ss -tlnp | grep 8080                      # is plato actually listening?

# RHEL-family only:
getsebool httpd_can_network_connect       # did you do step 3? expect: on

# Ubuntu/Debian only:
aa-status | grep nginx                    # expect: nothing (nginx unconfined)
```

On AlmaLinux/RHEL/Fedora, the SELinux boolean is the most-common 502 cause — re-run `setsebool -P httpd_can_network_connect 1`. On Ubuntu, AppArmor doesn't block this by default, so a 502 there points at plato itself or nginx config — read `journalctl -u nginx | tail -20` and `journalctl -u plato | tail -20`.

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
tail -20 /var/log/mail.log
```

If that fails, postfix is broken — go back to step 5. If only cron's mail fails (but magic-link mail works), check `/etc/cron.d/plato`'s `MAILTO=` line.

### plato won't start

```bash
# Lifecycle events (start failed, segfault, OOM, restart loop):
sudo journalctl -u plato -n 100 --no-pager

# App-level errors (most "won't start" reasons land here, not in journal):
sudo tail -100 /var/log/plato.log
```

Three things to look for in `/var/log/plato.log`:

1. **`auth: KNOWLESS_SECRET is required`** — `.env` is missing or unreadable by the `plato` user. Check `ls -l /opt/plato/.env` (must be 600 plato:plato).
2. **`Error: ENOENT: no such file or directory, open '.../forum.db'`** — you skipped migrations. `sudo -u plato -H bash -c "cd /opt/plato && node --env-file=.env bin/migrate.js"`.
3. **`Error: listen EADDRINUSE`** — another process holds your `PLATO_PORT`. `ss -tlnp | grep $PLATO_PORT` to find it.

### "Why is everyone signed out / new identities everywhere"

You changed `KNOWLESS_SECRET`. Restore the previous value from a backup `.env`. Identity is HMAC-derived from this secret — there is no recovery path other than restoring the prior value.

### `git pull` fails with "fatal: detected dubious ownership in repository at '/opt/plato'"

You ran `git pull` as `root` while `/opt/plato` is owned by `plato:plato`. Git's CVE-2022-24765 ownership check is firing — by design.

**The fix is the upgrade recipe in [Updating plato](#updating-plato), not a config workaround.** Always run the git + npm + migrate steps as `sudo -u plato -H bash -c '...'` so writes stay under one uid. Mixing root-git-pulls with plato-user-npm-runs is what creates the lockfile-drift symptom (`error: Your local changes to package-lock.json would be overwritten by merge`) — root and plato keep stepping on each other's working tree.

If you've already drifted: discard the local lockfile (`sudo -u plato -H bash -c 'cd /opt/plato && git checkout -- package-lock.json'`), then run the canonical recipe.

If you genuinely need to operate as root for some reason (single-user box, throwaway instance), the one-line bypass is:

```bash
git config --global --add safe.directory /opt/plato   # /root/.gitconfig
```

This disables the ownership check for `/opt/plato` only. Don't use it on shared / production boxes — it's an exit hatch, not the right pattern. The recipe in the upgrade section is.

### Already deployed as root and now `git pull` / `npm ci` fail with `EACCES` or `insufficient permission for adding an object to repository database`

You took the safe.directory exit hatch (or just ran `git pull` / `npm ci` as root before reading this) and now `/opt/plato` is uid-mixed: some files in `.git/objects/` and `node_modules/` are owned by `root`, others by `plato`. Git can't write new objects, npm can't unlink old binaries. The service is fine (plato runs as `plato`, reads files it can read); only updates are blocked.

One chown rewrites every file back to `plato:plato` — cheap, idempotent, doesn't restart the service:

```bash
sudo chown -R plato:plato /opt/plato
```

Then run the canonical upgrade recipe. The service keeps serving the running version throughout — `chown` doesn't touch open file descriptors, and the systemd unit isn't restarted until step 4.

If you also see `error: Your local changes to package-lock.json would be overwritten by merge`, that's the same root cause showing up at a different layer — `npm install` (run as one uid) wrote a lockfile diff that `git pull` (run as another uid) refuses to overwrite. After the chown, discard the drifted lockfile (`sudo -u plato -H bash -c 'cd /opt/plato && git checkout -- package-lock.json'`) and retry the recipe; the lockfile in the repo is the canonical truth.

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
- [ ] Firewall allows only 22/80/443 (`ufw status` on Ubuntu, `firewall-cmd --list-services` on RHEL).
- [ ] SSH password auth is off (`PasswordAuthentication no`) and you authenticate with a key — set in Step 0.
- [ ] Your laptop SSH private key (`~/.ssh/id_ed25519`) is backed up in a password manager or encrypted USB. With password auth off, losing this key = console-reset to recover.
- [ ] `KNOWLESS_SECRET` is backed up somewhere you trust (password manager, encrypted USB). Losing it ≈ losing every user.
- [ ] `git remote -v` in `/opt/plato` matches the upstream you intended.
- [ ] The first signed-in user on the live site is *you* — that establishes you as the de-facto admin in the modlog.

## What this guide intentionally doesn't do

- **Configure fail2ban / SSH brute-force protection.** That's a host-hardening concern unrelated to plato; pick your own SSH-hardening playbook (most distros' default policies are already fine for a 1-VPS hobby setup behind a private SSH key).
- **Set up monitoring beyond `/healthz`.** A monthly $0 ping from UptimeRobot or BetterStack on the public URL is plenty for a hobby forum. The `/healthz` endpoint is what they should hit.
- **Use a vendor SMTP relay** (Mailgun / Postmark / SES). knowless deliberately doesn't bless this — see [knowless PRD §16.2 "one mail purpose"](https://github.com/hamr0/knowless/blob/main/PRD.md). On a VPS that allows outbound :25, postfix delivering direct is cleaner: no third-party trust, no cred rotation, no vendor lock-in. If your provider blocks :25 and won't unblock, you've stepped off the supported path — `transportOverride` exists in knowless as an escape hatch but isn't documented as a path the project supports.
- **Configure fail2ban for postfix.** Postfix on `loopback-only` interfaces isn't an attack surface from outside the box, so the standard postfix fail2ban jails don't apply. If you change `inet_interfaces` to listen on the public IP (don't), then yes.

## Appendix: Homeserver / LAN smoke (auth-flow only)

For deploys where certbot can't help — private hostnames (`homelab`, `federver`), RFC1918 IPs, split-horizon DNS, a developer laptop, internal staging — this is a self-contained walkthrough that skips the postfix path. **No real mail delivery**: most residential ISPs block port 25 outbound, so the production mail stack can't work here. Magic links land in `/var/log/plato.log` instead, and you click them out of the log.

This validates the **auth flow + UI + observability hooks**. Real mail delivery, SPF/DKIM/DMARC, and cron alerting all need a VPS to validate.

### What you keep when you migrate to a real VPS

- `KNOWLESS_SECRET`, `config.json`, posts/, exports/, forum.db
- systemd unit, /etc/cron.d/plato, /etc/logrotate.d/plato

### What you redo on the VPS

- nginx config (certbot replaces self-signed)
- Step 5 (postfix + opendkim + DNS) — entirely new against your real domain
- `KNOWLESS_DEV_LOG_LINKS` flips back to default (off)

### Step A1 — Set context

```bash
export DOMAIN=federver               # your hostname (or whatever resolves on LAN)
export ADMIN_EMAIL=you@example.com   # for cron alerts; magic links never land here
export PLATO_PORT=8090               # 8080 is often taken on shared boxes
```

If `:80` is already taken (AdGuard / Pi-hole / Home Assistant / another tenant), check first:

```bash
sudo ss -tlnp 'sport = :80'
# Expect either: empty (nginx can have :80) or listing of the conflicting service.
```

### Step A2 — Disable nginx's stock `:80` server block (only if `:80` is taken)

Skip this on a real VPS — nginx owning :80 with HTTP→HTTPS redirect is the production default.

If `:80` is taken on this box (e.g. AdGuard owns it):

```bash
sudo /opt/plato/deploy/disable-nginx-default-server.sh
# Expect:
#   [disable-nginx-default-server] backed up /etc/nginx/nginx.conf → ...preplato
#   [disable-nginx-default-server] commented :80 server block(s) ...
#   [disable-nginx-default-server] nginx -t: passes
```

To reverse later: `sudo cp /etc/nginx/nginx.conf.preplato /etc/nginx/nginx.conf`.

### Step A3 — Steps 1–4 from the main guide

Run main-guide Steps 1 (packages — postfix/opendkim are optional in dev mode but installing them is fine), 2 (firewall), 3 (SELinux), 4 (plato user) verbatim. Skip Step 5 (postfix + DNS) entirely.

### Step A4 — Steps 6–8 from the main guide, with dev-mode `.env`

Step 6 (clone) and Step 8 (config.json) run verbatim. Step 7's `.env` template gets two extra lines for dev-mode behavior:

```bash
SECRET=$(sudo -u plato /opt/plato/bin/gen-secret.sh)
echo "secret length: ${#SECRET}"
# Expect: 64

sudo tee /opt/plato/.env > /dev/null <<ENV
KNOWLESS_SECRET=$SECRET
KNOWLESS_BASE_URL=https://$DOMAIN
KNOWLESS_FROM=auth@$DOMAIN
KNOWLESS_SMTP_HOST=localhost
KNOWLESS_SMTP_PORT=1025
KNOWLESS_DEV_LOG_LINKS=true
KNOWLESS_COOKIE_SECURE=false
PORT=$PLATO_PORT
DB_PATH=/opt/plato/forum.db
ENV
sudo chown plato:plato /opt/plato/.env
sudo chmod 600 /opt/plato/.env
```

The two dev-mode lines:
- `KNOWLESS_DEV_LOG_LINKS=true` — when SMTP submit fails (it will, since :1025 is unbound), knowless prints the magic link to stderr → `/var/log/plato.log`.
- `KNOWLESS_COOKIE_SECURE=false` — cookies work over self-signed HTTPS without strict-secure flag (browsers reject Secure cookies on cert-not-trusted origins).

### Step A5 — Bootstrap, then migrations + preflight

```bash
sudo DOMAIN=$DOMAIN ADMIN_EMAIL=$ADMIN_EMAIL PLATO_PORT=$PLATO_PORT \
  /opt/plato/deploy/bootstrap.sh
# Expect: WARNs about postfix + opendkim missing (we're not using them);
# the rest renders normally.

sudo -u plato -H bash -c "cd /opt/plato && node --env-file=.env bin/migrate.js"
# Expect: applied 23 migration(s)

sudo -u plato -H bash -c "cd /opt/plato && bin/preflight.sh"
# Expect: 2 WARNs (postfix not installed, KNOWLESS_SMTP_PORT=1025 dev fallback);
# no FAILs.
```

### Step A6 — Self-signed cert + nginx (443-only template)

```bash
sudo CN=$DOMAIN /opt/plato/deploy/gen-selfsigned-cert.sh
# Expect: cert at /etc/pki/tls/certs/plato.crt, key at /etc/pki/tls/private/plato.key

DOMAIN=$DOMAIN PLATO_PORT=$PLATO_PORT \
  envsubst '${DOMAIN} ${PLATO_PORT}' \
  < /opt/plato/deploy/plato.nginx-selfsigned.template \
  | sudo tee /etc/nginx/conf.d/plato.conf > /dev/null

sudo nginx -t
# Expect: configuration file /etc/nginx/nginx.conf test is successful

sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

### Step A7 — Start plato + smoke

```bash
sudo systemctl enable --now plato
sleep 2
sudo systemctl status plato --no-pager | head -10
# Expect: Active: active (running)

curl -sSk https://$DOMAIN/healthz
# Expect: {"ok":true,"version":"...","db_writable":true,"exports_dir_writable":true,...}

# Trigger a magic-link send. POST returns 200 even when SMTP fails
# (silent-miss design protects against email enumeration).
curl -sSk -X POST https://$DOMAIN/login \
  --data-urlencode "email=$ADMIN_EMAIL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -o /dev/null -w "HTTP: %{http_code}\n"
# Expect: HTTP: 200

# The magic link landed in plato.log (NOT journalctl — see Routine ops):
sudo tail -10 /var/log/plato.log
# Expect to see:
#   [knowless] mail submit failed: connect ECONNREFUSED ::1:1025
#   [plato mail.fail] ts=... connect ECONNREFUSED ::1:1025
#   [knowless dev:auth@$DOMAIN] magic link: https://$DOMAIN/auth/callback?t=...
#
# The first two lines are the observability hooks firing as intended.
# The third line is the magic link — copy the full URL.
```

### Step A8 — Browser validation

From a machine on the same LAN that can resolve `$DOMAIN` (or with a hosts-file entry):

1. Visit `https://$DOMAIN`. Browser warns about the self-signed cert. Accept it.
2. Paste the magic-link URL from `/var/log/plato.log` into the address bar.
3. You should land logged in. Header shows your handle.
4. Smoke the rest: create a sub at `/sub/create`, write a post, hit `/modlog`, hit `/healthz`.

If any of those break, the logs are in `/var/log/plato.log` and `/var/log/plato-*.log` for cron jobs.

### Teardown

```bash
sudo /opt/plato/deploy/teardown.sh --yes-data
# If you ran disable-nginx-default-server.sh:
sudo cp /etc/nginx/nginx.conf.preplato /etc/nginx/nginx.conf
sudo systemctl reload nginx
```

## Where to read next

- [`operator-guide.md`](operator-guide.md) — full operator reference: every config knob, every cron job, every threshold, every locked decision.
- [`cron-jobs.md`](cron-jobs.md) — per-cron deep dive: what runs, what mails, what restarts.
- [`plato.context.md`](plato.context.md) — developer integration view: routes, schema, sub state model.
- [`m5-mod-surface-spec.md`](../01-product/m5-mod-surface-spec.md) — moderation surface architecture (read this before changing modlog code).
