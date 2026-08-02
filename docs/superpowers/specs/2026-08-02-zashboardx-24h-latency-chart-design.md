# ZashboardX 24h Latency Chart Design

## Goal

Add an Uptime Kuma-inspired 24-hour latency chart to the existing proxy quality
popover without changing the existing collection rules, 24h availability,
recent-30 history, Smart/Fallback identity, or latency-test behavior.

The approved visual direction is:

- Enlarge the existing secondary popover to about 400px on desktop.
- Keep the mobile presentation as a bottom panel with a scrollable content area.
- Show the 24h chart above the existing recent-30 chart, status strip, and list.
- Draw one average-latency line with a min-to-max range band.
- Overlay mixed-failure buckets in yellow and all-failure buckets in red.

## Uptime Kuma Reference

The design borrows behavior, not component code, from the MIT-licensed
`louislam/uptime-kuma` project:

- `src/components/PingChart.vue`: time-axis chart behavior, hidden points until
  hover, min/average/max aggregation, failure overlays, gap separation, and
  periodic refresh.
- `server/socket-handlers/chart-socket-handler.js`: serving aggregated chart
  data instead of sending every raw heartbeat to the browser.
- `server/uptime-calculator.js`: minute-level status and latency aggregation.

ZashboardX will not add Chart.js or copy Uptime Kuma's Vue component. The
existing proxy quality popover is built from lightweight DOM and SVG helpers,
so the new chart will follow that local pattern.

## Scope

In scope:

- A compact 24h timeline API backed by the existing Metrics SQLite database.
- A fixed-size, on-demand SVG chart inside the current quality popover.
- Desktop and mobile layouts.
- Loading, unavailable, no-data, mixed-failure, all-failure, and sample-gap
  states.
- Focused storage, API, rendering-model, type-check, build, and performance
  validation.

Out of scope:

- A separate Metrics details page.
- 3h, 6h, 7d, or arbitrary chart periods.
- Changing how Mihomo history, frontend tests, or helper fallback probes are
  collected.
- Changing availability calculations or the existing recent-30 display.
- Preloading charts for every node on the proxy page.
- Adding a second charting dependency.
- A persistent rollup table. It can be considered later only if measured R5S
  query performance requires it.

## Data Source And Identity

The chart uses only samples already stored in the R5S Metrics `probe_samples`
table. Browser-local history is not merged into the chart response. Frontend
latency results already posted to the helper remain valid R5S samples and are
therefore included after ingestion.

The chart source name must be the same source selected for the popover's R5S
24h availability and R5S recent-30 list:

1. The card's own `props.name`.
2. Its known Smart outbound, when the card itself has no Metrics row.
3. Its currently resolved final node, when neither earlier source has Metrics.

This preserves the existing behavior while ensuring that Smart and Fallback
groups with their own samples chart the group itself. Samples from changing
children must never be concatenated into a synthetic group timeline. When a
fallback source is used, the popover displays the actual source name in a
subtle data-source label.

## Timeline API

Add a read-only endpoint:

```text
GET /api/metrics/timeline?node=<encoded-name>&window=24h
```

The first version supports only `24h` and always returns 96 buckets. Each bucket
represents exactly 15 minutes. `generatedAt` is the fixed end of the query and
the first bucket starts at `generatedAt - 24h`; bucket indices are calculated
relative to that rolling-window start. This includes the newest samples without
rounding the chart back to a wall-clock boundary.

Response shape:

```ts
type ProxyMetricsTimelineBucket = {
  start: string
  end: string
  sampleCount: number
  successCount: number
  failureCount: number
  avgDelay: number | null
  minDelay: number | null
  maxDelay: number | null
}

type ProxyMetricsTimelineResponse = {
  windowSeconds: number
  generatedAt: string
  nodeName: string
  bucketSeconds: number
  buckets: ProxyMetricsTimelineBucket[]
}
```

The backend returns every bucket, including empty buckets, so the frontend does
not infer missing time ranges. Aggregation counts all samples for availability
status but calculates latency values from successful samples with a non-null
delay only.

The query is restricted by exact `node_name` and timestamp range before
grouping. It must use the existing `(node_name, timestamp)` index and must not
scan or aggregate all nodes. The existing raw-sample and all-node Metrics
endpoints remain unchanged.

The existing 24h availability continues to be calculated from raw samples. The
96 chart buckets are a visual compression only and do not alter percentages,
sample counts, failures, or the recent-30 list.

## Chart Semantics

For each bucket:

- At least one successful delay: draw the average line at `avgDelay` and the
  translucent range band from `minDelay` to `maxDelay`.
- Both successes and failures: overlay a translucent yellow slice whose
  intensity reflects the failure ratio.
- Failures and no successes: overlay a translucent red slice and leave the
  latency line null for that bucket.
- No samples: draw neither status color nor latency and break the line across
  the bucket.

The chart never connects across empty or all-failure buckets. This follows the
useful gap behavior from Uptime Kuma and prevents a long unobserved period from
looking healthy.

