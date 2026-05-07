#!/usr/bin/env bash
# =============================================================================
# Obsidian Sync — upgrade. Pulls the latest code, reinstalls deps, runs
# migrations, rebuilds and reloads PM2 processes (zero-downtime restart).
#
# Run as root from anywhere; INSTALL_DIR is read from env or defaults to
# /opt/obsidian-sync.
# =============================================================================
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/obsidian-sync}"
SERVICE_USER="${SERVICE_USER:-obsidian}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Must be run as root." >&2
  exit 1
fi

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  echo "No git checkout at ${INSTALL_DIR} — nothing to upgrade." >&2
  exit 1
fi

step() { printf '\033[0;34m==>\033[0m %s\n' "$*"; }

step "Fetching latest changes..."
sudo -u "${SERVICE_USER}" -H bash -c "cd '${INSTALL_DIR}' && git fetch --all --tags && git pull --ff-only"

step "Installing dependencies..."
sudo -u "${SERVICE_USER}" -H bash -c "cd '${INSTALL_DIR}' && pnpm install --frozen-lockfile"

step "Running migrations..."
sudo -u "${SERVICE_USER}" -H bash -c "cd '${INSTALL_DIR}' && pnpm exec prisma generate && pnpm exec prisma migrate deploy"

step "Building..."
sudo -u "${SERVICE_USER}" -H bash -c "cd '${INSTALL_DIR}' && pnpm build"

step "Reloading PM2 processes..."
sudo -u "${SERVICE_USER}" -H bash -c "cd '${INSTALL_DIR}' && pm2 reload ecosystem.config.cjs --update-env"
sudo -u "${SERVICE_USER}" -H pm2 save >/dev/null

step "Done."
sudo -u "${SERVICE_USER}" -H pm2 status
