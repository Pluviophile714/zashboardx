# Android App Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Android wrapper home route into a Neko Dash-inspired controller launcher without changing the existing web dashboard behavior.

**Architecture:** Keep `#/app` as an isolated native-app entry page. It reads and writes existing backend setup state, checks backend status with Mihomo/OpenClash endpoints, and routes into the existing dashboard pages after selection.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Tailwind utility classes, existing zashboard setup store, Capacitor Android wrapper.

---

## File Structure

- Modify: `src/views/AppLauncherPage.vue`
  - Owns the Android-only app launcher UI, status checks, add/edit sheet, and quick action navigation.
- Verify only: `src/router/index.ts`
  - Confirms native app mode still opens `#/app` and regular web mode still opens the normal dashboard/setup flow.
- Verify only: `src/helper/appMode.ts`
  - Confirms Capacitor and preview flags still control app mode.
- Verify only: `capacitor.config.ts`
  - Confirms Android wrapper still serves the built `dist` assets.

Commits are intentionally deferred until the user explicitly asks, because the current workspace already contains a larger Android packaging change set.

---

### Task 1: Refine Launcher View Model

**Files:**
- Modify: `src/views/AppLauncherPage.vue`

- [ ] **Step 1: Add status helpers and app copy**

Replace the existing `BackendStatus` type and nearby constants with:

```ts
type BackendStatus = {
  online: boolean
  checking?: boolean
  version?: string
  mode?: string
}

const appVersion = __APP_VERSION__
const commitId = __COMMIT_ID__
const backendStatus = reactive<Record<string, BackendStatus>>({})
const showAllControllers = ref(false)
const showForm = ref(false)
const submitting = ref(false)
const formMessage = ref('')
const editingUuid = ref('')
const networkHint = '离家使用时先开启 Clash Party / TUN，内网地址会按现有规则回家。'
const visibleBackends = computed(() =>
  showAllControllers.value ? backendList.value : backendList.value.slice(0, 3),
)
const hiddenControllerCount = computed(() => Math.max(backendList.value.length - visibleBackends.value.length, 0))
```

Expected: the page can distinguish checking, online, and offline state, and it shows up to three controller cards by default.

- [ ] **Step 2: Update status test state transitions**

Change `testBackend` so it sets a checking state before fetch, treats missing host or port as offline, and never logs secrets:

```ts
const testBackend = async (backend: Backend) => {
  if (!backend.host || !backend.port) {
    backendStatus[backend.uuid] = { online: false }
    return
  }

  backendStatus[backend.uuid] = { ...backendStatus[backend.uuid], checking: true, online: false }
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 2500)

  try {
    const headers = {
      Authorization: `Bearer ${backend.password}`,
    }
    const versionResponse = await fetch(`${getUrlFromBackend(backend)}/version`, {
      headers,
      signal: controller.signal,
    })

    if (!versionResponse.ok) {
      backendStatus[backend.uuid] = { online: false, checking: false }
      return
    }

    const versionData = await versionResponse.json()
    let mode = ''

    try {
      const configResponse = await fetch(`${getUrlFromBackend(backend)}/configs`, {
        headers,
        signal: controller.signal,
      })
      const configData = await configResponse.json()
      mode = configData.mode || ''
    } catch {
      mode = ''
    }

    backendStatus[backend.uuid] = {
      online: true,
      checking: false,
      version: versionData.version || '',
      mode,
    }
  } catch {
    backendStatus[backend.uuid] = { online: false, checking: false }
  } finally {
    window.clearTimeout(timeoutId)
  }
}
```

Expected: cards immediately show a checking state, then online or offline.

- [ ] **Step 3: Add display helper functions**

Add these helpers after `getControllerSubtitle`:

```ts
const getStatusText = (backend: Backend) => {
  const status = backendStatus[backend.uuid]
  if (!status || status.checking) return '检测中'
  return status.online ? '运行正常' : '离线'
}

const getModeText = (backend: Backend) => {
  const status = backendStatus[backend.uuid]
  if (!status?.online) return '等待连接'
  return status.mode || '规则模式'
}
```

Expected: template code can stay readable and avoids inline status conditionals everywhere.

---

### Task 2: Rebuild Neko-Style Home Template

**Files:**
- Modify: `src/views/AppLauncherPage.vue`

- [ ] **Step 1: Replace the top-level layout**

Replace the current `<template>` content with a light app shell:

```vue
<template>
  <div class="min-h-dvh w-full overflow-y-auto bg-[#f3f3f7] text-slate-950">
    <main class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      <header class="mb-5 flex items-center justify-between"></header>
      <section class="mb-4 rounded-2xl bg-sky-100/80 px-3.5 py-2.5 text-xs font-semibold text-sky-600"></section>
      <section class="flex flex-col gap-3"></section>
      <section class="mt-5 overflow-hidden rounded-[1.55rem] bg-white shadow-[0_12px_28px_rgba(15,23,42,0.07)]"></section>
      <p class="mt-auto pt-8 text-center text-xs font-semibold text-slate-300"></p>
    </main>
  </div>
</template>
```

Expected: the app page is visually isolated from the web dashboard background.

- [ ] **Step 2: Add the Neko-like header**

Inside `<main>`, add:

