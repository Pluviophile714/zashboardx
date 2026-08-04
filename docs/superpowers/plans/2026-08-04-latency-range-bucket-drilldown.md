# Latency Range And Bucket Drilldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 1h/6h/24h latency timelines and on-demand raw bucket drilldown while keeping the first-level latency bar consistent with the second-level R5S sample strip.

**Architecture:** Keep `probe_samples` as the only historical store. Extend the helper timeline route through a fixed profile allowlist, add one bounded bucket-samples route, and cache both response types by node and interval in the frontend. Keep ephemeral range/drilldown state inside the node popover and expose selection callbacks from the existing timeline renderer.

**Tech Stack:** Vue 3, TypeScript, Node test runner, SQLite through `node:sqlite`, Vite, Tailwind/DaisyUI, tippy.js.

## Global Constraints

- Preserve 24-hour availability semantics, metrics collection, Smart/Fallback identity handling, manual latency testing, and historical SQLite data.
- Do not add tables, columns, migrations, retention changes, collection-frequency changes, or dependencies.
- Support exactly `1h`, `6h`, and `24h` timeline windows with 60x1m, 72x5m, and 96x15m buckets.
- Keep first-level availability fixed at 24 hours and reset the popover chart to 24 hours when it closes.
- Fetch raw bucket samples only after the user activates a populated selected chart point.
- Restore the normal R5S recent-30 strip after eight seconds without relevant interaction.
- Keep desktop and mobile behavior equivalent and do not increase popover height.

---

### Task 1: Fixed Timeline Profiles In Metrics Helper

**Files:**
- Modify: `packages/metrics-helper/src/server.ts:200-245`
- Modify: `packages/metrics-helper/src/server.test.ts:350-455`
- Modify: `packages/metrics-helper/src/storage.test.ts:650-760`

**Interfaces:**
- Produces: `TIMELINE_PROFILES` keyed by `'1h' | '6h' | '24h'` with `{ windowSeconds, bucketCount }`.
- Uses: `MetricsStorage.getNodeTimeline(nodeName, windowSeconds, bucketCount, nowMs)` without changing its public signature.

- [ ] **Step 1: Add failing storage tests for all three profiles**

Insert samples on exact bucket boundaries and assert bucket count, duration, and placement:

```ts
for (const profile of [
  { windowSeconds: 3_600, bucketCount: 60, bucketSeconds: 60 },
  { windowSeconds: 21_600, bucketCount: 72, bucketSeconds: 300 },
  { windowSeconds: 86_400, bucketCount: 96, bucketSeconds: 900 },
]) {
  const buckets = storage.getNodeTimeline('HK-01', profile.windowSeconds, profile.bucketCount, now)
  assert.equal(buckets.length, profile.bucketCount)
  assert.equal(Date.parse(buckets[0].end) - Date.parse(buckets[0].start), profile.bucketSeconds * 1000)
}
```

- [ ] **Step 2: Run the storage test and confirm the new assertions exercise each profile**

Run: `pnpm --filter @zashboardx/metrics-helper test`

Expected: existing storage implementation passes profile geometry; retain this evidence before changing the route.

- [ ] **Step 3: Add failing server tests for `1h` and `6h`**

Extend the Unicode timeline test to request all allowed windows and update the unsupported-window case to keep rejecting `7d`:

```ts
const cases = [
  { window: '1h', windowSeconds: 3_600, bucketSeconds: 60, bucketCount: 60 },
  { window: '6h', windowSeconds: 21_600, bucketSeconds: 300, bucketCount: 72 },
  { window: '24h', windowSeconds: 86_400, bucketSeconds: 900, bucketCount: 96 },
]
```

- [ ] **Step 4: Run the server test and verify RED**

Run: `pnpm --filter @zashboardx/metrics-helper test`

Expected: FAIL because `server.ts` currently rejects `1h` and `6h`.

- [ ] **Step 5: Implement the fixed profile allowlist**

Add near the route helpers in `server.ts`:

