# Mobile Latency Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move compact 24h details outside the plot and add touch inspection to the compact R5S recent-30 latency strip.

**Architecture:** Keep Metrics data and chart geometry unchanged. Add pure interaction helpers for testable compact-mode selection, then let the existing DOM renderers use those helpers while preserving desktop branches.

**Tech Stack:** Vue 3, TypeScript, native DOM/SVG, Tailwind/DaisyUI, Node test runner.

## Global Constraints

- Do not change Metrics collection, source identity, sample ordering, availability, or manual latency testing.
- Do not change desktop tooltip placement or the desktop detail list.
- Compact interaction must not close the popover or increase recent-30 layout height.
- Empty leading recent-30 slots must never display fabricated sample data.

---

### Task 1: Add Testable Mobile Selection Rules

**Files:**
- Create: `src/helper/latencySampleSelection.ts`
- Test: `src/helper/__tests__/latencySampleSelection.test.ts`
- Modify: `src/helper/proxyMetricsTimeline.ts`
- Test: `src/helper/__tests__/proxyMetricsTimeline.test.ts`

**Interfaces:**
- Produces: `getLatencySampleIndexAtPointer(clientX, left, width, itemCount): number | null`.
- Produces: `getProxyMetricsTimelineTooltipMode(compact): 'outside' | 'overlay'`.

- [ ] **Step 1: Write failing tests for compact mode and pointer boundaries**
- [ ] **Step 2: Run focused tests and verify missing exports fail**
- [ ] **Step 3: Implement the minimal pure helpers**
- [ ] **Step 4: Run focused tests and verify they pass**

### Task 2: Integrate Compact DOM Interactions

**Files:**
- Modify: `src/components/proxies/latencyTimelineChart.ts`
- Modify: `src/components/proxies/ProxyNodeCard.vue`
- Test: `src/helper/__tests__/proxyNodeCardLayout.test.ts`

**Interfaces:**
- Consumes: Task 1 helper functions.
- Preserves: existing desktop overlay tooltip, Tippy boundary handling, and desktop sample list.

- [ ] **Step 1: Append compact 24h readout after the SVG body and initialize it from the newest sampled bucket**
- [ ] **Step 2: Bind compact recent-30 pointer down/move/up/cancel to the existing summary row**
- [ ] **Step 3: Restore summary after 1000ms and ignore empty slots**
- [ ] **Step 4: Run helper tests, type-check, build, and `git diff --check`**
- [ ] **Step 5: Preview mobile and desktop layouts before any push or deployment**
