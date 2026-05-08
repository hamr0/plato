#!/usr/bin/env bash
# deploy/disable-nginx-default-server.sh — comment out Fedora's stock
# `server { listen 80; ... }` block in /etc/nginx/nginx.conf.
#
# WHEN TO USE: only when port 80 is already taken by another service
# (AdGuard, Pi-hole, Home Assistant, another web app on the same box).
# Production VPS deploys do NOT need this — nginx owning :80 with an
# HTTP→HTTPS redirect is the default and correct setup; certbot's
# --nginx mode wires that for you. This script is for shared hosts /
# homeservers where :80 is already bound and you can't hand it over.
#
# What it does:
#   - backs up /etc/nginx/nginx.conf to /etc/nginx/nginx.conf.preplato
#     (only if no backup exists yet; idempotent across re-runs)
#   - prefixes every line of the http{} block's `server { ... }` block
#     containing `listen 80;` with `#` so nginx skips it
#   - leaves all other server blocks (e.g. /etc/nginx/conf.d/*.conf
#     where plato.conf lives) untouched
#   - runs `nginx -t` to verify the result parses
#
# Idempotent. Safe to run multiple times — if every `listen 80;` line
# is already commented out, the sed does nothing and `nginx -t` still
# passes.
#
# Reverse: cp /etc/nginx/nginx.conf.preplato /etc/nginx/nginx.conf

set -euo pipefail

NGINX_CONF="${NGINX_CONF:-/etc/nginx/nginx.conf}"
BACKUP="${BACKUP:-${NGINX_CONF}.preplato}"

if [[ $EUID -ne 0 ]]; then
  echo "disable-nginx-default-server: must run as root (try: sudo $0)" >&2
  exit 1
fi

if [[ ! -f "$NGINX_CONF" ]]; then
  echo "disable-nginx-default-server: $NGINX_CONF not found" >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "disable-nginx-default-server: nginx not installed" >&2
  exit 1
fi

if [[ ! -f "$BACKUP" ]]; then
  cp "$NGINX_CONF" "$BACKUP"
  echo "[disable-nginx-default-server] backed up $NGINX_CONF → $BACKUP"
else
  echo "[disable-nginx-default-server] backup exists: $BACKUP (not overwriting)"
fi

# Comment out every line from the opening `server {` to the matching `}`
# of any server block whose body contains `listen 80;`. The sed pattern
# uses a {start,end} address range and an inner s// that anchors to non-
# already-commented lines (^[^#]) so re-runs are safe.
#
# Address range: {/^[[:space:]]*server[[:space:]]*{/,/^[[:space:]]*}/}
# Filter inside: matches blocks containing `listen 80;`
# Action: s/^/#/ — but only on lines not already starting with `#`.

sed -i '/^[[:space:]]*server[[:space:]]*{/,/^[[:space:]]*}/{
  /listen[[:space:]]*80;/,/^[[:space:]]*}/{
    /^[^#]/s/^/#/
  }
}' "$NGINX_CONF"

echo "[disable-nginx-default-server] commented :80 server block(s) in $NGINX_CONF"

if nginx -t 2>&1 | grep -q "syntax is ok"; then
  echo "[disable-nginx-default-server] nginx -t: passes"
else
  echo "[disable-nginx-default-server] WARN: nginx -t failed — restore from $BACKUP if needed:" >&2
  echo "    sudo cp $BACKUP $NGINX_CONF" >&2
  nginx -t || true
  exit 1
fi

echo
echo "Next: reload nginx so the change takes effect:"
echo "    sudo systemctl reload nginx"
