#!/usr/bin/env bash
# =============================================================================
# Obsidian Team — uninstaller. Always asks before destructive action.
#
# Removes:
#   - PM2 processes and systemd integration
#   - Caddyfile entry
#   - Application directory  (preserves /var/lib/obsidian-sync by default)
#   - Database and DB role   (only when --drop-db is passed)
#
# Usage:
#   sudo bash scripts/uninstall.sh
#   sudo bash scripts/uninstall.sh --drop-db --drop-storage --yes
# =============================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/obsidian-sync}"
LOG_DIR="${LOG_DIR:-/var/log/obsidian-sync}"
STORAGE_DIR="${STORAGE_DIR:-/var/lib/obsidian-sync}"
SERVICE_USER="${SERVICE_USER:-obsidian}"
DB_NAME="${DB_NAME:-obsidian_sync}"
DB_USER="${DB_USER:-obsidian}"

DROP_DB=0
DROP_STORAGE=0
ASSUME_YES=0

for arg in "$@"; do
  case "${arg}" in
    --drop-db)      DROP_DB=1 ;;
    --drop-storage) DROP_STORAGE=1 ;;
    --yes|-y)       ASSUME_YES=1 ;;
    *) echo "Unknown flag: ${arg}" >&2; exit 1 ;;
  esac
done

if [[ "${EUID}" -ne 0 ]]; then
  echo "Must be run as root." >&2
  exit 1
fi

confirm() {
  local prompt="$1"
  if [[ "${ASSUME_YES}" -eq 1 ]]; then return 0; fi
  read -r -p "${prompt} [y/N]: " ans
  [[ "${ans}" =~ ^[Yy]$ ]]
}

echo "About to uninstall Obsidian Team from ${INSTALL_DIR}."
confirm "Continue?" || { echo "Cancelled."; exit 0; }

# 1. PM2: stop processes + kill the God Daemon + remove startup hook.
#
# Killing the PM2 daemon is essential — `userdel` later refuses to remove
# the service user while it still owns running processes (exit code 8).
SERVICE_UID=""
if id "${SERVICE_USER}" >/dev/null 2>&1; then
  SERVICE_UID="$(id -u "${SERVICE_USER}")"
  if sudo -u "${SERVICE_USER}" -H pm2 list >/dev/null 2>&1; then
    sudo -u "${SERVICE_USER}" -H pm2 delete obsidian-sync-web obsidian-sync-socket 2>/dev/null || true
    sudo -u "${SERVICE_USER}" -H pm2 save --force >/dev/null 2>&1 || true
  fi
  sudo -u "${SERVICE_USER}" -H pm2 kill >/dev/null 2>&1 || true
  systemctl disable --now "pm2-${SERVICE_USER}" 2>/dev/null || true
  rm -f "/etc/systemd/system/pm2-${SERVICE_USER}.service"
  systemctl daemon-reload
  echo "✓ PM2 services removed"
fi

# 2. Caddy: remove site block — we just delete the whole Caddyfile and reload,
# since this installer creates a single-host file. Operators with custom mixed
# Caddyfiles should remove the host manually.
if [[ -f /etc/caddy/Caddyfile ]] && grep -q "${DB_NAME:-obsidian_sync}\|reverse_proxy localhost:3000" /etc/caddy/Caddyfile; then
  if confirm "Delete /etc/caddy/Caddyfile?"; then
    rm -f /etc/caddy/Caddyfile
    systemctl reload caddy 2>/dev/null || true
    echo "✓ Caddyfile removed"
  fi
fi

# 3. App directory.
if [[ -d "${INSTALL_DIR}" ]]; then
  if confirm "Remove ${INSTALL_DIR}?"; then
    rm -rf "${INSTALL_DIR}"
    echo "✓ App directory removed"
  fi
fi

# 4. Logs.
if [[ -d "${LOG_DIR}" ]]; then
  if confirm "Remove ${LOG_DIR}?"; then
    rm -rf "${LOG_DIR}"
    echo "✓ Logs removed"
  fi
fi

# 5. Storage.
if [[ "${DROP_STORAGE}" -eq 1 || -d "${STORAGE_DIR}" ]] && [[ "${DROP_STORAGE}" -eq 1 ]]; then
  rm -rf "${STORAGE_DIR}"
  echo "✓ Storage removed"
elif [[ -d "${STORAGE_DIR}" ]]; then
  echo "ℹ  Preserving ${STORAGE_DIR} (pass --drop-storage to delete)"
fi

# 6. Database.
if [[ "${DROP_DB}" -eq 1 ]]; then
  if command -v psql >/dev/null 2>&1; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL || true
DROP DATABASE IF EXISTS "${DB_NAME}";
DROP ROLE IF EXISTS "${DB_USER}";
SQL
    echo "✓ DB and role dropped"
  fi
else
  echo "ℹ  Preserving DB '${DB_NAME}' (pass --drop-db to drop)"
fi

# 7. Service user. Clean per-uid scratch dirs (e.g. /tmp/tsx-<uid>) first —
# userdel doesn't touch /tmp.
if id "${SERVICE_USER}" >/dev/null 2>&1 && confirm "Remove service user '${SERVICE_USER}'?"; then
  if [[ -n "${SERVICE_UID}" ]]; then
    rm -rf "/tmp/tsx-${SERVICE_UID}" 2>/dev/null || true
  fi
  if userdel -r "${SERVICE_USER}" 2>&1; then
    echo "✓ Service user removed"
  else
    echo "✗ userdel failed — the user still exists. Common causes: lingering"
    echo "  processes (run 'ps -u ${SERVICE_USER}' and kill them) or files"
    echo "  outside /home/${SERVICE_USER} owned by the user."
    exit 1
  fi
fi

echo "Done."
