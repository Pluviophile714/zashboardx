#!/usr/bin/env sh
set -eu

APP_NAME="zashboardx-metrics"
APP_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/${APP_NAME}"
IMAGE="ghcr.io/pluviophile714/zashboardx:latest"
METRICS_IMAGE="ghcr.io/pluviophile714/zashboardx:metrics-latest"
UPSTREAM_IMAGE="ghcr.io/zephyruso/zashboard:latest"
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

prompt_confirmation() {
  printf '%s' "$1" >&2
  IFS= read -r answer <&$INPUT_FD || answer=""
  printf '%s' "$answer"
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

existing_ordinary_id=""
existing_ordinary_name=""
existing_ordinary_port=""
existing_ordinary_running="false"
existing_ordinary_restart="unless-stopped"
existing_ordinary_count=0
for container_id in $(docker ps -a --format '{{.ID}}' 2>/dev/null || true); do
  managed="$(docker inspect "$container_id" --format "{{index .Config.Labels \"${MANAGED_LABEL}\"}}" 2>/dev/null || true)"
  [ "$managed" = "true" ] && continue
  image="$(docker inspect "$container_id" --format '{{.Config.Image}}' 2>/dev/null || true)"
  case "$image" in
    "$IMAGE"|"$UPSTREAM_IMAGE") ;;
    *) continue ;;
  esac
  binds="$(docker inspect "$container_id" --format '{{json .HostConfig.Binds}}' 2>/dev/null || true)"
  case "$binds" in
    ""|null|\[\]) ;;
    *) continue ;;
  esac
  network_mode="$(docker inspect "$container_id" --format '{{.HostConfig.NetworkMode}}' 2>/dev/null || true)"
  case "$network_mode" in
    ""|default|bridge) ;;
    *) continue ;;
  esac
  port_line="$(docker port "$container_id" 80/tcp 2>/dev/null | head -n 1 || true)"
  ordinary_port="$(printf '%s' "$port_line" | sed -n 's/.*://p' | sed 's#/.*##')"
  if ! printf '%s' "$ordinary_port" | grep -Eq '^[0-9]+$'; then
    continue
  fi
  existing_ordinary_count=$((existing_ordinary_count + 1))
  existing_ordinary_id="$container_id"
  existing_ordinary_name="$(docker inspect "$container_id" --format '{{.Name}}' 2>/dev/null | sed 's#^/##' || true)"
  existing_ordinary_port="$ordinary_port"
  existing_ordinary_running="$(docker inspect "$container_id" --format '{{.State.Running}}' 2>/dev/null || echo false)"
  existing_ordinary_restart="$(docker inspect "$container_id" --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null || echo unless-stopped)"
  [ -n "$existing_ordinary_restart" ] || existing_ordinary_restart="unless-stopped"
done

if [ "$existing_ordinary_count" -gt 1 ]; then
  echo "Found multiple recognizable ordinary panels; refusing automatic migration." >&2
  echo "Stop or migrate them manually, then rerun this installer." >&2
  exit 1
fi

saved_port="$(read_env_value PORT "$DEFAULT_PORT")"
saved_mihomo_url="$(read_env_value MIHOMO_BASE_URL "$DEFAULT_MIHOMO_BASE_URL")"
saved_mihomo_secret="$(read_env_value MIHOMO_SECRET "")"

if [ -n "$existing_ordinary_id" ]; then
  echo "Detected official ordinary panel '${existing_ordinary_name:-$existing_ordinary_id}' on port ${existing_ordinary_port}." >&2
  answer="$(prompt_confirmation "Migrate it to Metrics? [y/N]: ")"
  case "$answer" in
    y|Y|yes|YES) ;;
    *)
      echo "Migration cancelled. No containers or files were changed." >&2
      exit 0
      ;;
  esac
  saved_port="$existing_ordinary_port"
fi

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
    if [ "$managed" != "true" ] && [ "$container_id" != "$existing_ordinary_id" ]; then
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

restart_policy="unless-stopped"
if [ -n "$existing_ordinary_id" ]; then
  restart_policy="$existing_ordinary_restart"
  backup_stamp="$(date +%Y%m%d%H%M%S)"
  docker inspect "$existing_ordinary_id" >"${APP_DIR}/ordinary-container-${existing_ordinary_id}-${backup_stamp}.inspect.json"
fi

{
  write_env_value PORT "$PORT"
  write_env_value IMAGE "$IMAGE"
  write_env_value METRICS_IMAGE "$METRICS_IMAGE"
  write_env_value MIHOMO_BASE_URL "$MIHOMO_BASE_URL"
  write_env_value MIHOMO_SECRET "$MIHOMO_SECRET"
  write_env_value RESTART_POLICY "$restart_policy"
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
    restart: ${RESTART_POLICY}

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

migration_was_running=false
migration_old_removed=false

rollback_migration() {
  docker compose --project-name "$APP_NAME" down || true
  if [ "$migration_was_running" = "true" ] && [ "$migration_old_removed" = "false" ]; then
    docker start "$existing_ordinary_id" || true
  fi
}

migration_exit_handler() {
  status="$?"
  if [ "$status" -ne 0 ] && [ -n "$existing_ordinary_id" ]; then
    rollback_migration
  fi
  exit "$status"
}

trap migration_exit_handler EXIT HUP INT TERM

if [ -n "$existing_ordinary_id" ] && [ "$existing_ordinary_running" = "true" ]; then
  docker stop "$existing_ordinary_id"
  migration_was_running=true
fi

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
  rollback_migration
  exit 1
fi

if [ -n "$existing_ordinary_id" ]; then
  docker rm "$existing_ordinary_id"
  migration_old_removed=true
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
