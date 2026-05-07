#!/usr/bin/env bash
# Local snapshot of a plato instance. Designed to run from cron.
#
# What it captures:
#   - forum.db        via `sqlite3 .backup` (online, lock-safe — does NOT
#                     require the server to be stopped; SQLite's online
#                     backup API copies pages while writers continue)
#   - posts/          markdown source-of-truth for posts
#   - exports/        in-flight + recent archive downloads (tokens TTL'd)
#   - config.json     operator config
#   - spam-patterns.txt
#   - data/urlhaus.txt
#   - disposable-domains.txt
#
# Output: $BACKUP_DIR/plato-backup-YYYY-MM-DD-HHMMSS.tar.gz
# Rotation: keeps the newest $BACKUP_KEEP archives, deletes the rest.
#
# Restore (from a clean target):
#   1. install plato (npm ci) and run `npm run migrate`
#   2. stop the server
#   3. tar -xzf plato-backup-*.tar.gz -C /opt/plato/restore
#   4. cp restore/forum.db /opt/plato/forum.db
#   5. cp -r restore/posts /opt/plato/
#   6. (optional) cp restore/config.json restore/spam-patterns.txt …
#   7. ensure KNOWLESS_SECRET matches the original deploy (otherwise all
#      identity hashes shift and users look like new accounts)
#   8. start the server
#
# Off-host copy: this script does NOT push backups elsewhere. Uncomment
# the rsync stanza near the bottom and configure your own SSH key — we
# don't bake key management into plato.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

DB_PATH="${DB_PATH:-$ROOT/forum.db}"
POSTS_DIR="${POSTS_DIR:-$ROOT/posts}"
EXPORTS_DIR="${EXPORTS_DIR:-$ROOT/exports}"
CONFIG_PATH="${PLATO_CONFIG:-$ROOT/config.json}"
SPAM_PATTERNS_PATH="${PLATO_SPAM_PATTERNS:-$ROOT/spam-patterns.txt}"
URLHAUS_CACHE_PATH="${PLATO_URLHAUS_CACHE:-$ROOT/data/urlhaus.txt}"
DISPOSABLE_PATH="$ROOT/disposable-domains.txt"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "backup.sh: sqlite3 CLI not found on PATH (apt install sqlite3)" >&2
  exit 1
fi

if [ ! -f "$DB_PATH" ]; then
  echo "backup.sh: DB not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y-%m-%d-%H%M%S)
WORK=$(mktemp -d -t plato-backup-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

# 1. atomic SQLite snapshot. Uses the online-backup API, so concurrent
#    writers don't corrupt the copy and the server doesn't need to stop.
sqlite3 "$DB_PATH" ".backup '$WORK/forum.db'"

# 2. stage the auxiliary files that exist. Missing files are skipped
#    silently (fresh installs may not have config.json yet, urlhaus may
#    not have refreshed, exports/ may be empty).
[ -d "$POSTS_DIR" ]            && cp -r "$POSTS_DIR"            "$WORK/posts"
[ -d "$EXPORTS_DIR" ]          && cp -r "$EXPORTS_DIR"          "$WORK/exports"
[ -f "$CONFIG_PATH" ]          && cp    "$CONFIG_PATH"          "$WORK/config.json"
[ -f "$SPAM_PATTERNS_PATH" ]   && cp    "$SPAM_PATTERNS_PATH"   "$WORK/spam-patterns.txt"
[ -f "$URLHAUS_CACHE_PATH" ]   && { mkdir -p "$WORK/data"; cp "$URLHAUS_CACHE_PATH" "$WORK/data/urlhaus.txt"; }
[ -f "$DISPOSABLE_PATH" ]      && cp    "$DISPOSABLE_PATH"      "$WORK/disposable-domains.txt"

# 3. tar.gz the whole staging dir into the backup archive.
ARCHIVE="$BACKUP_DIR/plato-backup-$STAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" .

echo "backup.sh: wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# 4. rotation: keep BACKUP_KEEP newest, delete older.
#    `ls -1t` orders by mtime newest-first; tail skips the newest N.
#    set +e here because no-deletions is not an error.
if [ "$BACKUP_KEEP" -gt 0 ]; then
  set +e
  ls -1t "$BACKUP_DIR"/plato-backup-*.tar.gz 2>/dev/null \
    | tail -n +"$((BACKUP_KEEP + 1))" \
    | xargs -r rm -f
  set -e
fi

# 5. off-host copy — operator opts in by uncommenting and pointing at
#    their own host + SSH key. plato does not bundle SSH config.
#
# rsync -az --delete \
#   "$BACKUP_DIR/" \
#   backup-user@offsite.example.com:/srv/plato-backups/
