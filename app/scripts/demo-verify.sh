#!/usr/bin/env bash
# demo-verify.sh — automated demo-day verification gauntlet.
#
# Brings up the stack, seeds, runs Playwright + k6, captures pass/fail counts
# and p95 latencies, then writes a timestamped markdown report to
# app/demo-reports/demo-verify-<YYYYMMDD-HHMMSS>.md.
#
# Run from anywhere — paths are absolute.

set -euo pipefail

# ---------- paths ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${APP_DIR}/.." && pwd)"
E2E_DIR="${APP_DIR}/e2e-tests"
LOAD_DIR="${APP_DIR}/load-tests"
REPORT_DIR="${APP_DIR}/demo-reports"

PW_JSON="/tmp/demo-verify-pw-$$.json"
K6_BURST_LOG="/tmp/demo-verify-k6-burst-$$.log"
K6_FANOUT_LOG="/tmp/demo-verify-k6-fanout-$$.log"
STACK_LOG="/tmp/demo-verify-stack-$$.log"

# ---------- flags ----------
USE_LOCAL=0
KEEP_DATA=0
SKIP_E2E=0
SKIP_LOAD=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Stages: pre-flight -> bring-up -> seed -> e2e -> load -> report -> teardown.

Options:
  --local        Use ./dev-local.sh (infra in Docker, services on host) instead of ./dev.sh.
  --keep-data    Skip 'docker compose down -v' on teardown (keep volumes).
  --skip-e2e     Skip Playwright E2E run.
  --skip-load    Skip k6 load run.
  -h, --help     Show this help.

Report: ${REPORT_DIR}/demo-verify-<timestamp>.md
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)      USE_LOCAL=1 ;;
    --keep-data)  KEEP_DATA=1 ;;
    --skip-e2e)   SKIP_E2E=1 ;;
    --skip-load)  SKIP_LOAD=1 ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

