#!/usr/bin/env bash
# logs.sh — pretty live tail of the dev-local stack logs under app/.dev-logs/.
#
# Tails auth-service.log, backend.log, bff.log, frontend.log in parallel, prefixes
# each line with a coloured [service] label, then pipes through pino-pretty so
# JSON Pino entries become readable. Vite (frontend) plain-text lines pass through.
#
# Usage:
#   ./scripts/logs.sh                          # all 4 services
#   ./scripts/logs.sh --service=bff            # one service only
#   ./scripts/logs.sh --filter='POST /auth'    # grep before pino-pretty
#   ./scripts/logs.sh -h | --help

set -euo pipefail

# ---- locate repo + app dir ---------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/.." && pwd)"
cd "$REPO_ROOT"
cd "$APP_DIR"

LOG_DIR="$APP_DIR/.dev-logs"

# ---- defaults ----------------------------------------------------------------
SERVICE=""
FILTER=""

usage() {
  cat <<'EOF'
logs.sh — pretty live tail of dev-local stack logs (app/.dev-logs/*.log)

Options:
  --service=<name>   tail only one service: auth-service|backend|bff|frontend
  --filter=<regex>   grep --line-buffered each line before pino-pretty
  -h, --help         show this help

Sample output:
  [bff]      SYS:14:22:01.123 INFO  request completed url=/api/me status=200
  [auth]     SYS:14:22:01.450 WARN  2fa challenge issued userId=42
  [frontend] [vite] hmr update /src/App.tsx
EOF
}

# ---- arg parse ---------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --service=*) SERVICE="${arg#--service=}" ;;
    --filter=*)  FILTER="${arg#--filter=}" ;;
    -h|--help)   usage; exit 0 ;;
    *)
      echo "logs.sh: unknown arg: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# ---- validate ----------------------------------------------------------------
if [[ ! -d "$LOG_DIR" ]]; then
  echo "logs.sh: no log dir at $LOG_DIR — start the stack first (./dev-local.sh)" >&2
  exit 1
fi

declare -A LABEL_TO_FILE=(
  [auth]="$LOG_DIR/auth-service.log"
  [backend]="$LOG_DIR/backend.log"
  [bff]="$LOG_DIR/bff.log"
  [frontend]="$LOG_DIR/frontend.log"
)

# normalise --service value (accept both 'auth' and 'auth-service')
case "$SERVICE" in
  ""|auth|auth-service) [[ -n "$SERVICE" ]] && SERVICE="auth" ;;
  backend|bff|frontend) ;;
  *)
    echo "logs.sh: --service must be one of auth-service|backend|bff|frontend" >&2
    exit 2
    ;;
esac

# ---- ANSI colour per label ---------------------------------------------------
# 256-colour fg codes — picks distinct tones, resilient on dark terminals.
declare -A LABEL_COLOR=(
  [auth]=$'\033[38;5;213m'      # pink
  [backend]=$'\033[38;5;120m'   # green
  [bff]=$'\033[38;5;75m'        # blue
  [frontend]=$'\033[38;5;215m'  # orange
)
RESET=$'\033[0m'

# ---- pick which labels to follow --------------------------------------------
if [[ -n "$SERVICE" ]]; then
  LABELS=("$SERVICE")
else
  LABELS=(auth backend bff frontend)
fi

# ---- ensure target files exist (touch so tail -F doesn't whine) -------------
for label in "${LABELS[@]}"; do
  f="${LABEL_TO_FILE[$label]}"
  [[ -f "$f" ]] || : > "$f"
done

# ---- spawn one labelled tail per service, merge into a fifo -----------------
TMP_FIFO="$(mktemp -u -t logs-sh.XXXXXX).fifo"
mkfifo "$TMP_FIFO"

cleanup() {
  # kill background tails; ignore errors
  if [[ -n "${TAIL_PIDS:-}" ]]; then
    # shellcheck disable=SC2086
    kill $TAIL_PIDS 2>/dev/null || true
  fi
  rm -f "$TMP_FIFO"
}
trap cleanup EXIT INT TERM

TAIL_PIDS=""
for label in "${LABELS[@]}"; do
  f="${LABEL_TO_FILE[$label]}"
  color="${LABEL_COLOR[$label]}"
  # left-pad label to 9 chars for visual alignment
  prefix=$(printf '%s[%-9s]%s ' "$color" "$label" "$RESET")
  (
    # tail -F survives log rotation; awk prepends prefix line-buffered.
    tail -n 0 -F "$f" 2>/dev/null \
      | awk -v p="$prefix" '{ print p $0; fflush() }'
  ) >"$TMP_FIFO" &
  TAIL_PIDS="$TAIL_PIDS $!"
done

# ---- pipeline: merged stream -> [grep] -> pino-pretty -----------------------
PINO_ARGS=(-i pid,hostname,reqId -t 'SYS:HH:MM:ss.l')

if [[ -n "$FILTER" ]]; then
  # shellcheck disable=SC2002
  cat "$TMP_FIFO" \
    | grep --line-buffered -E "$FILTER" \
    | npx --yes pino-pretty "${PINO_ARGS[@]}"
else
  cat "$TMP_FIFO" | npx --yes pino-pretty "${PINO_ARGS[@]}"
fi
