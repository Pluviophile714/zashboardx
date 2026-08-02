# Optional Metrics Installation Design

## Goal

Keep the ordinary ZashboardX image as the lightweight default. Offer Metrics as an
optional, self-service enhancement that starts the existing panel image together
with the metrics helper, without requiring users to read or edit Docker Compose
YAML or ask the maintainer for deployment help.

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
2. Detect an existing managed Metrics stack. If found, reuse its port and data
   directory, ask for the current Mihomo URL and secret, update only that local
   configuration, and recreate the helper without discarding history.
3. Detect an existing ordinary ZashboardX container before using the requested
   port.
4. For a recognizable official ordinary installation, show the detected port
   and image, create a local migration backup, and ask for one explicit
   confirmation before migration.
5. For an unrecognizable custom container, make no changes. Explain the exact
   local conflict and point to the self-service manual migration section rather
   than requiring maintainer assistance.
6. Create a managed application directory and a private `.env` file.
7. Generate the internal Compose file with the panel, helper, private network,
   and persistent Metrics data directory.
8. Pull and start both public GHCR images.
9. Verify that the panel responds and that `/api/metrics/health` reports Mihomo
   reachable. A `401` response is reported as a secret mismatch with an
   instruction to rerun this installer.
10. During a recognized-container migration, stop but do not remove the old
   ordinary container before starting the Metrics stack. If its health check
   fails, stop the new stack and restart the unchanged old container
   automatically. Remove the old container only after the new stack passes.
11. Print the single panel URL plus a short note that historical Metrics need
    time to accumulate.

No user-facing YAML editing, database setup, extra exposed port, or image tag
selection is required.

## Installation Files

Add these public, generic assets:

- `scripts/install-metrics.sh`: interactive installer for a fresh Metrics stack
  or a migration from a recognizable official ordinary installation.
- `scripts/update-metrics.sh`: pulls and restarts both services while preserving
  the database.
- `scripts/disable-metrics.sh`: stops and removes the Metrics stack while
  leaving the ordinary panel running and retaining data by default;
  `--purge-data` requires explicit confirmation.
- `docs/metrics-migration.md`: self-service migration instructions for custom
  installations the automatic detector deliberately does not alter.
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
- A recognized migration saves the previous ordinary container's inspect backup
  in the managed application directory. The old container remains intact and
  stopped until the new Metrics stack passes health checks, then is removed.

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
  it immediately restores an ordinary panel on the same port and preserves
  `metrics-data` unless the user explicitly selects `--purge-data`.
- Rerunning `install-metrics.sh` against a managed stack acts as the supported
  configuration repair path. It updates a changed Mihomo URL or secret and
  recreates only the helper service while keeping the panel and SQLite history.
- The installer supports a common existing ordinary deployment when all of
  these preflight checks pass: the panel uses the official image, publishes one
  panel port, and does not rely on unrecognized custom runtime options. It
  preserves that port and restart policy during migration.
- The installer never guesses how to reproduce an arbitrary custom
  `docker run` command. It makes no changes in that case, and the repository
  provides a standalone self-service migration guide with explicit commands.

## Success Criteria

1. A user who knows their Mihomo controller URL can install Metrics without
   editing YAML or choosing image tags.
2. Ordinary `docker run` installation remains unchanged and documented first.
3. Metrics runs with one browser-visible panel port and no helper host port.
4. Secrets never appear in command examples, logs, or repository files.
5. A failed helper does not stop the panel from loading.
6. Update and disable workflows preserve Metrics data unless explicit deletion
   is requested.
7. A normal official `docker run` deployment can be converted to Metrics by the
   installer without maintainer involvement, and a failed conversion restores
   the original container.
8. A custom deployment is never silently replaced; its owner receives a local,
   documented migration path instead of needing interactive support.
9. A user can repair a `401` after a Mihomo secret change by rerunning the same
   installer, without editing YAML or losing history.
10. Disabling Metrics leaves the ordinary panel available on the same port.

## Validation Plan

- Run shell syntax checks for all three scripts.
- Exercise the installer against a clean temporary Docker environment.
- Verify the panel HTTP response and `/api/metrics/health` after installation.
- Verify that the helper has no published host port.
- Verify update preserves the SQLite data directory.
- Verify disable preserves data by default and only deletes it after explicit
  `--purge-data` confirmation.
- Verify a recognized ordinary container migrates with its panel port and
  restart policy preserved.
- Force a post-migration health-check failure and verify automatic restoration
  of the original ordinary container.
- Verify an unrecognized custom container is left untouched and produces a
  self-contained migration instruction.
- Change the Mihomo secret, rerun the installer, and verify the helper recovers
  without replacing the database.
- Verify disable removes the helper, keeps the ordinary panel returning HTTP
  `200` on the same port, and preserves the Metrics database by default.
