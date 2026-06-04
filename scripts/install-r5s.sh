#!/usr/bin/env sh
set -eu

APP_NAME="zashboardx"
APP_DIR="/opt/${APP_NAME}"
IMAGE="ghcr.io/pluviophile714/zashboardx:latest"
DEFAULT_PORT="2080"
PORT="${1:-$DEFAULT_PORT}"

if ! echo "$PORT" | grep -Eq '^[0-9]+$' || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Invalid port: ${PORT}"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Please install Docker first."
  exit 1
fi

mkdir -p "$APP_DIR"

cat >"${APP_DIR}/.env" <<EOF
PORT=${PORT}
IMAGE=${IMAGE}
EOF

cat >"${APP_DIR}/compose.yaml" <<'EOF'
services:
  zashboardx:
    image: ${IMAGE}
    container_name: zashboardx
    ports:
      - "${PORT}:80"
    restart: unless-stopped
EOF

cd "$APP_DIR"
docker compose pull
docker compose up -d

echo
echo "ZashboardX installed successfully."
echo "URL: http://<your-r5s-ip>:${PORT}"
echo "App dir: ${APP_DIR}"
