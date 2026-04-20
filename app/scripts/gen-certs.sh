#!/usr/bin/env bash
# gen-certs.sh — create a throwaway internal CA + per-service certs for mTLS
# between auth-service, backend, and bff TCP microservices.
#
# Output: $ROOT/secrets/internal-ca/
#   ca.key        — root CA private key (guard it; gitignored)
#   ca.crt        — root CA certificate (distributed to every service)
#   <svc>.key     — service private key
#   <svc>.crt     — service certificate (CN = <svc>.internal, SAN = 127.0.0.1, <svc>)
#
# Usage:
#   ./scripts/gen-certs.sh             # skip regeneration if ca.crt exists
#   ./scripts/gen-certs.sh --force     # regenerate everything
#   ./scripts/gen-certs.sh --service-only <name>   # issue one more cert from existing CA
#
# NOT for production. Use a proper PKI (step-ca, Vault, cert-manager, etc.) there.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/secrets/internal-ca"
SERVICES=(auth-service backend bff)

FORCE=false
SINGLE_SERVICE=""
while (($#)); do
  case "$1" in
    --force) FORCE=true; shift ;;
    --service-only) SINGLE_SERVICE="${2:?service name}"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$OUT"
chmod 700 "$OUT"

command -v openssl >/dev/null 2>&1 || { echo "openssl not found" >&2; exit 1; }

# --- CA ---
if [[ ! -f "$OUT/ca.crt" || "$FORCE" == true ]]; then
  echo "[certs] creating internal root CA"
  openssl genrsa -out "$OUT/ca.key" 4096 2>/dev/null
  openssl req -x509 -new -nodes -key "$OUT/ca.key" -sha256 -days 365 \
    -subj "/CN=hackathone-internal-ca/O=hackathone/OU=dev" \
    -out "$OUT/ca.crt"
  chmod 600 "$OUT/ca.key"
else
  echo "[certs] reusing existing CA ($OUT/ca.crt)"
fi

# --- service certs ---
issue_cert() {
  local svc="$1"
  local key="$OUT/$svc.key"
  local crt="$OUT/$svc.crt"
  local csr="$OUT/$svc.csr"
  local ext="$OUT/$svc.ext"

  if [[ -f "$crt" && "$FORCE" == false && -z "$SINGLE_SERVICE" ]]; then
    echo "[certs] $svc already issued (use --force to rotate)"
    return
  fi

  echo "[certs] issuing $svc"
  openssl genrsa -out "$key" 2048 2>/dev/null
  openssl req -new -key "$key" \
    -subj "/CN=$svc.internal/O=hackathone/OU=dev" \
    -out "$csr"

  cat > "$ext" <<EOF
subjectAltName = @alt
extendedKeyUsage = serverAuth, clientAuth
keyUsage = digitalSignature, keyEncipherment

[alt]
DNS.1 = $svc.internal
DNS.2 = $svc
DNS.3 = localhost
IP.1  = 127.0.0.1
IP.2  = ::1
EOF

  openssl x509 -req -in "$csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" -CAcreateserial \
    -out "$crt" -days 365 -sha256 -extfile "$ext"

  rm -f "$csr" "$ext"
  chmod 600 "$key"
}

if [[ -n "$SINGLE_SERVICE" ]]; then
  issue_cert "$SINGLE_SERVICE"
else
  for svc in "${SERVICES[@]}"; do issue_cert "$svc"; done
fi

echo ""
echo "[certs] done — files under $OUT"
ls -la "$OUT"
