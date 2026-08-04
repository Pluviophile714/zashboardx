# Interaction Adjustment Report

Date: 2026-08-04
Base: e437c6e

## Status

Implemented the approved device-specific bucket activation behavior without changing data or state semantics.

- Desktop mouse movement positions the vertical guide at the pointer's clamped SVG x-coordinate.
- Desktop uses a chart-wide transparent plot hit layer. Its click x-coordinate resolves the current guide bucket.
- Mobile chart touch movement remains selection-only; a populated information card is the activation target.
- Empty buckets do not activate.
- Drag and cancellation suppress the following synthetic click on the applicable activation surface.
- Desktop cards remain display-only. Mobile cards retain their actionable accessibility and tap behavior.
- Timeline range, drilldown cache, stale guards, eight-second reset, recent-30 fallback, all-record rendering, mobile strip behavior, outside close, and first-level R5S final-10 behavior were not changed.

## Tests

- `node --test src/helper/__tests__/proxyMetricsTimeline.test.ts src/helper/__tests__/proxyNodeCardLayout.test.ts src/helper/__tests__/latencySampleSelection.test.ts src/helper/__tests__/latencyDetailsViewport.test.ts src/helper/__tests__/latencyBucketDrilldown.test.ts`
  - 49 passed, 0 failed.
- `pnpm run type-check` passed.
- `pnpm exec eslint src` passed.
- Targeted Prettier check passed.
- `pnpm run build` passed; existing Rollup chunk and annotation warnings remain.
- `git diff --check` passed.

## Concerns

- `pnpm exec eslint .` still reports 5,138 errors in pre-existing generated Android/PWA assets under `android/app/src/main/assets/public`. The edited source tree passes `pnpm exec eslint src`.
- No live browser/device session was run in this adjustment; executable DOM interaction tests cover desktop guide-layer activation, mobile card activation, empty blocking, stationary input, and drag suppression.

## Commit

The final commit containing this report is returned with the task result.
