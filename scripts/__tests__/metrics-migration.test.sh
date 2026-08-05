#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

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
  if [ "${4:-}" = "{{.ID}}" ]; then
    echo "old-id"
  else
    echo "old-id|old-panel|ghcr.io/pluviophile714/zashboardx:latest"
  fi
  exit 0
fi

if [ "$1" = "inspect" ]; then
  template="${4:-}"
  case "$template" in
    *'.Config.Image'*) echo "ghcr.io/pluviophile714/zashboardx:latest" ;;
    *'.State.Running'*) echo "true" ;;
    *'.HostConfig.Binds'*) echo "null" ;;
    *'.HostConfig.NetworkMode'*) echo "default" ;;
    *'.HostConfig.RestartPolicy.Name'*) echo "unless-stopped" ;;
    *'.Config.Labels'*) echo "" ;;
    *) echo "" ;;
  esac
  exit 0
fi

if [ "$1" = "port" ]; then
  echo "0.0.0.0:2080"
  exit 0
fi

case "$1" in
  stop|start|rm) exit 0 ;;
  compose)
    if [ "${2:-}" = "--project-name" ] && [ "${3:-}" = "zashboardx-metrics" ] &&
      [ "${4:-}" = "up" ] && [ "${DOCKER_FAIL_UP:-}" = "1" ]; then
      exit 1
    fi
    exit 0
    ;;
esac

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
  */api/metrics/health) printf '%s\n' '{"ok":true,"mihomoReachable":true}' ;;
  http://127.0.0.1:2080/) printf '%s\n' '<!doctype html><title>ZashboardX</title>' ;;
  *) exit 1 ;;
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

if ! printf 'y\n2080\nhttp://mihomo.test:9090\nsecret-for-test\n' |
  sh "${ROOT_DIR}/scripts/install-metrics.sh" >"${TMP_DIR}/install.out" 2>&1; then
  cat "${TMP_DIR}/install.out" >&2
  exit 1
fi

APP_DIR="${DATA_HOME}/zashboardx-metrics"
test -f "$APP_DIR/compose.yaml"
backup_files="$(ls "$APP_DIR"/ordinary-container-old-id-*.inspect.json 2>/dev/null || true)"
test -n "$backup_files"
grep -q 'stop old-id' "$DOCKER_LOG"
grep -q 'rm old-id' "$DOCKER_LOG"
grep -q 'Installation complete' "${TMP_DIR}/install.out"

FAIL_DATA_HOME="${TMP_DIR}/failure-data"
: >"$DOCKER_LOG"
if printf 'y\n2080\nhttp://mihomo.test:9090\nsecret-for-test\n' |
  DOCKER_FAIL_UP=1 XDG_DATA_HOME="$FAIL_DATA_HOME" sh "${ROOT_DIR}/scripts/install-metrics.sh" >"${TMP_DIR}/failure.out" 2>&1; then
  cat "${TMP_DIR}/failure.out" >&2
  echo "installer accepted a failed Metrics stack startup" >&2
  exit 1
fi
grep -q 'stop old-id' "$DOCKER_LOG"
grep -q 'start old-id' "$DOCKER_LOG"
if grep -q 'rm old-id' "$DOCKER_LOG"; then
  echo "failed migration must not remove the old panel" >&2
  exit 1
fi

echo "metrics migration test passed"
