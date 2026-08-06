#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

grep -Fq 'ENV METRICS_UPSTREAM=http://zashboardx-metrics:8787' "${ROOT_DIR}/Dockerfile"
grep -Fq 'reverse_proxy {$METRICS_UPSTREAM}' "${ROOT_DIR}/Caddyfile"
grep -Fq 'encode gzip' "${ROOT_DIR}/Caddyfile"

if grep -Fq 'reverse_proxy http://zashboardx-metrics:8787' "${ROOT_DIR}/Caddyfile"; then
  echo "Metrics upstream must not be hard-coded in the Caddyfile" >&2
  exit 1
fi

echo "metrics upstream configuration test passed"