```ts
const TIMELINE_PROFILES = {
  '1h': { windowSeconds: 3_600, bucketCount: 60 },
  '6h': { windowSeconds: 21_600, bucketCount: 72 },
  '24h': { windowSeconds: 86_400, bucketCount: 96 },
} as const
```

Resolve the requested profile and call:

```ts
const profile = TIMELINE_PROFILES[requestedWindow as keyof typeof TIMELINE_PROFILES]
if (!profile) {
  sendStatus(response, 400, { error: 'unsupported_window' })
  return
}
sendJson(response, {
  windowSeconds: profile.windowSeconds,
  generatedAt: new Date(nowMs).toISOString(),
  nodeName,
  bucketSeconds: profile.windowSeconds / profile.bucketCount,
  buckets: options.storage.getNodeTimeline(
    nodeName,
    profile.windowSeconds,
    profile.bucketCount,
    nowMs,
  ),
})
```

- [ ] **Step 6: Run helper tests and commit**

Run: `pnpm --filter @zashboardx/metrics-helper test`

Expected: PASS.

Commit:

```bash
git add packages/metrics-helper/src/server.ts packages/metrics-helper/src/server.test.ts packages/metrics-helper/src/storage.test.ts
git commit -m "feat(metrics): support latency timeline ranges"
```

---

### Task 2: Bounded Raw Bucket Samples API

**Files:**
- Modify: `packages/metrics-helper/src/storage.ts:390-430`
- Modify: `packages/metrics-helper/src/types.ts:1-25`
- Modify: `packages/metrics-helper/src/storage.test.ts`
- Modify: `packages/metrics-helper/src/server.ts:215-285`
- Modify: `packages/metrics-helper/src/server.test.ts`

**Interfaces:**
- Produces: `MetricsStorage.getProbeSamplesBetween(nodeName, startMs, endMs, limit)` returning `{ samples: ProbeSample[]; truncated: boolean }`.
- Produces: `GET /api/metrics/bucket-samples?node=<name>&start=<iso>&end=<iso>`.
- Response: `{ nodeName, start, end, generatedAt, samples, truncated }`.

- [ ] **Step 1: Write failing storage tests for half-open bounds and stable ordering**

Insert records at `start`, inside the interval, and exactly at `end`. Give two inside records the same timestamp. Assert that `start` is included, `end` is excluded, and same-time records retain database-id order.

```ts
const result = storage.getProbeSamplesBetween('HK-01', Date.parse(start), Date.parse(end), 200)
assert.deepEqual(result.samples.map((sample) => sample.delay), [51, 52, 53])
assert.equal(result.truncated, false)
```

Add a limit test with three matching rows and `limit=2`; expect two samples and `truncated === true`.

- [ ] **Step 2: Run helper tests and verify RED**

Run: `pnpm --filter @zashboardx/metrics-helper test`

Expected: FAIL because `getProbeSamplesBetween` does not exist.

- [ ] **Step 3: Implement the indexed range query**

Use `limit + 1` to detect truncation and reuse the existing `ProbeSample` shape:

```sql
SELECT node_name, test_url, timestamp, delay, success, error_type
FROM probe_samples
WHERE node_name = ?
  AND timestamp >= ?
  AND timestamp < ?
ORDER BY timestamp ASC, id ASC
LIMIT ?
```

Return only the first `limit` rows and set `truncated` when the extra row exists.

- [ ] **Step 4: Add failing route tests**

Cover Unicode node names, a successful response, an empty interval, invalid timestamps, reversed bounds, an interval over 15 minutes, missing node, and POST rejection. Assert `cache-control: no-store`.

- [ ] **Step 5: Run route tests and verify RED**

Run: `pnpm --filter @zashboardx/metrics-helper test`

Expected: FAIL with 404 for `/api/metrics/bucket-samples`.

- [ ] **Step 6: Implement strict route validation**

Parse ISO values with `Date.parse`, require `startMs < endMs`, cap `endMs - startMs` at `900_000`, and cap node length at 512. Use a fixed limit of 200. Return normalized ISO bounds and the storage result.

