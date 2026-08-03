# Optional Metrics Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide one-command installation, update, and removal for the optional two-container Metrics edition without asking users to edit Compose YAML.

**Architecture:** Ordinary installation stays a single `docker run` panel. Metrics installation writes a managed Compose project containing the existing panel and helper images; Caddy connects to the helper by its `zashboardx-metrics` service name, and SQLite is stored in the managed directory. Scripts touch only stacks carrying a dedicated managed label.

**Tech Stack:** POSIX `sh`, Docker Compose v2, GHCR, Markdown.

## Global Constraints

- Ordinary `ghcr.io/pluviophile714/zashboardx:latest` installation is unchanged and documented first.
- Metrics uses `latest` plus `metrics-latest`, with no host port for the helper.
- Generated generic Compose must have service name `zashboardx-metrics`, no `container_name`, and label `com.zashboardx.metrics.managed=true` on both services.
- Keep `MIHOMO_SECRET` only in local `.env` mode `600`; never print or document a secret.
- Preserve `metrics-data` unless `disable-metrics.sh --purge-data` receives explicit `yes`.
- Do not modify private `scripts/install-r5s.sh` or `scripts/update-r5s.sh`.

---

### Task 1: Create the self-service installer

**Files:**
- Create: `scripts/install-metrics.sh`
- Create: `scripts/__tests__/install-metrics.test.sh`

**Interfaces:**
- Input: interactive `PORT` (default `2080`), required `MIHOMO_BASE_URL`, optional hidden `MIHOMO_SECRET`.
- Output: `${XDG_DATA_HOME:-$HOME/.local/share}/zashboardx-metrics/{.env,compose.yaml,metrics-data}` and Compose project `zashboardx-metrics`.

- [ ] **Step 1: Write a failing fresh-install shell test**

Stub `docker`, `curl`, and `sleep` in a temporary `PATH`, invoke the installer with scripted stdin, and assert the generated Compose contains both services, the managed label, `zashboardx-metrics`, `./metrics-data:/data`, and no `ports:` stanza in the helper service.

```sh
grep -q '^  zashboardx-metrics:$' "$APP_DIR/compose.yaml"
! sed -n '/zashboardx-metrics:/,/^[^ ]/p' "$APP_DIR/compose.yaml" | grep -q 'ports:'
grep -q 'com.zashboardx.metrics.managed=true' "$APP_DIR/compose.yaml"
```

- [ ] **Step 2: Verify the test fails**

Run: `sh scripts/__tests__/install-metrics.test.sh`

Expected: FAIL because `scripts/install-metrics.sh` is absent.

- [ ] **Step 3: Implement `install-metrics.sh`**

Use `set -eu`; require `docker compose version`; validate the port is `1..65535`; collect the secret with `stty -echo` and a trap restoring the terminal. Write `.env` with `chmod 600` and render this Compose shape:

```yaml
services:
  zashboardx:
    image: ${IMAGE}
    ports: ["${PORT}:80"]
    labels: ["com.zashboardx.metrics.managed=true"]
    depends_on: [zashboardx-metrics]
  zashboardx-metrics:
    image: ${METRICS_IMAGE}
    environment:
      MIHOMO_BASE_URL: ${MIHOMO_BASE_URL}
      MIHOMO_SECRET: ${MIHOMO_SECRET}
      SCRAPE_INTERVAL_SECONDS: "30"
      PROBE_CONCURRENCY: "8"
    volumes: ["./metrics-data:/data"]
    labels: ["com.zashboardx.metrics.managed=true"]
```

Before `docker compose --project-name zashboardx-metrics up -d`, inspect containers publishing the requested port. If any lack the managed label, print their name/image/port and exit without writing or stopping anything. A managed reinstall preserves `metrics-data`. Poll the panel root and `/api/metrics/health` for 30 seconds; a panel failure runs `docker compose down` and exits non-zero, while `mihomoReachable:false` leaves the panel running and tells the user to rerun the installer.

- [ ] **Step 4: Verify and commit**

Run: `sh -n scripts/install-metrics.sh && sh scripts/__tests__/install-metrics.test.sh`

