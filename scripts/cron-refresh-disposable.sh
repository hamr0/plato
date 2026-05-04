#!/usr/bin/env bash
# Cron-driven quarterly refresh of disposable-domains.txt.
# Restarts the plato service if the snapshot changed (so new domains load
# without a deploy), and emails the operator with success/failure details.
#
# Autoconfig: ROOT is the parent of this script. NOTIFY and SERVICE are
# read from config.json (`operator.email`, `operator.service`); SERVICE
# defaults to `plato`, NOTIFY skips the mail step if unset.
#
# Install (root crontab):
#   0 6 1 1,4,7,10 * /opt/plato/scripts/cron-refresh-disposable.sh
#
# Note on git: this script writes the snapshot in-place inside the repo
# checkout. After it runs, the working copy will diverge from origin until
# you mirror the change back from your laptop. The snapshot is append-mostly
# data, so drift is harmless until you next deploy.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/disposable-domains.txt"
CONFIG="$ROOT/config.json"

# Pull operator.email + operator.service from config.json. We already require
# Node to run plato, so no jq dependency. Missing fields → empty string.
read_config_field() {
  node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('$CONFIG', 'utf8'));
      process.stdout.write(String(((c.operator || {})['$1']) || ''));
    } catch (_) {}
  " 2>/dev/null
}

NOTIFY="$(read_config_field email)"
SERVICE="$(read_config_field service)"
[ -z "$SERVICE" ] && SERVICE='plato'

NOW="$(date -u +%FT%TZ)"
HOST="$(hostname -f 2>/dev/null || hostname)"

OLD_COUNT=0
[ -f "$DEST" ] && OLD_COUNT="$(wc -l < "$DEST")"
OLD_HASH="$(sha256sum "$DEST" 2>/dev/null | cut -d' ' -f1)"

REFRESH_OUT="$("$ROOT/scripts/refresh-disposable-domains.sh" 2>&1)"
REFRESH_EXIT=$?

NEW_COUNT=0
[ -f "$DEST" ] && NEW_COUNT="$(wc -l < "$DEST")"
NEW_HASH="$(sha256sum "$DEST" 2>/dev/null | cut -d' ' -f1)"

CHANGED='no'
[ "$OLD_HASH" != "$NEW_HASH" ] && CHANGED='yes'

RESTART_OUT=''
RESTART_EXIT=0
if [ "$REFRESH_EXIT" -eq 0 ] && [ "$CHANGED" = 'yes' ]; then
  RESTART_OUT="$(systemctl restart "$SERVICE" 2>&1)"
  RESTART_EXIT=$?
fi

if [ "$REFRESH_EXIT" -eq 0 ] && [ "$RESTART_EXIT" -eq 0 ]; then
  SUBJECT="[plato] disposable-domains refresh OK ($OLD_COUNT → $NEW_COUNT)"
else
  SUBJECT="[plato] disposable-domains refresh FAILED (refresh=$REFRESH_EXIT, restart=$RESTART_EXIT)"
fi

if [ -z "$NOTIFY" ]; then
  # No operator email configured — print the report to stderr so cron's
  # default mailer or journald still surfaces it.
  printf '[%s] %s\n' "$NOW" "$SUBJECT" >&2
  printf 'config.json operator.email is unset; skipping mail.\n' >&2
  exit 0
fi

# mail(1) isn't installed by default on minimal hosts; use sendmail directly
# so we don't add another package dependency.
{
  printf 'From: noreply@%s\n' "$HOST"
  printf 'To: %s\n' "$NOTIFY"
  printf 'Subject: %s\n' "$SUBJECT"
  printf 'Content-Type: text/plain; charset=utf-8\n'
  printf '\n'
  printf 'When:    %s\n' "$NOW"
  printf 'Host:    %s\n' "$HOST"
  printf 'Old:     %s domains (sha256 %s)\n' "$OLD_COUNT" "${OLD_HASH:-none}"
  printf 'New:     %s domains (sha256 %s)\n' "$NEW_COUNT" "${NEW_HASH:-none}"
  printf 'Changed: %s\n' "$CHANGED"
  printf '\n--- refresh output ---\n%s\n' "$REFRESH_OUT"
  if [ -n "$RESTART_OUT" ]; then
    printf '\n--- %s restart ---\n%s\n' "$SERVICE" "$RESTART_OUT"
  fi
  if [ "$CHANGED" = 'yes' ]; then
    printf '\nThe snapshot inside the git checkout changed.\n'
    printf 'Mirror it back to git from your laptop when convenient:\n'
    printf '  scp %s:%s disposable-domains.txt\n' "$HOST" "$DEST"
    printf '  git commit -am "chore: refresh disposable-domains snapshot"\n'
    printf '  git push\n'
  fi
} | /usr/sbin/sendmail -t

exit 0  # never fail the cron — the email IS the failure signal
