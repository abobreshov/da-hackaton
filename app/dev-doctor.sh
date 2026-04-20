#!/usr/bin/env bash
# dev-doctor.sh — diagnose and free dev-stack resources for this repo.
#
# Usage:
#   ./dev-doctor.sh                    # read-only report
#   ./dev-doctor.sh --clean            # stop our hackathone procs + docker infra (SIGTERM)
#   ./dev-doctor.sh --clean-services   # stop only hackathone procs, keep postgres + redis running
#   ./dev-doctor.sh --force            # as --clean but SIGKILL stubborn procs (also stops infra)
#   ./dev-doctor.sh --ports-only       # show what owns each service/infra port
#
# Only touches processes whose cwd points into this repo's app/ tree, so it
# is safe to run while other Node / Docker workloads are on the box.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; DIM='\033[2m'; NC='\033[0m'
info()  { echo -e "${GREEN}[doctor]${NC} $*"; }
warn()  { echo -e "${YELLOW}[doctor]${NC} $*"; }
err()   { echo -e "${RED}[doctor]${NC} $*"; }
hdr()   { echo -e "\n${BLUE}== $* ==${NC}"; }

MODE="report"
for arg in "$@"; do
  case "$arg" in
    --clean)           MODE="clean" ;;
    --clean-services)  MODE="clean-services" ;;
    --force)           MODE="force" ;;
    --ports-only)      MODE="ports" ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) warn "Unknown arg: $arg"; exit 2 ;;
  esac
done

# ---------- what we care about ----------
SERVICE_PORTS=(3003 3004 3006 3007)   # HTTP: auth, backend, bff, frontend
TCP_PORTS=(4003 4004)                 # NestJS microservice TCP
INFRA_PORTS=(5433 6380)               # dev-local postgres + redis
ALL_PORTS=("${SERVICE_PORTS[@]}" "${TCP_PORTS[@]}" "${INFRA_PORTS[@]}")

# ---------- helpers ----------
has() { command -v "$1" >/dev/null 2>&1; }

# True if the given pid's cwd points into this repo's app/ dir.
pid_in_repo() {
  local pid="$1" cwd
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" || return 1
  [[ "$cwd" == "$ROOT"* ]]
}

pid_label() {
  local pid="$1"
  local cwd cmd
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || echo '?')"
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-110)"
  echo "pid=$pid cwd=${cwd#"$REPO_ROOT/"} :: $cmd"
}

port_owner() {
  local port="$1"
  ss -Hlntp "sport = :$port" 2>/dev/null | awk -F'pid=' 'NR==1 && NF>1 { split($2,a,","); print a[1] }'
}

# Return PIDs (space-separated) of any docker-proxy processes forwarding $1.
# These are root-owned leftovers from a stopped docker stack that still pin the host port.
proxy_pids_for() {
  local port="$1"
  pgrep -a docker-proxy 2>/dev/null | awk -v p="$port" '
    $0 ~ ("-host-port " p " ") { print $1 }
  ' | tr '\n' ' '
}

# ---------- report phase ----------
hdr "Ports"
printf "  %-6s %-10s %-12s %s\n" "PORT" "STATE" "PID" "PROCESS"
any_port_listen=false
for port in "${ALL_PORTS[@]}"; do
  if ss -Hlntp "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    any_port_listen=true
    pid="$(port_owner "$port")"
    if [[ -n "$pid" && -e "/proc/$pid" ]]; then
      owner="$(pid_label "$pid")"
      if pid_in_repo "$pid"; then
        printf "  ${GREEN}%-6s %-10s %-12s %s${NC}\n" "$port" "LISTEN" "$pid" "(ours) ${owner#pid=*:: }"
      else
        printf "  ${YELLOW}%-6s %-10s %-12s %s${NC}\n" "$port" "LISTEN" "$pid" "(foreign) ${owner#pid=*:: }"
      fi
    else
      # Invisible to us (root-owned). Most common case: orphan docker-proxy from a prior `dev.sh`.
      proxies="$(proxy_pids_for "$port")"
      if [[ -n "$proxies" ]]; then
        printf "  ${RED}%-6s %-10s %-12s %s${NC}\n" "$port" "LISTEN" "${proxies% }" "(docker-proxy orphan — stop with: sudo kill ${proxies% })"
      else
        printf "  ${RED}%-6s %-10s %-12s %s${NC}\n" "$port" "LISTEN" "?" "(root-owned or zombie socket — run: sudo ss -tlnp 'sport = :$port' to identify)"
      fi
    fi
  else
    printf "  ${DIM}%-6s %-10s %-12s %s${NC}\n" "$port" "free" "-" "-"
  fi
