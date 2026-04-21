#!/usr/bin/env bash
# Reviewer-ready test gauntlet: build + unit-test all workspaces, typecheck e2e,
# print a coloured summary table with per-workspace test counts.
#
# Usage:
#   ./scripts/smoke.sh                     # full run
#   ./scripts/smoke.sh --skip-build        # tests only
#   ./scripts/smoke.sh --skip-tests        # builds only (still typechecks e2e)
#   ./scripts/smoke.sh --workspace=@app/bff   # restrict to one workspace
#
# Exit code: 0 on success, 1 on first failure.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

# --- flags -----------------------------------------------------------------
SKIP_BUILD=0
SKIP_TESTS=0
ONLY_WS=""
for arg in "$@"; do
  case "$arg" in
    --skip-build)        SKIP_BUILD=1 ;;
    --skip-tests)        SKIP_TESTS=1 ;;
    --workspace=*)       ONLY_WS="${arg#--workspace=}" ;;
    -h|--help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown flag: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

# --- colour ----------------------------------------------------------------
if [ -t 1 ]; then
  C_GREEN='\033[0;32m'
  C_RED='\033[0;31m'
  C_YELLOW='\033[0;33m'
  C_DIM='\033[2m'
  C_BOLD='\033[1m'
  C_RESET='\033[0m'
  CHECK='✓'
  CROSS='✗'
  DASH='—'
else
  C_GREEN=''; C_RED=''; C_YELLOW=''; C_DIM=''; C_BOLD=''; C_RESET=''
  CHECK='OK'
  CROSS='FAIL'
  DASH='-'
fi

info() { printf '%b[smoke]%b %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%b[smoke]%b %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '%b[smoke FAIL]%b %s\n' "$C_RED" "$C_RESET" "$*" >&2; }

# --- workspace registry ----------------------------------------------------
# Format: "name|runner"
#   runner ∈ {jest, vitest, none} — controls test-count regex.
WORKSPACES=(
  "@app/contracts|jest"
  "@app/auth-service|jest"
  "@app/backend|jest"
  "@app/bff|jest"
  "@app/frontend|vitest"
)

# Filter if --workspace= passed.
if [ -n "$ONLY_WS" ]; then
  filtered=()
  for entry in "${WORKSPACES[@]}"; do
    [ "${entry%%|*}" = "$ONLY_WS" ] && filtered+=("$entry")
  done
  if [ "${#filtered[@]}" -eq 0 ]; then
    fail "--workspace=$ONLY_WS does not match any known workspace"
    fail "known: ${WORKSPACES[*]%%|*}"
    exit 2
  fi
  WORKSPACES=("${filtered[@]}")
fi

# Per-workspace result state, parallel arrays indexed by position.
RESULT_BUILD=()
RESULT_TEST=()
RESULT_COUNT=()

# Generate a /tmp logfile path safe for a workspace name.
logfile() {
  local ws="$1" step="$2"
  local slug
  slug=$(printf '%s' "$ws" | tr '/@' '__')
  printf '/tmp/smoke-%s-%s.log' "$slug" "$step"
}

# Run a step for a workspace; on failure print last 20 log lines + exit 1.
run_step() {
  local ws="$1" step="$2"; shift 2
  local log; log=$(logfile "$ws" "$step")
  printf '%b[smoke]%b %-22s %s ...\n' "$C_DIM" "$C_RESET" "$ws" "$step"
  if "$@" >"$log" 2>&1; then
    printf '%b[smoke]%b %-22s %s %b%s%b\n' "$C_DIM" "$C_RESET" "$ws" "$step" "$C_GREEN" "$CHECK" "$C_RESET"
    return 0
  else
    fail "$ws $step failed — log: $log"
    printf '%b--- last 20 lines ---%b\n' "$C_YELLOW" "$C_RESET" >&2
    tail -n 20 "$log" >&2 || true
    return 1
  fi
}

# Extract test count from a jest/vitest log. Echoes integer or "?".
extract_count() {
  local log="$1" runner="$2" n=""
  case "$runner" in
    jest)
      # jest summary: "Tests:       12 passed, 12 total"
      n=$(grep -Eo 'Tests:[[:space:]]+[0-9]+ passed' "$log" | tail -n1 | grep -Eo '[0-9]+') || true
      ;;
    vitest)
      # vitest summary: "Tests  488 passed (488)"  OR  "Tests:  488 passed"
      n=$(grep -Eo 'Tests[[:space:]]+[0-9]+ passed' "$log" | tail -n1 | grep -Eo '[0-9]+') || true
      [ -z "$n" ] && n=$(grep -Eo 'Tests:[[:space:]]+[0-9]+ passed' "$log" | tail -n1 | grep -Eo '[0-9]+') || true
      ;;
  esac
  if [ -z "$n" ]; then
    printf '?'
  else
    printf '%s' "$n"
  fi
}

