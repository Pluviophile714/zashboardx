# zashboardx Metrics Helper Design

Date: 2026-07-04

## Goal

Add an optional R5S-side metrics helper for zashboardx so desktop and mobile browsers can read the same long-running proxy quality data.

mihomo/OpenClash remains the real proxy backend. The helper is only an indicator recorder. It should not own proxy routing, policy selection, subscription parsing, or dashboard setup.

The first useful outcome is a more honest and consistent 24h availability display:

- The current browser-local "本机24h" can remain as a fallback.
- When the helper is available, zashboardx can show "R5S 24h", coverage time, sample count, and failure count from one shared store.
- Loss rate stays optional. If mihomo later exposes a reliable lossrate API, the helper can ingest it without redesigning the UI.

## Non-Goals

- Do not replace mihomo as the backend.
- Do not require the helper for normal zashboardx usage.
- Do not store backend secrets in the repository, Docker image, committed compose files, or frontend bundle.
- Do not compute a strict packet loss percentage from free-form logs in phase 1.
- Do not make the proxy page heavier by streaming large timelines into every node card.

## Recommended Approach

Use a phased hybrid helper.

Phase 1 records active probe results. The helper periodically asks mihomo for proxy data and runs controlled delay checks for configured nodes or groups. It stores samples on the R5S and exposes a small read-only HTTP API. This gives stable cross-device 24h availability even when no browser is open.

Phase 2 adds log ingestion. The helper subscribes to mihomo logs and classifies timeout, dial failure, DNS, connection refused, and similar events. These events become supporting evidence in the detail popover, not the primary availability source.

Phase 3 adds official lossrate ingestion if mihomo/OpenClash exposes stable fields. Official lossrate should take priority over inferred values.

## Components

### zashboardx frontend

The existing static frontend stays lightweight.

It should optionally read helper metrics from the same origin:

- `/api/metrics/health`
- `/api/metrics/nodes`
- `/api/metrics/nodes/:encodedName`
- `/api/metrics/summary?window=24h`

If these requests fail or the helper is disabled, the UI falls back to the existing browser-local latency history. The proxy quality popover should not block rendering while waiting for helper metrics.

### zashboardx Caddy container

Caddy continues to serve the built static assets.

On the R5S deployment, Caddy can reverse proxy `/api/metrics/*` to the helper service inside Docker Compose. This keeps the browser on `http://192.168.8.2:2080` and avoids extra ports or CORS handling.

### zashboardx-metrics helper

The helper is a separate container, for example:

- Image: `ghcr.io/pluviophile714/zashboardx-metrics:latest`
- Internal port: `8787`
- Data volume: `/data`

Responsibilities:

- Connect to the configured mihomo API.
- Poll proxy and group metadata.
- Run scheduled delay checks with bounded concurrency.
- Store probe samples and optional log events.
- Return compact aggregated metrics to zashboardx.

Configuration should come from R5S-only environment variables:

- `MIHOMO_BASE_URL`
- `MIHOMO_SECRET`
- `PROBE_INTERVAL_SECONDS`
- `PROBE_CONCURRENCY`
- `PROBE_WINDOW_HOURS`
- `METRICS_RETENTION_DAYS`

The secret is stored only in `/opt/zashboardx/.env` on the R5S.

## Data Model

Use SQLite in phase 1. It is durable enough for R5S, simple to back up, and easy to query by time window.

Suggested tables:

- `nodes`: normalized node name, provider/group hints, last seen timestamp.
- `probe_samples`: node name, test URL, timestamp, delay milliseconds, success flag, error type.
- `log_events`: timestamp, node name if detected, level, category, raw message hash, short message.
- `metadata`: schema version and helper state.

Retention policy:

- Keep detailed samples for a configurable number of days, default 7 days.
- Aggregate 24h windows on read.
- Prune old records on a timer.

## API Shape

`GET /api/metrics/health`

Returns helper status:

```json
{
  "ok": true,
  "mihomoReachable": true,
  "lastProbeAt": "2026-07-04T12:00:00Z",
  "version": "0.1.0"
}
```

`GET /api/metrics/nodes?window=24h`

Returns compact metrics keyed by node name:

