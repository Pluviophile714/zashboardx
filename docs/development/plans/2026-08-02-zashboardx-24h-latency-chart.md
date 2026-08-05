# ZashboardX 24h Latency Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand, Uptime Kuma-inspired 24h latency timeline to the existing ZashboardX proxy quality popover.

**Architecture:** The Metrics helper aggregates one exact node into 96 fixed 15-minute buckets through the existing SQLite `(node_name, timestamp)` index. The frontend fetches and caches only the opened node's timeline, converts validated buckets into lightweight SVG geometry, and inserts the chart above the unchanged R5S recent-30 section.

**Tech Stack:** Vue 3, TypeScript, Node.js 24, `node:sqlite`, native SVG, Node test runner, Tailwind/DaisyUI, Tippy.js.

## Global Constraints

- Keep existing Metrics collection, availability calculations, raw samples, recent-30 display, Smart/Fallback identity, loss display, and manual latency testing behavior unchanged.
- Support only the rolling `24h` chart period and always return 96 buckets of exactly 15 minutes.
- Use only R5S `probe_samples`; never merge browser-local history into the 24h chart.
- Prefer the card's own Metrics identity before Smart outbound or resolved-node fallback, matching the current availability and R5S recent-30 resolution.
- Do not add Chart.js, another chart dependency, a persistent rollup table, or page-wide timeline preloading.
- Keep the popover usable at desktop and mobile widths, including scrolling inside the mobile panel.
- Preview desktop and mobile locally and obtain user approval before GitHub push or R5S deployment.

---

## File Structure

- `packages/metrics-helper/src/types.ts`: helper-side timeline bucket type.
- `packages/metrics-helper/src/storage.ts`: indexed, per-node 96-bucket aggregation.
- `packages/metrics-helper/src/storage.test.ts`: storage boundary and aggregation tests.
- `packages/metrics-helper/src/server.ts`: read-only `/api/metrics/timeline` route.
- `packages/metrics-helper/src/server.test.ts`: HTTP validation and response tests.
- `src/api/metricsHelper.ts`: frontend timeline types, validation, and fetch API.
- `src/store/proxyMetrics.ts`: timeline cache, deduplication, and invalidation.
- `src/helper/__tests__/metricsHelperTimeline.test.ts`: frontend response-normalization tests.
- `src/helper/proxyMetricsTimeline.ts`: pure bucket-to-SVG geometry conversion.
- `src/helper/__tests__/proxyMetricsTimeline.test.ts`: pure chart-model tests.
- `src/components/proxies/latencyTimelineChart.ts`: DOM/SVG section renderer.
- `src/components/proxies/ProxyNodeCard.vue`: popover composition, asynchronous update, sizing, and manual-test invalidation.

---

### Task 1: Aggregate One Node Into 96 Timeline Buckets

**Files:**
- Modify: `packages/metrics-helper/src/types.ts`
- Modify: `packages/metrics-helper/src/storage.ts`
- Test: `packages/metrics-helper/src/storage.test.ts`

**Interfaces:**
- Produces: `ProbeTimelineBucket` and `MetricsStorage.getNodeTimeline(nodeName, windowSeconds, bucketCount, nowMs)`.
- Consumes: existing `probe_samples` rows and `idx_probe_samples_node_time`.

- [ ] **Step 1: Add failing storage tests**

Append tests that insert samples into known 15-minute boundaries and assert all empty buckets are returned:

```ts
test('aggregates one node into ordered timeline buckets and preserves gaps', () => {
  const storage = createStorage()
  const nowMs = Date.parse('2026-07-05T00:00:00.000Z')

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-04T00:02:00.000Z',
    delay: 80,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-04T00:06:00.000Z',
    delay: 120,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-04T00:08:00.000Z',
    delay: null,
    success: false,
    errorType: 'timeout',
  })

  const buckets = storage.getNodeTimeline('HK-01', 24 * 60 * 60, 96, nowMs)

  assert.equal(buckets.length, 96)
  assert.deepEqual(buckets[0], {
    start: '2026-07-04T00:00:00.000Z',
    end: '2026-07-04T00:15:00.000Z',
    sampleCount: 3,
    successCount: 2,
    failureCount: 1,
    avgDelay: 100,
    minDelay: 80,
    maxDelay: 120,
  })
  assert.equal(buckets[1].sampleCount, 0)
  storage.close()
})
```

