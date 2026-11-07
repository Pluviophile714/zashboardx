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

## 2026-08-24 - Upstream 3.22.0 sync and sing-box removal

**Status:** Local merge verified; awaiting preview approval and release.

**Change:** Merged upstream release `3.22.0` (`07e5e5a`), then merged the
official sing-box removal (`4adb487`). The latter removes the sing-box native
API, its protocol dependencies, and the upstream Tools page with its related
Tailscale, OpenVPN, terminal, and USB/IP surfaces.

**Preserved fork behavior:**

- The Metrics Helper workspace remains in `pnpm-workspace.yaml`; the root
  `metrics:build` and `metrics:test` commands remain available.
- The primary latency value, first-level strip, secondary recent history, 1h
  raw timeline, SSE-driven rolling updates, and 6h/24h aggregated timeline
  and bucket drilldown were retained without source changes in their custom
  Metrics files.
- The complete-1h hydration rule remains in force: a recent-only response
  cannot become the 1h chart source, while a warm raw list still advances as
  new probes are received.
- Browser navigation filters the internal `app` route. It is reserved for an
  upstream native shell but has no browser route; rendering it would create a
  dead sidebar entry.
- The remaining node-card latency test call uses the Mihomo-only signature;
  the old fourth argument belonged to the removed sing-box path.

**Verification:**

- `pnpm install --frozen-lockfile` completed for both workspace projects.
- `pnpm --filter @zashboardx/metrics-helper test` - 76 passed.
- `node --test "src/helper/__tests__/*.test.ts"` - 141 passed.
- `pnpm exec vue-tsc --build --force` - passed with no diagnostics.
- `pnpm run build` - production bundle generated successfully.
- `git diff --check` - passed.

**Release:** Pending local proxy-page preview at `http://127.0.0.1:5175/`.

## 2026-08-24 - Restore latency strip green

**Status:** Local preview updated; not deployed.

**Change:** Restored the historical low-latency color
`oklch(0.648 0.15 160)` as a global token. Neutral themes no longer override
the low-latency green, so the first-level latency strip and chart keep the same
green across built-in themes.

**Preserved behavior:** Latency thresholds, shared samples, SSE updates, strip
animation, chart rendering, and 6h/24h bucket behavior were not changed.

**Verification:**

- `node --test src/helper/__tests__/latencyColorTokens.test.ts` - passed.
- `pnpm exec vue-tsc --build --force` - passed.
- `pnpm run build` - passed; PWA service worker generated.

## 2026-11-05 - Metrics rollups, seven-day chart, and upstream 3.30 sync

**Status:** Local merge and preview verified; GitHub push and R5S deployment are
still pending.

**R5S Metrics baseline captured before any deployment:**

- Container: `zashboardx-metrics`, running with restart count `0`.
- Image: `ghcr.io/pluviophile714/zashboardx:metrics-latest`.
- Current image ID: `sha256:afdd9b382eb6d6e78576a740b27c7637c384eb8cae8cdf2b4e0a85796854c3ca`.
- Metrics package in `/app/package.json`: `@zashboardx/metrics-helper@0.1.0`.
- Runtime: `node dist/index.js`; database: `/data/metrics.sqlite`.
- Host data mount: `/opt/zashboardx/metrics-data:/data`.
- Probe/scrape interval: 30 seconds; probe concurrency: 8; cache TTL: 10
  seconds; refresh debounce: 1500 ms.
- The live image does not contain `metrics_rollup_buckets` or the 7d profile,
  so the R5S is still running the pre-rollup Metrics implementation. No R5S
  container, environment variable, or database file was changed in this work.
- The local Metrics Helper package version is now `0.2.0`; the deployed R5S
  image remains `0.1.0` until the new Metrics image is built and deployed.

**Changes:**

- Added persistent 1-minute, 5-minute, and 15-minute rollup buckets while
  retaining `probe_samples` for the seven-day raw retention policy.
- Added the 7d timeline profile with 672 fifteen-minute buckets. The default
  popover range remains 1h; 6h/24h/7d data is requested on demand, and bucket
  drilldown remains available.
- Kept 1h on the complete raw rolling sample list and preserved SSE/polling
  live advancement, so new samples continue to move the chart and latency
  strips together.
- Synchronized the fork with official `Zephyruso/zashboard` v3.30.0 while
  preserving Metrics Helper, SSE, latency strips, 1h/6h/24h charts, Smart
  weights, and time-bucket inspection.
- Unified the post-v3.30 proxy state so the page, proxy helpers, latency tests,
  Smart ordering, and the new driver layer use the same `proxyMap`, group list,
  IPv6 state, and proxy-tab state.

**Verification:**

- `pnpm --filter @zashboardx/metrics-helper test` - 82 passed.
- `node --test "src/helper/__tests__/*.test.ts"` - 150 passed.
- `pnpm run type-check` - passed.
- `pnpm run build` - passed.
- Edge-backed `node test/verify.mjs` - 14/14 passed.
- Edge-backed `node test/collapse.mjs` - all 9 scenarios passed.
- Edge-backed `node test/latency-popover-smoke.mjs` - desktop and mobile
  popovers stayed inside the viewport and route leave removed all popovers.
