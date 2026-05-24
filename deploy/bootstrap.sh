#!/usr/bin/env bash
# deploy/bootstrap.sh — idempotent mechanical install for plato.
#
# What it does (the deterministic stuff that has only one right answer):
#   - creates the `plato` system user + INSTALL_DIR
#   - renders deploy/plato.service.template  → /etc/systemd/system/plato.service
#   - renders deploy/plato.nginx.template    → /etc/nginx/conf.d/plato.conf
#   - renders deploy/plato.cron              → /etc/cron.d/plato
#   - copies   deploy/plato.logrotate        → /etc/logrotate.d/plato
#   - creates BACKUP_DIR + /var/log/plato.log
#   - sets SELinux httpd_can_network_connect (no-op on non-SELinux hosts)
#   - daemon-reloads systemd
#
# What it does NOT do (the operator must own these decisions):
#   - install packages (node, nginx, certbot, postfix, opendkim, sqlite — see deploy-guide.md)
#   - configure postfix + opendkim, generate DKIM key, paste DNS records
#   - generate KNOWLESS_SECRET, write .env, write config.json
#   - run npm ci or migrations
#   - run certbot (issuance is a one-time interactive ACME exchange)
#   - start plato or nginx
#
# Re-runnable. Running it again after editing a template re-renders the
# installed file. Does NOT touch INSTALL_DIR contents (your db, posts/,
# config.json) — only system-level files outside it.
#
# Usage:
#   sudo DOMAIN=forum.example.com ADMIN_EMAIL=you@example.com ./deploy/bootstrap.sh
#
# Co-tenant flags — for a box already serving another app on nginx + postfix
# (e.g. plato sharing a VPS with another site). They make bootstrap additive
# instead of all-or-nothing, so it never clobbers the neighbour:
#   --skip-nginx   don't write /etc/nginx/conf.d/plato.conf; you add plato's
#                  server block to your existing nginx and own its cert.
#   --skip-mail    don't probe postfix/opendkim; you run mail ADDITIVELY —
#                  add a DKIM key + SigningTable line for $DOMAIN only, never
#                  the destructive deploy-guide §5 inet_interfaces step.
#   --co-tenant    shorthand for --skip-nginx --skip-mail.
# The always-safe shared steps (user, INSTALL_DIR, systemd unit, cron,
# logrotate, runtime dirs) run regardless. See deploy-guide § Co-tenant deploy.
#
# Optional env (sane defaults):
#   INSTALL_DIR=/opt/plato
#   PLATO_USER=plato
#   BACKUP_DIR=/var/lib/plato-backups
#   PLATO_PORT=8080      (must match PORT= in $INSTALL_DIR/.env)

set -euo pipefail

# ─── Flags ─────────────────────────────────────────────────────────────
# Co-tenant flags, for a box already serving another app on nginx + postfix.
# Both default off (single-app box: bootstrap owns the nginx vhost and probes
# the mail stack). See the header comment / deploy-guide § Co-tenant deploy.
SKIP_NGINX=0
SKIP_MAIL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-nginx) SKIP_NGINX=1 ;;
    --skip-mail)  SKIP_MAIL=1 ;;
    --co-tenant)  SKIP_NGINX=1; SKIP_MAIL=1 ;;
    -h|--help)    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "bootstrap.sh: unknown argument: $1 (try --help)" >&2; exit 1 ;;
  esac
  shift
done

# ─── Inputs ────────────────────────────────────────────────────────────
: "${DOMAIN:?Set DOMAIN=forum.example.com}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL=you@example.com}"
INSTALL_DIR="${INSTALL_DIR:-/opt/plato}"
PLATO_USER="${PLATO_USER:-plato}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/plato-backups}"
PLATO_PORT="${PLATO_PORT:-8080}"

# Resolve where we live so the template paths work no matter where the
# script is invoked from.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

# ─── Sanity ────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "bootstrap.sh: must run as root (try: sudo $0)" >&2
  exit 1
fi

for tool in envsubst systemctl; do
  if ! command -v "$tool" >/dev/null; then
    echo "bootstrap.sh: missing required tool: $tool" >&2
    exit 1
  fi
done

for tpl in plato.service.template plato.nginx.template plato.cron plato.logrotate; do
  if [[ ! -f "$SCRIPT_DIR/$tpl" ]]; then
    echo "bootstrap.sh: missing template: $SCRIPT_DIR/$tpl" >&2
    exit 1
  fi
