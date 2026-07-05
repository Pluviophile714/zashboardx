#!/usr/bin/env sh
set -eu

APP_NAME="zashboardx"
APP_DIR="/opt/${APP_NAME}"
IMAGE="ghcr.io/pluviophile714/zashboardx:latest"
METRICS_IMAGE="ghcr.io/pluviophile714/zashboardx:metrics-latest"
DEFAULT_PORT="2080"

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

write_stack_files() {
  PORT="$(read_env_value PORT "$DEFAULT_PORT")"
  MIHOMO_BASE_URL="$(read_env_value MIHOMO_BASE_URL "${MIHOMO_BASE_URL:-http://192.168.8.1:9090}")"
  MIHOMO_SECRET="$(read_env_value MIHOMO_SECRET "${MIHOMO_SECRET:-}")"
  PROBE_INTERVAL_SECONDS="$(read_env_value PROBE_INTERVAL_SECONDS "${PROBE_INTERVAL_SECONDS:-300}")"
  PROBE_CONCURRENCY="$(read_env_value PROBE_CONCURRENCY "${PROBE_CONCURRENCY:-8}")"
  PROBE_TIMEOUT_MS="$(read_env_value PROBE_TIMEOUT_MS "${PROBE_TIMEOUT_MS:-5000}")"
  PROBE_TEST_URL="$(read_env_value PROBE_TEST_URL "${PROBE_TEST_URL:-https://www.gstatic.com/generate_204}")"

  cat >"${APP_DIR}/.env" <<EOF
PORT=${PORT}
IMAGE=${IMAGE}
METRICS_IMAGE=${METRICS_IMAGE}
MIHOMO_BASE_URL=${MIHOMO_BASE_URL}
MIHOMO_SECRET=${MIHOMO_SECRET}
PROBE_INTERVAL_SECONDS=${PROBE_INTERVAL_SECONDS}
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
      PROBE_INTERVAL_SECONDS: ${PROBE_INTERVAL_SECONDS}
      PROBE_CONCURRENCY: ${PROBE_CONCURRENCY}
      PROBE_TIMEOUT_MS: ${PROBE_TIMEOUT_MS}
      PROBE_TEST_URL: ${PROBE_TEST_URL}
    volumes:
      - ./metrics-data:/data
    restart: unless-stopped
EOF
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Please install Docker first."
  exit 1
fi

if [ ! -f "${APP_DIR}/compose.yaml" ] || [ ! -f "${APP_DIR}/.env" ]; then
  echo "Installation not found: ${APP_DIR}"
  exit 1
fi

cd "$APP_DIR"
if ! grep -q "zashboardx-metrics" "${APP_DIR}/compose.yaml" || ! grep -qxF "METRICS_IMAGE=${METRICS_IMAGE}" "${APP_DIR}/.env"; then
  echo "Refreshing compose stack for zashboardx-metrics..."
  write_stack_files
fi
docker compose pull
docker compose up -d

echo
echo "ZashboardX updated successfully."
echo "Metrics helper: http://<your-r5s-ip>:$(read_env_value PORT "$DEFAULT_PORT")/api/metrics/health"
