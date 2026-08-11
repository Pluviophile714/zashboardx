# Latency Chart Stale Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep latency charts visible and responsive when the detail cache trails the shared metrics snapshot without allowing recent samples to move backwards.

**Architecture:** Treat a complete details response as an independently valid chart snapshot. Keep the existing per-node freshness checks around promotion into the shared recent-sample store, and retain existing cached charts during refreshes.

**Tech Stack:** Vue 3 reactive store, TypeScript, Node test runner, metrics-helper HTTP API.

## Global Constraints

- Do not change the 1h chart interaction or 6h/24h bucket behavior.
- Do not change recent-strip animation, SSE delivery, polling, or R5S configuration.
- Do not let older detail samples overwrite newer shared samples.

---

### Task 1: Preserve Complete Detail Snapshots

**Files:**
- Modify: `src/helper/__tests__/proxyMetricsLiveUpdates.test.ts`
- Modify: `src/store/proxyMetrics.ts`

**Interfaces:**
- Consumes: `refreshProxyMetricsDetails(nodeName, options)` and the existing shared sample cache.
- Produces: A cached `ProxyMetricsDetailsResponse` and timeline even when its snapshot is older than the global aggregate snapshot.

- [ ] **Step 1: Write the failing regression test**

Change the stale-detail test so it seeds a newer shared recent sample, returns an older complete detail snapshot, and expects the timeline cache to populate while the shared sample remains unchanged.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test src/helper/__tests__/proxyMetricsLiveUpdates.test.ts`

Expected: FAIL because `refreshProxyMetricsDetails` currently returns `null` for the older detail snapshot.

- [ ] **Step 3: Implement the minimal store change**

Remove only the global `proxyMetricsUpdatedAt` rejection. Retain response consistency validation and the per-node `snapshotIsCurrent` and `samplesAreCurrent` guards before shared-sample promotion.

- [ ] **Step 4: Run focused and surrounding tests**

Run the live-update, timeline, and node-card test files and confirm they pass.

- [ ] **Step 5: Run repository verification**

Run `pnpm run type-check`, `pnpm run build`, and `git diff --check`.

- [ ] **Step 6: Review scope**

Confirm the diff does not alter chart interactions, recent-strip animation, SSE handling, polling, metrics-helper storage, or deployment configuration.