The default chart has no visible point markers. Pointer hover or touch reveals
one nearest-bucket marker and a small tooltip containing:

- Bucket start and end time.
- Average, minimum, and maximum successful delay.
- Successful samples over total samples.
- Failure count.

The x-axis shows a small number of time labels and the y-axis uses milliseconds.
The y range is derived from successful bucket values with enough minimum range
to avoid exaggerating tiny changes. Initial drawing does not animate, and all
motion respects reduced-motion preferences.

## Popover Layout

Desktop:

- Increase width from the current `w-76` to approximately 400px, constrained by
  `calc(100vw - 2rem)`.
- Keep the existing hover boundary and delayed-close behavior, so moving from
  the latency capsule into the popover remains possible.
- Place the 24h chart below the availability/sample summary and above the
  existing recent-30 section.

Mobile:

- Keep the bottom-panel interaction and outside-tap close behavior.
- Keep pointer and touch movement inside the panel from closing it.
- Use a slightly shorter chart while preserving the same 96 buckets.
- Make the body a bounded flex column. The header and chart remain stable while
  the recent sample list uses the remaining vertical space for scrolling.

The chart does not replace the existing recent-30 sparkline, status strip, or
detail rows. The two timescales have separate labels: `24h 延迟` and
`R5S近30次`.

## Loading And Refresh

Chart data is fetched only for the source represented by an opened popover.
Opening one card must not trigger timeline requests for all visible cards.

- The popover opens using the current behavior; the new request adds no blocking
  wait to the existing open path.
- Existing availability and recent-30 content render immediately.
- An uncached timeline displays a stable chart-sized loading placeholder and is
  replaced in place without closing or recreating the popover.
- Frontend timeline responses are cached by `window + source name` for 30
  seconds and concurrent requests are deduplicated.
- A completed manual latency test invalidates that source's timeline cache. The
  next request reads the sample after the helper accepts the existing best-effort
  frontend POST.
- A failed refresh keeps the last good chart when one exists. With no prior
  chart, it displays `R5S 24h 趋势暂不可用`.
- A successful empty response displays `24h 趋势暂无样本`; it does not fall back
  to browser-local history.

This keeps ordinary page rendering and scrolling unchanged while avoiding the
large raw-sample transfer that previously caused slow Metrics requests.

## Component Boundaries

Metrics helper:

- `storage.ts`: one focused per-node bucket aggregation method.
- `server.ts`: validation and serialization for the timeline endpoint.
- `types.ts`: shared helper timeline types.

Frontend:

- `metricsHelper.ts`: response validation and timeline fetch API.
- `proxyMetrics.ts`: per-node timeline cache, request deduplication, and
  invalidation.
- A focused proxy chart helper/component: convert validated buckets into SVG
  paths, range areas, status slices, axes, and nearest-bucket details.
- `ProxyNodeCard.vue`: compose the new chart section into the existing popover
  and preserve its desktop/mobile interaction boundaries.

Chart math and SVG generation must not be added as another large block inside
`ProxyNodeCard.vue`; it receives already validated timeline data and emits a
bounded chart surface.

## Error Handling And Safety

- Reject missing, empty, or overlong node names with `400`.
- Reject unsupported window values instead of silently serving a different
  period.
- Return `405` for non-GET timeline requests.
- Escape all node and tooltip text; no API value is inserted as raw HTML.
- Clamp or reject non-finite latency values before SVG path generation.
- Abort frontend requests on timeout and on stale popover generations so a late
  response cannot overwrite a newly opened node.
- Do not mutate the Metrics database schema or existing samples for this
  feature.

## Validation

Metrics tests cover:

- Exact 24h window boundaries and 96 ordered buckets.
- Successful min/average/max aggregation.
- Mixed success/failure and all-failure buckets.
- Empty buckets and line-breaking data.
- Unicode and punctuation in node names.
- Unsupported windows and invalid node-name input.
- Querying one node without including another node's samples.

Frontend validation covers:

- Timeline response normalization and rejection of malformed buckets.
- SVG model generation for success, mixed, failure, and gap states.
- Request caching, deduplication, stale-response protection, and invalidation.
- Desktop hover entry/exit behavior.
- Mobile opening, internal list scrolling, and outside-tap closing.
- Existing recent-30, loss, availability, Smart/Fallback, and manual latency-test
  behavior remains present.

Release validation requires:

```text
pnpm metrics:test
pnpm metrics:build
pnpm run type-check
pnpm run build
git diff --check
```

Use the existing R5S database for a read-only performance check. Confirm the
query plan uses `idx_probe_samples_node_time`, one timeline response stays below
30KB, and a local R5S request for one node completes within 200ms under normal
load. Remote VPN latency is observed separately and is not confused with SQLite
query time.

Before GitHub push or R5S deployment, preview the proxy page at desktop and
mobile widths and obtain user approval. Deployment follows the existing GHCR
workflow and does not replace or clear the Metrics database.
