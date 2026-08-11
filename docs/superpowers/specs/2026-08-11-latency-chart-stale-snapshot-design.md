# Latency Chart Stale Snapshot Design

## Goal

Prevent an open latency detail card from showing a populated recent-30 strip while its 1h, 6h, or 24h chart remains stuck in the loading state.

## Constraints

- Preserve the existing 1h raw-sample chart, draggable pointer, bucket drilldown, recent-10 and recent-30 strips, latest latency value, animations, SSE refresh, and polling fallback.
- Never let an older detail response replace newer shared recent samples.
- Never clear a previously rendered chart while a background refresh is running.
- Keep each detail response internally consistent by requiring its top-level and timeline snapshot timestamps to match.

## Design

The shared `/api/metrics/nodes` snapshot and the per-node `/api/metrics/details` snapshot have different cache lifecycles. A complete detail response may therefore be slightly older than the newest shared aggregate snapshot even though it remains a valid chart snapshot.

The frontend will accept that complete detail response for chart rendering. Promotion into the shared recent-sample store remains guarded by the existing per-node snapshot and latest-sample comparisons, so the older detail response cannot roll back the recent-10 strip, recent-30 strip, or latest latency value.

When a newer detail response arrives, it replaces the older chart normally. Failed refreshes keep the last complete chart. Loading is shown only when no complete chart has ever been received for the selected node and window.

## Verification

- A regression test proves that a detail snapshot older than the global shared snapshot still populates the detail and timeline caches.
- The same test proves that newer shared recent samples are not replaced.
- Existing live-update, chart-interaction, type-check, and production-build verification remains green.