- Local preview `http://127.0.0.1:5176/` returned HTTP 200 and displayed the
  v3.30 proxy list against the mock Mihomo backend.

**Release boundary:** Do not overwrite `/opt/zashboardx/metrics-data` during
the later image update. The existing database must be migrated in place by the
new helper, then the Metrics health endpoint, rollup readiness, SSE, and the
dashboard HTTP 200 must be checked on the R5S.

## 2026-08-25 - Restore metrics freshness translations

**Status:** Local fix complete; not committed or deployed.

**Root cause:** `ProxyNodeCard.vue` still rendered the metrics freshness line
through `t('metricsLive')`, `t('metricsLastProbe')`, and the related unit keys,
but a later locale-file restoration had removed those entries from all four
language dictionaries. Vue I18n therefore displayed the raw keys, which made
the status appear in English and hid the relative probe age.

**Change:** Restored the seven freshness labels and three age-unit labels in
English, Simplified Chinese, Traditional Chinese, and Russian. The freshness
state calculation, SSE/polling updates, latency samples, and node-card layout
were not changed.

**Verification:**

- `node --test src/helper/__tests__/metricsFreshnessI18n.test.ts` - passed.
- `pnpm run type-check` - passed.
- `pnpm run build` - passed; PWA service worker generated.
- `git diff --check` - passed for the changed source and test files.

## 2026-09-08 - Upstream 3.26 virtual-list browser verification

**Status:** Local preview only in `zashboardx-upstream-326`; not pushed or deployed.

**Observed failures and fixes:**

- Browser verification initially passed 13/14 checks. Sorting after a latency
  test unmounted the old node card, so its DOM-based scrolling did nothing.
  The card now uses the list-provided `scrollNodeIntoViewKey` and the existing
  shared highlight state. Non-virtual callers retain the DOM fallback.
- Active cards inside a virtual list no longer independently schedule the old
  delayed centering operation; the list owns active-row positioning.
- Leaving the proxies route with a latency popover open left one detached
  Tippy popover in the page. Card unmount now destroys its own active instance.
  Desktop and mobile route-leave checks now report zero remaining popovers.
- The isolated browser harness explicitly uses en-US for upstream tests that
  locate English search placeholders. Product language settings are unchanged.

**Verification:**

- Frontend Node tests: 146/146 passed after the fixes.
- Type check, production build, and diff whitespace check passed.
- Upstream browser behavior suite: 14/14 passed after the scroll fix.
- Collapse suite: all nine scenarios passed, including reversal and unmount.
- Mobile benchmark at 390x844, 60 groups x 100 nodes, one run, no CPU throttle:
  first cards 483 ms; DOM count 487 initially and 502 after scrolling to bottom.
  This is a desktop-browser simulation, not physical-phone performance evidence.
- Popover smoke screenshots: desktop 1440x900 and mobile 390x844; no horizontal
  page overflow, popovers inside viewport, route leave removes the popover.
- Preview at http://127.0.0.1:5176/ returned HTTP 200.

**Limits:** The mock backend has no Metrics history. Popover screenshots show
the loading state, not a verified complete 1h chart. Real R5S SSE-to-chart
updates and 6h/24h bucket drilling still need browser verification with real
history. No Metrics Helper source, storage, or real backend settings changed.

## 2026-08-24 - Restore proxy penetration translations

**Status:** Local fix complete; not committed or deployed.

**Root cause:** The upstream proxy penetration component referenced
`strategyPenetration`, `collapsePenetration`, `stepwisePenetration`, and
`fullExpansion`, but none of the four locale dictionaries defined those keys.
Vue I18n therefore rendered the key names directly, which made the proxy
penetration controls appear in English in the Chinese interface.

**Change:** Added the four labels to English, Simplified Chinese, Traditional
Chinese, and Russian dictionaries. No proxy penetration behavior or latency
monitoring code was changed.

**Verification:**

- `node --test src/helper/__tests__/proxyPenetrationI18n.test.ts` - passed.
- `pnpm exec vue-tsc --build --force` - passed.
- `pnpm run build` - passed; PWA service worker generated.

## 2026-11-06 - Add calendar dates to 7d latency details

**Status:** Local fix complete; ready to push and deploy with the current
upstream-synced release.

**Change:** 7d chart axis labels now use compact calendar dates such as
`11-06`, while the selected bucket interval includes the date and time. If a
bucket crosses midnight, both ends include their dates. 1h, 6h, and 24h keep
their existing time-only labels. Metrics data, Rollup profiles, SSE updates,
and bucket drilldown behavior are unchanged.

**Verification:**

