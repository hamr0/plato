#!/usr/bin/env bash
# Tail /healthz from cron. Silent on success (no output → no cron mail).
# On failure: append a one-line stamp to $BACKUP_DIR/health.log and, if
# $HEALTH_ALERT_EMAIL is set, email the operator with a paste-ready
# GitHub issue body. The intent: when something breaks at 3am, the
# operator wakes up with diagnostic context already assembled.
#
# Suggested crontab: every 5 min.
#   */5 * * * * cd /opt/plato && BACKUP_DIR=/var/lib/plato-backups \
#       HEALTH_ALERT_EMAIL=op@example.com PLATO_LOG=/var/log/plato.log \
#       bin/health-watch.sh
#
# Env:
#   PLATO_URL            default http://localhost:8080
#   DOMAIN               forum domain; when set, the alert is sent From
#                        noreply@$DOMAIN and identifies as $DOMAIN (not the
#                        box hostname). Unset → falls back to system default.
#   BACKUP_DIR           default ./backups (where health.log lives)
#   HEALTH_ALERT_EMAIL   if set, alert recipient. If unset, falls back to
#                        config.json:operator.email (the same address every
#                        other plato cron job uses). If neither is set,
#                        the script logs to health.log and exits 0 — no
#                        email, but the file evidence is still there.
#   PLATO_CONFIG         path to config.json (default ./config.json)
#   PLATO_LOG            path to plato's stdout/stderr log; last 30 lines
#                        included in the email when present
#   HEALTH_TIMEOUT_S     curl --max-time, default 5

set -uo pipefail
# (no -e — we need to handle curl failure paths ourselves)

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PLATO_URL="${PLATO_URL:-http://localhost:8080}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
HEALTH_LOG="$BACKUP_DIR/health.log"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-5}"
PLATO_LOG="${PLATO_LOG:-}"
PLATO_CONFIG="${PLATO_CONFIG:-$ROOT/config.json}"

# Resolve alert recipient: env override wins, then config.json:operator.email.
# Resolved value drives the "send mail at all?" branch later.
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

mkdir -p "$BACKUP_DIR"

BODY_FILE=$(mktemp -t plato-healthz-body-XXXXXX)
trap 'rm -f "$BODY_FILE"' EXIT

# Capture status code + body separately. curl exit != 0 means
# connection-level failure (server down, DNS, timeout); use 000 as the
# pseudo-status in that case.
HTTP_STATUS=$(curl -sS --max-time "$HEALTH_TIMEOUT_S" \
  -o "$BODY_FILE" -w '%{http_code}' \
  "$PLATO_URL/healthz" 2>/dev/null) || HTTP_STATUS=000

if [ "$HTTP_STATUS" = "200" ]; then
  exit 0
fi

# --- failure path ---------------------------------------------------------

STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
HOST=$(hostname)

# Outward identity for the alert email: the forum's own domain (passed by cron
# as DOMAIN) so the alert is *From* the forum, not the box — matters on a
# co-tenant host where $(hostname) is the box, not the site. health.log and the
# GitHub-issue diagnostic keep $HOST (the box) — that's the useful debug detail.
FORUM="${DOMAIN:-$HOST}"
FROM_ADDR=""
[ -n "${DOMAIN:-}" ] && FROM_ADDR="noreply@$DOMAIN"

# Try to extract failure detail from the /healthz JSON if we got one.
REASON="http_status=$HTTP_STATUS"
if [ -s "$BODY_FILE" ] && command -v node >/dev/null 2>&1; then
  PARSED=$(node -e '
    let raw = "";
    process.stdin.on("data", c => raw += c);
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(raw);
        const failed = [];
        if (j.db_writable === false) failed.push("db_writable=false");
        if (j.exports_dir_writable === false) failed.push("exports_dir_writable=false");
        process.stdout.write(failed.join(",") || "unknown");
      } catch { process.stdout.write("unparseable_body"); }
    });
  ' < "$BODY_FILE" 2>/dev/null)
  [ -n "$PARSED" ] && REASON="$REASON $PARSED"
fi

