#!/usr/bin/env sh
set -eu

APP_NAME="zashboardx-metrics"
APP_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/${APP_NAME}"
IMAGE="ghcr.io/pluviophile714/zashboardx:latest"
METRICS_IMAGE="ghcr.io/pluviophile714/zashboardx:metrics-latest"
MANAGED_LABEL="com.zashboardx.metrics.managed"
DEFAULT_PORT="2080"
DEFAULT_MIHOMO_BASE_URL="http://192.168.1.1:9090"

if [ -t 0 ] || [ -t 1 ]; then
  exec 3</dev/tty
else
  exec 3<&0
fi
INPUT_FD=3

prompt_value() {
  prompt="$1"
  default_value="$2"
  printf '%s' "$prompt" >&2
  IFS= read -r value <&$INPUT_FD || value=""
  if [ -z "$value" ]; then
    value="$default_value"
  fi
  printf '%s' "$value"
}

prompt_secret() {
  existing="$1"
  if [ -n "$existing" ]; then
    printf '%s' "Mihomo secret (Enter keeps current, - clears it): " >&2
  else
    printf '%s' "Mihomo secret (optional): " >&2
  fi
  if [ -t "$INPUT_FD" ] && command -v stty >/dev/null 2>&1; then
    stty -echo <&$INPUT_FD
    trap 'stty echo <&3 2>/dev/null || true' EXIT HUP INT TERM
    IFS= read -r value <&$INPUT_FD || value=""
    stty echo <&$INPUT_FD
    trap - EXIT HUP INT TERM
    printf '\n' >&2
  else
    IFS= read -r value <&$INPUT_FD || value=""
  fi
  if [ -n "$existing" ]; then
    case "$value" in
      "") value="$existing" ;;
      -) value="" ;;
    esac
  fi
  printf '%s' "$value"
}

read_env_value() {
  key="$1"
  fallback="$2"
  if [ -f "${APP_DIR}/.env" ]; then
    value="$(grep -E "^${key}=" "${APP_DIR}/.env" | tail -n 1 | cut -d= -f2- || true)"
    value="$(printf '%s' "$value" | sed "s/^'//; s/'$//")"
    if [ -n "$value" ]; then
      printf '%s' "$value"
      return
    fi
  fi
  printf '%s' "$fallback"
}

validate_single_line() {
  name="$1"
  value="$2"
  case "$value" in
    *"
"*)
      echo "${name} must be a single line." >&2
      exit 1
      ;;
  esac
}

write_env_value() {
  key="$1"
  value="$2"
  escaped="$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
  printf "%s='%s'\n" "$key" "$escaped"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker before running this installer." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Install the Docker Compose plugin first." >&2
  exit 1
fi

saved_port="$(read_env_value PORT "$DEFAULT_PORT")"
saved_mihomo_url="$(read_env_value MIHOMO_BASE_URL "$DEFAULT_MIHOMO_BASE_URL")"
saved_mihomo_secret="$(read_env_value MIHOMO_SECRET "")"

PORT="$(prompt_value "Panel port [${saved_port}]: " "$saved_port")"
MIHOMO_BASE_URL="$(prompt_value "Mihomo controller URL [${saved_mihomo_url}]: " "$saved_mihomo_url")"
MIHOMO_SECRET="$(prompt_secret "$saved_mihomo_secret")"

if ! printf '%s' "$PORT" | grep -Eq '^[0-9]+$' || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Invalid panel port: ${PORT}" >&2
  exit 1
fi

case "$MIHOMO_BASE_URL" in
  http://*|https://*) ;;
  *)
    echo "Mihomo controller URL must start with http:// or https://." >&2
    exit 1
    ;;
esac

validate_single_line "Mihomo controller URL" "$MIHOMO_BASE_URL"
validate_single_line "Mihomo secret" "$MIHOMO_SECRET"

occupied="$(docker ps --filter "publish=${PORT}" --format '{{.ID}}|{{.Names}}|{{.Image}}' || true)"
if [ -n "$occupied" ]; then
  unmanaged=""
  old_ifs="$IFS"
  IFS='
'
  for row in $occupied; do
    container_id="${row%%|*}"
    managed="$(docker inspect "$container_id" --format "{{index .Config.Labels \"${MANAGED_LABEL}\"}}" 2>/dev/null || true)"
    if [ "$managed" != "true" ]; then
      unmanaged="${unmanaged}${row}
"
    fi
  done
  IFS="$old_ifs"
  if [ -n "$unmanaged" ]; then
    echo "Port ${PORT} is already used by an unmanaged container:" >&2
    printf '%s' "$unmanaged" >&2
    echo "No containers or configuration files were changed." >&2
    exit 1
  fi
fi

mkdir -p "${APP_DIR}/metrics-data"

{
  write_env_value PORT "$PORT"
  write_env_value IMAGE "$IMAGE"
  write_env_value METRICS_IMAGE "$METRICS_IMAGE"
  write_env_value MIHOMO_BASE_URL "$MIHOMO_BASE_URL"
  write_env_value MIHOMO_SECRET "$MIHOMO_SECRET"
} >"${APP_DIR}/.env"
chmod 600 "${APP_DIR}/.env"

cat >"${APP_DIR}/compose.yaml" <<'EOF'
services:
  zashboardx:
    image: ${IMAGE}
    ports:
      - "${PORT}:80"
    labels:
      - "com.zashboardx.metrics.managed=true"
    depends_on:
      - zashboardx-metrics
    restart: unless-stopped

  zashboardx-metrics:
    image: ${METRICS_IMAGE}
    env_file:
      - ./.env
    environment:
      SCRAPE_INTERVAL_SECONDS: "30"
      PROBE_INTERVAL_SECONDS: "30"
      PROBE_CONCURRENCY: "8"
      METRICS_RETENTION_DAYS: "7"
    volumes:
      - ./metrics-data:/data
    labels:
      - "com.zashboardx.metrics.managed=true"
    restart: unless-stopped
EOF

cd "$APP_DIR"
docker compose --project-name "$APP_NAME" pull
docker compose --project-name "$APP_NAME" up -d

panel_url="http://127.0.0.1:${PORT}"
attempt=0
panel_ready=false
while [ "$attempt" -lt 30 ]; do
  if curl -fsS "${panel_url}/" >/dev/null 2>&1; then
    panel_ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ "$panel_ready" != "true" ]; then
  echo "The panel did not become ready within 30 seconds. Stopping the new stack." >&2
  docker compose --project-name "$APP_NAME" down
  exit 1
fi

health=""
attempt=0
while [ "$attempt" -lt 30 ]; do
  health="$(curl -fsS "${panel_url}/api/metrics/health" 2>/dev/null || true)"
  if [ -n "$health" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

echo
echo "Installation complete."
echo "Panel: http://<docker-host>:${PORT}"
echo "Data: ${APP_DIR}/metrics-data"

if ! printf '%s' "$health" | grep -Eq '"mihomoReachable"[[:space:]]*:[[:space:]]*true'; then
  echo "The panel is running, but Metrics cannot reach Mihomo yet." >&2
  echo "Check the controller URL and secret, then rerun this installer." >&2
fi
