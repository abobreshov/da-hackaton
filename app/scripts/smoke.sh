#!/usr/bin/env bash
# Smoke-test: boots the dev stack, verifies health, logs in as seed admin,
# asserts session endpoint returns authed user. Satisfies brief §7 submission req.
# Usage: ./scripts/smoke.sh           (tears stack down on exit)
#        SMOKE_KEEP=1 ./scripts/smoke.sh (keeps stack up for grader inspection)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"
COOKIE_JAR="$(mktemp -t smoke-cookies.XXXXXX)"
BODY_FILE="$(mktemp -t smoke-body.XXXXXX)"

# Colour only if stdout is a TTY.
if [ -t 1 ]; then
  C_GREEN='\033[0;32m'
  C_RED='\033[0;31m'
  C_YELLOW='\033[0;33m'
  C_RESET='\033[0m'
else
  C_GREEN=''
  C_RED=''
  C_YELLOW=''
  C_RESET=''
fi

info() { printf '%b[smoke]%b %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%b[smoke]%b %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '%b[smoke FAIL]%b %s\n' "$C_RED" "$C_RESET" "$*" >&2; }

EXIT_CODE=0

cleanup() {
  local ec=$?
  rm -f "$COOKIE_JAR" "$BODY_FILE" 2>/dev/null || true
  if [ "${SMOKE_KEEP:-0}" = "1" ]; then
    warn "SMOKE_KEEP=1 — leaving stack up. Tear down manually:"
    warn "  docker compose $COMPOSE_FILES down"
  else
    info "Tearing down stack..."
    docker compose $COMPOSE_FILES down >/dev/null 2>&1 || true
  fi
  exit "$ec"
}
trap cleanup EXIT INT TERM

# --- prereqs ---------------------------------------------------------------
command -v docker >/dev/null 2>&1 || { fail "docker not found in PATH"; exit 1; }
command -v curl   >/dev/null 2>&1 || { fail "curl not found in PATH";   exit 1; }

# --- certs -----------------------------------------------------------------
if [ ! -d "$APP_DIR/secrets/internal-ca" ]; then
  info "Certs missing — running scripts/gen-certs.sh..."
  "$APP_DIR/scripts/gen-certs.sh"
else
  info "Certs present — skipping gen-certs.sh."
fi

# --- bring stack up --------------------------------------------------------
info "Starting stack (docker compose up -d --build)..."
docker compose $COMPOSE_FILES up -d --build

# --- health poll -----------------------------------------------------------
# Each target: "label|url|accept_codes"  (accept_codes comma-separated).
TARGETS=(
  "frontend|http://localhost:3007/|200,301,302,304"
  "bff|http://localhost:3006/api/v1/auth/session|200,401,403"
  "mailpit|http://localhost:8025/|200"
)

wait_for() {
  local label="$1" url="$2" accept="$3"
  local deadline=$(( $(date +%s) + 120 ))
  local code
  info "Waiting for $label ($url)..."
  while [ "$(date +%s)" -lt "$deadline" ]; do
    code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || echo "000")
    case ",$accept," in
      *",$code,"*) info "  $label up (HTTP $code)"; return 0 ;;
    esac
    sleep 2
  done
  fail "$label did not become healthy within 120s (last HTTP $code)"
  return 1
}

for target in "${TARGETS[@]}"; do
  IFS='|' read -r label url accept <<<"$target"
  wait_for "$label" "$url" "$accept" || exit 1
done

# --- login assertion -------------------------------------------------------
info "POST /auth/login with seed admin creds..."
LOGIN_CODE=$(curl -sS -o "$BODY_FILE" -w '%{http_code}' \
  -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -X POST \
  --data '{"email":"admin@example.com","password":"Admin123!"}' \
  "http://localhost:3006/api/v1/auth/login" || echo "000")

if [ "$LOGIN_CODE" != "200" ]; then
  fail "login expected HTTP 200, got $LOGIN_CODE"
  fail "response body: $(head -c 500 "$BODY_FILE")"
  exit 1
fi

if ! grep -qi 'session' "$COOKIE_JAR"; then
  fail "login did not set a session cookie. Cookie jar:"
  cat "$COOKIE_JAR" >&2
  exit 1
fi
info "  login OK — session cookie set."

# --- session assertion -----------------------------------------------------
info "GET /auth/session with cookie jar..."
SESSION_CODE=$(curl -sS -o "$BODY_FILE" -w '%{http_code}' \
  -b "$COOKIE_JAR" \
  "http://localhost:3006/api/v1/auth/session" || echo "000")

if [ "$SESSION_CODE" != "200" ]; then
  fail "session expected HTTP 200, got $SESSION_CODE"
  fail "response body: $(head -c 500 "$BODY_FILE")"
  exit 1
fi

if ! grep -q '"email":"admin@example.com"' "$BODY_FILE"; then
  fail "session body missing expected email. Body:"
  head -c 500 "$BODY_FILE" >&2
  echo >&2
  exit 1
fi
info "  session OK — body contains admin@example.com."

# --- success ---------------------------------------------------------------
printf '%bSMOKE OK%b\n' "$C_GREEN" "$C_RESET"
exit 0
