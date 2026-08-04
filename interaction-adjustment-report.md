# Latency Interaction Adjustment Report

Date: 2026-08-04
Base behavior: e437c6e
Round 2 fix: separate follow-up commit after `ecb0d0c`

## Round 2 Evidence

The activation mode is now derived from input capability rather than the compact
layout breakpoint. `getLatencyTimelineInputMode()` checks
`matchMedia('(pointer: coarse)')` with browser guards and falls back to
`navigator.maxTouchPoints`. Fine-pointer input uses the chart-wide guide hit
layer, so narrow desktop windows still activate from a stationary click at the
current guide bucket. Coarse-pointer input uses the populated information card,
so wide or landscape touch layouts still card-tap.

The chart guide follows the fine-pointer mouse position and the hit layer maps
the stationary click to the current guide bucket. Chart drag remains selection
only and suppresses the following generated click. Empty buckets remain blocked.
The information card remains display-only for fine-pointer input and is the
coarse-pointer activation surface.

Mobile card pointer and touch start, move, cancel, and end handlers call
`onInteraction()`, preserving the active drilldown eight-second reset timer
during relevant card gestures. Existing range controls, stale guards, recent-30
fallback, all-bucket records, mobile strip behavior, outside close, and first
level R5S final-10 consistency remain unchanged.

## Verification

- Focused executable tests: 53 passed, 0 failed.
- `pnpm run type-check`: passed.
- `pnpm exec eslint src`: passed.
- Targeted Prettier check: passed.
- `pnpm run build`: passed.
- `git diff --check`: passed.

The build retains existing Rollup annotation, chunk-size, and dynamic-import
warnings. Full `pnpm exec eslint .` remains affected by 5,138 pre-existing
errors in generated Android/PWA assets under
`android/app/src/main/assets/public`; the edited source tree passes lint.
