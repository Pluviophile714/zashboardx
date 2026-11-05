# Metrics Rollup and 7-Day Latency Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add low-cost persistent Metrics rollups and a validated 7-day latency timeline without weakening the existing real-time 1h path.

**Architecture:** Keep raw probe samples as the source of truth and add a SQLite rollup table with 1m, 5m, and 15m rows. The storage worker performs a one-time rebuild and then refreshes only affected buckets. The frontend keeps 1h raw samples and fetches a 672-point 7d timeline on demand through the existing SVG renderer.

**Tech Stack:** Node 24 `node:sqlite`, TypeScript, worker_threads, Vue 3, existing SVG chart helpers, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-05-metrics-rollup-7d-chart-design.md`

## Global Constraints

- Preserve seven-day raw retention in `probe_samples`.
- Preserve SSE, the first-level latency strip, complete 1h hydration, 6h/24h bucket drilldown, and Smart behavior.
- Rollup migration must be backward-compatible with the current R5S database.
- 7d must be opt-in in the popover and must not become the default range.

## Review Focus

- Existing databases with no rollup tables: startup and reads remain available.
- Samples corrected by Smart/Fallback logic: affected rollup buckets are replaced, not double-counted.
- Empty and all-failure buckets: chart gaps and status slices remain correct.
- New samples during rebuild: they are included before the rollup is marked ready.
- 672-bucket mobile chart: no horizontal overflow or popover jump.

---

### Task 1: Define rollup schema and pure bucket helpers

**Files:**
- Modify: `packages/metrics-helper/src/types.ts`
- Modify: `packages/metrics-helper/src/storage.ts`
- Test: `packages/metrics-helper/src/storage.test.ts`

**Interfaces:**
- Produce fixed rollup levels `60`, `300`, and `900` seconds.
- Produce `getNodeTimeline(nodeName, windowSeconds, bucketCount, nowMs)` with the existing return shape, using rollups for 6h/24h/7d when ready and raw fallback otherwise.

- [ ] **Step 1: Add failing tests** for schema creation, rollup row fields, empty buckets, all-failure buckets, and 7d geometry.
- [ ] **Step 2: Run the focused storage tests and confirm the new expectations fail.**
- [ ] **Step 3: Add the rollup table and profile constants without altering the raw tables.**
- [ ] **Step 4: Implement rollup row normalization and timeline reconstruction with exact bucket boundaries.**
- [ ] **Step 5: Run focused storage tests and confirm they pass.**

### Task 2: Implement serialized rebuild and affected-bucket refresh

**Files:**
- Modify: `packages/metrics-helper/src/storage.ts`
- Modify: `packages/metrics-helper/src/probeStorageWorker.ts`
- Modify: `packages/metrics-helper/src/probeStorageWorkerClient.ts`
- Test: `packages/metrics-helper/src/storage.test.ts`
- Test: `packages/metrics-helper/src/probeStorageWorkerClient.test.ts`

**Interfaces:**
- Produce `rebuildMetricsRollups(retentionDays, nowMs)` for the initial compatibility rebuild.
- Produce `refreshMetricsRollupBuckets(nodeName, timestamps)` for corrected/new samples.

- [ ] **Step 1: Add failing tests** for a complete rebuild, a sample update, and samples arriving while rebuild is queued.
- [ ] **Step 2: Run the focused tests and confirm the missing worker/storage behavior fails.**
- [ ] **Step 3: Implement SQL aggregation for 1m/5m/15m rows, including jitter sum/count and latest-sample fields.**
- [ ] **Step 4: Serialize rebuild and probe writes through the existing storage worker.**
- [ ] **Step 5: Refresh only the affected buckets after accepted inserts or corrections.**
- [ ] **Step 6: Run focused tests and confirm they pass.**

### Task 3: Use rollups for node summaries and long timelines

**Files:**
- Modify: `packages/metrics-helper/src/storage.ts`
- Modify: `packages/metrics-helper/src/metricsCache.ts`
- Modify: `packages/metrics-helper/src/index.ts`
- Test: `packages/metrics-helper/src/metricsCache.test.ts`
- Test: `packages/metrics-helper/src/storage.test.ts`

**Interfaces:**
- Produce rollup-backed default 24h `NodeMetrics` snapshots after readiness.
- Keep raw fallback until rollups are complete or if a rollup query fails.

- [ ] **Step 1: Add a regression test proving a ready rollup avoids the raw all-node aggregation path.**
- [ ] **Step 2: Run the regression test and confirm it fails against the current implementation.**
- [ ] **Step 3: Implement rollup-backed node summary aggregation with the existing response fields.**
- [ ] **Step 4: Start one serialized rebuild at Metrics helper startup without changing probe cadence or SSE behavior.**
- [ ] **Step 5: Run Metrics tests and confirm the old fallback behavior remains covered.**

### Task 4: Add the 7d HTTP/API contract

**Files:**
- Modify: `packages/metrics-helper/src/server.ts`
- Modify: `src/api/metricsHelper.ts`
- Test: `packages/metrics-helper/src/server.test.ts`
- Test: `src/helper/__tests__/metricsHelperTimeline.test.ts`

**Interfaces:**
- Add `ProxyMetricsTimelineWindow = '7d'`.
- Add profile `{ windowSeconds: 604800, bucketSeconds: 900, bucketCount: 672 }`.
- Keep 6h/24h bundle response unchanged; 7d is fetched with the timeline/details route on demand.

- [ ] **Step 1: Add failing HTTP and normalization tests for valid 7d and invalid window responses.**
- [ ] **Step 2: Run them and confirm `7d` is rejected before implementation.**
- [ ] **Step 3: Add the server allowlist and frontend response validation.**
- [ ] **Step 4: Run the API and frontend helper tests.**

### Task 5: Add the 7d popover control and chart behavior

**Files:**
- Modify: `src/helper/proxyMetricsTimeline.ts`
- Modify: `src/components/proxies/latencyTimelineChart.ts`
- Modify: `src/components/proxies/ProxyNodeCard.vue`
- Modify: `src/store/proxyMetrics.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `src/i18n/zh-tw.ts`
- Modify: `src/i18n/ru.ts`
- Test: `src/helper/__tests__/proxyMetricsTimeline.test.ts`
- Test: `src/helper/__tests__/proxyNodeCardLayout.test.ts`

