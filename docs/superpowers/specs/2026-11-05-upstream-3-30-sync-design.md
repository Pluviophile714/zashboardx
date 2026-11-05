# Upstream Zashboard 3.30 Synchronization Design

**Date:** 2026-11-05

## Intent

Bring `Pluviophile714/zashboardx` up to the official `Zephyruso/zashboard`
`v3.30.0` baseline while keeping the fork's user-facing and R5S-specific
features intact.

## Goals

- Adopt safe upstream changes through `upstream/main` at
  `bf4f00bb8d905f8a78f627af7cf84457c4db53c4`.
- Keep the fork's custom Metrics Helper and all latency monitoring behavior.
- Keep Smart-weight display and compatibility behavior.
- Keep the R5S install/update workflow and Metrics image workflow.
- Record any intentionally retained fork-only files and any upstream changes
  that could not be adopted because they conflict with those features.

## Non-goals

- Do not delete the Metrics Helper because upstream no longer ships it.
- Do not restore sing-box or other features the user previously chose not to
  use unless they are required by the upstream merge.
- Do not deploy or replace the R5S image before local tests and preview.

## Merge strategy

The current fork commit is the protected base. Merge `upstream/main` in the
isolated sync worktree, resolve ordinary conflicts in favor of compatible
upstream behavior, and explicitly restore fork-owned Metrics files when the
upstream side deletes them. Review every deletion in `packages/metrics-helper`,
`src/api/metricsHelper.ts`, `src/store/proxyMetrics.ts`, the latency chart
renderer, and the ProxyNodeCard integration before committing.

The merge is complete only when the fork still builds as both the dashboard and
the Metrics helper image, and when the custom regression suites pass.

## Release boundary

The synchronization branch may be committed locally first. Push to
`Pluviophile714/zashboardx:master` only after the 7d/rollup implementation and
the upstream merge pass verification. GitHub Actions must build both image
artifacts; the R5S database mount must be preserved during any later deployment.
