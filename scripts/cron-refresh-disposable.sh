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

# Intentional: no -e. We collect errors per step and report via mail —
# `exit 0` is the contract so cron's default mailer doesn't double-report.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/disposable-domains.txt"
CONFIG="$ROOT/config.json"

# Pull operator.<field> from config.json. Field name + CONFIG path travel
# via env so the JS source contains no shell interpolation — defence in
# depth even though both inputs are derived from script-local sources.
read_config_field() {
  CONFIG="$CONFIG" FIELD="$1" node -e '
    try {
      const c = JSON.parse(require("fs").readFileSync(process.env.CONFIG, "utf8"));
      process.stdout.write(String(((c.operator || {})[process.env.FIELD]) || ""));
    } catch (_) {}
  ' 2>/dev/null
}

NOTIFY="$(read_config_field email)"
SERVICE="$(read_config_field service)"
[ -z "$SERVICE" ] && SERVICE='plato'

# Derive a DKIM-signable From: an on-domain sender, NOT noreply@<bare-hostname>
# (unsignable → Gmail 550-5.7.26, same class as the pulselog-from bug). Mirrors
# bin/gen-pulselog-config.js: operator.mailFrom, else noreply@<domain> from
# KNOWLESS_FROM (env or .env), KNOWLESS_BASE_URL, branding.baseUrl.
mail_from() {
  CONFIG="$CONFIG" ENVFILE="$ROOT/.env" node -e '
    const fs = require("fs");
    let c = {}; try { c = JSON.parse(fs.readFileSync(process.env.CONFIG, "utf8")); } catch (_) {}
    const op = c.operator || {}, br = c.branding || {};
    function compute() {
      if (op.mailFrom) return String(op.mailFrom);
      let env = {};
      try {
        for (const line of fs.readFileSync(process.env.ENVFILE, "utf8").split("\n")) {
          const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
          if (m) env[m[1]] = m[2].replace(/^["\x27]|["\x27]$/g, "");
        }
      } catch (_) {}
      const from = process.env.KNOWLESS_FROM || env.KNOWLESS_FROM || "";
      const at = from.lastIndexOf("@");
      let domain = at >= 0 && at < from.length - 1 ? from.slice(at + 1).trim() : "";
      if (!domain) {
        for (const u of [process.env.KNOWLESS_BASE_URL, env.KNOWLESS_BASE_URL, br.baseUrl]) {
          try { const h = new URL(u || "").hostname; if (h) { domain = h; break; } } catch (_) {}
        }
      }
      return domain ? "noreply@" + domain : "";
    }
    process.stdout.write(compute());
  ' 2>/dev/null
}

NOW="$(date -u +%FT%TZ)"
HOST="$(hostname -f 2>/dev/null || hostname)"
FROM_ADDR="$(mail_from)"
[ -z "$FROM_ADDR" ] && FROM_ADDR="noreply@$HOST"  # last resort (unsignable, but never empty)

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
  printf 'From: %s\n' "$FROM_ADDR"
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
} | /usr/sbin/sendmail -t || printf '[plato] sendmail failed; cron will surface this stderr\n' >&2

exit 0  # never fail the cron — the email IS the failure signal
