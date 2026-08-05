#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
cleanup() {
  status="$?"
  if [ "$status" -ne 0 ] && [ -f "${TMP_DIR}/install.out" ]; then
    cat "${TMP_DIR}/install.out" >&2 || true
  fi
  rm -rf "$TMP_DIR"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

BIN_DIR="${TMP_DIR}/bin"
HOME_DIR="${TMP_DIR}/home"
DATA_HOME="${TMP_DIR}/data"
DOCKER_LOG="${TMP_DIR}/docker.log"
mkdir -p "$BIN_DIR" "$HOME_DIR" "$DATA_HOME"

cat >"${BIN_DIR}/docker" <<'EOF'
#!/usr/bin/env sh
set -eu
printf '%s\n' "$*" >>"$DOCKER_LOG"

if [ "$1" = "compose" ] && [ "${2:-}" = "version" ]; then
  echo "Docker Compose version v2.39.0"
  exit 0
fi

if [ "$1" = "ps" ]; then
  if [ "${DOCKER_OCCUPIED:-}" = "1" ]; then
    if [ "${4:-}" = "{{.ID}}" ]; then
      echo "custom-id"
    else
      echo "custom-id|custom-panel|custom/image:latest"
    fi
  fi
  exit 0
fi

if [ "$1" = "inspect" ]; then
  echo "false"
  exit 0
fi

if [ "$1" = "compose" ]; then
  exit 0
fi

echo "unexpected docker command: $*" >&2
exit 1
EOF

cat >"${BIN_DIR}/curl" <<'EOF'
#!/usr/bin/env sh
set -eu

url=""
for arg in "$@"; do
  case "$arg" in
    http://*|https://*) url="$arg" ;;
  esac
done

case "$url" in
  */api/metrics/health)
    printf '%s\n' '{"ok":true,"mihomoReachable":true}'
    ;;
  http://127.0.0.1:2180/)
    printf '%s\n' '<!doctype html><title>ZashboardX</title>'
    ;;
  *)
    echo "unexpected curl url: $url" >&2
    exit 1
    ;;
esac
EOF

cat >"${BIN_DIR}/sleep" <<'EOF'
#!/usr/bin/env sh
exit 0
EOF

chmod +x "${BIN_DIR}/docker" "${BIN_DIR}/curl" "${BIN_DIR}/sleep"

export PATH="${BIN_DIR}:$PATH"
export HOME="$HOME_DIR"
export XDG_DATA_HOME="$DATA_HOME"
export DOCKER_LOG

printf '2180\nhttp://mihomo.test:9090\nsecret-for-test\n' |
  sh "${ROOT_DIR}/scripts/install-metrics.sh" >"${TMP_DIR}/install.out" 2>&1

APP_DIR="${DATA_HOME}/zashboardx-metrics"
COMPOSE_FILE="${APP_DIR}/compose.yaml"
ENV_FILE="${APP_DIR}/.env"

test -d "${APP_DIR}/metrics-data"
test -f "$COMPOSE_FILE"
test -f "$ENV_FILE"

grep -q '^  zashboardx:$' "$COMPOSE_FILE"
grep -q '^  zashboardx-metrics:$' "$COMPOSE_FILE"
grep -q 'com.zashboardx.metrics.managed=true' "$COMPOSE_FILE"
grep -q './metrics-data:/data' "$COMPOSE_FILE"
grep -q '"${PORT}:80"' "$COMPOSE_FILE"

helper_section="$(sed -n '/^  zashboardx-metrics:$/,$p' "$COMPOSE_FILE")"
if printf '%s\n' "$helper_section" | grep -q '^    ports:'; then
  echo "metrics helper must not publish a host port" >&2
  exit 1
fi

grep -q "^PORT='2180'$" "$ENV_FILE"
grep -q "^MIHOMO_BASE_URL='http://mihomo.test:9090'$" "$ENV_FILE"
grep -q "^MIHOMO_SECRET='secret-for-test'$" "$ENV_FILE"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) test "$(stat -c '%a' "$ENV_FILE")" = "600" ;;
esac

