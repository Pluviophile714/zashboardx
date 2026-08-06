# Kuma-Style Latency Strip Design

## Goal

Make the first-level 10-segment latency strip and the second-level recent-30 strip show the same ordered probe samples, while adding a short left-slide animation only when a new real sample arrives.

## Data Model

- `proxyMetricsSamplesMap` is the single source of truth for recent raw samples.
- Each node keeps the latest 30 samples from `/api/metrics/samples?window=24h&limit=30`.
- The second-level strip renders all 30 samples.
- The first-level strip renders `samples.slice(-10)` from the same cache entry.
- Aggregated `/api/metrics/nodes` data remains responsible for availability and summary statistics, but no longer supplies the first-level strip.

## Refreshing

- The proxies page refreshes recent samples for visible Metrics nodes on a stable interval.
- A response replaces the shared 30-sample array only when its ordered sample identity changes.
- Opening the detail popover may force a refresh, but it updates the same shared array instead of switching sources.
- No new sample means no strip movement and no animation.

## Animation

- Detect a newly appended sample from the previous and next sample identity lists.
- Apply a 250ms transform transition to the first-level strip.
- Respect `prefers-reduced-motion` and render immediately when motion is reduced.
- Initial loading and cache replacement do not animate.

## Validation

- Regression tests prove the first-level strip is derived from the recent-30 cache only.
- Regression tests prove identical responses preserve array identity and do not request animation.
- Regression tests prove one appended sample requests one animation.
- Existing Metrics helper tests, frontend helper tests, type checking, and production build must pass.
