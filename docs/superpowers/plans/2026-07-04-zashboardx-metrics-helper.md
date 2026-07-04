# zashboardx Metrics Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an optional R5S-side metrics helper that gives zashboardx shared 24h proxy availability metrics across desktop and mobile browsers.

**Architecture:** Add a focused Node.js/TypeScript helper package under `packages/metrics-helper` using Node 24 `node:sqlite` for durable local storage. The static zashboardx frontend reads compact metrics through same-origin `/api/metrics/*`, served by Caddy reverse proxy to the helper container when present, and falls back to existing browser-local data when absent.

**Tech Stack:** TypeScript, Node.js 24, `node:test`, `node:sqlite`, pnpm workspace, Vite/Vue, Caddy, Docker Buildx, GitHub Actions.

---

## File Structure

- Create `pnpm-workspace.yaml`: declare the root app and `packages/*`.
- Modify `package.json`: add workspace scripts for helper tests/build.
- Create `packages/metrics-helper/package.json`: helper package scripts.
- Create `packages/metrics-helper/tsconfig.json`: TypeScript build config.
- Create `packages/metrics-helper/src/types.ts`: shared helper types.
- Create `packages/metrics-helper/src/config.ts`: environment parsing.
- Create `packages/metrics-helper/src/aggregate.ts`: pure metric aggregation.
- Create `packages/metrics-helper/src/aggregate.test.ts`: red/green tests for availability windows.
- Create `packages/metrics-helper/src/storage.ts`: SQLite schema and repository.
- Create `packages/metrics-helper/src/storage.test.ts`: repository tests against temp SQLite files.
- Create `packages/metrics-helper/src/mihomoClient.ts`: mihomo API client and node selection.
- Create `packages/metrics-helper/src/mihomoClient.test.ts`: mock fetch tests for discovery and probing.
- Create `packages/metrics-helper/src/prober.ts`: scheduled bounded probe runner.
- Create `packages/metrics-helper/src/server.ts`: read-only HTTP API.
- Create `packages/metrics-helper/src/index.ts`: process entrypoint.
- Create `Dockerfile.metrics-helper`: multi-arch helper image.
- Modify `Caddyfile`: reverse proxy `/api/metrics/*`.
- Modify `.github/workflows/deploy.yml`: build and publish helper image.
- Modify `scripts/install-r5s.sh`: install compose stack with optional helper.
- Modify `scripts/update-r5s.sh`: pull/update both services and prune after user-approved deploy.
- Create `src/api/metricsHelper.ts`: frontend fetch API.
- Create `src/store/proxyMetrics.ts`: page-level cached helper metrics store.
- Modify `src/views/ProxiesPage.vue`: preload helper metrics on mount and refresh on proxy tab use.
- Modify `src/components/proxies/ProxyNodeCard.vue`: display `R5S 24h` when helper metrics exist.

## Task 1: Workspace and Helper Package Skeleton

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json`
- Create: `packages/metrics-helper/package.json`
- Create: `packages/metrics-helper/tsconfig.json`

- [ ] **Step 1: Add workspace metadata**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - .
  - packages/*
```

- [ ] **Step 2: Add root scripts**

Add scripts to `package.json`:

```json
{
  "metrics:build": "pnpm --filter @zashboardx/metrics-helper build",
  "metrics:test": "pnpm --filter @zashboardx/metrics-helper test"
}
```

- [ ] **Step 3: Add helper package config**

Create `packages/metrics-helper/package.json`:

```json
{
  "name": "@zashboardx/metrics-helper",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "pnpm run build && node --test \"dist/**/*.test.js\"",
    "start": "node dist/index.js"
  }
}
```

- [ ] **Step 4: Add helper tsconfig**

