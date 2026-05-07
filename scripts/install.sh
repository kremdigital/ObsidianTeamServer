#!/usr/bin/env bash
# =============================================================================
# Obsidian Sync — installer for Ubuntu 22.04+ / Debian 12+.
#
# Idempotent: safe to re-run for upgrades and partial recoveries.
# Reads optional overrides from environment, otherwise prompts interactively.
#
# Usage:
#   sudo bash scripts/install.sh                 # interactive install
#   sudo NON_INTERACTIVE=1 DOMAIN=sync.example.com \
#        ADMIN_EMAIL=root@example.com ADMIN_PASSWORD=... \
#        bash scripts/install.sh                 # unattended
# =============================================================================
set -euo pipefail

# ---- Defaults ---------------------------------------------------------------
INSTALL_DIR="${INSTALL_DIR:-/opt/obsidian-sync}"
LOG_DIR="${LOG_DIR:-/var/log/obsidian-sync}"
STORAGE_DIR="${STORAGE_DIR:-/var/lib/obsidian-sync}"
SERVICE_USER="${SERVICE_USER:-obsidian}"
DB_NAME="${DB_NAME:-obsidian_sync}"
DB_USER="${DB_USER:-obsidian}"
NODE_MAJOR="${NODE_MAJOR:-20}"
PG_MAJOR="${PG_MAJOR:-16}"
REPO_URL="${REPO_URL:-}"

# ---- Output helpers ---------------------------------------------------------
COLOR_BLUE='\033[0;34m'
COLOR_GREEN='\033[0;32m'
COLOR_YELLOW='\033[0;33m'
COLOR_RED='\033[0;31m'
COLOR_RESET='\033[0m'

log()  { printf "${COLOR_BLUE}==>${COLOR_RESET} %s\n" "$*"; }
ok()   { printf "${COLOR_GREEN}✓${COLOR_RESET}  %s\n" "$*"; }
warn() { printf "${COLOR_YELLOW}!${COLOR_RESET}  %s\n" "$*" >&2; }
err()  { printf "${COLOR_RED}✗${COLOR_RESET}  %s\n" "$*" >&2; }

# ---- Pre-flight -------------------------------------------------------------
require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    err "This script must be run as root. Try: sudo bash scripts/install.sh"
    exit 1
  fi
}

detect_os() {
  if [[ ! -f /etc/os-release ]]; then
    err "/etc/os-release not found. This installer supports Debian/Ubuntu only."
    exit 1
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID}" in
    ubuntu|debian) ok "Detected ${PRETTY_NAME}" ;;
    *)             err "Unsupported OS: ${PRETTY_NAME}. This installer supports Debian/Ubuntu only."; exit 1 ;;
  esac
  OS_ID="${ID}"
  OS_CODENAME="${VERSION_CODENAME:-${UBUNTU_CODENAME:-stable}}"
}

# ---- System dependencies ----------------------------------------------------
install_system_deps() {
  log "Installing base system packages..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y \
    curl ca-certificates gnupg lsb-release \
    git build-essential \
    debian-keyring debian-archive-keyring apt-transport-https
  ok "System packages installed"
}

# ---- Node.js (NodeSource) ---------------------------------------------------
install_node() {
  if command -v node >/dev/null 2>&1 && node -v | grep -qE "^v${NODE_MAJOR}\."; then
    ok "Node.js $(node -v) already installed"
    return
  fi
  log "Installing Node.js ${NODE_MAJOR}.x via NodeSource..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
  ok "Node.js $(node -v) installed"
}

install_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    ok "pnpm $(pnpm -v) already installed"
    return
  fi
  log "Installing pnpm via npm..."
  npm install -g pnpm@latest
  ok "pnpm $(pnpm -v) installed"
}