START_TS=$(date +%s)
TOTAL_TESTS=0
ANY_FAIL=0

# --- per-workspace loop ----------------------------------------------------
for entry in "${WORKSPACES[@]}"; do
  ws="${entry%%|*}"
  runner="${entry##*|}"

  build_status="$DASH"
  test_status="$DASH"
  count="$DASH"

  if [ "$SKIP_BUILD" -eq 0 ]; then
    if run_step "$ws" build yarn workspace "$ws" run build; then
      build_status="$C_GREEN$CHECK$C_RESET"
    else
      build_status="$C_RED$CROSS$C_RESET"
      ANY_FAIL=1
      RESULT_BUILD+=("$build_status")
      RESULT_TEST+=("$DASH")
      RESULT_COUNT+=("$DASH")
      break
    fi
  fi

  if [ "$SKIP_TESTS" -eq 0 ]; then
    log=$(logfile "$ws" test)
    if run_step "$ws" test yarn workspace "$ws" run test; then
      test_status="$C_GREEN$CHECK$C_RESET"
      n=$(extract_count "$log" "$runner")
      count="$n"
      if [ "$n" != "?" ]; then
        TOTAL_TESTS=$(( TOTAL_TESTS + n ))
      fi
    else
      test_status="$C_RED$CROSS$C_RESET"
      count="$DASH"
      ANY_FAIL=1
      RESULT_BUILD+=("$build_status")
      RESULT_TEST+=("$test_status")
      RESULT_COUNT+=("$count")
      break
    fi
  fi

  RESULT_BUILD+=("$build_status")
  RESULT_TEST+=("$test_status")
  RESULT_COUNT+=("$count")
done

# --- e2e typecheck ---------------------------------------------------------
E2E_STATUS="$DASH"
if [ "$ANY_FAIL" -eq 0 ] && [ -z "$ONLY_WS" ]; then
  if [ -d "$APP_DIR/e2e-tests" ]; then
    if run_step e2e-tests typecheck bash -c 'cd e2e-tests && npx --no-install tsc --noEmit'; then
      E2E_STATUS="$C_GREEN$CHECK$C_RESET"
    else
      E2E_STATUS="$C_RED$CROSS$C_RESET"
      ANY_FAIL=1
    fi
  else
    warn "e2e-tests/ not found — skipping typecheck."
  fi
fi

END_TS=$(date +%s)
ELAPSED=$(( END_TS - START_TS ))

# --- summary ---------------------------------------------------------------
printf '\n%b================ SMOKE SUMMARY ================%b\n' "$C_BOLD" "$C_RESET"
printf '%-20s %-7s %-7s %s\n' "Workspace" "Build" "Tests" "Count"
printf '%-20s %-7s %-7s %s\n' "--------------------" "-----" "-----" "-----"
i=0
for entry in "${WORKSPACES[@]}"; do
  ws="${entry%%|*}"
  if [ "$i" -lt "${#RESULT_BUILD[@]}" ]; then
    b="${RESULT_BUILD[$i]}"
    t="${RESULT_TEST[$i]}"
    c="${RESULT_COUNT[$i]}"
  else
    b="$DASH"; t="$DASH"; c="$DASH"
  fi
  # printf padding ignores ANSI bytes — rendered width is still aligned for
  # 1-glyph status markers, which is what we have.
  printf '%-20s %-7b %-7b %s\n' "$ws" "$b" "$t" "$c"
  i=$(( i + 1 ))
done
if [ -z "$ONLY_WS" ]; then
  printf '%-20s %-7s %-7b %s\n' "e2e-tests typecheck" "" "$E2E_STATUS" ""
fi
printf '%b-----------------------------------------------%b\n' "$C_DIM" "$C_RESET"

if [ "$ANY_FAIL" -eq 0 ]; then
  printf '%bTOTAL: %d unit tests in %ds%b\n' "$C_GREEN" "$TOTAL_TESTS" "$ELAPSED" "$C_RESET"
  printf '%bSMOKE OK%b\n' "$C_GREEN" "$C_RESET"
  exit 0
else
  printf '%bTOTAL: %d unit tests recorded before failure (%ds)%b\n' "$C_YELLOW" "$TOTAL_TESTS" "$ELAPSED" "$C_RESET"
  printf '%bSMOKE FAILED%b\n' "$C_RED" "$C_RESET"
  exit 1
fi
