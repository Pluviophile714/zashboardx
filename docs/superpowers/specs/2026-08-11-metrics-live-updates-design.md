# Metrics Live Updates Design

**Goal:** Make proxy metrics update immediately after a new shared snapshot is ready while preserving the existing snapshot-based consistency and polling fallback.

## Decisions

- The existing `snapshotAt` remains the consistency boundary. Samples and timelines are never merged from different snapshots.
- The Metrics helper exposes a same-origin Server-Sent Events endpoint at `/api/metrics/events`.
- The helper emits `snapshot_ready` only after the aggregation cache has installed a new snapshot.
- The frontend keeps the current 30-second polling loop as a fallback and uses the event stream to trigger a forced refresh when the event snapshot is newer.
- Event-stream failure is non-fatal. The page continues to use polling and reports live connectivity separately from metrics availability.
- The first implementation exposes freshness through the existing metrics request state and the latest snapshot timestamp; no new first-level card text is added.

## Data Flow

1. Mihomo history and fallback probes are written into SQLite.
2. `MetricsAggregationCache` refreshes the requested snapshot in its existing worker.
3. After the snapshot is installed, `MetricsUpdateHub` publishes its `snapshotAt`.
4. `proxyMetrics.ts` receives the event, ignores older snapshots, and forces the existing shared 24h refresh.
5. Open detail cards observe the existing `proxyMetricsUpdatedAt` and refresh their current window through the existing detail endpoint.

## Reliability

- SSE clients receive a `ready` event and periodic comments to keep reverse proxies alive.
- The server removes clients on connection close and never blocks metric collection on a client.
- `EventSource` automatically reconnects. The existing page timer remains active so a failed stream cannot stop updates.
- Updates are idempotent because the frontend compares normalized snapshot timestamps before refreshing.

## Scope Exclusions

- No second metrics database or frontend cache.
- No change to the 1h/6h/24h chart geometry.
- No deployment or R5S configuration change in this feature itself.

## Detail Loading Performance Follow-up

- Probe-round SQLite writes run in a dedicated worker so the HTTP event loop remains responsive while hundreds of Mihomo nodes are persisted.
- The worker uses the existing `MetricsStorage` methods and one transaction per phase; deduplication, fallback collapsing, retention, and timestamps keep their current semantics.
- Detail responses use a shared cache keyed by node, window, and sample limit. The first request is computed in a read-only worker; later requests return the last complete snapshot immediately while a dirty snapshot refreshes in the background.
- Cached detail keys are refreshed as soon as a probe round finishes. The existing aggregate snapshot SSE remains the frontend freshness signal, so an open card normally receives a ready detail snapshot by the time it reacts to the event.
- A failed frontend refresh never removes the last successful chart. When no chart exists yet, the active card retries with bounded backoff instead of requiring the user to leave and hover again.
