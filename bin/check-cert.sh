#!/usr/bin/env bash
# Daily TLS cert expiry check. Silent ≥ WARN_DAYS, daily email when
# remaining days drop below WARN_DAYS, URGENT subject prefix when below
# URGENT_DAYS. The matching renewal layer (certbot.timer + Caddy auto-TLS,
# whichever you use) handles the *renewal* itself; this is the
# operator-side alarm for "renewal silently stopped working."
#
# Suggested crontab: daily 04:15 UTC.
#   15 4 * * * root cd /opt/plato && DOMAIN=forum.example.com \
#       BACKUP_DIR=/var/lib/plato-backups bin/check-cert.sh \
#       >> /var/log/plato-cert.log 2>&1
#
# Env:
#   DOMAIN               required — the public hostname to probe
#   PORT                 TLS port, default 443
#   WARN_DAYS            below this, send daily nag email. Default 14
#   URGENT_DAYS          below this, prepend "URGENT" to subject. Default 3
#   BACKUP_DIR           default ./backups (where health.log is appended)
#   HEALTH_ALERT_EMAIL   override recipient. Falls back to
#                        config.json:operator.email; if neither, log only
#   PLATO_CONFIG         default ./config.json
#   CONNECT_TIMEOUT_S    openssl s_client timeout, default 10

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DOMAIN="${DOMAIN:-}"
PORT="${PORT:-443}"
WARN_DAYS="${WARN_DAYS:-14}"
URGENT_DAYS="${URGENT_DAYS:-3}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
HEALTH_LOG="$BACKUP_DIR/health.log"
PLATO_CONFIG="${PLATO_CONFIG:-$ROOT/config.json}"
CONNECT_TIMEOUT_S="${CONNECT_TIMEOUT_S:-10}"

if [ -z "$DOMAIN" ]; then
  echo "check-cert: DOMAIN env required" >&2
  exit 2
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "check-cert: openssl not on PATH" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"

# Resolve alert recipient: env override → config.json:operator.email → none.
ALERT_EMAIL="${HEALTH_ALERT_EMAIL:-}"
if [ -z "$ALERT_EMAIL" ] && [ -r "$PLATO_CONFIG" ] && command -v node >/dev/null 2>&1; then
  ALERT_EMAIL=$(node -e '
    const fs = require("fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.stdout.write((c.operator && c.operator.email) || "");
    } catch { process.stdout.write(""); }
  ' "$PLATO_CONFIG" 2>/dev/null) || ALERT_EMAIL=""
fi

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HOST=$(hostname)

# Pull the cert's notAfter via openssl s_client. SNI matters for
# multi-cert vhosts. The </dev/null prevents s_client from blocking on
# stdin; the timeout caps an unresponsive connection.
ENDDATE_RAW=$(timeout "$CONNECT_TIMEOUT_S" \
  openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:$PORT" </dev/null 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null) || ENDDATE_RAW=""

if [ -z "$ENDDATE_RAW" ]; then
  REASON="probe_failed"
  echo "$STAMP host=$HOST cert=$DOMAIN $REASON" >> "$HEALTH_LOG"
  if [ -n "$ALERT_EMAIL" ]; then
    SUBJECT="[plato] cert probe FAILED for $DOMAIN on $HOST"
    BODY=$(cat <<EOF
plato cert check failed at $STAMP

host:    $HOST
domain:  $DOMAIN:$PORT
result:  could not retrieve certificate (TLS probe failed)

This usually means:
  - $DOMAIN is not resolving, or
  - the host is not listening on $PORT, or
  - the firewall is blocking outbound from this VPS to itself, or
  - DNS / Let's Encrypt / nginx is misconfigured.

Investigation:
  curl -vI https://$DOMAIN/healthz
  systemctl status nginx
  journalctl -u nginx -n 50

This alarm fires once a day from cron until the probe succeeds.
EOF
)
    if command -v mail >/dev/null 2>&1; then
      printf '%s\n' "$BODY" | mail -s "$SUBJECT" "$ALERT_EMAIL"
    elif command -v sendmail >/dev/null 2>&1; then
      {
        echo "To: $ALERT_EMAIL"
        echo "Subject: $SUBJECT"
        echo "Content-Type: text/plain; charset=utf-8"
        echo
        printf '%s\n' "$BODY"
      } | sendmail -t
    else
      echo "check-cert: no \`mail\` or \`sendmail\`; alert dropped" >&2
    fi
  fi
  exit 0
fi

# Parse "notAfter=May 25 23:59:59 2026 GMT" → epoch seconds.
ENDDATE=${ENDDATE_RAW#notAfter=}
EXPIRY_EPOCH=$(date -d "$ENDDATE" +%s 2>/dev/null) || EXPIRY_EPOCH=""

if [ -z "$EXPIRY_EPOCH" ]; then
  echo "$STAMP host=$HOST cert=$DOMAIN parse_failed enddate=$ENDDATE_RAW" >> "$HEALTH_LOG"
  exit 0
fi

NOW_EPOCH=$(date -u +%s)
DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

# Above the warn threshold: silent exit. The success path writes nothing,
# so cron stays quiet and health.log only carries failures.
if [ "$DAYS_LEFT" -ge "$WARN_DAYS" ]; then
  exit 0
fi

# Below threshold — log + alert.
echo "$STAMP host=$HOST cert=$DOMAIN days_left=$DAYS_LEFT expires=$ENDDATE" >> "$HEALTH_LOG"

if [ -z "$ALERT_EMAIL" ]; then
  exit 0
fi

if [ "$DAYS_LEFT" -lt "$URGENT_DAYS" ]; then
  SUBJECT="[plato] URGENT cert expires in $DAYS_LEFT day(s) — $DOMAIN"
else
  SUBJECT="[plato] cert expires in $DAYS_LEFT days — $DOMAIN"
fi

BODY=$(cat <<EOF
plato TLS cert nearing expiry at $STAMP

host:        $HOST
domain:      $DOMAIN:$PORT
days_left:   $DAYS_LEFT
expires_at:  $ENDDATE

This alarm fires once a day from cron while days_left < $WARN_DAYS.

If you're using nginx + certbot:
  systemctl status certbot.timer
  certbot renew --dry-run        # verify renewal would work today
  certbot renew                  # force a renewal attempt

If renewal still fails, capture:
  journalctl -u certbot -n 200
  /var/log/letsencrypt/letsencrypt.log

For a manual issuance from scratch:
  certbot --nginx -d $DOMAIN

Recent cert-related lines from $HEALTH_LOG:
$(grep -F "cert=$DOMAIN" "$HEALTH_LOG" 2>/dev/null | tail -n 5 || echo "(none)")
EOF
)

if command -v mail >/dev/null 2>&1; then
  printf '%s\n' "$BODY" | mail -s "$SUBJECT" "$ALERT_EMAIL"
elif command -v sendmail >/dev/null 2>&1; then
  {
    echo "To: $ALERT_EMAIL"
    echo "Subject: $SUBJECT"
    echo "Content-Type: text/plain; charset=utf-8"
    echo
    printf '%s\n' "$BODY"
  } | sendmail -t
else
  echo "check-cert: no \`mail\` or \`sendmail\`; alert dropped" >&2
fi

exit 0