```sh
git add scripts/install-metrics.sh scripts/__tests__/install-metrics.test.sh
git commit -m "feat: add self-service metrics installer"
```

### Task 2: Add supported update and disable workflows

**Files:**
- Create: `scripts/update-metrics.sh`
- Create: `scripts/disable-metrics.sh`
- Modify: `scripts/__tests__/install-metrics.test.sh`

**Interfaces:**
- Input: the managed directory and `.env` from Task 1.
- Output: either refreshed two-service Metrics, or ordinary one-service panel on the same port with Metrics data retained.

- [ ] **Step 1: Write failing lifecycle tests**

Extend the shell fixture to require `update-metrics.sh` to reject missing or unlabelled Compose, call `docker compose pull` then `up -d`, and keep the data directory. Require `disable-metrics.sh` to reject unmanaged Compose, run `down` without `-v`, start a one-service ordinary panel on saved `${PORT}`, and retain data. For `--purge-data`, require stdin exactly `yes` before deleting only `${APP_DIR}/metrics-data`.

- [ ] **Step 2: Verify lifecycle tests fail**

Run: `sh scripts/__tests__/install-metrics.test.sh`

Expected: FAIL because lifecycle scripts do not exist.

- [ ] **Step 3: Implement lifecycle scripts**

Both scripts verify `com.zashboardx.metrics.managed=true` before acting. Update runs:

```sh
docker compose --project-name zashboardx-metrics pull
docker compose --project-name zashboardx-metrics up -d
```

Then applies the same panel/health polling as Task 1. Disable runs `docker compose --project-name zashboardx-metrics down`, writes `compose-ordinary.yaml` using saved `IMAGE` and `PORT`, starts it with project name `zashboardx`, and never removes `.env` or SQLite absent the explicit purge confirmation.

- [ ] **Step 4: Verify and commit**

Run: `sh -n scripts/install-metrics.sh scripts/update-metrics.sh scripts/disable-metrics.sh && sh scripts/__tests__/install-metrics.test.sh`

```sh
git add scripts/update-metrics.sh scripts/disable-metrics.sh scripts/__tests__/install-metrics.test.sh
git commit -m "feat: add metrics lifecycle commands"
```

### Task 3: Publish the self-service guide

**Files:**
- Create: `docs/metrics-install.md`
- Create: `docs/metrics-migration.md`
- Modify: `README.md`
- Modify: `scripts/__tests__/install-metrics.test.sh`

**Interfaces:**
- Input: public scripts from Tasks 1 and 2.
- Output: copy-paste commands with no YAML or secret required.

- [ ] **Step 1: Write failing documentation assertions**

Fail when README does not list ordinary installation before Metrics, the install guide lacks all three script URLs, or docs contain `MIHOMO_SECRET=` followed by a non-empty value.

- [ ] **Step 2: Implement documentation**

Document Docker/Compose and a controller address reachable from the helper. Use these exact command forms, with the secret entered only at the hidden prompt:

```sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/install-metrics.sh | sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/update-metrics.sh | sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/disable-metrics.sh | sh
```

Explain that only the panel port is exposed and history takes time to accumulate. State that auto-install refuses an occupied custom port; the migration guide instructs the owner to stop their custom container, run the installer with that port, validate panel and health, then remove the old container only after success.

- [ ] **Step 3: Complete validation and commit**

Run: `sh scripts/__tests__/install-metrics.test.sh && pnpm metrics:test && pnpm run type-check && pnpm run build && git diff --check`

```sh
git add README.md docs/metrics-install.md docs/metrics-migration.md scripts/__tests__/install-metrics.test.sh
git commit -m "docs: explain self-service metrics installation"
```

## Acceptance Checks

- [ ] A fresh Metrics install starts two internal services and exposes one panel port.
- [ ] `/api/metrics/health` is reachable at the panel origin.
- [ ] Update and default disable preserve SQLite data.
- [ ] Custom containers are never replaced by an automatic script.
- [ ] Public documentation does not require YAML edits or expose secrets.