- [ ] **Step 7: Run helper tests and commit**

Run: `pnpm --filter @zashboardx/metrics-helper test`

Expected: PASS.

Commit:

```bash
git add packages/metrics-helper/src/storage.ts packages/metrics-helper/src/types.ts packages/metrics-helper/src/storage.test.ts packages/metrics-helper/src/server.ts packages/metrics-helper/src/server.test.ts
git commit -m "feat(metrics): expose raw bucket samples"
```

---

### Task 3: Frontend Timeline Profiles And Bucket Cache

**Files:**
- Modify: `src/api/metricsHelper.ts:1-350`
- Modify: `src/store/proxyMetrics.ts:1-170`
- Modify: `src/helper/__tests__/metricsHelperTimeline.test.ts`
- Create: `src/helper/__tests__/metricsHelperBucketSamples.test.ts`

**Interfaces:**
- Produces: `ProxyMetricsTimelineWindow = '1h' | '6h' | '24h'`.
- Produces: `PROXY_METRICS_TIMELINE_PROFILES` with expected response geometry.
- Produces: `fetchProxyMetricsBucketSamplesAPI(nodeName, start, end, timeout)`.
- Produces: `refreshProxyMetricsBucketSamples(nodeName, start, end, { force })` and `getProxyMetricsBucketSamplesCacheKey(nodeName, start, end)`.

- [ ] **Step 1: Write failing timeline normalization tests**

Parameterize valid responses for all profiles and assert that a response with the wrong bucket count, bucket duration, or window duration is rejected for the requested window.

```ts
assert.equal(getProxyMetricsTimelineProfile('1h').bucketCount, 60)
assert.equal(getProxyMetricsTimelineProfile('6h').bucketSeconds, 300)
assert.equal(getProxyMetricsTimelineProfile('24h').windowSeconds, 86_400)
```

- [ ] **Step 2: Run frontend helper tests and verify RED**

Run: `node --test src/helper/__tests__/metricsHelperTimeline.test.ts`

Expected: FAIL because timeline profiles are not exported and normalization is hard-coded to 24h.

- [ ] **Step 3: Implement typed timeline profiles and dynamic validation**

Use the selected profile in `fetchProxyMetricsTimelineAPI` to validate `windowSeconds`, `bucketSeconds`, bucket count, and contiguous bucket boundaries. Keep the default argument `24h`.

- [ ] **Step 4: Write failing bucket-response tests**

Mock `fetch` with a response containing ordered success/failure samples and assert normalized ISO timestamps, `truncated`, node identity, and exact interval identity. Add rejection cases for mismatched node/bounds and malformed samples.

- [ ] **Step 5: Run bucket-response tests and verify RED**

Run: `node --test src/helper/__tests__/metricsHelperBucketSamples.test.ts`

Expected: FAIL because the API function and response type do not exist.

- [ ] **Step 6: Implement the bucket API and store cache**

Add separate shallow refs, fetch timestamps, and pending-request maps. Use a 30-second TTL and a key formed from exact normalized values:

```ts
export const getProxyMetricsBucketSamplesCacheKey = (
  nodeName: string,
  start: string,
  end: string,
) => `${start}\n${end}\n${nodeName}`
```

Do not merge bucket responses into the recent-30 cache.

- [ ] **Step 7: Run frontend API/store tests and commit**

Run:

```bash
node --test src/helper/__tests__/metricsHelperTimeline.test.ts src/helper/__tests__/metricsHelperBucketSamples.test.ts
pnpm run type-check
```

Expected: PASS.

Commit:

```bash
git add src/api/metricsHelper.ts src/store/proxyMetrics.ts src/helper/__tests__/metricsHelperTimeline.test.ts src/helper/__tests__/metricsHelperBucketSamples.test.ts
git commit -m "feat: cache latency bucket samples"
```

---

### Task 4: Timeline Range Control And Selection Callbacks