# ---------- helpers ----------
ts()   { date '+%Y-%m-%d %H:%M:%S'; }
log()  { printf '[%s] %s\n' "$(ts)" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$(ts)" "$*" >&2; }
die()  { printf '[%s] ERROR: %s\n' "$(ts)" "$*" >&2; exit 1; }

START_EPOCH=$(date +%s)
REPORT_TS="$(date '+%Y%m%d-%H%M%S')"
REPORT_FILE="${REPORT_DIR}/demo-verify-${REPORT_TS}.md"

DEV_MODE="dev.sh"
[[ ${USE_LOCAL} -eq 1 ]] && DEV_MODE="dev-local.sh"

GIT_SHA="$(git -C "${REPO_DIR}" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
GIT_DIRTY=""
if ! git -C "${REPO_DIR}" diff --quiet 2>/dev/null || ! git -C "${REPO_DIR}" diff --cached --quiet 2>/dev/null; then
  GIT_DIRTY=" (dirty)"
fi

# Output buffers for report sections.
PREFLIGHT_LINES=()
E2E_TOTAL=0
E2E_PASS=0
E2E_FAIL=0
E2E_FLAKY=0
E2E_SKIPPED=0
E2E_PER_SPEC=""
E2E_STATUS="skipped"
K6_BURST_P95=""
K6_FANOUT_P95=""
K6_STATUS="skipped"
STACK_PID=""

# ---------- teardown ----------
teardown() {
  local exit_code=$?
  log "Teardown begin (exit_code=${exit_code})"

  if [[ -n "${STACK_PID}" ]] && kill -0 "${STACK_PID}" 2>/dev/null; then
    log "Stopping stack PID ${STACK_PID}"
    kill -TERM "${STACK_PID}" 2>/dev/null || true
    # Give it a moment to clean up.
    for _ in 1 2 3 4 5; do
      kill -0 "${STACK_PID}" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "${STACK_PID}" 2>/dev/null || true
  fi

  if [[ ${KEEP_DATA} -eq 1 ]]; then
    log "Skipping volume teardown (--keep-data)"
    if [[ -x "${APP_DIR}/dev-doctor.sh" ]]; then
      ( cd "${APP_DIR}" && ./dev-doctor.sh --clean-services >/dev/null 2>&1 || true )
    fi
  else
    if [[ -x "${APP_DIR}/dev-doctor.sh" ]]; then
      log "Running dev-doctor --clean"
      ( cd "${APP_DIR}" && ./dev-doctor.sh --clean >/dev/null 2>&1 || true )
    fi
    log "docker compose down -v (dev + infra)"
    ( cd "${APP_DIR}" && docker compose -f docker-compose.dev.yml down -v >/dev/null 2>&1 || true )
    ( cd "${APP_DIR}" && docker compose -f docker-compose.infra.yml down -v >/dev/null 2>&1 || true )
  fi

  rm -f "${PW_JSON}" "${K6_BURST_LOG}" "${K6_FANOUT_LOG}" 2>/dev/null || true
  log "Teardown done"
}
trap teardown EXIT

# ---------- stage: pre-flight ----------
preflight() {
  log "Stage 1/6: pre-flight"

  if ! command -v docker >/dev/null 2>&1; then
    die "docker CLI not found"
  fi
  if ! docker info >/dev/null 2>&1; then
    die "Docker daemon not reachable"
  fi
  PREFLIGHT_LINES+=("- docker daemon: OK")

  local ports=(3006 3007 5433 6380)
  local conflict=0
  for p in "${ports[@]}"; do
    if (exec 3<>/dev/tcp/127.0.0.1/"$p") 2>/dev/null; then
      exec 3<&- 3>&- || true
      warn "Port ${p} already in use"
      PREFLIGHT_LINES+=("- port ${p}: BUSY")
      conflict=1
    else
      PREFLIGHT_LINES+=("- port ${p}: free")
    fi
  done
  [[ ${conflict} -eq 1 ]] && die "Port collision detected — run ./dev-doctor.sh --clean"

  if [[ ${SKIP_E2E} -eq 0 ]]; then
    if ! ( cd "${E2E_DIR}" && yarn playwright --version >/dev/null 2>&1 ); then
      warn "Playwright not yet installed — bring-up will run yarn install:browsers"
      PREFLIGHT_LINES+=("- playwright: missing (will install)")
    else
      PREFLIGHT_LINES+=("- playwright: OK")
    fi
  fi

  if [[ ${SKIP_LOAD} -eq 0 ]]; then
    if ! command -v k6 >/dev/null 2>&1; then
      warn "k6 not installed — load tests will be skipped"
      SKIP_LOAD=1
      K6_STATUS="skipped (k6 not installed)"
      PREFLIGHT_LINES+=("- k6: missing (load skipped)")
    else
      PREFLIGHT_LINES+=("- k6: OK ($(k6 version 2>&1 | head -n1))")
    fi
  fi
}

# ---------- stage: bring-up ----------
wait_for_url() {
  local url="$1" max="${2:-90}" elapsed=0
  while (( elapsed < max )); do
    if curl -fsS -o /dev/null --max-time 2 "${url}"; then
      return 0
    fi
    sleep 2
    elapsed=$(( elapsed + 2 ))
  done
  return 1
}

bringup() {
  log "Stage 2/6: bring-up via ${DEV_MODE}"
  local script="dev.sh"
  [[ ${USE_LOCAL} -eq 1 ]] && script="dev-local.sh"

  ( cd "${APP_DIR}" && ./"${script}" --no-seed >"${STACK_LOG}" 2>&1 ) &
  STACK_PID=$!
  log "Stack started in background (PID ${STACK_PID}); polling http://localhost:3007"

  if ! wait_for_url "http://localhost:3007" 90; then
    warn "Frontend did not respond within 90s; tail of stack log:"
    tail -n 40 "${STACK_LOG}" >&2 || true
    die "Bring-up failed"
  fi
  log "Frontend reachable"

  log "Seeding (auth-service + backend demo data)"
  ( cd "${APP_DIR}" && yarn workspace @app/auth-service seed ) || warn "auth seed exited non-zero"
  ( cd "${APP_DIR}" && yarn workspace @app/backend seed:demo ) || warn "backend seed:demo exited non-zero"
}

# ---------- stage: e2e ----------
run_e2e() {
  if [[ ${SKIP_E2E} -eq 1 ]]; then
    log "Stage 3/6: e2e SKIPPED"
    E2E_STATUS="skipped"
    return 0
  fi

  log "Stage 3/6: e2e (Playwright)"
  ( cd "${E2E_DIR}" && yarn install:browsers ) || warn "playwright install:browsers exited non-zero"

  set +e
  ( cd "${E2E_DIR}" && \
      PLAYWRIGHT_JSON_OUTPUT_NAME="${PW_JSON}" \
      yarn playwright test --reporter=line --reporter=json )
  local pw_exit=$?
  set -e

  if [[ -f "${PW_JSON}" ]]; then
    if command -v jq >/dev/null 2>&1; then
      E2E_TOTAL=$(jq '[.suites[]?.specs[]?, .suites[]?.suites[]?.specs[]?] | length' "${PW_JSON}" 2>/dev/null || echo 0)
      E2E_PASS=$(jq '.stats.expected // 0' "${PW_JSON}" 2>/dev/null || echo 0)
      E2E_FAIL=$(jq '.stats.unexpected // 0' "${PW_JSON}" 2>/dev/null || echo 0)
      E2E_FLAKY=$(jq '.stats.flaky // 0' "${PW_JSON}" 2>/dev/null || echo 0)
      E2E_SKIPPED=$(jq '.stats.skipped // 0' "${PW_JSON}" 2>/dev/null || echo 0)
      E2E_PER_SPEC=$(jq -r '
        [.. | objects | select(has("specs")) | .specs[]?]
        | map({
            file: (.file // "?"),
            title: .title,
            ok: ((.tests // []) | all(.results[]?.status == "passed" or .results[]?.status == "skipped"))
          })
        | group_by(.file)
        | map("- " + (.[0].file) + ": " + ([.[] | select(.ok)] | length | tostring) + "/" + (length | tostring) + " passed")
        | .[]
      ' "${PW_JSON}" 2>/dev/null || echo "")
    else
      warn "jq not available; per-spec breakdown limited"
      E2E_PER_SPEC="- (jq not installed — see ${PW_JSON})"
    fi
  else
    warn "Playwright JSON report not produced"
  fi

  if [[ ${pw_exit} -eq 0 ]]; then
    E2E_STATUS="pass"
  else
    E2E_STATUS="fail (exit=${pw_exit})"
  fi
  log "Playwright finished: ${E2E_STATUS}; pass=${E2E_PASS} fail=${E2E_FAIL} flaky=${E2E_FLAKY} skipped=${E2E_SKIPPED}"
}

# ---------- stage: load ----------
extract_p95() {
  # k6 prints lines like:  http_req_duration..............: avg=12ms ... p(95)=42ms
  local file="$1"
  grep -Eo 'p\(95\)=[0-9.]+(ms|s|µs|us)' "${file}" 2>/dev/null | head -n1 | sed 's/^p(95)=//' || true
}

run_load() {
  if [[ ${SKIP_LOAD} -eq 1 ]]; then
    log "Stage 4/6: load SKIPPED"
    return 0
  fi

  log "Stage 4/6: k6 load tests"
  K6_STATUS="ran"

  if [[ -f "${LOAD_DIR}/k6-message-burst.js" ]]; then
    log "k6: message-burst"
    set +e
    ( cd "${LOAD_DIR}" && k6 run k6-message-burst.js ) | tee "${K6_BURST_LOG}"
    set -e
    K6_BURST_P95="$(extract_p95 "${K6_BURST_LOG}")"
  else
    warn "k6-message-burst.js not found — skipping"
  fi

  if [[ -f "${LOAD_DIR}/k6-presence-fanout.js" ]]; then
    log "k6: presence-fanout"
    set +e
    ( cd "${LOAD_DIR}" && k6 run k6-presence-fanout.js ) | tee "${K6_FANOUT_LOG}"
    set -e
    K6_FANOUT_P95="$(extract_p95 "${K6_FANOUT_LOG}")"
  else
    warn "k6-presence-fanout.js not found — skipping"
  fi
}

# ---------- stage: report ----------
write_report() {
  log "Stage 5/6: report -> ${REPORT_FILE}"
  mkdir -p "${REPORT_DIR}"

  local end_epoch
  end_epoch=$(date +%s)
  local runtime=$(( end_epoch - START_EPOCH ))

  {
    echo "# Demo Verify Report"
    echo
    echo "- **Timestamp:** $(ts)"
    echo "- **Git commit:** \`${GIT_SHA}\`${GIT_DIRTY}"
    echo "- **Dev mode:** ${DEV_MODE}"
    echo "- **Total runtime:** ${runtime}s"
    echo "- **Flags:** local=${USE_LOCAL} keep-data=${KEEP_DATA} skip-e2e=${SKIP_E2E} skip-load=${SKIP_LOAD}"
    echo
    echo "## Pre-flight"
    for line in "${PREFLIGHT_LINES[@]}"; do
      echo "${line}"
    done
    echo
    echo "## E2E (Playwright)"
    echo
    echo "- **Status:** ${E2E_STATUS}"
    echo "- **Totals:** pass=${E2E_PASS} fail=${E2E_FAIL} flaky=${E2E_FLAKY} skipped=${E2E_SKIPPED} (specs=${E2E_TOTAL})"
    echo
    echo "### Per-spec"
    if [[ -n "${E2E_PER_SPEC}" ]]; then
      echo "${E2E_PER_SPEC}"
    else
      echo "_no per-spec data_"
    fi
    echo
    echo "## Load (k6)"
    echo
    echo "- **Status:** ${K6_STATUS}"
    echo "- **k6-message-burst p95:** ${K6_BURST_P95:-n/a}"
    echo "- **k6-presence-fanout p95:** ${K6_FANOUT_P95:-n/a}"
    echo
    echo "## Verdict"
    echo
    if [[ "${E2E_STATUS}" == "pass" && "${E2E_FAIL}" -eq 0 ]]; then
      echo "- E2E: PASS"
    elif [[ "${E2E_STATUS}" == "skipped" ]]; then
      echo "- E2E: SKIPPED"
    else
      echo "- E2E: FAIL"
    fi
    if [[ ${SKIP_LOAD} -eq 1 ]]; then
      echo "- Load: SKIPPED"
    else
      echo "- Load: see p95 numbers above"
    fi
  } > "${REPORT_FILE}"

  log "Report written"
}

# ---------- main ----------
mkdir -p "${REPORT_DIR}"
preflight
bringup
run_e2e
run_load
write_report
log "Stage 6/6: teardown (handled by trap)"
log "Done. Report: ${REPORT_FILE}"
