#!/usr/bin/env bash
# Docker dev: all services in Docker with hot-reload. Only frontend + BFF exposed to host.
# Usage: ./dev.sh [--no-seed] [--build]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
NO_SEED=false
BUILD_FLAG=""

for arg in "$@"; do
  case $arg in
    --no-seed) NO_SEED=true ;;
    --build)   BUILD_FLAG="--build" ;;
  esac
done

GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${GREEN}[dev]${NC} $*"; }

command -v docker >/dev/null 2>&1 || { echo "docker not found"; exit 1; }

cleanup() {
  info "Stopping..."
  docker compose -f "$ROOT/docker-compose.dev.yml" down
}
trap cleanup EXIT INT TERM

info "Starting all services in Docker..."
docker compose -f "$ROOT/docker-compose.dev.yml" up -d $BUILD_FLAG

info "Waiting for postgres..."
until docker compose -f "$ROOT/docker-compose.dev.yml" exec -T postgres \
    pg_isready -U postgres -q 2>/dev/null; do
  sleep 1
done

if [ "$NO_SEED" = false ]; then
  info "Seeding database..."
  docker compose -f "$ROOT/docker-compose.dev.yml" exec auth-service \
    sh -c "cd /app && yarn seed" 2>/dev/null || \
  docker compose -f "$ROOT/docker-compose.dev.yml" exec auth-service \
    sh -c "node /app/scripts/seed.mjs" 2>/dev/null || \
  info "Seed skipped (service may still be starting)"
fi

if [ "$NO_SEED" = false ]; then
  info "Seeding demo rooms..."
  docker compose -f "$ROOT/docker-compose.dev.yml" exec backend \
    sh -c "cd /app && yarn seed:demo" 2>/dev/null || \
  info "Demo-room seed skipped (backend may still be starting)"
fi

echo ""
info "Dev environment running."
echo ""
echo "  Frontend  →  http://localhost:3007"
echo "  BFF API   →  http://localhost:3006/api/v1"
echo "  Mailpit   →  http://localhost:8025  (SMTP capture + search + REST API)"
echo "  Dozzle    →  http://localhost:9999  (container logs)"
echo ""
echo "  Test users:"
echo "    admin@example.com  /  Admin123!  (admin)"
echo "    user@example.com   /  User1234!  (user)"
echo ""
echo "  Logs:  docker compose -f docker-compose.dev.yml logs -f [service]"
info "Press Ctrl+C to stop."

docker compose -f "$ROOT/docker-compose.dev.yml" logs -f
