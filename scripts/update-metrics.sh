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

check_managed_stack() {
  if [ ! -f "${APP_DIR}/compose.yaml" ] || [ ! -f "${APP_DIR}/.env" ]; then
    echo "Metrics installation not found: ${APP_DIR}" >&2
    exit 1
  fi
  if ! grep -q 'com.zashboardx.metrics.managed=true' "${APP_DIR}/compose.yaml"; then
    echo "Refusing to update an unrecognized Compose project." >&2
    exit 1
  fi
}

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker and Docker Compose v2 are required." >&2
  exit 1
fi

check_managed_stack
cd "$APP_DIR"
docker compose --project-name "$APP_NAME" pull
docker compose --project-name "$APP_NAME" up -d

PORT="$(read_env_value PORT 2080)"
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
  echo "The updated panel did not become ready within 30 seconds." >&2
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

echo "Metrics installation updated."
echo "Panel: http://<docker-host>:${PORT}"
if ! printf '%s' "$health" | grep -Eq '"mihomoReachable"[[:space:]]*:[[:space:]]*true'; then
  echo "Warning: the panel is running, but Metrics cannot reach Mihomo yet." >&2
fi