Add separate assertions for an all-failure bucket, exclusion of another node,
the exact window start/end, and a sample at `generatedAt` being included in the
last bucket rather than creating bucket 96.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
pnpm metrics:build
node --test --test-name-pattern="timeline buckets" packages/metrics-helper/dist/storage.test.js
```

Expected: FAIL because `getNodeTimeline` does not exist.

- [ ] **Step 3: Add the timeline type and indexed aggregation**

Add to `types.ts`:

```ts
export type ProbeTimelineBucket = {
  start: string
  end: string
  sampleCount: number
  successCount: number
  failureCount: number
  avgDelay: number | null
  minDelay: number | null
  maxDelay: number | null
}
```

Implement this exact public signature in `MetricsStorage`:

```ts
getNodeTimeline(
  nodeName: string,
  windowSeconds: number,
  bucketCount = 96,
  nowMs = Date.now(),
): ProbeTimelineBucket[]
```

Normalize `nowMs` to an integer second, derive `windowStart`, and run one query
restricted by `node_name`, `timestamp >= windowStart`, and `timestamp <= now`.
Group with an integer bucket expression equivalent to:

```sql
CAST((unixepoch(timestamp) - :window_start_epoch) / :bucket_seconds AS INTEGER)
```

Aggregate `COUNT(*)`, success/failure counts, and successful non-null
`AVG/MIN/MAX(delay)`. Clamp a row at the exact query end into bucket 95. Fill all
missing indices in TypeScript with zero counts and null delays.

- [ ] **Step 4: Run storage tests**

Run: `pnpm metrics:test`

Expected: all Metrics tests pass, including the new 96-bucket cases.

- [ ] **Step 5: Commit the storage unit**

```powershell
git add packages/metrics-helper/src/types.ts packages/metrics-helper/src/storage.ts packages/metrics-helper/src/storage.test.ts
git commit -m "feat(metrics): aggregate 24h latency timeline"
```

---

### Task 2: Expose The Read-Only Timeline Endpoint

**Files:**
- Modify: `packages/metrics-helper/src/server.ts`
- Test: `packages/metrics-helper/src/server.test.ts`

**Interfaces:**
- Consumes: `MetricsStorage.getNodeTimeline(nodeName, 86400, 96, nowMs)`.
- Produces: `GET /api/metrics/timeline?node=<name>&window=24h` JSON.

- [ ] **Step 1: Add failing HTTP tests**

Create a test with a Unicode node name and assert the fixed response contract:

```ts
const response = await fetch(
  `${baseUrl}/api/metrics/timeline?node=${encodeURIComponent('🇭🇰 HKG 香港 07 [主]')}&window=24h`,
)
const body = (await response.json()) as {
  windowSeconds: number
  generatedAt: string
  nodeName: string
  bucketSeconds: number
  buckets: { sampleCount: number }[]
}

assert.equal(response.status, 200)
assert.equal(body.windowSeconds, 86_400)
assert.equal(body.nodeName, '🇭🇰 HKG 香港 07 [主]')
assert.equal(body.bucketSeconds, 900)
assert.equal(body.buckets.length, 96)
```

Also test missing/over-512-character node names return `400`, `window=7d`
returns `400`, and `POST /api/metrics/timeline` returns `405`.

- [ ] **Step 2: Run the server tests and verify failure**

Run:

```powershell
pnpm metrics:build
node --test --test-name-pattern="timeline" packages/metrics-helper/dist/server.test.js
```

Expected: FAIL with `404` for the new route.

- [ ] **Step 3: Implement route validation and serialization**

Add a route before the generic node routes:

```ts
if (url.pathname === '/api/metrics/timeline') {
  const nodeName = url.searchParams.get('node')?.trim() ?? ''
  const requestedWindow = url.searchParams.get('window') ?? '24h'

  if (!nodeName || nodeName.length > 512) {
    sendStatus(response, 400, { error: 'invalid_node' })
    return
  }
  if (requestedWindow !== '24h') {
    sendStatus(response, 400, { error: 'unsupported_window' })
    return
  }

  sendJson(response, {
    windowSeconds: 86_400,
    generatedAt: new Date(nowMs).toISOString(),
    nodeName,
    bucketSeconds: 900,
    buckets: options.storage.getNodeTimeline(nodeName, 86_400, 96, nowMs),
  })
  return
}
```

Preserve the existing global method check so non-GET requests remain `405`, and
preserve `cache-control: no-store`.

- [ ] **Step 4: Run all Metrics tests and build**

Run:

```powershell
pnpm metrics:test
pnpm metrics:build
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit the endpoint unit**