done

echo "[bootstrap] domain=$DOMAIN admin=$ADMIN_EMAIL install=$INSTALL_DIR user=$PLATO_USER port=$PLATO_PORT skip_nginx=$SKIP_NGINX skip_mail=$SKIP_MAIL"

# ─── User + directory ─────────────────────────────────────────────────
if id -u "$PLATO_USER" >/dev/null 2>&1; then
  echo "[bootstrap] user $PLATO_USER already exists"
else
  echo "[bootstrap] creating system user $PLATO_USER"
  useradd --system --create-home --home-dir "$INSTALL_DIR" --shell /sbin/nologin "$PLATO_USER"
fi

# Don't touch contents if INSTALL_DIR already has plato in it; just ensure
# top-level ownership is correct.
mkdir -p "$INSTALL_DIR"
chown "$PLATO_USER:$PLATO_USER" "$INSTALL_DIR"

mkdir -p "$BACKUP_DIR"
chown "$PLATO_USER:$PLATO_USER" "$BACKUP_DIR"

# plato writes to posts/ and exports/ at runtime; bootstrap creates
# them with plato ownership so they survive systemd's ProtectSystem
# sandbox (which permits writes only to ReadWritePaths). preflight.sh
# deliberately doesn't mkdir these — when run as root that would land
# the dirs as root:root, blocking plato silently.
mkdir -p "$INSTALL_DIR/posts" "$INSTALL_DIR/exports" "$INSTALL_DIR/data"
chown -R "$PLATO_USER:$PLATO_USER" \
  "$INSTALL_DIR/posts" "$INSTALL_DIR/exports" "$INSTALL_DIR/data"

touch /var/log/plato.log
chown "$PLATO_USER:$PLATO_USER" /var/log/plato.log

# ─── Mail readiness check ─────────────────────────────────────────────
#
# knowless connects to localhost:25 — that means postfix (or another MTA)
# must be installed and listening. opendkim signs outbound mail so it
# clears DKIM at recipient ISPs. Bootstrap doesn't install or configure
# either (operator decisions: relay vs direct delivery, DKIM key rotation,
# DNS records); it just warns when they're missing.
if [[ "$SKIP_MAIL" -eq 1 ]]; then
  echo "[bootstrap] --skip-mail: not probing postfix/opendkim — you run mail"
  echo "             additively (add a DKIM key + SigningTable line for $DOMAIN"
  echo "             only; never the destructive deploy-guide §5 main.cf step)."
else
  if ! command -v postconf >/dev/null 2>&1; then
    echo "[bootstrap] WARN: postfix not installed — magic-link mail will fail"
    echo "             (install postfix + opendkim per deploy-guide §5)"
  fi
  if ! command -v opendkim-genkey >/dev/null 2>&1; then
    echo "[bootstrap] WARN: opendkim not installed — outbound mail will deliver"
    echo "             unsigned and land in spam (install per deploy-guide §5)"
  fi
fi

# ─── Render templates ─────────────────────────────────────────────────
# envsubst with an explicit whitelist so nginx's own $host / $remote_addr
# variables aren't expanded as shell vars.

echo "[bootstrap] writing /etc/systemd/system/plato.service"
INSTALL_DIR="$INSTALL_DIR" PLATO_USER="$PLATO_USER" \
  envsubst '${INSTALL_DIR} ${PLATO_USER}' \
  < "$SCRIPT_DIR/plato.service.template" \
  > /etc/systemd/system/plato.service
chmod 644 /etc/systemd/system/plato.service

if [[ "$SKIP_NGINX" -eq 1 ]]; then
  echo "[bootstrap] --skip-nginx: leaving /etc/nginx/conf.d/plato.conf to you"
  echo "             (add a server block for $DOMAIN → 127.0.0.1:$PLATO_PORT to"
  echo "             your existing nginx; template at deploy/plato.nginx.template)"
else
  echo "[bootstrap] writing /etc/nginx/conf.d/plato.conf"
  DOMAIN="$DOMAIN" PLATO_PORT="$PLATO_PORT" \
    envsubst '${DOMAIN} ${PLATO_PORT}' \
    < "$SCRIPT_DIR/plato.nginx.template" \
    > /etc/nginx/conf.d/plato.conf
  chmod 644 /etc/nginx/conf.d/plato.conf