# ---- PostgreSQL -------------------------------------------------------------
install_postgres() {
  if command -v psql >/dev/null 2>&1 && psql --version | grep -qE "psql \(PostgreSQL\) ${PG_MAJOR}"; then
    ok "PostgreSQL ${PG_MAJOR} already installed"
  else
    log "Installing PostgreSQL ${PG_MAJOR} (PGDG repo)..."
    install -d /etc/apt/keyrings
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
      gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
    chmod 644 /etc/apt/keyrings/postgresql.gpg
    echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt ${OS_CODENAME}-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    apt-get update -y
    apt-get install -y "postgresql-${PG_MAJOR}"
    ok "PostgreSQL ${PG_MAJOR} installed"
  fi

  systemctl enable --now postgresql
}

setup_db() {
  log "Ensuring database role and database exist..."
  # Generate a strong password if user didn't provide one (re-uses existing on re-run).
  if [[ -z "${DB_PASSWORD:-}" ]]; then
    if [[ -f "${INSTALL_DIR}/.env" ]] && grep -q '^DATABASE_URL=' "${INSTALL_DIR}/.env"; then
      # Reuse the password from the existing .env to keep idempotency.
      existing_url="$(grep '^DATABASE_URL=' "${INSTALL_DIR}/.env" | head -n1 | cut -d= -f2-)"
      DB_PASSWORD="$(echo "${existing_url}" | sed -nE 's|^postgresql://[^:]+:([^@]+)@.*$|\1|p')"
    fi
    if [[ -z "${DB_PASSWORD:-}" ]]; then
      DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
    fi
  fi

  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE "${DB_USER}" WITH LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB;
  ELSE
    ALTER ROLE "${DB_USER}" WITH LOGIN PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL

  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
  fi
  ok "DB role '${DB_USER}' and database '${DB_NAME}' ready"
}

# ---- Caddy ------------------------------------------------------------------
install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    ok "Caddy already installed ($(caddy version | head -n1))"
    return
  fi
  log "Installing Caddy from cloudsmith repo..."
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
    gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
    tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
  ok "Caddy installed"
}

# ---- Service user, dirs ------------------------------------------------------
ensure_service_user() {
  if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --create-home --shell /bin/bash "${SERVICE_USER}"
    ok "Created system user '${SERVICE_USER}'"
  fi
  install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${INSTALL_DIR}" "${LOG_DIR}" "${STORAGE_DIR}"
}

# ---- Interactive prompts ----------------------------------------------------
prompt_input() {
  local var_name="$1" prompt="$2" default="${3:-}" silent="${4:-}"
  local current="${!var_name:-}"
  if [[ -n "${current}" ]]; then
    return  # already set via env / prior call
  fi
  if [[ "${NON_INTERACTIVE:-0}" = "1" ]]; then
    if [[ -n "${default}" ]]; then
      printf -v "${var_name}" '%s' "${default}"
      return
    fi
    err "${var_name} is required in non-interactive mode."
    exit 1
  fi
  local input
  if [[ "${silent}" = "silent" ]]; then
    read -r -s -p "${prompt}: " input; echo
  else
    if [[ -n "${default}" ]]; then
      read -r -p "${prompt} [${default}]: " input
      input="${input:-${default}}"
    else
      read -r -p "${prompt}: " input
    fi
  fi
  printf -v "${var_name}" '%s' "${input}"
}

prompt_user() {
  log "Configuration"
  prompt_input DOMAIN          "Public domain (e.g. sync.example.com)"
  prompt_input ADMIN_EMAIL     "Super-admin email"
  prompt_input ADMIN_PASSWORD  "Super-admin password" "" silent

  prompt_input OPEN_REGISTRATION "Open registration (allow signups without invite)?" "false"
  prompt_input SMTP_HOST       "SMTP host (leave blank to use file logger)" ""
  if [[ -n "${SMTP_HOST}" ]]; then
    prompt_input SMTP_PORT     "SMTP port" "587"
    prompt_input SMTP_USER     "SMTP user" ""
    prompt_input SMTP_PASSWORD "SMTP password" "" silent
    prompt_input SMTP_FROM     "SMTP from address" "no-reply@${DOMAIN}"
  fi
}

