# Engineering Change Log

This is the append-only implementation record for ZashboardX changes that need
to survive chat compaction and handoffs. It records completed behavior, not
ideas or unverified plans.

## Maintenance Rules

- Before modifying an affected area, read the current invariants and the most
  recent related entry.
- After a behavior change is implemented and verified locally, append one
  entry with the data flow, preserved behavior, verification, and release
  status.
- Do not rewrite older entries to make the history look cleaner. Add a follow-up
  entry when a later change supersedes an earlier one.
- Plans belong in `docs/**/plans/`; this file is the record of what actually
  happened.

## Current Invariants

- The first-level latency tag, first-level recent strip, secondary recent-30
  data, and the 1h chart use the same per-node rolling raw-sample source.
- The 1h chart uses exact raw probe timestamps. It must not draw a recent-30
  subset against a one-hour axis.
- Once a node has a complete 1h raw cache, SSE and polling updates append new
  records, remove records older than one hour, and update the chart without a
  full detail refresh for each probe.
- The 6h and 24h charts continue to use server-side aggregated time buckets.
  Their selected-bucket drilldown and existing detail interactions must remain
  intact.
- Do not remove the fixed popover layout, the 1h raw-sample inspection, the
  6h/24h bucket inspection, or the relocated first-level recent strip when
  changing latency data flow.

## 2026-08-15 - One-hour rolling cache hydration

**Status:** Local change, verified; not committed or deployed yet.

**Problem:** `/api/metrics/nodes` initially provides only recent samples. The
secondary popover could render those samples against the full one-hour axis
before the `limit=200` detail response arrived, producing a partial 1h curve.

**Change:**

- Added a per-node `proxyMetricsOneHourSamplesReadyMap` in
  `src/store/proxyMetrics.ts`.
- A node becomes ready only after a successful 1h detail response requested
  with the full raw limit of 200 records.
- `ProxyNodeCard.vue` keeps the 1h chart in its existing loading state until
  that ready flag exists, so a cold cache cannot render the temporary recent
  subset as a one-hour chart.
- After readiness, the existing rolling merge path remains the live source:
  SSE triggers the normal metrics refresh, recent samples are merged into the
  full raw list, samples older than one hour are pruned, and open detail cards
  re-render from that shared list.

**Preserved behavior:**

- The primary latency value, first-level strip, secondary recent-30 view, and
  1h chart still derive from the same shared rolling raw list.
- 1h raw-point selection, 6h/24h aggregation, bucket drilldown, popover size,
  and existing transition behavior were not changed.

**Files changed:**

- `src/store/proxyMetrics.ts`
- `src/components/proxies/ProxyNodeCard.vue`
- `src/helper/__tests__/proxyMetricsLiveUpdates.test.ts`
- `src/helper/__tests__/proxyNodeCardLayout.test.ts`

**Verification:**

- `node --test "src/helper/__tests__/*.test.ts"` - 139 passed.
- `pnpm run type-check` - passed.
- `pnpm run build` - passed.
- `git diff --check` - passed.
- Local preview - HTTP 200 at `http://127.0.0.1:5175/`.

**Release:** User approved commit and deployment on 2026-08-15. The final
commit, Actions run, and R5S verification are recorded with the release task.

## 2026-08-15 - Release record for one-hour rolling cache hydration

**Source commit:** `3576477` (`fix: keep one-hour latency charts complete`)
on `master`.

**GitHub Actions:** `Build Image` run `31857832700` completed successfully in
3 minutes 56 seconds. It published the dashboard and Metrics helper images.

**R5S deployment:** `/root/update-zashboardx.sh` pulled the new images and
recreated `zashboardx` plus `zashboardx-metrics`.

**R5S verification:**

- `zashboardx`: `running`, `true`, restart count `0`.
- Image: `ghcr.io/pluviophile714/zashboardx:latest`.
- `http://192.168.8.2:2080/`: HTTP `200`.
- `docker image prune -f`: reclaimed 15.18 MB of dangling image data.

## 2026-08-17 - One-hour readiness and initial popover placement

**Status:** Local change, verified; not committed or deployed yet.

**Problem:** A stale `1h`, `limit=200` detail response could be rejected because
its snapshot preceded the shared metrics snapshot, while still marking the
node's shared raw cache as ready. The cache could therefore contain only the
recent 30 samples and render as a partial curve across a full one-hour axis.
The latency details popover also initially opened with a temporary Tippy
placement and unconstrained height, then changed direction and height on the
next animation frame.

