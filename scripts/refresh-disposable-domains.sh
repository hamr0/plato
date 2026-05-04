#!/usr/bin/env bash
# Refresh disposable-domains.txt from the upstream
# disposable-email-domains repo. Run manually (or via quarterly cron)
# — the list is intentionally NOT fetched at runtime so a remote list
# change can't silently expand the block surface.
#
#   ./scripts/refresh-disposable-domains.sh
#   git diff disposable-domains.txt   # review what changed
#   git commit -m "chore: refresh disposable-domains snapshot"
set -euo pipefail

URL='https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HERE/disposable-domains.txt"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -fsSL "$URL" -o "$TMP"
LINES="$(wc -l < "$TMP")"
if [ "$LINES" -lt 1000 ]; then
  echo "refusing to overwrite — upstream returned only $LINES lines (looks broken)" >&2
  exit 1
fi
mv "$TMP" "$DEST"
echo "wrote $DEST ($LINES domains)"