# ---- Repo & app -------------------------------------------------------------
clone_or_update_repo() {
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    ok "Repo already at ${INSTALL_DIR} — skipping clone."
    return
  fi
  if [[ -z "${REPO_URL}" ]]; then
    # If the installer is running from inside a checked-out repo, copy that.
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local repo_root="${script_dir%/scripts}"
    if [[ -f "${repo_root}/package.json" ]]; then
      log "Copying local checkout from ${repo_root} to ${INSTALL_DIR}..."
      rsync -a --exclude=node_modules --exclude=.next --exclude=dist \
        --exclude=storage --exclude=storage-e2e --exclude=logs \
        "${repo_root}/" "${INSTALL_DIR}/"
      chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
      ok "Source copied"
      return
    fi
    err "No REPO_URL set and no local checkout found. Set REPO_URL=git@... or run from inside the repo."
    exit 1
  fi
  log "Cloning ${REPO_URL} into ${INSTALL_DIR}..."
  sudo -u "${SERVICE_USER}" git clone "${REPO_URL}" "${INSTALL_DIR}"
}

install_app() {
  log "Installing application dependencies..."
  pushd "${INSTALL_DIR}" >/dev/null
  sudo -u "${SERVICE_USER}" pnpm install --frozen-lockfile
  popd >/dev/null
  ok "Dependencies installed"
}

generate_env() {
  local env_file="${INSTALL_DIR}/.env"
  if [[ -f "${env_file}" ]]; then
    log ".env already exists — keeping existing secrets, only refreshing user-facing fields."
    update_env_field "${env_file}" PUBLIC_URL "https://${DOMAIN}"
    update_env_field "${env_file}" ADMIN_EMAIL "${ADMIN_EMAIL}"
    [[ -n "${ADMIN_PASSWORD:-}" ]] && update_env_field "${env_file}" ADMIN_PASSWORD "${ADMIN_PASSWORD}"
    update_env_field "${env_file}" OPEN_REGISTRATION "${OPEN_REGISTRATION:-false}"
    [[ -n "${SMTP_HOST:-}" ]]     && update_env_field "${env_file}" SMTP_HOST     "${SMTP_HOST}"
    [[ -n "${SMTP_PORT:-}" ]]     && update_env_field "${env_file}" SMTP_PORT     "${SMTP_PORT}"
    [[ -n "${SMTP_USER:-}" ]]     && update_env_field "${env_file}" SMTP_USER     "${SMTP_USER}"
    [[ -n "${SMTP_PASSWORD:-}" ]] && update_env_field "${env_file}" SMTP_PASSWORD "${SMTP_PASSWORD}"
    [[ -n "${SMTP_FROM:-}" ]]     && update_env_field "${env_file}" SMTP_FROM     "${SMTP_FROM}"
    chown "${SERVICE_USER}:${SERVICE_USER}" "${env_file}"
    chmod 600 "${env_file}"
    ok ".env refreshed"
    return
  fi

  log "Generating new .env..."
  local jwt_secret jwt_refresh
  jwt_secret="$(openssl rand -base64 64 | tr -d '\n')"
  jwt_refresh="$(openssl rand -base64 64 | tr -d '\n')"
  cat > "${env_file}" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}

JWT_SECRET=${jwt_secret}
JWT_REFRESH_SECRET=${jwt_refresh}
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

PORT_WEB=3000
PORT_SOCKET=3001
PUBLIC_URL=https://${DOMAIN}
STORAGE_PATH=${STORAGE_DIR}

OPEN_REGISTRATION=${OPEN_REGISTRATION:-false}

SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT:-587}
SMTP_USER=${SMTP_USER:-}
SMTP_PASSWORD=${SMTP_PASSWORD:-}
SMTP_FROM=${SMTP_FROM:-}

LOG_LEVEL=info
LOG_DIR=${LOG_DIR}

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

NODE_ENV=production
EOF
  chown "${SERVICE_USER}:${SERVICE_USER}" "${env_file}"
  chmod 600 "${env_file}"
  ok ".env generated"
}

