#!/usr/bin/env bash
# bin/preflight.sh — pre-start sanity check for plato deployments.
#
# Run this once after first install (or after any config edit), before
# `systemctl start plato`. It catches the misconfigurations that
# otherwise surface as silent magic-link failures, 502s, or missing
# alerts at 3am.
#
# Each check is one line: OK / WARN / FAIL. WARN is "production should
# fix this; dev is OK"; FAIL means plato will not start correctly.
# Exits 0 when no FAIL, 1 otherwise. WARN does not affect exit status.
#
# Run as the plato user from the install dir:
#   sudo -u plato -H bash -c "cd /opt/plato && bin/preflight.sh"

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
PLATO_CONFIG="${PLATO_CONFIG:-$ROOT/config.json}"
DB_PATH_DEFAULT="$ROOT/forum.db"
POSTS_DIR_DEFAULT="$ROOT/posts"
EXPORTS_DIR_DEFAULT="$ROOT/exports"

FAIL_COUNT=0
WARN_COUNT=0

ok()   { printf "  OK    %s\n" "$1"; }
warn() { printf "  WARN  %s\n" "$1"; WARN_COUNT=$((WARN_COUNT + 1)); }
fail() { printf "  FAIL  %s\n" "$1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

read_env() {
  if [ ! -r "$ENV_FILE" ]; then echo ""; return; fi
  grep -E "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}

echo "plato preflight ($ROOT)"
echo

# ─── Node version ─────────────────────────────────────────────────────
echo "runtime:"
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version | sed 's/^v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  NODE_MINOR=$(echo "$NODE_VER" | cut -d. -f2)
  if [ "$NODE_MAJOR" -gt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 5 ]; }; then
    ok "node $NODE_VER (≥ 22.5 required for --env-file)"
  else
    fail "node $NODE_VER (need ≥ 22.5; --env-file flag added in 22.5)"
  fi
else
  fail "node not on PATH"
fi

if command -v sqlite3 >/dev/null 2>&1; then
  ok "sqlite3 $(sqlite3 --version | awk '{print $1}')"
else
  warn "sqlite3 not on PATH (plato uses node:sqlite, but the CLI is needed for backup.sh)"
fi

echo
echo "mail:"
if [ -x /usr/sbin/sendmail ]; then
  ok "/usr/sbin/sendmail present"
  if [ -e /etc/msmtprc ]; then
    PERMS=$(stat -c '%a' /etc/msmtprc 2>/dev/null || stat -f '%Lp' /etc/msmtprc 2>/dev/null)
    if [ "$PERMS" = "600" ]; then
      ok "/etc/msmtprc exists, mode 600"
    else
      warn "/etc/msmtprc exists but mode is $PERMS (msmtp REFUSES non-600; chmod 600 /etc/msmtprc)"
    fi
    # Only root can read 600-locked /etc/msmtprc; check for unreplaced
    # placeholders (the most common new-deploy mistake).
    if [ -r /etc/msmtprc ]; then
      if grep -qE 'YOUR_EMAIL@gmail\.com|APP_PASSWORD_GOES_HERE|xxxx-xxxx-xxxx-xxxx' /etc/msmtprc; then
        fail "/etc/msmtprc still contains placeholder values — edit it before starting plato"
      fi
      if ! grep -qE '^account[[:space:]]+default' /etc/msmtprc; then
        fail "/etc/msmtprc has no uncommented \`account default\` block — msmtp will error \"account default not found\""
      fi
    fi
  else
    warn "/etc/msmtprc not present (production needs it; see deploy/msmtprc.example)"
  fi
else
  warn "/usr/sbin/sendmail not present (production needs msmtp; OK in dev — knowless falls back to stderr)"
fi

# ─── .env ─────────────────────────────────────────────────────────────
echo
echo "config:"
if [ -r "$ENV_FILE" ]; then
  PERMS=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE" 2>/dev/null)
  if [ "$PERMS" = "600" ]; then
    ok ".env exists, mode 600"
  else
    warn ".env exists but mode is $PERMS (chmod 600 .env recommended; secret leak risk)"
  fi

  SECRET=$(read_env KNOWLESS_SECRET)
  if [ -z "$SECRET" ]; then
    fail "KNOWLESS_SECRET is empty — run: bin/gen-secret.sh"
  elif [ "${#SECRET}" -lt 32 ]; then
    fail "KNOWLESS_SECRET is shorter than 32 chars (got ${#SECRET}); regenerate via bin/gen-secret.sh"
  else
    ok "KNOWLESS_SECRET set (${#SECRET} chars)"
  fi

  BASE_URL=$(read_env KNOWLESS_BASE_URL)
  if [ -z "$BASE_URL" ]; then
    fail "KNOWLESS_BASE_URL is empty"
  else
    ok "KNOWLESS_BASE_URL=$BASE_URL"
  fi

  SENDMAIL_PATH=$(read_env PLATO_SENDMAIL_PATH)
  if [ -n "$SENDMAIL_PATH" ]; then
    if [ -x "$SENDMAIL_PATH" ]; then
      ok "PLATO_SENDMAIL_PATH=$SENDMAIL_PATH (executable)"
    else
      fail "PLATO_SENDMAIL_PATH=$SENDMAIL_PATH (not present or not executable)"
    fi
  else
    warn "PLATO_SENDMAIL_PATH unset (dev: OK; production: set to /usr/sbin/sendmail)"
  fi
else
  fail ".env not present at $ENV_FILE"
fi

# ─── config.json ──────────────────────────────────────────────────────
if [ -r "$PLATO_CONFIG" ]; then
  if command -v node >/dev/null 2>&1; then
    if node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "$PLATO_CONFIG" 2>/dev/null; then
      ok "config.json parses as JSON"
      OPERATOR_EMAIL=$(node -e '
        const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        process.stdout.write((c.operator && c.operator.email) || "");
      ' "$PLATO_CONFIG" 2>/dev/null)
      if [ -n "$OPERATOR_EMAIL" ]; then
        ok "operator.email=$OPERATOR_EMAIL"
      else
        warn "operator.email unset (cron alerts will silently drop unless HEALTH_ALERT_EMAIL is set per-line)"
      fi
      BASE_URL_CFG=$(node -e '
        const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        process.stdout.write((c.branding && c.branding.baseUrl) || "");
      ' "$PLATO_CONFIG" 2>/dev/null)
      if [ -n "$BASE_URL_CFG" ]; then
        ok "branding.baseUrl=$BASE_URL_CFG"
      else
        warn "branding.baseUrl unset (archive exports will lack live-instance backlinks)"
      fi
    else
      fail "config.json present but invalid JSON"
    fi
  fi
else
  warn "config.json not present (operator block + branding will use defaults)"
fi

# ─── Filesystem ───────────────────────────────────────────────────────
echo
echo "filesystem:"
DB_PATH=$(read_env DB_PATH)
DB_PATH="${DB_PATH:-$DB_PATH_DEFAULT}"
DB_DIR=$(dirname "$DB_PATH")
if [ -w "$DB_DIR" ]; then
  ok "DB_PATH dir writable ($DB_DIR)"
else
  fail "DB_PATH dir not writable ($DB_DIR) — chown plato:plato $DB_DIR"
fi

# Note: do NOT mkdir these dirs from preflight. When preflight runs as
# root (the deploy guide's path) any mkdir lands as root:root, which
# silently breaks plato (running as the plato user) — `/healthz` then
# reports `exports_dir_writable: false` after a clean-looking start.
# Bootstrap or the operator owns directory creation; preflight only
# checks. This rule was added after the homeserver smoke test caught
# a 502/ok:false flow that traced back to preflight's own mkdir.

POSTS_DIR=$(read_env POSTS_DIR)
POSTS_DIR="${POSTS_DIR:-$POSTS_DIR_DEFAULT}"
if [ ! -d "$POSTS_DIR" ]; then
  fail "POSTS_DIR does not exist ($POSTS_DIR) — bootstrap.sh creates it; or: sudo -u plato mkdir -p $POSTS_DIR"
elif [ -w "$POSTS_DIR" ]; then
  POSTS_OWNER=$(stat -c '%U' "$POSTS_DIR" 2>/dev/null || stat -f '%Su' "$POSTS_DIR" 2>/dev/null)
  ok "POSTS_DIR writable ($POSTS_DIR, owner=$POSTS_OWNER)"
else
  fail "POSTS_DIR not writable ($POSTS_DIR) — chown plato:plato $POSTS_DIR"
fi

EXPORTS_DIR=$(read_env EXPORTS_DIR)
EXPORTS_DIR="${EXPORTS_DIR:-$EXPORTS_DIR_DEFAULT}"
if [ ! -d "$EXPORTS_DIR" ]; then
  fail "EXPORTS_DIR does not exist ($EXPORTS_DIR) — bootstrap.sh creates it; or: sudo -u plato mkdir -p $EXPORTS_DIR"
elif [ -w "$EXPORTS_DIR" ]; then
  EXPORTS_OWNER=$(stat -c '%U' "$EXPORTS_DIR" 2>/dev/null || stat -f '%Su' "$EXPORTS_DIR" 2>/dev/null)
  ok "EXPORTS_DIR writable ($EXPORTS_DIR, owner=$EXPORTS_OWNER)"
else
  fail "EXPORTS_DIR not writable ($EXPORTS_DIR) — chown plato:plato $EXPORTS_DIR"
fi

# ─── Port ─────────────────────────────────────────────────────────────
PORT=$(read_env PORT)
PORT="${PORT:-8080}"
if command -v ss >/dev/null 2>&1; then
  if ss -tln "sport = :$PORT" 2>/dev/null | tail -n +2 | grep -q .; then
    fail "port $PORT already in use (run: ss -tlnp 'sport = :$PORT' to find the holder)"
  else
    ok "port $PORT free"
  fi
elif command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
    fail "port $PORT already in use"
  else
    ok "port $PORT free"
  fi
fi

# ─── Summary ──────────────────────────────────────────────────────────
echo
if [ "$FAIL_COUNT" -eq 0 ]; then
  if [ "$WARN_COUNT" -eq 0 ]; then
    echo "preflight: all checks passed."
  else
    echo "preflight: $WARN_COUNT warning(s); no FAIL. Safe to start plato."
  fi
  exit 0
else
  echo "preflight: $FAIL_COUNT failure(s), $WARN_COUNT warning(s). Fix FAILs before starting plato."
  exit 1
fi