**Interfaces:**
- Add `7d` to the existing segmented control and cache keys.
- Keep default range `1h` and existing 1h/6h/24h interactions.
- Keep selected-bucket activation and raw 15-minute drilldown.

- [ ] **Step 1: Add failing geometry/control tests for 672 buckets, x-axis labels, and no overflow.**
- [ ] **Step 2: Run them and confirm the new 7d expectations fail.**
- [ ] **Step 3: Add the 7d profile to the helper, store, chart control, and popover request path.**
- [ ] **Step 4: Keep the chart height stable while switching windows and ensure the 7d response replaces stale data atomically.**
- [ ] **Step 5: Add translated range labels/status text where the existing UI uses i18n.**
- [ ] **Step 6: Run frontend tests, type-check, and build.**

### Task 6: Verify the complete metrics change and record it

**Files:**
- Modify: `docs/development/engineering-change-log.md`
- Test: repository test suites and browser smoke harness

- [ ] **Step 1: Run `pnpm --filter @zashboardx/metrics-helper test`.**
- [ ] **Step 2: Run frontend helper tests, `pnpm run type-check`, and `pnpm run build`.**
- [ ] **Step 3: Run desktop/mobile chart smoke checks with the mock backend and record the limitation that real R5S history is not available locally.**
- [ ] **Step 4: Append only verified behavior, test results, and the deployment status to the engineering log.**