# 1. one-line stamp into the rolling log.
echo "$STAMP host=$HOST status=$HTTP_STATUS $REASON" >> "$HEALTH_LOG"

# 2. if no alert email configured (env nor config.json), we're done —
#    the log is the artifact.
if [ -z "$ALERT_EMAIL" ]; then
  exit 0
fi

# 3. assemble email body. Sections: summary → diagnostic → recent log →
#    paste-ready GitHub issue template.
PLATO_VERSION="unknown"
if [ -s "$BODY_FILE" ] && command -v node >/dev/null 2>&1; then
  PLATO_VERSION=$(node -e '
    let raw = ""; process.stdin.on("data", c => raw += c);
    process.stdin.on("end", () => {
      try { process.stdout.write(JSON.parse(raw).version || "unknown"); }
      catch { process.stdout.write("unknown"); }
    });
  ' < "$BODY_FILE" 2>/dev/null) || PLATO_VERSION="unknown"
fi

EMAIL_FILE=$(mktemp -t plato-health-email-XXXXXX)
{
  echo "plato healthz check failed at $STAMP"
  echo "forum:   $FORUM"
  echo "host:    $HOST"
  echo "url:     $PLATO_URL/healthz"
  echo "status:  $HTTP_STATUS"
  echo "reason:  $REASON"
  echo "version: $PLATO_VERSION"
  echo
  echo "--- /healthz response body (first 20 lines) ---"
  if [ -s "$BODY_FILE" ]; then head -n 20 "$BODY_FILE"; else echo "(empty — connection failure)"; fi
  echo
  echo
  echo "--- last 30 lines of $PLATO_LOG ---"
  if [ -n "$PLATO_LOG" ] && [ -r "$PLATO_LOG" ]; then
    tail -n 30 "$PLATO_LOG"
  else
    echo "(PLATO_LOG unset or unreadable; no process log captured)"
  fi
  echo
  echo "--- last 5 rows of $HEALTH_LOG ---"
  tail -n 5 "$HEALTH_LOG" 2>/dev/null || echo "(no prior history)"
  echo
  echo "--- paste-ready GitHub issue ---"
  echo "Title: [plato $PLATO_VERSION] healthz failure on $HOST: $REASON"
  echo
  echo "Project: https://github.com/hamr0/plato"
  echo "Version: $PLATO_VERSION"
  echo "When:    $STAMP"
  echo
  echo "## What happened"
  echo "/healthz returned status $HTTP_STATUS. Diagnostic detail: $REASON."
  echo
  echo "## Reproduction"
  echo "(describe what triggered this — deploy, cron, config edit, etc.)"
  echo
  echo "## Diagnostic"
  echo '```'
  if [ -s "$BODY_FILE" ]; then head -n 20 "$BODY_FILE"; fi
  echo
  if [ -n "$PLATO_LOG" ] && [ -r "$PLATO_LOG" ]; then
    echo "# last 30 lines of plato log"
    tail -n 30 "$PLATO_LOG"
  fi
  echo '```'
} > "$EMAIL_FILE"

SUBJECT="[plato] healthz alert on $FORUM: status=$HTTP_STATUS"

if command -v mail >/dev/null 2>&1; then
  if [ -n "$FROM_ADDR" ]; then
    mail -s "$SUBJECT" -r "$FROM_ADDR" "$ALERT_EMAIL" < "$EMAIL_FILE"
  else
    mail -s "$SUBJECT" "$ALERT_EMAIL" < "$EMAIL_FILE"
  fi
elif command -v sendmail >/dev/null 2>&1; then
  {
    [ -n "$FROM_ADDR" ] && echo "From: $FROM_ADDR"
    echo "To: $ALERT_EMAIL"
    echo "Subject: $SUBJECT"
    echo "Content-Type: text/plain; charset=utf-8"
    echo
    cat "$EMAIL_FILE"
  } | sendmail -t
else
  echo "health-watch: no \`mail\` or \`sendmail\` on PATH; alert dropped" >&2
  echo "health-watch: would have emailed $ALERT_EMAIL with subject: $SUBJECT" >&2
fi

rm -f "$EMAIL_FILE"
exit 0