Create `packages/metrics-helper/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.node.json",
  "compilerOptions": {
    "composite": false,
    "declaration": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "tsBuildInfoFile": "./dist/.tsbuildinfo"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: Verify skeleton**

Run: `pnpm metrics:build`

Expected: fail because there are no helper source files yet. This is acceptable before Task 2 creates source files.

## Task 2: Pure Aggregation With TDD

**Files:**
- Create: `packages/metrics-helper/src/types.ts`
- Create: `packages/metrics-helper/src/aggregate.test.ts`
- Create: `packages/metrics-helper/src/aggregate.ts`

- [ ] **Step 1: Write failing aggregation tests**

Create `aggregate.test.ts` with tests for empty input, partial coverage, failures, and delay stats:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateNodeMetrics } from './aggregate.js'
import type { ProbeSample } from './types.js'

const at = (minute: number) => new Date(Date.UTC(2026, 6, 4, 0, minute, 0)).toISOString()

test('returns null availability when there are no samples', () => {
  const metrics = aggregateNodeMetrics([], Date.parse(at(30)), 24 * 60 * 60)
  assert.equal(metrics.availability, null)
  assert.equal(metrics.sampleCount, 0)
  assert.equal(metrics.coverageSeconds, 0)
})

test('computes availability and coverage inside the requested window', () => {
  const samples: ProbeSample[] = [
    { nodeName: 'HK-01', testUrl: 'https://example.com', timestamp: at(0), delay: 80, success: true },
    { nodeName: 'HK-01', testUrl: 'https://example.com', timestamp: at(5), delay: null, success: false, errorType: 'timeout' },
    { nodeName: 'HK-01', testUrl: 'https://example.com', timestamp: at(10), delay: 120, success: true },
  ]
  const metrics = aggregateNodeMetrics(samples, Date.parse(at(30)), 24 * 60 * 60)
  assert.equal(metrics.availability, 2 / 3)
  assert.equal(metrics.coverageSeconds, 600)
  assert.equal(metrics.sampleCount, 3)
  assert.equal(metrics.successCount, 2)
  assert.equal(metrics.failureCount, 1)
  assert.equal(metrics.avgDelay, 100)
  assert.equal(metrics.minDelay, 80)
  assert.equal(metrics.maxDelay, 120)
  assert.equal(metrics.lastDelay, 120)
})
```

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm metrics:test`

Expected: fail because `aggregate.ts` and `types.ts` do not exist.

- [ ] **Step 3: Implement types and aggregation**

Create `types.ts` and `aggregate.ts` with:

```ts
export type ProbeSample = {
  nodeName: string
  testUrl: string
  timestamp: string
  delay: number | null
  success: boolean
  errorType?: string
}

export type NodeMetrics = {
  availability: number | null
  coverageSeconds: number
  sampleCount: number
  successCount: number
  failureCount: number
  avgDelay: number | null
  minDelay: number | null
  maxDelay: number | null
  lastDelay: number | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lossRate: number | null
  lossSource: 'official' | 'probe' | 'log-inferred' | null
}
```

`aggregateNodeMetrics(samples, nowMs, windowSeconds)` filters by timestamp, counts successes and failures, calculates coverage from first to last sample, and returns `lossRate: null`.

- [ ] **Step 4: Run test and verify GREEN**

Run: `pnpm metrics:test`

Expected: all helper tests pass.

## Task 3: SQLite Storage With TDD

**Files:**
- Create: `packages/metrics-helper/src/storage.test.ts`
- Create: `packages/metrics-helper/src/storage.ts`

- [ ] **Step 1: Write failing storage tests**

Test that storage initializes schema, inserts samples, aggregates by node name, and prunes old samples.

- [ ] **Step 2: Run storage tests and verify RED**

Run: `pnpm metrics:test`

Expected: fail because `storage.ts` does not exist.

- [ ] **Step 3: Implement SQLite repository**

Use `node:sqlite` `DatabaseSync`. Create tables `nodes`, `probe_samples`, and `metadata`. Implement methods:

```ts
init(): void
recordNode(nodeName: string, type: string | null): void
insertProbeSample(sample: ProbeSample): void
getNodeMetrics(windowSeconds: number, nowMs?: number): Record<string, NodeMetrics>
getSingleNodeMetrics(nodeName: string, windowSeconds: number, nowMs?: number): NodeMetrics | null
prune(retentionDays: number, nowMs?: number): number
close(): void
```

- [ ] **Step 4: Run storage tests and verify GREEN**

Run: `pnpm metrics:test`

Expected: aggregation and storage tests pass.

## Task 4: Mihomo Client and Probe Runner

**Files:**
- Create: `packages/metrics-helper/src/config.ts`
- Create: `packages/metrics-helper/src/mihomoClient.test.ts`
- Create: `packages/metrics-helper/src/mihomoClient.ts`
- Create: `packages/metrics-helper/src/prober.ts`

- [ ] **Step 1: Write failing mihomo client tests**

Mock `fetch` to verify:

- `/proxies` discovery excludes groups and built-ins.
- delay probe returns success when mihomo returns `{ "delay": 88 }`.
- delay probe returns failure on HTTP error or abort.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm metrics:test`

Expected: fail because client implementation does not exist.

- [ ] **Step 3: Implement config and mihomo client**

Parse environment defaults:

```ts
MIHOMO_BASE_URL=http://127.0.0.1:9090
MIHOMO_SECRET=
METRICS_BIND_HOST=0.0.0.0
METRICS_PORT=8787
PROBE_INTERVAL_SECONDS=300
PROBE_CONCURRENCY=4
PROBE_TIMEOUT_MS=5000
PROBE_TEST_URL=https://www.gstatic.com/generate_204
PROBE_WINDOW_HOURS=24
METRICS_RETENTION_DAYS=7
METRICS_DATABASE_PATH=/data/metrics.sqlite
```

Use `Authorization: Bearer <secret>` only when a secret exists.

- [ ] **Step 4: Implement bounded prober**

Implement a simple promise pool. A probe cycle discovers nodes, records node metadata, probes each node with bounded concurrency, inserts samples, prunes retention, and records helper health.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `pnpm metrics:test`

