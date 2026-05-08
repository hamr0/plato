#!/usr/bin/env bash
# Generate a self-signed TLS cert + key for plato homeserver / LAN testing.
# Production uses Let's Encrypt via `certbot --nginx`; see deploy-guide.md.
#
# Default paths match deploy/plato.nginx-selfsigned.template and
# deploy/teardown.sh's cleanup, so the three pieces are interchangeable
# without per-script env tweaking.
#
# Usage:
#   sudo CN=federver ./deploy/gen-selfsigned-cert.sh
#   sudo CN=$DOMAIN  ./deploy/gen-selfsigned-cert.sh   # if DOMAIN exported
#
# Optional env (sane defaults):
#   CN                  required — Common Name (your hostname/domain)
#   SELF_SIGNED_CRT     /etc/pki/tls/certs/plato.crt
#   SELF_SIGNED_KEY     /etc/pki/tls/private/plato.key
#   SELF_SIGNED_DAYS    365

set -euo pipefail

CN="${CN:-${DOMAIN:-}}"
CRT="${SELF_SIGNED_CRT:-/etc/pki/tls/certs/plato.crt}"
KEY="${SELF_SIGNED_KEY:-/etc/pki/tls/private/plato.key}"
DAYS="${SELF_SIGNED_DAYS:-365}"

if [[ -z "$CN" ]]; then
  echo "gen-selfsigned-cert: CN env required (or set DOMAIN)" >&2
  echo "  e.g. sudo CN=federver $0" >&2
  exit 2
fi

if [[ $EUID -ne 0 ]]; then
  echo "gen-selfsigned-cert: must run as root (writes /etc/pki/tls/*)" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "gen-selfsigned-cert: openssl not on PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "$CRT")" "$(dirname "$KEY")"

# Generate. -nodes leaves the key unencrypted (nginx needs to read it
# unattended). -addext SAN covers the hostname + localhost + 127.0.0.1
# so curl -k works against either the LAN address or localhost.
openssl req -x509 -nodes -newkey rsa:4096 -days "$DAYS" \
  -subj "/CN=$CN" \
  -keyout "$KEY" -out "$CRT" \
  -addext "subjectAltName=DNS:$CN,DNS:localhost,IP:127.0.0.1" \
  2>/dev/null

chmod 600 "$KEY"
chmod 644 "$CRT"
chown root:root "$CRT" "$KEY"

echo "[gen-selfsigned-cert] wrote:"
echo "  cert: $CRT"
echo "  key:  $KEY"
echo "  CN:   $CN"
echo "  expires: $(openssl x509 -enddate -noout -in "$CRT" | cut -d= -f2)"
echo
echo "Next: render deploy/plato.nginx-selfsigned.template into"
echo "      /etc/nginx/conf.d/plato.conf, run nginx -t, reload nginx."