**Files:**
- Modify: `src/components/proxies/latencyTimelineChart.ts`
- Modify: `src/helper/proxyMetricsTimeline.ts`
- Modify: `src/helper/__tests__/proxyMetricsTimeline.test.ts`
- Modify: `src/helper/__tests__/proxyNodeCardLayout.test.ts`

**Interfaces:**
- Extends `LatencyTimelineChartOptions` with `window`, `onWindowChange`, `onBucketChange`, `onBucketActivate`, and `onInteraction`.
- Produces the selected `ProxyMetricsTimelineBucket` through callbacks without owning popover drilldown state.

- [ ] **Step 1: Write failing layout tests for the segmented control and callbacks**

Assert that the renderer creates three buttons, marks the selected window, calls `onWindowChange`, emits bucket selection from pointer movement, and activates only populated buckets when the selected chart point is clicked.

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `node --test src/helper/__tests__/proxyMetricsTimeline.test.ts src/helper/__tests__/proxyNodeCardLayout.test.ts`

Expected: FAIL because the renderer has a fixed `24h` title and no callbacks.

- [ ] **Step 3: Implement the range control**

Build a compact three-button segmented control in the chart header. Use `aria-pressed`, stable button dimensions, and text `1h`, `6h`, `24h`. Preserve an optional source label without allowing header overflow.

- [ ] **Step 4: Make the selected chart point the activation target**

Keep the tooltip card display-only. Make the selected bucket point/plot area in the SVG interactive only when the selected bucket is populated. Keep sample inspection on the SVG. Emit `onBucketChange(bucket)` from `renderBucket`, `onBucketActivate(bucket)` from a stationary click/tap on the selected chart point, and `onInteraction()` from chart and strip pointer/touch activity. A drag must suppress the following synthetic click.

- [ ] **Step 5: Replace fixed 24h labels with the selected window**

Use `${options.window} latency` text equivalents in the title, aria label, loading, unavailable, and empty states while keeping concrete x-axis times.

- [ ] **Step 6: Run targeted tests and commit**

Run:

```bash
node --test src/helper/__tests__/proxyMetricsTimeline.test.ts src/helper/__tests__/proxyNodeCardLayout.test.ts
pnpm run type-check
```

Expected: PASS.

Commit:

```bash
git add src/components/proxies/latencyTimelineChart.ts src/helper/proxyMetricsTimeline.ts src/helper/__tests__/proxyMetricsTimeline.test.ts src/helper/__tests__/proxyNodeCardLayout.test.ts
git commit -m "feat: add latency timeline range controls"
```

---

### Task 5: Popover Drilldown State And First-Level Consistency

**Files:**
- Modify: `src/components/proxies/ProxyNodeCard.vue:160-1150`
- Create: `src/helper/latencyBucketDrilldown.ts`
- Create: `src/helper/__tests__/latencyBucketDrilldown.test.ts`
- Modify: `src/helper/__tests__/proxyNodeCardLayout.test.ts`

**Interfaces:**
- Produces pure helpers for strip content and title formatting.
- Consumes timeline callbacks and bucket-sample store APIs from Tasks 3 and 4.
- Preserves the already written first-level R5S-preference regression behavior.

- [ ] **Step 1: Write failing pure-helper tests**

Cover normal recent-30 mode, a 14-record bucket, a 17-record bucket, more than 30 records without truncation, failure mapping to `NOT_CONNECTED`, exact interval title, and inactive drilldown fallback.

```ts
assert.equal(formatLatencyBucketTitle(bucket, 17), '15:45 - 16:00 · 17 records')
assert.equal(resolveLatencyStripHistory({ mode: 'recent', recent, bucket: [] }), recent)
assert.equal(resolveLatencyStripHistory({ mode: 'bucket', recent, bucket }), bucket)
```

- [ ] **Step 2: Run helper tests and verify RED**

Run: `node --test src/helper/__tests__/latencyBucketDrilldown.test.ts`

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the pure drilldown helpers**