```vue
<header class="mb-5 flex items-center justify-between">
  <div class="flex items-center gap-3">
    <div class="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
      <img
        src="/pwa-192x192.png"
        class="h-6 w-6"
        alt="ZashboardX"
      />
    </div>
    <div>
      <h1 class="text-[2.4rem] leading-none font-black tracking-tight">ZashboardX</h1>
      <p class="mt-1 text-xs font-semibold text-slate-400">Android dashboard wrapper</p>
    </div>
  </div>
  <button
    class="flex h-11 w-11 items-center justify-center rounded-full bg-sky-100 text-sky-500 shadow-sm active:scale-95"
    aria-label="Add controller"
    @click="openCreateForm"
  >
    <PlusIcon class="h-6 w-6" />
  </button>
</header>
```

Expected: title and add button match the reference home screen proportions.

- [ ] **Step 3: Add the network hint bar**

Below the header, add:

```vue
<section class="mb-4 rounded-2xl bg-sky-100/80 px-3.5 py-2.5 text-xs font-semibold text-sky-600">
  <div class="flex items-center gap-2">
    <WifiIcon class="h-4 w-4 shrink-0" />
    <span class="min-w-0 truncate">{{ networkHint }}</span>
  </div>
</section>
```

Expected: off-home access remains visible without exposing the controller port publicly.

- [ ] **Step 4: Add controller cards**

Replace the controller list with:

```vue
<section class="flex flex-col gap-3">
  <button
    v-for="backend in visibleBackends"
    :key="backend.uuid"
    class="group rounded-[1.55rem] bg-white p-4 text-left shadow-[0_12px_28px_rgba(15,23,42,0.07)] transition active:scale-[0.99]"
    @click="openBackend(backend.uuid)"
  >
    <div class="flex items-center gap-4">
      <div
        class="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
        :class="backendStatus[backend.uuid]?.online ? 'bg-emerald-100' : 'bg-rose-100'"
      >
        <span
          class="h-5 w-5 rounded-full"
          :class="backendStatus[backend.uuid]?.online ? 'bg-emerald-500 shadow-[0_0_24px_rgba(16,185,129,0.85)]' : 'bg-rose-400 shadow-[0_0_20px_rgba(251,113,133,0.45)]'"
        />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h2 class="truncate text-lg font-black">
            {{ getControllerTitle(backend) }}
          </h2>
          <span
            v-if="backend.uuid === activeUuid"
            class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-500"
          >
            当前
          </span>
        </div>
        <p class="mt-1 truncate text-xs font-semibold text-slate-400">
          {{ getControllerSubtitle(backend) }}
        </p>
        <div class="mt-2 flex items-center gap-2 text-[11px] font-bold">
          <span :class="backendStatus[backend.uuid]?.online ? 'text-emerald-500' : 'text-rose-400'">
            {{ getStatusText(backend) }}
          </span>
          <span class="text-slate-300">·</span>
          <span class="text-emerald-500">{{ getModeText(backend) }}</span>
        </div>
      </div>
      <button
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-300 transition group-active:bg-slate-100"
        aria-label="Edit controller"
        @click.stop="openEditForm(backend.uuid)"
      >
        <EllipsisHorizontalIcon class="h-6 w-6" />
      </button>
    </div>
  </button>
</section>
```

Expected: controller list resembles the reference home cards and retains edit/open behavior.

- [ ] **Step 5: Keep empty, collapsed, quick action, and version sections**

Keep the empty state, collapsed controller toggle, quick action list, and version label, but ensure the collapse button uses `hiddenControllerCount`:

```vue
{{ showAllControllers ? '收起控制器' : `展开折叠的 ${hiddenControllerCount} 个控制器` }}
```

Expected: three or fewer controllers show by default, and the label remains correct.

---

### Task 3: Harden Sheet Form Behavior

**Files:**
- Modify: `src/views/AppLauncherPage.vue`

- [ ] **Step 1: Trim form values before testing**

In `saveController`, replace candidate construction with:

```ts
const candidate: Omit<Backend, 'uuid'> = {
  protocol: form.protocol,
  host: form.host.trim(),
  port: form.port.trim(),
  secondaryPath: form.secondaryPath.trim(),
  password: form.password,
  label: form.label.trim(),
}
```

Expected: accidental spaces in host, port, label, or path do not break connection.

- [ ] **Step 2: Use a temporary UUID that cannot collide**

Replace:

```ts
const id = editingUuid.value || 'pending'
```

with:

```ts
const id = editingUuid.value || '__pending_app_controller__'
```

Expected: status checks for a new controller do not collide with a real backend UUID.

- [ ] **Step 3: Clear temporary status after a successful new controller save**

After `addBackend(candidate)`, add:

```ts
delete backendStatus[id]
```

Expected: no stale temporary status remains after creating a controller.

---

### Task 4: Validate Android App Build

**Files:**
- Verify: `src/views/AppLauncherPage.vue`
- Verify: `capacitor.config.ts`
- Verify: `android/`

- [ ] **Step 1: Run type checking**

Run:

```powershell
pnpm run type-check
```

Expected: command exits with code `0`.

- [ ] **Step 2: Run web build**

Run:

```powershell
pnpm run build
```

Expected: command exits with code `0`. Vite large chunk warnings are acceptable.

- [ ] **Step 3: Sync Android wrapper**

Run:

```powershell
pnpm run android:sync
```

Expected: command exits with code `0` and Capacitor copies the latest `dist` assets into the Android project.

- [ ] **Step 4: Check diff hygiene**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors. Normal LF/CRLF warnings from Git are acceptable on Windows.