grep -q 'compose --project-name zashboardx-metrics pull' "$DOCKER_LOG"
grep -q 'compose --project-name zashboardx-metrics up -d' "$DOCKER_LOG"
grep -q 'Installation complete' "${TMP_DIR}/install.out"

if grep -q 'secret-for-test' "${TMP_DIR}/install.out"; then
  echo "installer printed the Mihomo secret" >&2
  exit 1
fi

printf '\n\n\n' | sh "${ROOT_DIR}/scripts/install-metrics.sh" >"${TMP_DIR}/reinstall.out" 2>&1
grep -q "^MIHOMO_SECRET='secret-for-test'\$" "$ENV_FILE"

printf 'sqlite-test-data\n' >"${APP_DIR}/metrics-data/metrics.sqlite"

sh "${ROOT_DIR}/scripts/update-metrics.sh" >"${TMP_DIR}/update.out" 2>&1
grep -q 'compose --project-name zashboardx-metrics pull' "$DOCKER_LOG"
grep -q 'compose --project-name zashboardx-metrics up -d' "$DOCKER_LOG"
grep -q 'sqlite-test-data' "${APP_DIR}/metrics-data/metrics.sqlite"

sh "${ROOT_DIR}/scripts/disable-metrics.sh" >"${TMP_DIR}/disable.out" 2>&1
grep -q 'compose --project-name zashboardx-metrics down' "$DOCKER_LOG"
grep -q 'compose --project-name zashboardx -f compose-ordinary.yaml up -d' "$DOCKER_LOG"
if grep -q 'down.*-v' "$DOCKER_LOG"; then
  echo "disable must not remove Compose volumes" >&2
  exit 1
fi
grep -q 'sqlite-test-data' "${APP_DIR}/metrics-data/metrics.sqlite"
grep -q '^    image: ${IMAGE}$' "${APP_DIR}/compose-ordinary.yaml"
grep -q '"${PORT}:80"' "${APP_DIR}/compose-ordinary.yaml"

printf 'no\n' | sh "${ROOT_DIR}/scripts/disable-metrics.sh" --purge-data >/dev/null 2>&1
grep -q 'sqlite-test-data' "${APP_DIR}/metrics-data/metrics.sqlite"

printf 'yes\n' | sh "${ROOT_DIR}/scripts/disable-metrics.sh" --purge-data >/dev/null 2>&1
test ! -e "${APP_DIR}/metrics-data"

CONFLICT_DATA_HOME="${TMP_DIR}/conflict-data"
if DOCKER_OCCUPIED=1 XDG_DATA_HOME="$CONFLICT_DATA_HOME" printf '2190\nhttp://mihomo.test:9090\nsecret-for-test\n' |
  DOCKER_OCCUPIED=1 XDG_DATA_HOME="$CONFLICT_DATA_HOME" sh "${ROOT_DIR}/scripts/install-metrics.sh" >"${TMP_DIR}/conflict.out" 2>&1; then
  echo "installer accepted an occupied unmanaged port" >&2
  exit 1
fi
test ! -e "${CONFLICT_DATA_HOME}/zashboardx-metrics"

ordinary_line="$(grep -n 'docker run -d -p 80:80 ghcr.io/pluviophile714/zashboardx:latest' "${ROOT_DIR}/README.md" | cut -d: -f1)"
metrics_line="$(grep -n 'Optional Metrics Installation' "${ROOT_DIR}/README.md" | cut -d: -f1)"
test -n "$ordinary_line"
test -n "$metrics_line"
test "$ordinary_line" -lt "$metrics_line"
for script_name in install-metrics.sh update-metrics.sh disable-metrics.sh; do
  grep -q "raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/${script_name}" \
    "${ROOT_DIR}/docs/metrics-install.md"
done
if grep -Eq 'MIHOMO_SECRET=[^[:space:]]+' "${ROOT_DIR}/README.md" "${ROOT_DIR}/docs/metrics-install.md" "${ROOT_DIR}/docs/metrics-migration.md"; then
  echo "public docs must not contain a non-empty Mihomo secret" >&2
  exit 1
fi

echo "install-metrics fresh install test passed"