- Proxy latency layout tests: 64/64 passed.
- Full frontend helper tests: 151/151 passed.
- Metrics Helper tests: 82/82 passed.
- Type check and production build passed.
- The browser verification suites could not start their local Chrome
  debugging endpoint in this run; no application assertion failed.

## 2026-11-06 - Skip redundant Metrics rollup rebuilds on restart

**Status:** Local fix complete; ready to push and deploy.

**Root cause:** The Metrics service rebuilt all seven days of Rollup data on
every startup, even when the persisted Rollup metadata already marked the
tables ready. The single storage worker was occupied by that full rebuild, so
fresh Mihomo samples and the 1h chart appeared stale during deployment.

**Change:** Startup now rebuilds Rollups only when the persisted ready marker
is absent or not ready. Existing raw samples, 7d Rollup data, SSE updates, and
the first-time rebuild path are unchanged.

**Verification:**

- Added startup policy tests for ready and not-ready Rollup states.
- R5S first-time rebuild completed successfully: 3,936,255 60-second rows,
  793,323 300-second rows, and 265,222 900-second rows.
- R5S health recovered to `ok=true` and `mihomoReachable=true` after the
  first rebuild.

## 2026-11-07 - Keep Metrics cold starts usable and prune expired rollups

**Status:** Local change, verified; not committed or deployed yet.

**Problem:** A cold Metrics process had no in-memory snapshot for a requested
non-default window, so `/api/metrics/nodes` returned `503 metrics_warming_up`
until the background aggregation completed. Daily retention removed old raw
`probe_samples`, but did not remove old `metrics_rollup_buckets`, allowing the
Rollup table and its indexes to grow beyond the seven-day retention window.

**Change:**

- Cold `/api/metrics/nodes` requests now return the available database-backed
  aggregation immediately with `fallback: true` while the requested in-memory
  snapshot continues warming in the background.
- Metrics startup schedules the 1h aggregation first, then schedules the
  default 24h aggregation after a short delay. This does not replace the 1h
  raw detail path or its SSE-driven rolling updates.
- The existing retention pass now deletes Rollup buckets older than the same
  configured retention window as raw samples. Seven-day raw history and the
  7d chart remain enabled.

**Preserved behavior:**

- 1h remains the complete raw-sample chart and continues to append new samples
  from SSE/polling, trimming samples that leave the one-hour window.
- Existing stale-while-revalidate behavior still shows an older timeline first
  and replaces it after the background refresh; no artificial blurred image is
  created when no previous snapshot exists.
- 6h/24h bucket aggregation, bucket drilldown, 7d Rollup data, Smart metrics,
  and the first-level latency strip are unchanged.

**Verification:**

- `pnpm run metrics:test` - 85 passed.
- `git diff --check` - passed.
- `pnpm run type-check` - passed.
- `pnpm run build` - passed.

**Release:** Not committed, pushed, or deployed yet.

## 2026-11-07 - Avoid blank latency charts during slow first reads

**Status:** Local fix verified; deployment pending.

**Problem:** The first 1h detail request must load the complete raw sample window. On
the R5S, a cold detail worker can take longer than the frontend's three-second
request timeout, leaving the popover on `正在读取` before a later retry finally
shows the full chart. The 6h, 24h, and 7d views were using the same heavier detail
request even though they only need aggregated timeline buckets.

**Change:**

- Increased the detail request timeout to twelve seconds so a slow complete 1h
  read is not aborted prematurely. The chart still waits for the full raw list,
  so it never draws a partial 1h line.
- Routed 6h, 24h, and 7d refreshes through the lightweight aggregate timeline
  endpoint. Bucket drilldown continues to fetch its exact raw samples separately.
- Kept stale timeline state and retry behavior intact so an existing complete chart
  remains visible while a newer request is being refreshed.

**Verification:**

- Added a regression assertion for the raw-1h versus aggregate-long-window split.
- Proxy latency layout tests: 66/66 passed.
- `pnpm run type-check` - passed.
- `pnpm run metrics:test` - 85 passed.
- `pnpm run build` - passed.

**Release:** Not committed, pushed, or deployed yet.

## 2026-11-07 - Surface Metrics fallback state in latency details

**Status:** Local change, verified; not committed or deployed yet.

**Problem:** The cold-start node response now has a `fallback` marker, but the
frontend did not consume it. A database-backed response could therefore look
like live data even while the in-memory aggregation was still being built.

**Change:**

- Propagated the Metrics `fallback` marker through the API and shared store.
- Latency details now label fallback data as `数据整理中` in Simplified Chinese
  and use matching translations in the other supported locales.
- Kept the existing stale timeline state separate: an older complete chart is
  still shown as syncing with the light blur treatment.
- Kept the complete-raw-sample gate for 1h, so fallback recent samples cannot
  be drawn as a partial one-hour chart.

**Verification:**

- Frontend helper tests: 152 passed.
- Metrics Helper tests: 85 passed.
- Type check and production build passed.
- `git diff --check` passed.

**Release:** Not committed, pushed, or deployed yet.
