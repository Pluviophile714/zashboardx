# Kuma-Style Latency Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the first-level latency strip synchronized with the second-level recent-30 history and animate only newly appended real samples.

**Architecture:** Store the latest 30 raw samples once in `proxyMetricsSamplesMap`. Both UI strips derive from that cache. A small pure helper compares ordered sample identities and reports whether the update is unchanged, replaced, or appended so Vue can animate only the appended case.

**Tech Stack:** Vue 3, TypeScript, Node test runner, Tailwind CSS.

## Global Constraints

- Do not add WebSocket, SSE, or a new backend endpoint.
- Keep the second-level detail behavior and mobile interaction unchanged.
- Respect reduced-motion preferences.

---

### Task 1: Shared Recent-Sample Window

**Files:**
- Create: `src/helper/proxyMetricsRecentSamples.ts`
- Create: `src/helper/__tests__/proxyMetricsRecentSamples.test.ts`
- Modify: `src/store/proxyMetrics.ts`

**Interfaces:**
- Produces: `getProxyMetricsSampleIdentity(sample)`, `classifyRecentSampleUpdate(previous, next)`.
- Update classification: `initial | unchanged | appended | replaced`.

- [ ] Write failing tests for unchanged responses, one appended sample, and non-tail replacement.
- [ ] Run `node --test src/helper/__tests__/proxyMetricsRecentSamples.test.ts` and confirm missing-module failure.
- [ ] Implement the pure comparison helper.
- [ ] Update `refreshProxyMetricsSamples` to preserve the cached array for unchanged responses and expose the update classification.
- [ ] Run the helper tests and existing Metrics frontend tests.

### Task 2: One Source for Both Strips

**Files:**
- Modify: `src/components/proxies/ProxyNodeCard.vue`
- Modify: `src/helper/__tests__/proxyNodeCardLayout.test.ts`

**Interfaces:**
- Consumes: the `24h / 30 / node` sample cache entry.
- Produces: first-level history equal to `recent30.slice(-10)`.

- [ ] Add a failing source-level regression test that rejects `metrics.recentSamples` as a first-level source.
- [ ] Run the focused layout test and confirm the old fallback fails it.
- [ ] Remove the aggregated recent-sample fallback from the first-level strip.
- [ ] Keep the local Mihomo history fallback only when Metrics raw samples are unavailable.
- [ ] Run the focused layout tests.

### Task 3: Polling and Animation

**Files:**
- Modify: `src/views/ProxiesPage.vue`
- Modify: `src/components/proxies/ProxyNodeCard.vue`
- Modify: `src/helper/__tests__/proxyNodeCardLayout.test.ts`

**Interfaces:**
- Poll the existing recent-sample endpoint without changing backend contracts.
- Animate only an `appended` update after initial data is already present.

- [ ] Add failing tests for periodic raw-sample refresh and appended-only animation classes.
- [ ] Run the focused tests and confirm failure.
- [ ] Add stable polling tied to the proxies page lifecycle.
- [ ] Add a 250ms first-level slide animation with reduced-motion handling.
- [ ] Run focused tests and all frontend helper tests.

### Task 4: Full Verification

**Files:**
- Verify only.

- [ ] Run `pnpm run metrics:test`.
- [ ] Run `node --test src/helper/__tests__/*.test.ts`.
- [ ] Run `pnpm run type-check`.
- [ ] Run `pnpm run build`.
- [ ] Run `git diff --check` and inspect the local preview.
