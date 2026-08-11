# Metrics Live Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Push ready Metrics snapshots to the existing shared frontend store while keeping polling as a fallback.

**Architecture:** The helper owns a small SSE client hub. The aggregation cache publishes only after a snapshot is installed. The frontend subscribes from `ProxiesPage.vue`, forces the existing 24h shared refresh on newer events, and leaves open detail synchronization to the existing `proxyMetricsUpdatedAt` watcher.

**Tech Stack:** Node.js HTTP server, TypeScript, native browser `EventSource`, Vue reactive store, Node test runner.

## Global Constraints

- Preserve the existing `snapshotAt` consistency boundary.
- Keep the 30-second polling fallback.
- Do not add a second database or metrics data source.
- Do not change R5S deployment configuration for this feature.

---

### Task 1: Metrics update event hub

**Files:**
- Create: `packages/metrics-helper/src/metricsEvents.ts`
- Modify: `packages/metrics-helper/src/metricsCache.ts`
- Modify: `packages/metrics-helper/src/server.ts`
- Modify: `packages/metrics-helper/src/index.ts`
- Test: `packages/metrics-helper/src/server.test.ts`

**Interfaces:**
- `MetricsUpdateHub.subscribe(response): () => void`
- `MetricsUpdateHub.publish(event: MetricsSnapshotReadyEvent): void`
- `MetricsSnapshotReadyEvent = { type: 'snapshot_ready'; snapshotAt: string; windowSeconds: number }`
- `MetricsAggregationCacheOptions.onSnapshotReady?: (event) => void`

- [ ] Write an integration test that connects to `/api/metrics/events`, receives `ready`, publishes a newer snapshot event, and receives `snapshot_ready`.
- [ ] Run the focused helper test and verify it fails because the route and hub do not exist.
- [ ] Implement the hub, SSE headers, heartbeat comments, cleanup on close, and cache callback after both synchronous and worker refresh paths.
- [ ] Run `pnpm metrics:test` and verify all helper tests pass.

### Task 2: Frontend live subscription

**Files:**
- Modify: `src/api/metricsHelper.ts`
- Modify: `src/store/proxyMetrics.ts`
- Modify: `src/views/ProxiesPage.vue`
- Test: `src/helper/__tests__/proxyNodeCardLayout.test.ts`
- Test: `src/helper/__tests__/proxyMetricsTimeline.test.ts`

**Interfaces:**
- `openProxyMetricsEvents(onSnapshotReady, onConnectionChange): () => void`
- `startProxyMetricsLiveUpdates(): () => void`
- `proxyMetricsLiveConnected: Ref<boolean>`

- [ ] Add a store test asserting older events do not force a refresh and newer events do.
- [ ] Run the focused Node tests and verify the new behavior fails.
- [ ] Implement EventSource subscription, timestamp comparison, forced shared refresh, and cleanup.
- [ ] Keep the existing 30-second timer unchanged as fallback.
- [ ] Run the focused frontend tests and verify they pass.

### Task 3: Freshness semantics

**Files:**
- Modify: `src/store/proxyMetrics.ts`
- Modify: `src/components/proxies/ProxyNodeCard.vue`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/en.ts`
- Test: `src/helper/__tests__/proxyNodeCardLayout.test.ts`

- [ ] Add a failing test for a detail freshness label based on the latest sample timestamp and live connection state.
- [ ] Implement a compact detail-only freshness line: live/轮询 fallback and relative last-sample age.
- [ ] Keep the first-level card unchanged.
- [ ] Run the full frontend test set.

### Task 4: Verification and preview

**Files:**
- No source files.

- [ ] Run `pnpm metrics:test`.
- [ ] Run `node --test src/helper/__tests__/*.test.ts`.
- [ ] Run `pnpm run type-check`.
- [ ] Run `pnpm run build`.
- [ ] Run `git diff --check`.
- [ ] Reuse port `5175`, open desktop and mobile proxy previews, and confirm live updates do not alter the existing charts.

### Task 5: Move probe persistence off the HTTP event loop

**Files:**
- Create: `packages/metrics-helper/src/probeStorageWorker.ts`
- Create: `packages/metrics-helper/src/probeStorageWorkerClient.ts`
- Modify: `packages/metrics-helper/src/prober.ts`
- Modify: `packages/metrics-helper/src/storage.ts`
- Modify: `packages/metrics-helper/src/index.ts`
- Test: `packages/metrics-helper/src/probeStorageWorkerClient.test.ts`
- Test: `packages/metrics-helper/src/prober.test.ts`

- [ ] Add a failing test proving a persistent-database probe round is submitted through an asynchronous worker boundary.
- [ ] Add a failing test proving fallback selection and persisted samples retain the existing behavior through the worker-backed path.
- [ ] Implement a persistent worker client, transactional history ingestion, fallback selection, fallback sample persistence, and retention pruning.
- [ ] Keep the direct storage path for `:memory:` tests and explicit injected storage users.

### Task 6: Serve shared detail snapshots without synchronous database scans

**Files:**
- Create: `packages/metrics-helper/src/metricsDetailsCache.ts`
- Create: `packages/metrics-helper/src/metricsDetailsWorker.ts`
- Modify: `packages/metrics-helper/src/server.ts`
- Modify: `packages/metrics-helper/src/index.ts`
- Test: `packages/metrics-helper/src/metricsDetailsCache.test.ts`
- Test: `packages/metrics-helper/src/server.test.ts`

- [ ] Add a failing test that an expired cached detail snapshot is returned immediately while its replacement is pending.
- [ ] Add a failing server test that `/api/metrics/details` reads the detail cache instead of synchronously calling storage.
- [ ] Implement read-only worker aggregation keyed by node, window, bucket count, and sample limit.
- [ ] Mark cached detail keys dirty immediately after each completed probe round.

### Task 7: Recover active charts automatically after transient failures

**Files:**
- Modify: `src/components/proxies/ProxyNodeCard.vue`
- Test: `src/helper/__tests__/proxyNodeCardLayout.test.ts`

- [ ] Add a failing source regression test for bounded active-card retry and preservation of an existing detail snapshot.
- [ ] Retry the active source/window without requiring hover re-entry.
- [ ] Show unavailable only when no successful snapshot exists, while continuing background recovery attempts.
- [ ] Clear retry state on success, window change, tooltip destruction, and component unmount.