```powershell
git add packages/metrics-helper/src/server.ts packages/metrics-helper/src/server.test.ts
git commit -m "feat(metrics): serve node latency timeline"
```

---

### Task 3: Add Frontend Timeline Validation And Cache

**Files:**
- Modify: `src/api/metricsHelper.ts`
- Modify: `src/store/proxyMetrics.ts`
- Create: `src/helper/__tests__/metricsHelperTimeline.test.ts`

**Interfaces:**
- Produces: `ProxyMetricsTimelineBucket`, `ProxyMetricsTimelineResponse`, `fetchProxyMetricsTimelineAPI`, `refreshProxyMetricsTimeline`, `getProxyMetricsTimelineCacheKey`, and `invalidateProxyMetricsTimeline`.
- Consumes: the Task 2 endpoint.

- [ ] **Step 1: Write failing response-normalization tests**

Create `metricsHelperTimeline.test.ts`, import the normalizer from
`../../api/metricsHelper.ts`, and cover one valid bucket plus invalid count,
timestamp, ordering, and latency combinations:

```ts
test('normalizes a valid timeline bucket and rejects inconsistent counts', () => {
  assert.deepEqual(
    normalizeMetricsTimelineBucket({
      start: '2026-07-04T00:00:00.000Z',
      end: '2026-07-04T00:15:00.000Z',
      sampleCount: 3,
      successCount: 2,
      failureCount: 1,
      avgDelay: 100,
      minDelay: 80,
      maxDelay: 120,
    }),
    {
      start: '2026-07-04T00:00:00.000Z',
      end: '2026-07-04T00:15:00.000Z',
      sampleCount: 3,
      successCount: 2,
      failureCount: 1,
      avgDelay: 100,
      minDelay: 80,
      maxDelay: 120,
    },
  )
  assert.equal(
    normalizeMetricsTimelineBucket({
      start: '2026-07-04T00:00:00.000Z',
      end: '2026-07-04T00:15:00.000Z',
      sampleCount: 3,
      successCount: 3,
      failureCount: 1,
      avgDelay: 100,
      minDelay: 80,
      maxDelay: 120,
    }),
    null,
  )
})
```

Run: `node --test src/helper/__tests__/metricsHelperTimeline.test.ts`

Expected: FAIL because the normalizer does not exist.

- [ ] **Step 2: Add frontend timeline types and a strict normalizer**

Define the response types with the same field names as Task 2. Add an exported
pure normalizer:

```ts
export const normalizeMetricsTimelineBucket = (
  value: unknown,
): ProxyMetricsTimelineBucket | null
```

It must reject invalid timestamps, `end <= start`, negative/non-integer counts,
`successCount + failureCount !== sampleCount`, non-finite delays, and non-null
latency fields when `successCount === 0`. It must normalize valid timestamps to
ISO strings.

- [ ] **Step 3: Add the fetch API**

Implement:

```ts
export const fetchProxyMetricsTimelineAPI = async (
  nodeName: string,
  metricsWindow = '24h',
  timeout = 3000,
): Promise<ProxyMetricsTimelineResponse | null>
```

Use `URLSearchParams`, `cache: 'no-store'`, and `AbortController`. Accept only a
response with `windowSeconds === 86400`, `bucketSeconds === 900`, exactly 96
valid ordered buckets, and the requested node name.

- [ ] **Step 4: Add cache and request deduplication**

In `proxyMetrics.ts`, add a shallow timeline map and maps for fetch times and
pending requests. Use a 30-second TTL and this key:

```ts
export const getProxyMetricsTimelineCacheKey = (
  nodeName: string,
  metricsWindow = '24h',
) => `${metricsWindow}\n${nodeName}`
```