done
[[ "$any_port_listen" == false ]] && info "All watched ports free."

if [[ "$MODE" == "ports" ]]; then exit 0; fi

hdr "Processes (hackathone-only)"
# Exclude self, parent shell, and any process matching bash/doctor itself or common exec helpers
# so we don't accidentally kill the session that invoked us.
self_pids=("$$" "$PPID")
is_self() {
  local pid="$1" sp
  for sp in "${self_pids[@]}"; do [[ "$pid" == "$sp" ]] && return 0; done
  # Also skip our own parent chain so the interactive shell survives --clean-services.
  local ancestor="$PPID"
  while [[ -n "$ancestor" && "$ancestor" != "0" && "$ancestor" != "1" ]]; do
    [[ "$pid" == "$ancestor" ]] && return 0
    ancestor="$(awk '/^PPid:/ {print $2}' "/proc/$ancestor/status" 2>/dev/null)"
  done
  return 1
}

# Only match known dev-server binaries — never kill arbitrary shells, editors, or claude-code
# subprocesses that happen to live under app/.
is_target_binary() {
  local pid="$1" comm
  comm="$(awk -F'[()]' '{print $2}' "/proc/$pid/stat" 2>/dev/null)"
  case "$comm" in
    node|esbuild|vite|tsc|ts-node) return 0 ;;
    *) return 1 ;;
  esac
}

mapfile -t repo_pids < <(
  for pid in /proc/[0-9]*; do
    pid="${pid##*/}"
    [[ -e "/proc/$pid/cwd" ]] || continue
    is_self "$pid" && continue
    is_target_binary "$pid" || continue
    pid_in_repo "$pid" && echo "$pid"
  done 2>/dev/null
)

if [[ "${#repo_pids[@]}" -eq 0 ]]; then
  info "No processes rooted in $ROOT."
else
  for pid in "${repo_pids[@]}"; do
    [[ -e "/proc/$pid" ]] || continue
    echo "  $(pid_label "$pid")"
  done
fi

hdr "Docker infra (from docker-compose.infra.yml)"
if has docker && docker compose version >/dev/null 2>&1; then
  if docker compose -f "$ROOT/docker-compose.infra.yml" ps --status running --format '{{.Service}}\t{{.State}}' 2>/dev/null | grep -q .; then
    docker compose -f "$ROOT/docker-compose.infra.yml" ps
  else
    info "No hackathone infra containers running."
  fi
else
  warn "docker/docker compose not available — skipping infra check."
fi

if [[ "$MODE" == "report" ]]; then
  cat <<EOF

Next steps:
  ./dev-doctor.sh --clean            stop hackathone processes + docker infra (SIGTERM)
  ./dev-doctor.sh --clean-services   stop hackathone processes only, keep postgres + redis up
  ./dev-doctor.sh --force            SIGKILL stubborn processes + stop infra
  ./dev-doctor.sh --ports-only       re-check ports only
EOF
  exit 0
fi

# ---------- clean phase ----------
signal="TERM"
[[ "$MODE" == "force" ]] && signal="KILL"
hdr "Stopping hackathone processes (SIG$signal)"

if [[ "${#repo_pids[@]}" -eq 0 ]]; then
  info "Nothing to stop."
else
  # Sort leaves-first so we drop children before their shells / watchers.
  for pid in "${repo_pids[@]}"; do
    [[ -e "/proc/$pid" ]] || continue
    label="$(pid_label "$pid")"
    if kill "-$signal" "$pid" 2>/dev/null; then
      info "sent SIG$signal → $label"
    else
      warn "could not signal pid=$pid"
    fi
  done

  # If only TERM, give procs a moment, then show remainder.
  if [[ "$signal" == "TERM" ]]; then
    for _ in 1 2 3 4 5; do
      still_alive=false
      for pid in "${repo_pids[@]}"; do [[ -e "/proc/$pid" ]] && still_alive=true && break; done
      [[ "$still_alive" == false ]] && break
      sleep 1
    done
    for pid in "${repo_pids[@]}"; do
      [[ -e "/proc/$pid" ]] && warn "still alive after SIGTERM: $(pid_label "$pid") — rerun with --force"
    done
  fi
fi

if [[ "$MODE" == "clean-services" ]]; then
  info "Leaving docker infra (postgres + redis) running — use --clean to stop it too."
else
  hdr "Stopping hackathone infra"
  if has docker && docker compose version >/dev/null 2>&1; then
    docker compose -f "$ROOT/docker-compose.infra.yml" down --remove-orphans 2>&1 | sed 's/^/  /'
  else
    warn "docker/docker compose not available — skipping."
  fi
fi

hdr "Final port status"
bash "$0" --ports-only