```json
{
  "windowSeconds": 86400,
  "nodes": {
    "HK-01": {
      "availability": 0.992,
      "coverageSeconds": 82800,
      "sampleCount": 276,
      "successCount": 274,
      "failureCount": 2,
      "avgDelay": 82,
      "minDelay": 48,
      "maxDelay": 260,
      "lastDelay": 76,
      "lastSuccessAt": "2026-07-04T11:59:00Z",
      "lastFailureAt": "2026-07-04T05:20:00Z",
      "lossRate": null,
      "lossSource": null
    }
  }
}
```

`lossSource` can later be `"official"`, `"probe"`, or `"log-inferred"`. In phase 1 it should normally be `null` unless we deliberately decide to label probe failure rate as a separate value.

## UI Integration

The existing proxy quality popover remains the main display surface.

When helper metrics exist for a node, show a shared R5S line near the existing availability line:

- `R5S 24h: 99.2% · 274/276`
- `覆盖 23 小时 · 失败 2 次`

If helper data is thin, make it clear:

- `R5S 24h: --`
- `覆盖 3 分钟 · 样本不足`

Keep the current browser-local line either as fallback or secondary text:

- `本机24h: 100.0% · 10/10`
- `覆盖 14 分钟 · 本机缓存`

The frontend should cache helper responses briefly, for example 10 to 30 seconds, and avoid fetching per card on hover. A page-level metrics store should fetch once and let cards read from memory. This protects mobile smoothness.

## Deployment

Keep the current GHCR flow.

The repository can build two images:

- `ghcr.io/pluviophile714/zashboardx:latest`
- `ghcr.io/pluviophile714/zashboardx-metrics:latest`

R5S Docker Compose can run both services:

- `zashboardx`: public port `2080:80`
- `zashboardx-metrics`: internal only, no host port

The install/update scripts should remain one-command friendly. Updating zashboardx should pull both images, recreate the stack, verify HTTP 200, and prune dangling images.

Users who do not want metrics can run only the static zashboardx image.

## Error Handling

- If mihomo is unreachable, keep serving the last stored metrics and mark helper health degraded.
- If the helper is unreachable, zashboardx falls back to browser-local metrics without visible errors.
- If the database is locked or corrupted, the helper should expose unhealthy status and avoid deleting the existing database automatically.
- If a node disappears, keep its historical samples until retention pruning removes them.
- If proxy names change, treat them as new nodes in phase 1.

## Performance Constraints

- Do not open a WebSocket per frontend client for metrics.
- Do not fetch helper metrics from every node card.
- Do not probe all nodes at high frequency without concurrency limits.
- Default probe interval should be conservative enough for R5S, such as 5 minutes.
- Store compact samples and aggregate on demand over indexed timestamps.
- Keep popover rendering based on already-loaded data.

## Security

- The helper API is intended for the LAN and should be read-only.
- The helper must never return the mihomo secret.
- The frontend bundle must not embed the mihomo secret.
- R5S secrets live in `.env` only.
- The helper should bind only inside Docker unless a user explicitly exposes it.

## Validation Plan

Before implementation is considered complete:

- Type-check and build zashboardx.
- Unit-test metric aggregation for empty, partial, full, and failure-heavy windows.
- Run the helper locally against a mocked mihomo API.
- Preview desktop and mobile proxy pages.
- Verify helper-disabled fallback behavior.
- Deploy to R5S only after preview approval.
- Confirm `http://192.168.8.2:2080/` returns HTTP 200.
- Confirm `/api/metrics/health` returns healthy or clearly degraded JSON.
- Run R5S image pruning after successful deployment.

## Phase 1 Decisions

- Runtime: use Node.js/TypeScript so the helper fits the current repository and GitHub Actions toolchain.
- Probe scope: default to leaf proxy nodes that appear in proxy/group candidates, excluding built-in entries such as `DIRECT`, `REJECT`, and strategy groups. Add include/exclude configuration later only if the default is too noisy.
- UI wording: show `R5S 24h` when helper metrics exist. Keep `本机24h` as secondary/fallback data only when it adds useful coverage context.
- Loss wording: keep `loss: --` unless official lossrate data exists. Probe failures should be labeled as failures or availability, not as packet loss.

## Proposed Phase 1 Scope

Build the helper as an optional Node.js/TypeScript service in this repository.

Implement:

- SQLite storage.
- Mihomo `/proxies` discovery.
- Scheduled bounded delay probing.
- Read-only metrics API.
- Caddy reverse proxy for `/api/metrics/*`.
- Frontend metrics store with short cache.
- Proxy popover display for shared R5S 24h availability.
- R5S compose/script updates.

Leave log parsing and official lossrate ingestion for later phases.
