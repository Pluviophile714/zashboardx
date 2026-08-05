#!/usr/bin/env sh
set -eu

APP_NAME="zashboardx-metrics"
APP_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/${APP_NAME}"

read_env_value() {
  key="$1"
  fallback="$2"
  value="$(grep -E "^${key}=" "${APP_DIR}/.env" | tail -n 1 | cut -d= -f2- || true)"
  value="$(printf '%s' "$value" | sed "s/^'//; s/'$//")"
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker and Docker Compose v2 are required." >&2
  exit 1
fi

if [ ! -f "${APP_DIR}/compose.yaml" ] || [ ! -f "${APP_DIR}/.env" ]; then
  echo "Metrics installation not found: ${APP_DIR}" >&2
  exit 1
fi
if ! grep -q 'com.zashboardx.metrics.managed=true' "${APP_DIR}/compose.yaml"; then
  echo "Refusing to disable an unrecognized Compose project." >&2
  exit 1
fi

cd "$APP_DIR"
docker compose --project-name "$APP_NAME" down

PORT="$(read_env_value PORT 2080)"
IMAGE="$(read_env_value IMAGE ghcr.io/pluviophile714/zashboardx:latest)"
cat >"${APP_DIR}/compose-ordinary.yaml" <<'EOF'
services:
  zashboardx:
    image: ${IMAGE}
    ports:
      - "${PORT}:80"
    restart: unless-stopped
EOF

docker compose --project-name zashboardx -f compose-ordinary.yaml up -d

case "${1:-}" in
  "")
    echo "Metrics disabled. The ordinary panel is running on port ${PORT}."
    echo "Metrics data retained at ${APP_DIR}/metrics-data"
    ;;
  --purge-data)
    if [ -t 0 ] || [ -t 1 ]; then
      exec 3</dev/tty
    else
      exec 3<&0
    fi
    printf 'Type yes to permanently delete Metrics history: ' >&2
    IFS= read -r confirmation <&3 || confirmation=""
    if [ "$confirmation" != "yes" ]; then
      echo "Metrics history retained."
      exit 0
    fi
    rm -rf "${APP_DIR}/metrics-data"
    echo "Metrics history deleted."
    ;;
  *)
    echo "Usage: $0 [--purge-data]" >&2
    exit 1
    ;;
esac