Implement:

```ts
refreshProxyMetricsTimeline(
  nodeName: string,
  options?: { force?: boolean; window?: string },
): Promise<ProxyMetricsTimelineResponse | null>

invalidateProxyMetricsTimeline(nodeName: string): void
```

Keep the last good timeline when refresh fails. Deduplicate concurrent requests
for the same key and prevent one key from overwriting another.

- [ ] **Step 5: Run frontend tests and type-check**

Run:

```powershell
node --test src/helper/__tests__/metricsHelperTimeline.test.ts
pnpm run type-check
```

Expected: both commands exit `0` with no changes to existing Metrics types or
call sites.

- [ ] **Step 6: Commit the frontend data unit**

```powershell
git add src/api/metricsHelper.ts src/store/proxyMetrics.ts src/helper/__tests__/metricsHelperTimeline.test.ts
git commit -m "feat: cache proxy latency timelines"
```

---

### Task 4: Build And Test The SVG Timeline Model

**Files:**
- Create: `src/helper/proxyMetricsTimeline.ts`
- Create: `src/helper/__tests__/proxyMetricsTimeline.test.ts`
- Create: `src/components/proxies/latencyTimelineChart.ts`

**Interfaces:**
- Consumes: `ProxyMetricsTimelineResponse` from Task 3.
- Produces: `buildProxyMetricsTimelineChartModel` and `createLatencyTimelineChartSection`.

- [ ] **Step 1: Write failing pure geometry tests**

Test contiguous success paths, a min/max band, mixed-failure slices,
all-failure slices, and gaps. The central assertion should follow this shape:

```ts
const model = buildProxyMetricsTimelineChartModel(response, {
  width: 360,
  height: 150,
  padding: { top: 10, right: 8, bottom: 22, left: 34 },
})

assert.equal(model.averagePaths.length, 2)
assert.equal(model.rangePaths.length, 2)
assert.equal(model.statusSlices[0].kind, 'mixed')
assert.equal(model.statusSlices[1].kind, 'failed')
assert.equal(model.points[gapIndex], null)
```

Also assert constant latency still receives a non-zero y range and every SVG
coordinate is finite.

- [ ] **Step 2: Run the helper test and verify failure**

Run:

```powershell
node --test src/helper/__tests__/proxyMetricsTimeline.test.ts
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement the pure chart model**

Define model types for axes, nullable points, contiguous average/range paths,
and status slices. Use successful bucket `avgDelay` for the line and
`minDelay/maxDelay` for the band. Split path runs whenever a bucket has no
successful latency. Compute yellow slice opacity from
`failureCount / sampleCount`; use red for `successCount === 0`.

Do not access `document`, Vue state, CSS variables, or card props in this pure
module.

- [ ] **Step 4: Implement the DOM/SVG renderer**

Implement this interface in `latencyTimelineChart.ts`:

```ts
type LatencyTimelineChartState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'empty' }
  | { status: 'ready'; timeline: ProxyMetricsTimelineResponse }

