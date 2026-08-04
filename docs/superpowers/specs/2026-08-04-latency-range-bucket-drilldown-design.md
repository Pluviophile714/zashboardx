# Latency Range And Bucket Drilldown Design

## Goal

Extend the existing node latency popover with two related capabilities:

1. Switch the latency chart between 1 hour, 6 hours, and 24 hours.
2. Drill into a selected chart bucket and inspect its raw probe samples in the existing latency-bar area.

The change must preserve the existing 24-hour availability calculation, metrics collection, Smart/Fallback identity handling, manual latency testing, and historical SQLite data.

## User Experience

### Time Range

- The popover always opens on `24h`.
- A compact `1h / 6h / 24h` segmented control appears beside the latency chart title.
- Closing the popover resets the range to `24h`; the choice is not persisted.
- The first-level card availability remains a 24-hour value regardless of chart range.
- Chart windows and bucket sizes are fixed:
  - `1h`: 60 one-minute buckets.
  - `6h`: 72 five-minute buckets.
  - `24h`: 96 fifteen-minute buckets.
- The existing average line, min/max range, failures, success counts, and jitter are calculated independently inside each bucket. A bucket with fewer than two successful samples reports no jitter.

### Bucket Selection And Drilldown

- Pointer movement or touch movement over the chart selects a bucket and updates the existing bucket information card.
- A stationary click/tap on the selected chart point activates a populated bucket. Empty buckets do not enter drilldown.
- Activating the chart point replaces the normal `R5S recent 30` latency strip with all raw samples whose timestamps fall inside the selected bucket.
- The drilldown title shows the exact interval and actual record count, for example `15:45-16:00 · 17 records`. It must not assume that a 15-minute bucket always contains 15 records.
- Raw samples remain ordered oldest to newest. Success and failure use the same colors and semantics as the existing recent-sample strip.
- Pointer/touch movement across the drilldown strip shows the selected sample timestamp, delay, and result using the existing sample inspector.
- A second activation of the selected chart point exits drilldown immediately.
- Eight seconds without chart or latency-strip interaction exits drilldown and restores `R5S recent 30`.
- Any relevant interaction restarts the eight-second timer.
- Closing or destroying the popover clears timers, exits drilldown, and resets the chart to `24h`.

### Latency Strip Layout

- The strip keeps its current height and does not increase popover height.
- Up to 30 bucket samples use the existing 30 stable tracks, with unsampled tracks rendered as placeholders.
- If a bucket contains more than 30 raw records, all records remain visible as compact equal-width tracks; records are not silently discarded.
- The normal non-drilldown state remains the latest 30 R5S records.

### First-Level Card Consistency

- Once the R5S recent-sample response for a node is cached, the first-level 10-segment latency bar uses the final 10 samples from that same response.
- These 10 segments therefore correspond exactly to the rightmost 10 records in the normal second-level strip.
- Before an R5S sample response is available, the first-level bar continues to use the current browser/Mihomo history as a nonblank fallback.
- This change does not alter the current latency number or manual latency-test behavior.

## Backend And API

### Storage

- Reuse the existing `probe_samples` table and its `(node_name, timestamp)` index.
- No table, column, migration, retention, or collection-frequency change is required.
- Existing historical samples become immediately available to all three ranges and bucket drilldown.

### Timeline Endpoint

- Extend `GET /api/metrics/timeline` to accept `window=1h`, `window=6h`, and `window=24h`.
- The server chooses the fixed window duration, bucket count, and bucket duration from an allowlist; clients cannot provide arbitrary aggregation sizes.
- The response retains the current schema and returns the selected `windowSeconds`, `bucketSeconds`, ordered buckets, and generated timestamp.
- Existing `window=24h` behavior remains backward compatible.

### Bucket Samples Endpoint

- Add `GET /api/metrics/bucket-samples?node=...&start=...&end=...`.
- `start` and `end` must be valid ISO timestamps, `start < end`, and the interval must not exceed 15 minutes.
- The result contains every raw row in the half-open interval `[start, end)`, ordered by timestamp and database id.
- A conservative server maximum prevents unbounded responses. Reaching that maximum returns an explicit truncated flag rather than silently pretending the result is complete.
- Responses use `Cache-Control: no-store`, matching current metrics detail requests.

## Frontend State And Data Flow

- Timeline cache keys continue to include node name and selected window.
- Bucket-sample cache keys include node name, bucket start, and bucket end.
- Selecting a range requests only that timeline. Selecting a bucket does not request raw data until the selected chart point is activated.
- A drilldown request uses generation tokens so a late response from a previous node, range, or bucket cannot replace the current popover.
- The existing recent-30 cache and refresh behavior remain unchanged.
- Desktop mouse and mobile touch share the same state machine; only their input events differ.

## Failure Handling

- A failed range request leaves the current successful chart visible and marks the requested range unavailable; it does not blank the popover.
- A failed bucket-sample request leaves `R5S recent 30` visible and does not enter drilldown.
- An empty bucket cannot issue a drilldown request.
- A bucket that contains only failures is still drillable and shows those failures.
- Missing jitter remains `--` and is not converted to zero.

## Performance

- All reads use the existing `(node_name, timestamp)` index.
- Timeline requests aggregate only the selected window.
- Raw bucket samples are fetched on demand for one node and at most 15 minutes.
- No all-node raw-sample payload is added to the 24-hour aggregate endpoint.

## Verification

- Storage tests cover 1h, 6h, and 24h bucket boundaries and counts.
- Timeline API tests cover allowed ranges, invalid ranges, and backward-compatible 24h responses.
- Bucket-sample API tests cover half-open boundaries, ordering, Unicode node names, empty results, validation, and response limits.
- Frontend tests cover range cache keys, stale-response protection, drilldown entry/exit, actual record counts, more than 30 records, and eight-second inactivity reset.
- Layout tests cover the segmented control and unchanged popover height on desktop and mobile.
- Regression tests verify that the first-level final 10 segments use the same cached R5S samples as the second-level recent-30 strip.
- Final validation includes type checking, metrics-helper tests, frontend helper tests, production build, and desktop/mobile browser inspection.

## Interaction Adjustment

- The chart is the drilldown activation target: horizontal sliding selects a time bucket, and a stationary tap/click on the selected chart point enters that bucket's raw-record view.
- The bucket information card remains display-only and shows the selected bucket's interval and aggregate statistics.
- A drag must never activate the bucket; only a stationary chart click/tap can do so.
