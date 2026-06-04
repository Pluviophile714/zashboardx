#!/usr/bin/env sh
set -eu

APP_NAME="zashboardx"
APP_DIR="/opt/${APP_NAME}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Please install Docker first."
  exit 1
fi

if [ ! -f "${APP_DIR}/compose.yaml" ] || [ ! -f "${APP_DIR}/.env" ]; then
  echo "Installation not found: ${APP_DIR}"
  exit 1
fi

cd "$APP_DIR"
docker compose pull
docker compose up -d

echo
echo "ZashboardX updated successfully."
