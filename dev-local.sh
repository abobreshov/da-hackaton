#!/usr/bin/env bash
# Local dev: infra (postgres + redis) in Docker, services run on host with hot-reload.
# Usage: ./dev-local.sh [--skip-install] [--skip-seed]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SKIP_INSTALL=false
SKIP_SEED=false

for arg in "$@"; do
  case $arg in
    --skip-install) SKIP_INSTALL=true ;;
    --skip-seed)    SKIP_SEED=true ;;
  esac
done

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[dev]${NC} $*"; }
warn()  { echo -e "${YELLOW}[dev]${NC} $*"; }
error() { echo -e "${RED}[dev]${NC} $*"; exit 1; }

# ── Prerequisites ────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || error "docker not found"
command -v node   >/dev/null 2>&1 || error "node not found"
command -v npm    >/dev/null 2>&1 || error "npm not found"

NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[ "$NODE_VER" -ge 22 ] || warn "Node 22+ recommended (found $NODE_VER)"

# ── Cleanup on exit ──────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  info "Stopping all services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  info "Stopping infra..."
  docker compose -f "$ROOT/docker-compose.infra.yml" down 2>/dev/null || true
  info "Done."
}
trap cleanup EXIT INT TERM

# ── Start infra ──────────────────────────────────────────────────────────────
info "Starting postgres + redis..."
docker compose -f "$ROOT/docker-compose.infra.yml" up -d

info "Waiting for postgres..."
until docker compose -f "$ROOT/docker-compose.infra.yml" exec -T postgres \
    pg_isready -U postgres -q 2>/dev/null; do
  sleep 1
done
info "Postgres ready."

info "Waiting for redis..."
until docker compose -f "$ROOT/docker-compose.infra.yml" exec -T redis \
    redis-cli ping 2>/dev/null | grep -q PONG; do
  sleep 1
done
info "Redis ready."

# ── Load .env files ──────────────────────────────────────────────────────────
load_env() {
  local file="$1"
  if [ -f "$file" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$file"
    set +a
  fi
}

# ── Install deps ─────────────────────────────────────────────────────────────
if [ "$SKIP_INSTALL" = false ]; then
  for svc in auth-service backend bff; do
    info "Installing $svc deps..."
    (cd "$ROOT/src/$svc" && npm install --silent)
  done
  info "Installing frontend deps..."
  (cd "$ROOT/src/frontend" && npm install --silent)
fi

# ── Seed DB ──────────────────────────────────────────────────────────────────
if [ "$SKIP_SEED" = false ]; then
  info "Seeding database..."
  (
    load_env "$ROOT/src/auth-service/.env"
    cd "$ROOT/src/auth-service"
    npm run seed
  )
fi

# ── Start services in background ─────────────────────────────────────────────
LOGS="$ROOT/.dev-logs"
mkdir -p "$LOGS"

start_service() {
  local name="$1"
  local dir="$2"
  local cmd="$3"
  local env_file="$4"

  info "Starting $name..."
  (
    [ -f "$env_file" ] && set -a && source "$env_file" && set +a
    cd "$dir"
    eval "$cmd" > "$LOGS/$name.log" 2>&1
  ) &
  PIDS+=($!)
  echo "  $name  →  $LOGS/$name.log  (pid $!)"
}

start_service "auth-service" \
  "$ROOT/src/auth-service" \
  "npm run start:dev" \
  "$ROOT/src/auth-service/.env"

# Wait for auth-service to be up before starting backend
sleep 4

start_service "backend" \
  "$ROOT/src/backend" \
  "npm run start:dev" \
  "$ROOT/src/backend/.env"

sleep 3

start_service "bff" \
  "$ROOT/src/bff" \
  "npm run start:dev" \
  "$ROOT/src/bff/.env"

sleep 2

start_service "frontend" \
  "$ROOT/src/frontend" \
  "npm run dev" \
  "$ROOT/src/frontend/.env"

echo ""
info "All services started."
echo ""
echo "  Frontend  →  http://localhost:3007"
echo "  BFF API   →  http://localhost:3006/api/v1"
echo "  Logs      →  $LOGS/"
echo ""
echo "  Test users:"
echo "    admin@example.com  /  Admin123!  (admin)"
echo "    user@example.com   /  User1234!  (user)"
echo ""
info "Press Ctrl+C to stop."

# ── Wait ─────────────────────────────────────────────────────────────────────
wait