update_env_field() {
  local file="$1" key="$2" value="$3"
  # Replace existing line or append.
  if grep -qE "^${key}=" "${file}"; then
    sed -i.bak -E "s|^${key}=.*|${key}=${value}|" "${file}" && rm -f "${file}.bak"
  else
    echo "${key}=${value}" >> "${file}"
  fi
}

build_app() {
  log "Building application..."
  pushd "${INSTALL_DIR}" >/dev/null
  sudo -u "${SERVICE_USER}" pnpm build
  popd >/dev/null
  ok "Build complete"
}

run_migrations() {
  log "Running Prisma migrations..."
  pushd "${INSTALL_DIR}" >/dev/null
  sudo -u "${SERVICE_USER}" pnpm exec prisma generate
  sudo -u "${SERVICE_USER}" pnpm exec prisma migrate deploy
  sudo -u "${SERVICE_USER}" pnpm exec tsx prisma/seed.ts
  popd >/dev/null
  ok "Migrations applied and seed run"
}

# ---- PM2 --------------------------------------------------------------------
install_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    ok "PM2 $(pm2 -v) already installed"
  else
    log "Installing PM2..."
    npm install -g pm2
    ok "PM2 installed"
  fi
}

start_services() {
  log "Starting services via PM2 (as ${SERVICE_USER})..."
  sudo -u "${SERVICE_USER}" -H bash -c "cd ${INSTALL_DIR} && pm2 startOrReload ecosystem.config.cjs --update-env"
  sudo -u "${SERVICE_USER}" -H bash -c "pm2 save"
  # Ensure PM2 starts on boot.
  if ! systemctl is-enabled "pm2-${SERVICE_USER}" >/dev/null 2>&1; then
    log "Configuring PM2 systemd integration..."
    env PATH="${PATH}:/usr/bin" pm2 startup systemd \
      -u "${SERVICE_USER}" --hp "/home/${SERVICE_USER}" --silent
  fi
  ok "Services running"
}

# ---- Caddy config -----------------------------------------------------------
configure_caddy() {
  log "Writing Caddyfile..."
  install -d /etc/caddy
  install -d -o caddy -g caddy /var/log/caddy 2>/dev/null || true

  if [[ -f "${INSTALL_DIR}/config/Caddyfile.example" ]]; then
    DOMAIN="${DOMAIN}" envsubst < "${INSTALL_DIR}/config/Caddyfile.example" \
      > /etc/caddy/Caddyfile
  else
    cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    encode gzip zstd
    handle /socket.io/* { reverse_proxy localhost:3001 }
    handle { reverse_proxy localhost:3000 }
    log { output file /var/log/caddy/access.log }
}
EOF
  fi
  systemctl reload caddy || systemctl restart caddy
  ok "Caddy configured for https://${DOMAIN}"
}

ensure_envsubst() {
  if ! command -v envsubst >/dev/null 2>&1; then
    apt-get install -y gettext-base
  fi
}

# ---- Final ------------------------------------------------------------------
finalize() {
  cat <<EOF

${COLOR_GREEN}✓ Obsidian Sync installed.${COLOR_RESET}

  URL:           https://${DOMAIN}
  Super-admin:   ${ADMIN_EMAIL}
  App directory: ${INSTALL_DIR}
  Logs:          ${LOG_DIR}
  Storage:       ${STORAGE_DIR}

Useful commands:
  sudo -u ${SERVICE_USER} pm2 status
  sudo -u ${SERVICE_USER} pm2 logs obsidian-sync-web
  sudo -u ${SERVICE_USER} pm2 logs obsidian-sync-socket
  sudo systemctl status caddy

Re-run this script to upgrade to a newer commit (it's idempotent).
EOF
}

# ---- Main -------------------------------------------------------------------
main() {
  require_root
  detect_os
  install_system_deps
  install_node
  install_pnpm
  install_postgres
  install_caddy
  ensure_envsubst
  ensure_service_user
  setup_db
  prompt_user
  clone_or_update_repo
  install_app
  generate_env
  build_app
  run_migrations
  install_pm2
  start_services
  configure_caddy
  finalize
}

main "$@"