Keep these helpers DOM-free. Preserve chronological order and return all bucket records.

- [ ] **Step 4: Write failing component source/layout tests**

Assert that `ProxyNodeCard.vue` defaults range state to `24h`, requests the selected timeline, starts an 8,000 ms reset timer only after successful bucket data arrives, refreshes the timer on interaction, clears it during teardown, and resets range/drilldown when the tip is destroyed.

- [ ] **Step 5: Run component tests and verify RED**

Run: `node --test src/helper/__tests__/proxyNodeCardLayout.test.ts`

Expected: FAIL because the component has no range/drilldown state.

- [ ] **Step 6: Implement ephemeral popover state**

Maintain refs/locals for `activeWindow`, `selectedBucket`, `bucketHistory`, request generation, and reset timer. A window change exits drilldown, clears stale bucket state, and requests the selected timeline. A successful bucket request enters drilldown and rebuilds the active tippy content; a failed request leaves recent-30 visible.

- [ ] **Step 7: Reuse the existing latency strip inspector**

Pass either recent history or bucket history into `buildLatencyStatusTimeline`. In bucket mode, show the exact interval and record count; pointer/touch activity restarts the timer. Keep min/avg/max as the idle summary and selected-sample details while inspecting.

- [ ] **Step 8: Preserve first-level/second-level correspondence**

Keep `getLatencyStabilityHistory()` preferring the cached R5S recent-30 response and slicing its final 10 samples. Retain browser/Mihomo history only as the prefetch fallback. Run the existing regression test proving this source choice.

- [ ] **Step 9: Run component tests, type check, and commit**

Run:

```bash
node --test src/helper/__tests__/latencyBucketDrilldown.test.ts src/helper/__tests__/proxyNodeCardLayout.test.ts src/helper/__tests__/latencySampleSelection.test.ts src/helper/__tests__/latencyDetailsViewport.test.ts
pnpm run type-check
```

Expected: PASS.

Commit:

```bash
git add src/components/proxies/ProxyNodeCard.vue src/helper/latencyBucketDrilldown.ts src/helper/__tests__/latencyBucketDrilldown.test.ts src/helper/__tests__/proxyNodeCardLayout.test.ts
git commit -m "feat: drill into latency timeline buckets"
```

---

### Task 6: Full Verification And Browser Inspection

**Files:**
- Verify only; modify implementation or tests only when a failure identifies a defect.

**Interfaces:**
- Validates the complete frontend/helper contract and the unchanged deployment contract.

- [ ] **Step 1: Run all focused and package tests**

```bash
node --test src/helper/__tests__/metricsHelperTimeline.test.ts src/helper/__tests__/metricsHelperBucketSamples.test.ts src/helper/__tests__/proxyMetricsTimeline.test.ts src/helper/__tests__/latencyBucketDrilldown.test.ts src/helper/__tests__/proxyNodeCardLayout.test.ts src/helper/__tests__/latencySampleSelection.test.ts src/helper/__tests__/latencyDetailsViewport.test.ts
pnpm --filter @zashboardx/metrics-helper test
```

Expected: zero failures.

- [ ] **Step 2: Run static and production checks**

```bash
pnpm run type-check
pnpm run build
git diff --check
```

Expected: zero errors; existing Rollup chunk warnings are acceptable.

- [ ] **Step 3: Inspect desktop behavior at the local preview**

At `http://127.0.0.1:5175/#/proxies`, verify 1h/6h/24h axes, selected chart-point activation, raw sample inspection, eight-second restoration, first-level rightmost-10 correspondence, and reset to 24h after close/reopen.

- [ ] **Step 4: Inspect mobile behavior**

Use a phone-sized viewport and verify touch chart selection, stationary chart-point activation, sample-strip sliding without closing the popover, outside-tap close, no overlap, and unchanged popover height constraints.

- [ ] **Step 5: Review final diff and commit any verification corrections**

```bash
git status --short --branch
git diff --stat
git diff --check
```

Do not deploy until the user approves the local desktop/mobile preview.