Expected: all helper tests pass.

## Task 5: Helper HTTP API

**Files:**
- Create: `packages/metrics-helper/src/server.ts`
- Create: `packages/metrics-helper/src/index.ts`

- [ ] **Step 1: Write server behavior through storage tests or lightweight integration tests**

Use Node `http` against a temporary storage file. Verify `/api/metrics/health`, `/api/metrics/nodes?window=24h`, `/api/metrics/nodes/HK-01?window=24h`, and unknown routes.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm metrics:test`

Expected: fail because server implementation does not exist.

- [ ] **Step 3: Implement read-only HTTP API**

`server.ts` exports `createMetricsServer({ storage, health, defaultWindowSeconds })`. It returns JSON with `Cache-Control: no-store` and never returns secrets.

- [ ] **Step 4: Implement process entrypoint**

`index.ts` parses config, opens storage, starts the HTTP server, starts the scheduled prober, handles SIGINT/SIGTERM, and logs short status lines.

- [ ] **Step 5: Run tests and helper build**

Run:

```sh
pnpm metrics:test
pnpm metrics:build
```

Expected: both commands exit 0.

## Task 6: Docker, Caddy, GitHub Actions, and R5S Scripts

**Files:**
- Create: `Dockerfile.metrics-helper`
- Modify: `Caddyfile`
- Modify: `.github/workflows/deploy.yml`
- Modify: `scripts/install-r5s.sh`
- Modify: `scripts/update-r5s.sh`

- [ ] **Step 1: Add helper Dockerfile**

Build the helper with Node 24 and run only `packages/metrics-helper/dist/index.js` in the runtime image.

- [ ] **Step 2: Add Caddy reverse proxy**

Before `try_files`, route:

```caddyfile
@metrics path /api/metrics /api/metrics/*
reverse_proxy @metrics http://zashboardx-metrics:8787
```

- [ ] **Step 3: Publish helper image in GitHub Actions**

Keep the existing zashboardx image build and add a second `docker/build-push-action` step for `Dockerfile.metrics-helper` tagged as `ghcr.io/pluviophile714/zashboardx-metrics:latest` and `${{ github.sha }}`.

- [ ] **Step 4: Update R5S install script**

Write compose with two services. Preserve existing `.env` values when possible. Keep `MIHOMO_SECRET` empty unless already present on the R5S.

- [ ] **Step 5: Update R5S update script**

Run `docker compose pull`, `docker compose up -d`, and leave image pruning to the deployment procedure after verification.

## Task 7: Frontend Metrics Store and Popover UI

**Files:**
- Create: `src/api/metricsHelper.ts`
- Create: `src/store/proxyMetrics.ts`
- Modify: `src/views/ProxiesPage.vue`
- Modify: `src/components/proxies/ProxyNodeCard.vue`

- [ ] **Step 1: Add frontend helper API**

Fetch `/api/metrics/nodes?window=24h` with a short abort timeout and return `null` on unreachable helper.

- [ ] **Step 2: Add page-level cache store**

Expose `proxyMetricsMap`, `proxyMetricsAvailable`, and `refreshProxyMetrics({ force?: boolean })`. Use a 30 second cache and one in-flight request.

- [ ] **Step 3: Preload from proxies page**

Call `refreshProxyMetrics()` from `ProxiesPage.vue` after `fetchProxies()`.

- [ ] **Step 4: Render R5S metrics in popover**

In `ProxyNodeCard.vue`, when metrics exist for `props.name`, show:

- `R5S 24h: 99.2% · 274/276`
- `覆盖 23 小时 · 失败 2 次`

If helper metrics do not exist, preserve current browser-local display.

## Task 8: Verification and Commit

**Files:**
- All files above.

- [ ] **Step 1: Run focused helper tests**

Run: `pnpm metrics:test`

Expected: all helper tests pass.

- [ ] **Step 2: Run frontend type check**

Run: `pnpm run type-check`

Expected: exit 0.

- [ ] **Step 3: Run production build**

Run: `pnpm run build`

Expected: exit 0 and `dist/` updates.

- [ ] **Step 4: Run helper build**

Run: `pnpm metrics:build`

Expected: exit 0.

- [ ] **Step 5: Preview before R5S deployment**

Start or reuse local Vite preview and open `http://127.0.0.1:5175/#/proxies`. Verify the helper-disabled fallback does not break the proxy quality popover.

- [ ] **Step 6: Commit**

Commit with:

```sh
git add pnpm-workspace.yaml package.json pnpm-lock.yaml packages Dockerfile.metrics-helper Caddyfile .github/workflows/deploy.yml scripts src docs/superpowers/plans/2026-07-04-zashboardx-metrics-helper.md
git commit -m "feat: add optional zashboardx metrics helper"
```

Stop after commit and preview. Push/deploy to R5S only after the user approves the preview.
