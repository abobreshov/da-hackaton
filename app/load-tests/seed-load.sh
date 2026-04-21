#!/usr/bin/env bash
# seed-load.sh — prepare data for the k6 load-test scripts.
#
# What it does:
#   1. Ensures the standard seed has run (admin / user / user2fa exist).
#   2. Ensures the demo seed has run (rooms `general` / `random` / `demo`
#      with id 1 = general assumed).
#   3. (Optional) Documents how to bulk-create N extra users; we DO NOT
#      modify the auth-service seed script per project policy. Until a
#      bulk endpoint exists, register N users by hitting POST /api/v1/auth/register.
#
# Usage:
#   ./app/load-tests/seed-load.sh                # idempotent baseline seed
#   ./app/load-tests/seed-load.sh --register N   # also register N loadtest users
#
# Pre-reqs: Yarn 4 + Postgres reachable (matches `./dev.sh` or `./dev-local.sh`).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

BFF_BASE="${BFF_BASE:-http://localhost:3006/api/v1}"
ORIGIN="${ORIGIN:-http://localhost:3007}"
EXTRA=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --register)
      EXTRA="${2:-0}"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *)
      echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

echo "[seed-load] running auth-service seed (admin/user/user2fa)…"
( cd "${APP_DIR}" && yarn workspace @app/auth-service seed )

echo "[seed-load] running backend demo seed (rooms general/random/demo)…"
( cd "${APP_DIR}" && yarn workspace @app/backend seed:demo ) || \
  echo "[seed-load] WARN: backend demo seed failed — room id 1 may not exist."

if [[ "${EXTRA}" -gt 0 ]]; then
  echo "[seed-load] registering ${EXTRA} loadtest users via BFF /auth/register…"
  echo "[seed-load] NOTE: registration returns 202 regardless; verify-email is required"
  echo "             before login works. Production load tests should use a backend"
  echo "             bulk-create endpoint that bypasses email verification."
  for i in $(seq 1 "${EXTRA}"); do
    EMAIL="loadtest+${i}@example.com"
    USERNAME="loadtest${i}"
    PASSWORD="LoadTest123!"
    curl -sS -X POST "${BFF_BASE}/auth/register" \
      -H "Content-Type: application/json" \
      -H "Origin: ${ORIGIN}" \
      -H "Referer: ${ORIGIN}/" \
      -d "{\"email\":\"${EMAIL}\",\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}" \
      >/dev/null && echo "  - ${EMAIL} registered (verify-email pending)"
  done
fi

echo "[seed-load] done."
echo "[seed-load] room id used by k6-message-burst.js defaults to 1 (=#general)."
echo "[seed-load] verify with: psql … -c 'select id, name from rooms order by id;'"
