# Upstream Zashboard 3.30 Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge official Zashboard `v3.30.0` changes into zashboardx while retaining the fork's Metrics Helper, Smart integration, and latency monitoring features.

**Architecture:** Use the current fork commit as the protected base and merge `upstream/main` in the isolated sync worktree. Review upstream deletions explicitly, restore fork-owned surfaces when necessary, then resolve shared-file conflicts with tests and the existing deployment workflow as the acceptance gates.

**Tech Stack:** Git, Vue 3, TypeScript, Vite, pnpm, Node test runner, GitHub Actions, Docker multi-arch images.

**Spec:** `docs/superpowers/specs/2026-11-05-upstream-3-30-sync-design.md`

## Global Constraints

- Target repository: `Pluviophile714/zashboardx`, branch `master`.
- Upstream baseline: `Zephyruso/zashboard` `v3.30.0` at `bf4f00bb8d905f8a78f627af7cf84457c4db53c4`.
- Preserve Metrics Helper, seven-day raw retention, SSE, latency strips, 1h/6h/24h charts, 7d chart, bucket inspection, and Smart behavior.
- Do not deploy until local verification and preview are complete.

## Review Focus

- Upstream deletion of fork-owned Metrics files must not become a silent feature removal.
- `src/views/ProxiesPage.vue`, proxy composables, and i18n must preserve fork behavior after upstream changes.
- The Metrics image workflow must continue to build `metrics-latest`.
- Android/DAE/upstream-only changes must not reintroduce unwanted sing-box or unrelated deployment changes.

---

### Task 1: Create a clean upstream merge checkpoint

**Files:**
- Modify: Git history and merge conflict files only

- [ ] **Step 1: Confirm the sync worktree has no tracked changes and preserve the two untracked preview screenshots.**
- [ ] **Step 2: Merge `upstream/main` with `--no-commit` so the full deletion/conflict set is inspectable.**
- [ ] **Step 3: Restore fork-owned Metrics files before resolving shared application files.**
- [ ] **Step 4: Review `git diff --name-status --diff-filter=D` and confirm no Metrics or Smart file remains deleted accidentally.**

### Task 2: Resolve shared frontend and workflow changes

**Files:**
- Modify: files reported by the merge conflict set, especially `src/views/ProxiesPage.vue`, proxy composables, i18n, `package.json`, `pnpm-lock.yaml`, and `.github/workflows/*.yml`

- [ ] **Step 1: Resolve shared files by retaining the latest compatible upstream behavior plus fork-specific integrations.**
- [ ] **Step 2: Check that the dashboard and Metrics package scripts still exist.**
- [ ] **Step 3: Run `git diff --check` and inspect the staged diff for accidental deletion of fork-owned files.**

### Task 3: Run the merged verification matrix

**Files:**
- Test: existing repository test suites and browser harness

- [ ] **Step 1: Run `pnpm install --frozen-lockfile`.**
- [ ] **Step 2: Run Metrics tests, frontend tests, type-check, and production build.**
- [ ] **Step 3: Run the virtual-list/collapse/popover smoke checks at desktop and mobile widths.**
- [ ] **Step 4: Verify the Metrics Dockerfile builds against the merged workspace.**
- [ ] **Step 5: Record the upstream commit, preserved files, test outputs, and release status in the engineering log.**

### Task 4: Prepare but do not deploy the release

**Files:**
- Modify: Git history and release metadata only after verification

- [ ] **Step 1: Commit the rollup/7d implementation and upstream sync as reviewable commits.**
- [ ] **Step 2: Push `master` only after the local preview is available and the deployment workflow is known to build both images.**
- [ ] **Step 3: Wait for GitHub Actions and verify the dashboard and Metrics image artifacts before any R5S update.**
- [ ] **Step 4: Preserve the R5S Metrics data mount during the eventual deployment.**