export const createLatencyTimelineChartSection = (
  state: LatencyTimelineChartState,
  options: { compact: boolean; sourceLabel?: string },
): HTMLElement
```

Use `document.createElement` and `document.createElementNS`; never insert API
text through `innerHTML`. Render a fixed-height placeholder for loading/error/
empty states. Hide point markers by default and use pointer movement to reveal
the nearest bucket's marker and text tooltip. Add an SVG accessible label and
honor `prefers-reduced-motion`.

- [ ] **Step 5: Run helper tests, type-check, and build**

Run:

```powershell
node --test src/helper/__tests__/*.test.ts
pnpm run type-check
pnpm run build
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit the chart unit**

```powershell
git add src/helper/proxyMetricsTimeline.ts src/helper/__tests__/proxyMetricsTimeline.test.ts src/components/proxies/latencyTimelineChart.ts
git commit -m "feat: render 24h latency timeline"
```

---

### Task 5: Integrate The Chart Into The Existing Popover

**Files:**
- Modify: `src/components/proxies/ProxyNodeCard.vue`

**Interfaces:**
- Consumes: Task 3 cache APIs and Task 4 `createLatencyTimelineChartSection`.
- Preserves: current `openWithDeferredRefresh`, Tippy hover boundaries, mobile outside-tap handling, recent-30 source resolution, and manual latency-test call.

- [ ] **Step 1: Add timeline source/state helpers**

Use `getR5sLatencySampleSourceName()` as the timeline source. Add one helper that
returns loading, unavailable, empty, or ready state from the Task 3 cache. If
the chosen source differs from `props.name`, pass a visible source label to the
section renderer.

- [ ] **Step 2: Compose the section without changing recent-30**

In `createLatencyDetailsTip()`, append the 24h section after the shared Metrics
summary and before `buildLatencyStatusTimeline`. Keep the existing sparkline,
status strip, jitter/loss row, availability text, and detail list intact.

Increase desktop width to `w-[25rem]`. For compact mode, retain the viewport
width and bottom-panel behavior, make the root a bounded flex column, and keep
the detail list as the internal scroll area.

- [ ] **Step 3: Refresh timeline without delaying popover opening**

Start `refreshProxyMetricsTimeline(sourceName)` when handling pointer entry or
mobile hold. Do not add it to the existing 350ms blocking race. If it is still
pending after the Tippy instance opens, update that active instance once with
`instance.setContent(createLatencyDetailsTip())` when the request settles.
Guard the update with the source name and active instance so a late HK response
cannot repaint a newly opened JP card.

- [ ] **Step 4: Invalidate after manual latency tests**

After `proxyLatencyTest(...)` settles, call `invalidateProxyMetricsTimeline` for
each unique name returned by `getMetricsCandidateNames()`. Do not block the test
button on a timeline refresh and do not change sorting or scroll behavior.

- [ ] **Step 5: Run static regression checks**

Run:

```powershell
node --test src/helper/__tests__/*.test.ts
pnpm metrics:test
pnpm run type-check
pnpm run build
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit the integration unit**

```powershell
git add src/components/proxies/ProxyNodeCard.vue
git commit -m "feat: show 24h latency chart in proxy details"
```

---

### Task 6: Validate Performance And Desktop/Mobile Behavior

**Files:**
- Modify only if validation finds a defect in files already listed above.

**Interfaces:**
- Consumes: complete Tasks 1-5 implementation.
- Produces: a locally approved preview; no GitHub push or R5S deployment yet.

- [ ] **Step 1: Validate SQLite query planning**

Against a copy or read-only connection to the existing R5S database, run
`EXPLAIN QUERY PLAN` for the timeline aggregation and confirm it searches with
`idx_probe_samples_node_time`. Do not run `VACUUM` or mutate production data.

- [ ] **Step 2: Measure endpoint size and local R5S time**

Request one populated node and record HTTP status, elapsed milliseconds, bucket
count, and response byte size. Acceptance criteria:

```text
HTTP 200
96 buckets
less than 200ms on the R5S local network under normal load
less than 30KB response body
```

- [ ] **Step 3: Start the local preview**

Run `pnpm dev --host 127.0.0.1` on an unused port and open `#/proxies` in the
in-app browser. Keep the server running for user inspection.

- [ ] **Step 4: Verify desktop behavior**

At a desktop viewport, inspect a leaf node, Smart group, Fallback group, and
nested group. Confirm the first hover opens without additional delay, moving
into the popover does not close it, chart/list source labels agree, late data
updates in place once, and moving away still closes normally.

- [ ] **Step 5: Verify mobile behavior**

At a mobile viewport, confirm the panel stays above navigation, chart text fits,
touching and scrolling the recent list does not close the panel, outside tap
does close it, and the chart does not cause horizontal overflow or layout shift.

- [ ] **Step 6: Run final verification**

Run:

```powershell
node --test src/helper/__tests__/*.test.ts
pnpm metrics:test
pnpm metrics:build
pnpm run type-check
pnpm run build
git diff --check
git status --short --branch
```

Expected: all checks pass and only intentional commits are ahead of
`origin/master`.

- [ ] **Step 7: Present the preview for approval**

Give the user the local URL and keep the in-app browser on the proxy page. Stop
before pushing GitHub or updating the R5S. Push, Actions verification, R5S
update, HTTP checks, and dangling-image cleanup happen only after explicit
preview approval.
