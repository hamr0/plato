#!/usr/bin/env bash
# Local snapshot of a plato instance. Designed to run from cron.
#
# Captures the state that cannot be regenerated:
#   - forum.db        the forum: posts, comments, votes, subs, drafts, modlog
#   - knowless.db     the auth/identity store: registered users, sessions
#   - posts/          markdown source-of-truth for posts
#   - config.json     operator config
#   - spam-patterns.txt
#
# Both databases are snapshotted with plato's bundled node:sqlite
# (bin/db-snapshot.mjs — VACUUM INTO): online and lock-safe (no server stop),
# and with no dependency on a system `sqlite3` CLI, which on RHEL-family
# distros is too old to open the STRICT schema. Regenerable caches
# (exports/, data/urlhaus.txt, disposable-domains.txt) are intentionally
# left out — they rebuild themselves.
#
# Output: $BACKUP_DIR/plato-backup-YYYY-MM-DD-HHMMSS.tar.gz
# Rotation: keeps the newest $BACKUP_KEEP archives, deletes the rest.
#
# Restore (from a clean target):
#   1. install plato (npm ci) and run `npm run migrate`
#   2. stop the server
#   3. tar -xzf plato-backup-*.tar.gz -C /opt/plato/restore
#   4. cp restore/forum.db restore/knowless.db /opt/plato/
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
KNOWLESS_DB_PATH="${KNOWLESS_DB_PATH:-$ROOT/knowless.db}"
POSTS_DIR="${POSTS_DIR:-$ROOT/posts}"
CONFIG_PATH="${PLATO_CONFIG:-$ROOT/config.json}"
SPAM_PATTERNS_PATH="${PLATO_SPAM_PATTERNS:-$ROOT/spam-patterns.txt}"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"

if [ ! -f "$DB_PATH" ]; then
  echo "backup.sh: forum DB not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y-%m-%d-%H%M%S)
# Stage inside BACKUP_DIR, not /tmp: on a small VPS /tmp is often tmpfs and
# a growing knowless.db could exhaust RAM mid-snapshot.
WORK=$(mktemp -d -p "$BACKUP_DIR" .tmp-snapshot-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

# 1. online, lock-safe snapshots of both databases via bundled node:sqlite.
#    knowless.db may be absent on a fresh install — skip it if so.
NODE_NO_WARNINGS=1 node "$ROOT/bin/db-snapshot.mjs" "$DB_PATH" "$WORK/forum.db"
[ -f "$KNOWLESS_DB_PATH" ] && NODE_NO_WARNINGS=1 node "$ROOT/bin/db-snapshot.mjs" "$KNOWLESS_DB_PATH" "$WORK/knowless.db"

# 2. stage the source-of-truth + operator files that exist. Missing files
#    are skipped silently (a fresh install may not have config.json yet).
[ -d "$POSTS_DIR" ]          && cp -r "$POSTS_DIR"          "$WORK/posts"
[ -f "$CONFIG_PATH" ]        && cp    "$CONFIG_PATH"        "$WORK/config.json"
[ -f "$SPAM_PATTERNS_PATH" ] && cp    "$SPAM_PATTERNS_PATH" "$WORK/spam-patterns.txt"

# 3. tar to a .tmp sibling, then rename atomically — a failed tar never
#    appears under the canonical name, so rotation can't pick a corrupt file.
ARCHIVE="$BACKUP_DIR/plato-backup-$STAMP.tar.gz"
tar -czf "$ARCHIVE.tmp" -C "$WORK" .
mv "$ARCHIVE.tmp" "$ARCHIVE"

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