fi

echo "[bootstrap] writing /etc/cron.d/plato"
INSTALL_DIR="$INSTALL_DIR" ADMIN_EMAIL="$ADMIN_EMAIL" DOMAIN="$DOMAIN" BACKUP_DIR="$BACKUP_DIR" \
  envsubst '${INSTALL_DIR} ${ADMIN_EMAIL} ${DOMAIN} ${BACKUP_DIR}' \
  < "$SCRIPT_DIR/plato.cron" \
  > /etc/cron.d/plato
chmod 644 /etc/cron.d/plato

echo "[bootstrap] writing /etc/logrotate.d/plato"
cp "$SCRIPT_DIR/plato.logrotate" /etc/logrotate.d/plato
chmod 644 /etc/logrotate.d/plato

# ─── SELinux (AlmaLinux / RHEL / Fedora) ──────────────────────────────
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce)" == "Enforcing" ]]; then
  echo "[bootstrap] SELinux enforcing — setting httpd_can_network_connect"
  setsebool -P httpd_can_network_connect 1
  if [[ -d "$INSTALL_DIR" ]] && command -v restorecon >/dev/null 2>&1; then
    restorecon -R "$INSTALL_DIR" 2>/dev/null || true
  fi
else
  echo "[bootstrap] SELinux not enforcing — skipping setsebool"
fi

# ─── Daemon reload ────────────────────────────────────────────────────
systemctl daemon-reload

# ─── Done ─────────────────────────────────────────────────────────────
# Closing summary adapts to the co-tenant flags — the nginx file line and the
# mail / nginx "by hand" steps differ when the operator owns those layers.
if [[ "$SKIP_NGINX" -eq 1 ]]; then
  nginx_file="  /etc/nginx/conf.d/plato.conf   — SKIPPED (--skip-nginx; you own the vhost)"
  nginx_steps="  7. add a server block for $DOMAIN -> 127.0.0.1:$PLATO_PORT to your existing
     nginx (template: deploy/plato.nginx.template), then: nginx -t && systemctl reload nginx
  8. certbot --nginx -d $DOMAIN -m $ADMIN_EMAIL --agree-tos -n   (additive: your other
     vhost + cert stay untouched)"
else
  nginx_file="  /etc/nginx/conf.d/plato.conf"
  nginx_steps="  7. nginx -t && systemctl enable --now nginx
  8. certbot --nginx -d $DOMAIN -m $ADMIN_EMAIL --agree-tos -n --redirect"
fi

if [[ "$SKIP_MAIL" -eq 1 ]]; then
  mail_step="  1. mail — ADDITIVE only (postfix already serves your other app): do NOT run
     deploy-guide §5 (inet_interfaces=loopback-only + mydestination/virtual_transport
     rewrites would sever the co-tenant). Add ONLY an opendkim key + KeyTable/SigningTable
     lines for *@$DOMAIN, restart opendkim, publish SPF/DKIM/DMARC for $DOMAIN.
     See deploy-guide.md § Co-tenant deploy."
else
  mail_step="  1. postfix + opendkim — install, configure, generate DKIM key, paste DNS
     records (SPF / DKIM / DMARC) at registrar. See deploy-guide.md §5 (+ knowless OPS.md §5)."
fi

cat <<EOF

[bootstrap] done.

Files installed:
  /etc/systemd/system/plato.service
$nginx_file
  /etc/cron.d/plato
  /etc/logrotate.d/plato
  $BACKUP_DIR (owned by $PLATO_USER)

Next, by hand (these need decisions / secrets):
$mail_step
  2. $INSTALL_DIR/.env     — KNOWLESS_SECRET (bare KNOWLESS_FROM=auth@$DOMAIN) + KNOWLESS_SMTP_PORT=25
  3. $INSTALL_DIR/config.json — branding + operator block (branding.forumName is the mail sender name)
  4. cd $INSTALL_DIR && sudo -u $PLATO_USER npm ci --omit=dev
  5. cd $INSTALL_DIR && sudo -u $PLATO_USER node --env-file=.env bin/migrate.js
  6. systemctl enable --now plato
$nginx_steps

Then smoke-test:
  curl -sS https://$DOMAIN/healthz | jq .

Full walkthrough: docs/02-features/deploy-guide.md
EOF
