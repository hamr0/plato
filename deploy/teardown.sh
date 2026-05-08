#!/usr/bin/env bash
# deploy/teardown.sh — undo everything bootstrap.sh + the deploy guide
# add to a host. Useful for:
#   - testing the deploy on a homeserver and rolling back when done
#   - decommissioning a plato instance
#   - "I want to start fresh" after a botched install
#
# What it removes:
#   - systemctl stop + disable plato (then unit file)
#   - /etc/nginx/conf.d/plato.conf  (then `nginx -s reload` if nginx is running)
#   - /etc/cron.d/plato
#   - /etc/logrotate.d/plato
#   - /var/log/plato*.log
#
# What it CAN remove (asks first; pass --yes-data to skip the prompt):
#   - $INSTALL_DIR (default /opt/plato) — your db, posts, exports
#   - the `plato` system user
#   - $BACKUP_DIR (default /var/lib/plato-backups) — every backup tarball
#   - /etc/msmtprc — legacy relay credentials from pre-postfix deploys
#   - self-signed cert at /etc/pki/tls/{certs,private}/plato.{crt,key}
#
# What it leaves alone:
#   - SELinux setbool httpd_can_network_connect (harmless; useful for any
#     other web app you'll run here)
#   - certbot-issued certs in /etc/letsencrypt (revoke separately if needed)
#   - the plato git repo, packages installed via dnf/apt
#
# Usage:
#   sudo ./deploy/teardown.sh            # interactive — prompts for data deletion
#   sudo ./deploy/teardown.sh --yes-data # delete everything, no prompts
#   sudo ./deploy/teardown.sh --dry-run  # show what would be removed, change nothing

set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/plato}"
PLATO_USER="${PLATO_USER:-plato}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/plato-backups}"
SELF_SIGNED_CRT="${SELF_SIGNED_CRT:-/etc/pki/tls/certs/plato.crt}"
SELF_SIGNED_KEY="${SELF_SIGNED_KEY:-/etc/pki/tls/private/plato.key}"

DRY_RUN=0
YES_DATA=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes-data) YES_DATA=1 ;;
    -h|--help)
      sed -n '1,40p' "$0" | grep -E '^#'
      exit 0 ;;
    *)
      echo "teardown: unknown flag: $arg" >&2
      exit 2 ;;
  esac
done

if [[ $EUID -ne 0 && $DRY_RUN -ne 1 ]]; then
  echo "teardown: must run as root for destructive ops (try: sudo $0)." >&2
  echo "         Use --dry-run to preview without root." >&2
  exit 1
fi

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [dry-run] $*"
  else
    eval "$@"
  fi
}

confirm() {
  local prompt="$1"
  if [[ $YES_DATA -eq 1 ]]; then return 0; fi
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  [dry-run] would prompt: $prompt"
    return 1
  fi
  read -r -p "$prompt [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

echo "[teardown] mode: $([[ $DRY_RUN -eq 1 ]] && echo dry-run || echo destructive)"
echo "[teardown] install_dir=$INSTALL_DIR user=$PLATO_USER backup_dir=$BACKUP_DIR"
echo

# ─── Stop + disable plato ─────────────────────────────────────────────
if systemctl list-unit-files plato.service >/dev/null 2>&1; then
  echo "[teardown] stopping plato"
  run "systemctl stop plato 2>/dev/null || true"
  run "systemctl disable plato 2>/dev/null || true"
  if [[ -f /etc/systemd/system/plato.service ]]; then
    echo "[teardown] removing /etc/systemd/system/plato.service"
    run "rm -f /etc/systemd/system/plato.service"
  fi
  run "systemctl daemon-reload"
else
  echo "[teardown] plato.service not registered with systemd — skipping"
fi

# ─── nginx site ───────────────────────────────────────────────────────
if [[ -f /etc/nginx/conf.d/plato.conf ]]; then
  echo "[teardown] removing /etc/nginx/conf.d/plato.conf"
  run "rm -f /etc/nginx/conf.d/plato.conf"
  if systemctl is-active --quiet nginx 2>/dev/null; then
    echo "[teardown] reloading nginx"
    run "nginx -s reload 2>/dev/null || systemctl reload nginx"
  fi
else
  echo "[teardown] no /etc/nginx/conf.d/plato.conf — skipping"
fi

# ─── Self-signed cert (test/homeserver only) ──────────────────────────
for f in "$SELF_SIGNED_CRT" "$SELF_SIGNED_KEY"; do
  if [[ -f "$f" ]]; then
    if confirm "remove self-signed cert $f?"; then
      run "rm -f \"$f\""
    fi
  fi
done

# ─── Cron + logrotate ─────────────────────────────────────────────────
for f in /etc/cron.d/plato /etc/logrotate.d/plato; do
  if [[ -f "$f" ]]; then
    echo "[teardown] removing $f"
    run "rm -f \"$f\""
  fi
done

# ─── Cron logs ────────────────────────────────────────────────────────
shopt -s nullglob
for f in /var/log/plato*.log; do
  if [[ -f "$f" ]]; then
    echo "[teardown] removing $f"
    run "rm -f \"$f\""
  fi
done
shopt -u nullglob

# ─── Data (asks first) ────────────────────────────────────────────────
if [[ -d "$INSTALL_DIR" ]]; then
  if confirm "DELETE $INSTALL_DIR (db, posts, exports, .env, secret)?"; then
    run "rm -rf \"$INSTALL_DIR\""
  else
    echo "[teardown] kept $INSTALL_DIR"
  fi
fi

if [[ -d "$BACKUP_DIR" ]]; then
  if confirm "DELETE $BACKUP_DIR (every backup tarball)?"; then
    run "rm -rf \"$BACKUP_DIR\""
  else
    echo "[teardown] kept $BACKUP_DIR"
  fi
fi

if id -u "$PLATO_USER" >/dev/null 2>&1; then
  if confirm "remove system user $PLATO_USER?"; then
    run "userdel \"$PLATO_USER\" 2>/dev/null || true"
  fi
fi

if [[ -f /etc/msmtprc ]]; then
  if confirm "remove /etc/msmtprc (legacy relay credentials from pre-postfix deploys)?"; then
    run "rm -f /etc/msmtprc"
  fi
fi

echo
echo "[teardown] done."
echo
echo "Things this script DID NOT touch (intentionally):"
echo "  - SELinux setbool httpd_can_network_connect (harmless; useful for other apps)"
echo "  - any certbot-issued certs in /etc/letsencrypt"
echo "  - dnf-installed packages (nginx, certbot, postfix, opendkim, nodejs, sqlite)"
echo "  - postfix + opendkim configuration (operator owns these — they predate plato)"
echo "  - the plato git checkout (you cloned it; you remove it)"