**Change:**

- The one-hour ready flag is now set only when the complete detail response is
  accepted into the shared rolling raw-sample cache.
- The popover now computes its final compact or desktop placement and max
  height before calling `showTip`. Compact popovers start with zero Tippy
  content padding, and Popper flipping is disabled because the application has
  already selected a valid vertical side.
- Live refreshes reuse the existing height-preserving detail render path, so a
  delayed refresh cannot briefly remove the active height constraint.

**Preserved behavior:**

- A warm 1h cache still advances incrementally from SSE and polling updates;
  this change does not refetch 200 samples for each new probe.
- The first-level latency value and strip, secondary recent history, 1h raw
  point drilldown, 6h/24h bucket drilldown, and viewport-resize repositioning
  remain unchanged.

**Verification:**

- `node --test "src/helper/__tests__/*.test.ts"` - 141 passed.
- `pnpm run type-check` - passed.
- `pnpm run build` - passed.
- Local preview - HTTP 200 at `http://127.0.0.1:5175/` with no console errors.

**Release:** Awaiting user approval to commit and deploy.

## 2026-08-17 - Fresh complete one-hour detail snapshots

**Status:** Local change, verified; not committed or deployed yet.

**Required behavior:** Opening the secondary node details must render a complete
1h chart, newly stored probes must advance the chart and recent latency strips,
and a temporary recent-only response must never be drawn across the full-hour
axis.

**Root cause:** `MetricsDetailsCache` used stale-while-revalidate for every
timeline request. A dirty or expired `1h`, `limit=200` cache entry could
therefore return an older snapshot containing only about 30 minutes of history
while its complete refresh ran in the background. The frontend correctly kept
the live right edge, but the stale response left the first half of the chart
empty until the later refresh arrived.

**Change:**

- `MetricsDetailsCache.get()` now supports `requireFresh`. A dirty or expired
  snapshot in this mode joins the existing in-flight refresh and returns its
  completed result instead of returning the stale snapshot.
- `/api/metrics/details` enables `requireFresh` only for the complete 1h raw
  request (`window=1h`, `limit>=200`). The 6h/24h stale-while-revalidate and
  bundle-cache behavior is unchanged.
- If an older complete 1h response finishes immediately behind a newer SSE
  update, the frontend merges that response's history with the live tail and
  retains the newer snapshot marker. Recent updates can no longer prevent the
  complete historical prefix from hydrating.

**Data-source invariant:**

- There is still one authoritative per-node rolling raw array. The complete 1h
  chart uses the full array, both recent strips use its tail, and the latest
  latency uses its final record.
- After hydration, SSE and polling append new probes, prune records outside the
  one-hour window, and redraw the chart and strips from that same array.
- The recent-30 response is not a second 1h chart source and cannot replace a
  previously complete one-hour array.

**Verification:**

- `pnpm --filter @zashboardx/metrics-helper test` - 76 passed.
- `node --test "src/helper/__tests__/*.test.ts"` - 141 passed.
- `pnpm run type-check` - passed.
- `pnpm run build` - passed.
- Prettier check for all changed source and test files - passed.
- `git diff --check` - passed.

**Release:** Awaiting user approval to commit and deploy.

## 2026-08-17 - Release record for fresh complete one-hour snapshots

**Source commit:** `218aed3` (`fix: keep complete one-hour latency snapshots
fresh`) on `master`.

**GitHub Actions:** `Build Image` run `31992843893` completed successfully in
4 minutes 39 seconds. Type checking, Metrics helper tests, installer tests,
the production build, and both multi-architecture GHCR image publishes passed.

**R5S deployment:** `/root/update-zashboardx.sh` pulled the new dashboard and
Metrics helper images and recreated both containers.

**R5S verification:**

- `zashboardx`: running, restart count `0`, image ID
  `sha256:120d8c9998880983dcd33a5ae938505387702e890d5d3cb23404ae44a347ba96`.
- `zashboardx-metrics`: running, restart count `0`, image ID
  `sha256:082d6d8c238c48d89a4d260e1e16126b970e85db328d16b54b0242c70268f0d6`.
- Dashboard endpoint returned HTTP `200`; Metrics health reported `ok` and
  Mihomo reachable.
- A real `window=1h&limit=200` request returned 51 raw samples spanning 57
  minutes, with matching detail and timeline snapshot timestamps, in 261 ms.
- Metrics helper logs contained only the normal listening message.
- `docker image prune -f` reclaimed 15.18 MB of dangling image data.
