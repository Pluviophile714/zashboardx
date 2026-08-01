# Optional Metrics Installation Design

## Goal

Keep the ordinary ZashboardX image as the lightweight default. Offer Metrics as an
optional, one-command enhancement that starts the existing panel image together
with the metrics helper, without requiring users to read or edit Docker Compose
YAML.

## Product Shape

### Ordinary installation

- Remains the primary recommendation.
- Uses the existing static `ghcr.io/pluviophile714/zashboardx:latest` image.
- Continues to work with a simple `docker run` command.
- Has no durable server-side Metrics history. The frontend uses its existing
  browser-local history behavior.

### Metrics installation

- Is an optional installation path, not a different frontend build.
- Runs two internal Docker services:
  - `zashboardx`: the existing panel image.
  - `zashboardx-metrics`: the existing helper image.
- The browser still visits one panel URL. Caddy proxies `/api/metrics/*` to the
  helper over the private Compose network.
- The helper keeps its SQLite database in a persistent host directory.
- When the helper is unavailable, the unchanged frontend falls back to local
  history rather than preventing the panel from loading.

## User Experience

Metrics users run one copy-paste command that downloads and starts
`install-metrics.sh`. The script interactively asks for only:

1. Panel port, default `2080`.
2. Mihomo external-controller URL, for example `http://192.168.1.1:9090`.
3. Mihomo secret, optional and entered without echoing it back to the terminal.

The script performs the rest:

1. Check for Docker and the Docker Compose plugin.
2. Reject an occupied requested port or an existing unmanaged panel container
   with a clear message.
3. Create a managed application directory and a private `.env` file.
4. Generate the internal Compose file with the panel, helper, private network,
   and persistent Metrics data directory.
5. Pull and start both public GHCR images.
6. Verify that the panel responds and that `/api/metrics/health` returns JSON.
7. Print the single panel URL plus a short note that historical Metrics need
   time to accumulate.

No user-facing YAML editing, database setup, extra exposed port, or image tag
selection is required.

## Installation Files

Add these public, generic assets:

- `scripts/install-metrics.sh`: interactive installer for a fresh Metrics stack.
- `scripts/update-metrics.sh`: pulls and restarts both services while preserving
  the database.
- `scripts/disable-metrics.sh`: stops and removes the Metrics stack while
  retaining data by default; `--purge-data` requires explicit confirmation.
- `docs/metrics-install.md`: short explanation, prerequisites, troubleshooting,
  and the one-command install/update/disable instructions.
- README links to ordinary installation first, then to the optional Metrics
  installation guide.

The current `scripts/install-r5s.sh` and `scripts/update-r5s.sh` remain
personal R5S-maintenance scripts. They are not the public installation path and
must not be documented as one.

## Container Details

- Continue publishing the existing images:
  - `ghcr.io/pluviophile714/zashboardx:latest`
  - `ghcr.io/pluviophile714/zashboardx:metrics-latest`
- Do not create a multi-process all-in-one image. The two services retain
  independent health, restart, and upgrade behavior while being hidden behind
  one installation command.
- The Compose service name remains `zashboardx-metrics`, matching the Caddy
  reverse-proxy destination already embedded in the panel image.
- Do not set global `container_name` values in the new generic Compose file.
  This avoids collisions with other installations on the same Docker host.
- The helper exposes no host port. Only the panel port is published.

## Configuration and Security

- `MIHOMO_BASE_URL` is required. It must be reachable from the helper container;
  host-local `127.0.0.1` is not generally correct for a bridge-networked
  container.
- `MIHOMO_SECRET` is optional, but when supplied it is stored only in the local
  `.env` file with restrictive permissions.
- The installer must not print the secret, place it in a command-line example,
  or commit it to the repository.
- Defaults: 30-second collection interval, eight concurrent leaf-node probes,
  seven-day retention, and existing Metrics cache defaults. Advanced tuning is
  intentionally deferred from the first-run flow.

## Upgrade and Removal

- `update-metrics.sh` pulls `latest` and `metrics-latest`, then runs Compose
  recreation without deleting `metrics-data`.
- `disable-metrics.sh` stops services and removes their managed Compose stack;
  it preserves `metrics-data` unless the user explicitly selects
  `--purge-data`.
- The first release intentionally supports fresh Metrics installation only.
  Automatically converting arbitrary pre-existing `docker run` containers is
  deferred because their ports, mounts, labels, networks, and custom flags
  cannot be reconstructed safely. A later migration command can target only a
  recognizable official installation after a separate design review.

## Success Criteria

1. A user who knows their Mihomo controller URL can install Metrics without
   editing YAML or choosing image tags.
2. Ordinary `docker run` installation remains unchanged and documented first.
3. Metrics runs with one browser-visible panel port and no helper host port.
4. Secrets never appear in command examples, logs, or repository files.
5. A failed helper does not stop the panel from loading.
6. Update and disable workflows preserve Metrics data unless explicit deletion
   is requested.

## Validation Plan

- Run shell syntax checks for all three scripts.
- Exercise the installer against a clean temporary Docker environment.
- Verify the panel HTTP response and `/api/metrics/health` after installation.
- Verify that the helper has no published host port.
- Verify update preserves the SQLite data directory.
- Verify disable preserves data by default and only deletes it after explicit
  `--purge-data` confirmation.
