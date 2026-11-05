# Metrics Rollup and 7-Day Latency Chart Design

**Date:** 2026-11-05

## Intent

Reduce recurring R5S CPU spikes without weakening the existing 30-second probe
cadence, SSE updates, 1h raw chart, first-level latency strip, or seven-day raw
retention. Add a seven-day latency chart that is useful on an R5S-sized device.

## Goals

- Keep `probe_samples` as the authoritative raw history and retain it for the
  configured seven-day retention period.
- Keep the 1h chart on the existing rolling raw-sample source so new probes can
  move the chart forward immediately through SSE and polling fallback.
- Add persistent per-node rollup buckets at 1 minute, 5 minutes, and 15 minutes.
- Serve 6h, 24h, and 7d timeline data from rollups after the rollup snapshot is
  ready, with a raw-query fallback during migration or recovery.
- Add a `7d` timeline profile with 672 fifteen-minute buckets.
- Preserve pointer/touch bucket inspection and raw bucket drilldown where the
  selected interval is within the existing 15-minute drilldown limit.
- Make the all-node metrics cache read rollups for its default 24h window after
  migration, removing the repeated full raw-history scan from the 30-second
  probe path.

## Non-goals

- Do not remove or rewrite existing raw samples.
- Do not make 7d the default popover range; the default remains 1h.
- Do not add a new chart dependency.
- Do not stream seven-day raw samples to the browser.
- Do not change Smart weights, latency-strip semantics, or the existing 1h
  complete-snapshot rule.
- Do not merge upstream code that deletes the custom Metrics Helper or latency
  chart surfaces.

## Constraints and compatibility

- The deployed R5S image is `ghcr.io/pluviophile714/zashboardx:metrics-latest`
  with the database mounted at `/data/metrics.sqlite`.
- The existing `nodes`, `probe_samples`, and `metadata` tables remain intact.
- The new schema must be created with `CREATE TABLE IF NOT EXISTS` and must be
  safe against an existing database created by the current metrics image.
- Rollup rebuild must happen through the existing storage worker so probe writes
  remain serialized with SQLite writes.
- During an initial rebuild, reads must remain available through the existing
  raw-query path. A missing rollup snapshot must never produce an empty chart.
- If a rollup query fails or is incomplete, the helper must fall back to the
  current raw aggregation and expose the same response shape.

## Chosen approach

### Rollup storage

Add a `metrics_rollup_buckets` table keyed by `(node_name, bucket_seconds,
bucket_start)`. Each row stores sample count, success/failure counts, delay sum,
minimum and maximum successful delay, jitter sum/count, first/last timestamps,
and the latest successful delay. This is sufficient for chart values and the
all-node availability/latency summary without reconstructing the raw window.

The storage worker performs one compatibility rebuild after startup. The rebuild
is serialized with probe writes, covers the configured retention window, and
marks rollups ready only after the complete snapshot is committed. After that,
new or corrected probe samples refresh only their affected 1m, 5m, and 15m
buckets from the indexed raw rows. This keeps correction behavior correct for
Smart and Fallback samples without a full-history recalculation.

### Timeline API

Extend the existing fixed profile allowlist:

| Window | Buckets | Resolution |
| --- | ---: | ---: |
| 1h | raw samples | exact probe timestamps |
| 6h | 72 | 5 minutes |
| 24h | 96 | 15 minutes |
| 7d | 672 | 15 minutes |

The `timeline` endpoint accepts `7d`. The existing 6h/24h bundle remains
limited to those two windows so opening a node does not fetch a larger chart
unnecessarily. The frontend requests 7d on demand and caches it using the same
validated snapshot mechanism as the other windows.

The 7d chart uses the existing SVG renderer, smooth paths, failure slices, and
pointer/touch bucket selection. Its raw bucket drilldown is requested only for
the selected 15-minute interval, so the chart itself remains compact.

### All-node metrics

When rollups are ready, the default 24h node summary aggregates the 15-minute
rows. It continues to return the existing `ProxyMetricsNode` shape and keeps
the same 30-second freshness contract for newly written samples. The cache and
SSE event behavior remain unchanged. The old raw aggregation remains the
fallback for non-default windows or an unavailable/incomplete rollup.

## Upstream synchronization boundary

The official upstream baseline is `Zephyruso/zashboard` `v3.30.0` at
`bf4f00bb8d905f8a78f627af7cf84457c4db53c4`. The fork sync must preserve the
custom Metrics Helper workspace, SSE events, first-level latency strip, 1h raw
timeline, 6h/24h charts, bucket drilldown, Smart-weight integration, and the
new rollup/7d code. Upstream changes to unrelated navigation, connection,
overview, DAE, styling, and dependency fixes may be adopted after build and
browser verification. Upstream deletions of fork-owned Metrics files are not
accepted as merge resolutions.

## Verification

- Unit tests cover rollup schema migration, complete rebuild, affected-bucket
  refresh, empty buckets, failures, jitter, retention, and 7d profile geometry.
- Metrics HTTP tests cover `window=7d`, malformed/unsupported windows, fallback
  behavior, and response validation.
- Existing Metrics and frontend test suites remain green.
- Type check and production build pass after the upstream merge.
- Browser smoke checks cover the 1h default, switching to 7d, chart viewport
  bounds, and bucket drilldown on desktop and mobile widths.
- No deployment occurs until the merged preview and R5S compatibility checks
  are complete.
