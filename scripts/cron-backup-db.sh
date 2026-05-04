#!/usr/bin/env bash
# Daily snapshot of plato's full state: forum.db + knowless.db + posts/.
# Writes data/backups/plato-YYYY-MM-DD.tar.gz, prunes anything older than
# BACKUP_KEEP_DAYS (default 7).
#
# Uses SQLite's `.backup` so WAL-mode databases snapshot cleanly under
# concurrent writes — raw `cp` of forum.db is not safe.
#
# Autoconfig: ROOT is the parent of this script. NOTIFY is read from
# config.json operator.email; if unset, failures land in stderr.
#
# Install (root crontab):
#   30 4 * * * /opt/plato/scripts/cron-backup-db.sh

# Intentional: no -e. We collect errors per step and report via mail —
# `exit 0` is the contract so cron's default mailer doesn't double-report.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT/config.json"
BACKUP_DIR="$ROOT/data/backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
DATE="$(date -u +%F)"
NOW="$(date -u +%FT%TZ)"
HOST="$(hostname -f 2>/dev/null || hostname)"
ARCHIVE="$BACKUP_DIR/plato-$DATE.tar.gz"
mkdir -p "$BACKUP_DIR"
# Stage SQLite snapshots inside BACKUP_DIR rather than /tmp — on small
# VPS /tmp is often tmpfs and could OOM with a multi-GB knowless.db.
TMP_DIR="$(mktemp -d -p "$BACKUP_DIR")"
trap 'rm -rf "$TMP_DIR"' EXIT

# Pass CONFIG via env to keep the JS source free of shell interpolation
# (defence in depth — CONFIG is already derived from script location, but
# `$VAR` inside `node -e "..."` is brittle if a future change adds
# operator-controlled bits).
NOTIFY="$(CONFIG="$CONFIG" node -e '
  try {
    const c = JSON.parse(require("fs").readFileSync(process.env.CONFIG, "utf8"));
    process.stdout.write(String(((c.operator || {}).email) || ""));
  } catch (_) {}
' 2>/dev/null)"

ERRORS=''

# Snapshot the SQLite databases via .backup (WAL-safe).
for DB in forum.db knowless.db; do
  SRC="$ROOT/$DB"
  if [ -f "$SRC" ]; then
    if ! sqlite3 "$SRC" ".backup '$TMP_DIR/$DB'" 2>>"$TMP_DIR/err"; then
      ERRORS="$ERRORS\nsqlite backup failed: $DB"
    fi
  fi
done

# Tar to a .tmp sibling first, then rename atomically. tar-failed writes
# never appear under the canonical name, so retention can't be fooled and
# a "newest archive" restore can't pick a corrupt file.
TAR_OUT="$(tar -czf "$ARCHIVE.tmp" -C "$TMP_DIR" forum.db knowless.db -C "$ROOT" posts 2>&1)"
TAR_EXIT=$?
if [ "$TAR_EXIT" -eq 0 ]; then
  mv "$ARCHIVE.tmp" "$ARCHIVE"
else
  ERRORS="$ERRORS\ntar failed (exit $TAR_EXIT): $TAR_OUT"
  rm -f "$ARCHIVE.tmp"
fi

ARCHIVE_SIZE='0'
[ -f "$ARCHIVE" ] && ARCHIVE_SIZE="$(du -h "$ARCHIVE" | cut -f1)"

# Prune anything matching plato-*.tar.gz older than KEEP_DAYS.
# `find -maxdepth 1` and the literal name pattern keep the delete scope
# strictly inside BACKUP_DIR — cannot escape via symlinks or globbing.
PRUNED="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'plato-*.tar.gz' -mtime +"$KEEP_DAYS" -print -delete 2>/dev/null)"
# `grep -c .` counts non-empty lines; trims the leading whitespace some
# `wc -l` builds emit and naturally returns 0 for empty input.
PRUNE_COUNT="$(printf '%s' "$PRUNED" | grep -c .)"

if [ -z "$ERRORS" ]; then
  SUBJECT="[plato] backup OK $DATE ($ARCHIVE_SIZE, pruned $PRUNE_COUNT)"
else
  SUBJECT="[plato] backup FAILED $DATE"
fi

if [ -z "$NOTIFY" ]; then
  printf '[%s] %s\n' "$NOW" "$SUBJECT" >&2
  [ -n "$ERRORS" ] && printf '%b\n' "$ERRORS" >&2
  exit 0
fi

# Only mail on failure, or on prune events. The "OK no-prune" daily case
# would be 7 emails/week of pure noise — silent success is the contract.
if [ -z "$ERRORS" ] && [ "$PRUNE_COUNT" -eq 0 ]; then
  exit 0
fi

{
  printf 'From: noreply@%s\n' "$HOST"
  printf 'To: %s\n' "$NOTIFY"
  printf 'Subject: %s\n' "$SUBJECT"
  printf 'Content-Type: text/plain; charset=utf-8\n'
  printf '\n'
  printf 'When:    %s\n' "$NOW"
  printf 'Host:    %s\n' "$HOST"
  printf 'Archive: %s (%s)\n' "$ARCHIVE" "$ARCHIVE_SIZE"
  printf 'Keep:    %s days\n' "$KEEP_DAYS"
  printf 'Pruned:  %s archive(s)\n' "$PRUNE_COUNT"
  if [ -n "$PRUNED" ]; then
    printf '%s\n' "$PRUNED" | sed 's/^/  - /'
  fi
  if [ -n "$ERRORS" ]; then
    printf '\n--- errors ---%b\n' "$ERRORS"
    [ -s "$TMP_DIR/err" ] && printf '\n--- sqlite stderr ---\n' && cat "$TMP_DIR/err"
  fi
} | /usr/sbin/sendmail -t || printf '[plato] sendmail failed; cron will surface this stderr\n' >&2

exit 0
