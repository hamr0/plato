#!/usr/bin/env bash
# Tear down the M7 manual-smoke pair started by bin/m7-manual-smoke-up.sh.
# Kills both servers (PIDs from /tmp/plato-manual-smoke/{a,b}.pid, with
# port-based fallback) and wipes the staging dir.

set -euo pipefail

ROOT_TMP=/tmp/plato-manual-smoke

for label in a b; do
  pidfile=$ROOT_TMP/$label.pid
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill "$pid" 2>/dev/null; then
      echo "stopped instance $label (pid $pid)"
    fi
  fi
done

# Belt-and-suspenders for the case where the pidfile lost track (e.g.
# the terminal that ran -up.sh got SIGHUP'd before nohup detached).
for port in 8081 8082; do
  pid=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pid" ]; then
    kill $pid 2>/dev/null || true
    echo "stopped lingering process on :$port (pid $pid)"
  fi
done

rm -rf "$ROOT_TMP"
echo "wiped $ROOT_TMP"
