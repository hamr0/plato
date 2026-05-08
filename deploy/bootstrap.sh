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
#   - install packages (node, nginx, certbot, msmtp, sqlite — see deploy-guide.md)
#   - write /etc/msmtprc (your relay creds; see deploy/msmtprc.example)
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
# Optional env (sane defaults):
#   INSTALL_DIR=/opt/plato
#   PLATO_USER=plato
#   BACKUP_DIR=/var/lib/plato-backups
#   PLATO_PORT=8080      (must match PORT= in $INSTALL_DIR/.env)

set -euo pipefail

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

echo "[bootstrap] domain=$DOMAIN admin=$ADMIN_EMAIL install=$INSTALL_DIR user=$PLATO_USER port=$PLATO_PORT"

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

touch /var/log/plato.log
chown "$PLATO_USER:$PLATO_USER" /var/log/plato.log

# ─── Render templates ─────────────────────────────────────────────────
# envsubst with an explicit whitelist so nginx's own $host / $remote_addr
# variables aren't expanded as shell vars.

echo "[bootstrap] writing /etc/systemd/system/plato.service"
INSTALL_DIR="$INSTALL_DIR" PLATO_USER="$PLATO_USER" \
  envsubst '${INSTALL_DIR} ${PLATO_USER}' \
  < "$SCRIPT_DIR/plato.service.template" \
  > /etc/systemd/system/plato.service
chmod 644 /etc/systemd/system/plato.service

echo "[bootstrap] writing /etc/nginx/conf.d/plato.conf"
DOMAIN="$DOMAIN" PLATO_PORT="$PLATO_PORT" \
  envsubst '${DOMAIN} ${PLATO_PORT}' \
  < "$SCRIPT_DIR/plato.nginx.template" \
  > /etc/nginx/conf.d/plato.conf
chmod 644 /etc/nginx/conf.d/plato.conf

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
cat <<EOF

[bootstrap] done.

Files installed:
  /etc/systemd/system/plato.service
  /etc/nginx/conf.d/plato.conf
  /etc/cron.d/plato
  /etc/logrotate.d/plato
  $BACKUP_DIR (owned by $PLATO_USER)

Next, by hand (these need decisions / secrets):
  1. /etc/msmtprc          — see deploy/msmtprc.example
  2. $INSTALL_DIR/.env     — KNOWLESS_SECRET + PLATO_SENDMAIL_PATH
  3. $INSTALL_DIR/config.json — branding + operator block
  4. cd $INSTALL_DIR && sudo -u $PLATO_USER npm ci --omit=dev
  5. cd $INSTALL_DIR && sudo -u $PLATO_USER node --env-file=.env bin/migrate.js
  6. systemctl enable --now plato
  7. nginx -t && systemctl enable --now nginx
  8. certbot --nginx -d $DOMAIN -m $ADMIN_EMAIL --agree-tos -n --redirect

Then smoke-test:
  curl -sS https://$DOMAIN/healthz | jq .

Full walkthrough: docs/02-features/deploy-guide.md
EOF
