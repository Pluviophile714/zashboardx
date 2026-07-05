#!/usr/bin/env sh
set -eu

APP_NAME="zashboardx"
APP_DIR="/opt/${APP_NAME}"
IMAGE="ghcr.io/pluviophile714/zashboardx:latest"
METRICS_IMAGE="ghcr.io/pluviophile714/zashboardx:metrics-latest"
DEFAULT_PORT="2080"
PORT="${1:-$DEFAULT_PORT}"

read_env_value() {
  key="$1"
  fallback="$2"
  if [ -f "${APP_DIR}/.env" ]; then
    value="$(grep -E "^${key}=" "${APP_DIR}/.env" | tail -n 1 | cut -d= -f2- || true)"
    if [ -n "$value" ]; then
      echo "$value"
      return
    fi
  fi
  echo "$fallback"
}

if ! echo "$PORT" | grep -Eq '^[0-9]+$' || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Invalid port: ${PORT}"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Please install Docker first."
  exit 1
fi

mkdir -p "$APP_DIR"

MIHOMO_BASE_URL="$(read_env_value MIHOMO_BASE_URL "${MIHOMO_BASE_URL:-http://192.168.8.1:9090}")"
MIHOMO_SECRET="$(read_env_value MIHOMO_SECRET "${MIHOMO_SECRET:-}")"
SCRAPE_INTERVAL_SECONDS="$(read_env_value SCRAPE_INTERVAL_SECONDS "${SCRAPE_INTERVAL_SECONDS:-30}")"
PROBE_CONCURRENCY="$(read_env_value PROBE_CONCURRENCY "${PROBE_CONCURRENCY:-8}")"
PROBE_TIMEOUT_MS="$(read_env_value PROBE_TIMEOUT_MS "${PROBE_TIMEOUT_MS:-5000}")"
PROBE_TEST_URL="$(read_env_value PROBE_TEST_URL "${PROBE_TEST_URL:-https://www.gstatic.com/generate_204}")"

cat >"${APP_DIR}/.env" <<EOF
PORT=${PORT}
IMAGE=${IMAGE}
METRICS_IMAGE=${METRICS_IMAGE}
MIHOMO_BASE_URL=${MIHOMO_BASE_URL}
MIHOMO_SECRET=${MIHOMO_SECRET}
SCRAPE_INTERVAL_SECONDS=${SCRAPE_INTERVAL_SECONDS}
PROBE_INTERVAL_SECONDS=${SCRAPE_INTERVAL_SECONDS}
PROBE_CONCURRENCY=${PROBE_CONCURRENCY}
PROBE_TIMEOUT_MS=${PROBE_TIMEOUT_MS}
PROBE_TEST_URL=${PROBE_TEST_URL}
EOF

cat >"${APP_DIR}/compose.yaml" <<'EOF'
services:
  zashboardx:
    image: ${IMAGE}
    container_name: zashboardx
    ports:
      - "${PORT}:80"
    depends_on:
      - zashboardx-metrics
    restart: unless-stopped

  zashboardx-metrics:
    image: ${METRICS_IMAGE}
    container_name: zashboardx-metrics
    environment:
      MIHOMO_BASE_URL: ${MIHOMO_BASE_URL}
      MIHOMO_SECRET: ${MIHOMO_SECRET}
      SCRAPE_INTERVAL_SECONDS: ${SCRAPE_INTERVAL_SECONDS}
      PROBE_INTERVAL_SECONDS: ${PROBE_INTERVAL_SECONDS}
      PROBE_CONCURRENCY: ${PROBE_CONCURRENCY}
      PROBE_TIMEOUT_MS: ${PROBE_TIMEOUT_MS}
      PROBE_TEST_URL: ${PROBE_TEST_URL}
    volumes:
      - ./metrics-data:/data
    restart: unless-stopped
EOF

cd "$APP_DIR"
docker compose pull
if docker ps -a --format '{{.Names}}' | grep -qx "$APP_NAME"; then
  CURRENT_IMAGE="$(docker inspect "$APP_NAME" --format '{{.Config.Image}}' 2>/dev/null || true)"
  if [ "$CURRENT_IMAGE" != "$IMAGE" ]; then
    docker stop "$APP_NAME" >/dev/null 2>&1 || true
    docker rm "$APP_NAME" >/dev/null 2>&1 || true
  fi
fi
if docker ps -a --format '{{.Names}}' | grep -qx "zashboardx-metrics"; then
  CURRENT_METRICS_IMAGE="$(docker inspect zashboardx-metrics --format '{{.Config.Image}}' 2>/dev/null || true)"
  if [ "$CURRENT_METRICS_IMAGE" != "$METRICS_IMAGE" ]; then
    docker stop zashboardx-metrics >/dev/null 2>&1 || true
    docker rm zashboardx-metrics >/dev/null 2>&1 || true
  fi
fi
docker compose up -d

echo
echo "ZashboardX installed successfully."
echo "URL: http://<your-r5s-ip>:${PORT}"
echo "App dir: ${APP_DIR}"
echo "Metrics helper: http://<your-r5s-ip>:${PORT}/api/metrics/health"
