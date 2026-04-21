#!/usr/bin/env bash
# Local dev: only postgres + redis in Docker. All 4 services run on host via yarn.
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

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[dev]${NC} $*"; }
warn()  { echo -e "${YELLOW}[dev]${NC} $*"; }
error() { echo -e "${RED}[dev]${NC} $*"; exit 1; }

# Host ports for infra (non-default to avoid conflicts with other local projects)
export POSTGRES_HOST_PORT=5433
export REDIS_HOST_PORT=6380

# Shared env overrides — services read localhost on these ports
export DATABASE_URL="postgresql://postgres:postgres@localhost:${POSTGRES_HOST_PORT}/appdb"
export REDIS_HOST=localhost
export REDIS_PORT="${REDIS_HOST_PORT}"

command -v docker   >/dev/null 2>&1 || error "docker not found"
command -v node     >/dev/null 2>&1 || error "node not found"
command -v corepack >/dev/null 2>&1 || error "corepack not found (Node 16+)"
corepack enable >/dev/null 2>&1 || true
command -v yarn     >/dev/null 2>&1 || error "yarn not found (run: corepack prepare yarn@4.9.1 --activate)"

# Internal mTLS certs (inter-service TCP). Generated lazily on first run.
CERT_DIR="$ROOT/secrets/internal-ca"
if [ ! -f "$CERT_DIR/ca.crt" ]; then
  info "Generating internal CA + service certs ($CERT_DIR)"
  "$ROOT/scripts/gen-certs.sh"
fi
export TLS_ENABLED=true
export TLS_CA_PATH="$CERT_DIR/ca.crt"
# Each service overrides TLS_CERT_PATH / TLS_KEY_PATH below.

# Shared inter-service key (dev value; production must come from a real secret store)
export SYSTEM_KEY="${SYSTEM_KEY:-dev-internal-system-key-min-32-chars-ok}"
# Bind TCP microservices to loopback so the wire is only reachable from this host.
export TCP_BIND="${TCP_BIND:-127.0.0.1}"

NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[ "$NODE_VER" -ge 22 ] || warn "Node 22+ recommended (found $NODE_VER)"

PIDS=()
cleanup() {
  info "Stopping services..."
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  info "Stopping infra..."
  docker compose -f "$ROOT/docker-compose.infra.yml" down 2>/dev/null || true
  info "Done."
}
trap cleanup EXIT INT TERM

info "Starting postgres + redis (host ports ${POSTGRES_HOST_PORT}/${REDIS_HOST_PORT})..."
docker compose -f "$ROOT/docker-compose.infra.yml" up -d

info "Waiting for postgres..."
until docker compose -f "$ROOT/docker-compose.infra.yml" exec -T postgres \
    pg_isready -U postgres -q 2>/dev/null; do sleep 1; done
info "Postgres ready."

info "Waiting for redis..."
until docker compose -f "$ROOT/docker-compose.infra.yml" exec -T redis \
    redis-cli ping 2>/dev/null | grep -q PONG; do sleep 1; done
info "Redis ready."

if [ "$SKIP_INSTALL" = false ]; then
  info "Installing workspace deps (yarn)..."
  (cd "$ROOT" && yarn install --no-immutable)
fi

if [ "$SKIP_SEED" = false ]; then
  info "Seeding database..."
  (cd "$ROOT/src/auth-service" && yarn seed)
fi

LOGS="$ROOT/.dev-logs"
mkdir -p "$LOGS"

start_service() {
  local name="$1" dir="$2" cmd="$3" env_file="$4" svc_cert="$5"
  info "Starting $name..."
  (
    # Service-specific env first, then override with host-aware values
    if [ -f "$env_file" ]; then set -a; source "$env_file"; set +a; fi
    export DATABASE_URL REDIS_HOST REDIS_PORT SYSTEM_KEY TCP_BIND
    # WORKERS_ENABLED is also re-exported here so a per-call prefix
    # (e.g. `WORKERS_ENABLED=true start_service backend …`) wins over
    # whatever the .env file set.
    if [ -n "${WORKERS_ENABLED+set}" ]; then export WORKERS_ENABLED; fi
    if [ "$TLS_ENABLED" = "true" ] && [ -n "$svc_cert" ]; then
      export TLS_ENABLED
      export TLS_CA_PATH
      export TLS_CERT_PATH="$CERT_DIR/$svc_cert.crt"
      export TLS_KEY_PATH="$CERT_DIR/$svc_cert.key"
    fi
    cd "$dir"
    eval "$cmd" > "$LOGS/$name.log" 2>&1
  ) &
  PIDS+=($!)
  echo "  $name  →  $LOGS/$name.log  (pid $!)"
}

start_service "auth-service" "$ROOT/src/auth-service" "yarn start:dev" "$ROOT/src/auth-service/.env" "auth-service"
sleep 4
# Backend runs the BullMQ workers inline when WORKERS_ENABLED=true. Without
# this export, `dev-local.sh` would never drain the user-cascade-delete /
# retention-prune / attachments-cleanup / abuse-report-notify queues — jobs
# would accumulate in Redis. `dev.sh` (full Docker) already starts a
# dedicated `backend-worker` container; `dev-local.sh` colocates them.
WORKERS_ENABLED=true start_service "backend" "$ROOT/src/backend" "yarn start:dev" "$ROOT/src/backend/.env" "backend"
sleep 3
start_service "bff"          "$ROOT/src/bff"          "yarn start:dev" "$ROOT/src/bff/.env"          "bff"
sleep 2
start_service "frontend"     "$ROOT/src/frontend"     "yarn dev"       "$ROOT/src/frontend/.env"    ""

echo ""
info "All services started."
echo ""
echo "  Frontend  →  http://localhost:3007"
echo "  BFF API   →  http://localhost:3006/api/v1"
echo "  Auth HTTP →  http://localhost:3003/api/v1"
echo "  Postgres  →  localhost:${POSTGRES_HOST_PORT}"
echo "  Redis     →  localhost:${REDIS_HOST_PORT}"
echo "  Logs      →  $LOGS/"
echo ""
echo "  Test users:"
echo "    admin@example.com     /  Admin123!    (admin)"
echo "    user@example.com      /  User1234!    (user, no 2FA)"
echo "    user2fa@example.com   /  Secure2FA!   (user, 2FA ON)"
echo ""
info "Press Ctrl+C to stop."

wait
