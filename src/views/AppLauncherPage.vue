<template>
  <div class="min-h-dvh w-full overflow-y-auto bg-[#f3f3f7] text-slate-950">
    <main
      class="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]"
    >
      <header class="mb-5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
          >
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
          type="button"
          class="flex h-11 w-11 items-center justify-center rounded-full bg-sky-100 text-sky-500 shadow-sm active:scale-95"
          aria-label="Add controller"
          @click="openCreateForm"
        >
          <PlusIcon class="h-6 w-6" />
        </button>
      </header>

      <section
        class="mb-4 rounded-2xl bg-sky-100/80 px-3.5 py-2.5 text-xs font-semibold text-sky-600"
      >
        <div class="flex items-center gap-2">
          <WifiIcon class="h-4 w-4 shrink-0" />
          <span class="min-w-0 truncate">{{ networkHint }}</span>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <article
          v-for="backend in visibleBackends"
          :key="backend.uuid"
          class="rounded-[1.55rem] bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.07)]"
        >
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-4 rounded-[1.2rem] text-left transition outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.99]"
              :aria-label="`打开 ${getControllerTitle(backend)}`"
              @click="openBackend(backend.uuid)"
            >
              <div
                class="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
                :class="backendStatus[backend.uuid]?.online ? 'bg-emerald-100' : 'bg-rose-100'"
              >
                <span
                  class="h-5 w-5 rounded-full"
                  :class="
                    backendStatus[backend.uuid]?.online
                      ? 'bg-emerald-500 shadow-[0_0_24px_rgba(16,185,129,0.85)]'
                      : 'bg-rose-400 shadow-[0_0_20px_rgba(251,113,133,0.45)]'
                  "
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
                  <span
                    :class="
                      backendStatus[backend.uuid]?.online ? 'text-emerald-500' : 'text-rose-400'
                    "
                  >
                    {{ getStatusText(backend) }}
                  </span>
                  <span class="text-slate-300">·</span>
                  <span class="text-emerald-500">
                    {{ getModeText(backend) }}
                  </span>
                </div>
              </div>
            </button>
            <button
              type="button"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-300 transition focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:bg-slate-100"
              aria-label="Edit controller"
              @click="openEditForm(backend.uuid)"
            >
              <EllipsisHorizontalIcon class="h-6 w-6" />
            </button>
          </div>
        </article>

        <button
          v-if="backendList.length === 0"
          type="button"
          class="rounded-[1.55rem] border border-dashed border-slate-300 bg-white/80 p-6 text-center text-slate-400 shadow-[0_12px_28px_rgba(15,23,42,0.05)]"
          @click="openCreateForm"
        >
          <PlusIcon class="mx-auto mb-2 h-8 w-8 text-sky-400" />
          <div class="font-semibold text-slate-600">添加 Clash / OpenClash 控制器</div>
          <div class="mt-1 text-xs">推荐先填主路由内网地址，再用 Clash Party 回家访问。</div>
        </button>
      </section>

      <button
        v-if="showAllControllers || hiddenControllerCount > 0"
        type="button"
        class="my-4 flex items-center justify-center gap-1 text-sm font-medium text-slate-400"
        @click="showAllControllers = !showAllControllers"
      >
        <ChevronDownIcon
          class="h-4 w-4 transition"
          :class="showAllControllers && 'rotate-180'"
        />
        {{ showAllControllers ? '收起控制器' : `展开折叠的 ${hiddenControllerCount} 个控制器` }}
      </button>

      <section
        class="mt-5 overflow-hidden rounded-[1.55rem] bg-white shadow-[0_12px_28px_rgba(15,23,42,0.07)]"
      >
        <button
          v-for="item in quickActions"
          :key="item.label"
          type="button"
          class="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-4 text-left last:border-b-0 active:bg-slate-50"
          @click="openQuickAction(item.route)"
        >
          <div
            class="flex h-9 w-9 items-center justify-center rounded-xl"
            :class="item.color"
          >
            <component
              :is="item.icon"
              class="h-5 w-5"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="font-bold">{{ item.label }}</div>
            <div class="truncate text-xs text-slate-400">{{ item.description }}</div>
          </div>
          <ChevronRightIcon class="h-5 w-5 text-slate-300" />
        </button>
      </section>

      <p class="mt-auto pt-8 text-center text-xs font-medium text-slate-300">
        Ver. {{ appVersion }}{{ commitId ? ` · ${commitId}` : '' }}
      </p>
    </main>

    <div
      v-if="showForm"
      class="fixed inset-0 z-50 flex items-end bg-black/45 px-3 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur-sm"
      @click.self="closeForm()"
    >
      <div
        class="max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1.75rem)] w-full overflow-y-auto rounded-[2rem] bg-white px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-slate-950 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-controller-form-title"
      >
        <div class="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />
        <div class="mb-4 flex items-center justify-between">
          <h2
            id="app-controller-form-title"
            class="text-xl font-black"
          >
            {{ editingUuid ? '编辑控制器' : '添加控制器' }}
          </h2>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-400 disabled:opacity-50"
            aria-label="关闭控制器表单"
            :disabled="submitting"
            @click="closeForm()"
          >
            <XMarkIcon class="h-5 w-5" />
          </button>
        </div>

        <div class="grid grid-cols-[6rem_1fr] gap-2">
          <select
            v-model="form.protocol"
            class="rounded-2xl bg-slate-100 px-3 py-3 text-sm font-semibold outline-none"
            aria-label="控制器协议"
          >
            <option value="http">http</option>
            <option value="https">https</option>
          </select>
          <input
            v-model="form.host"
            class="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold outline-none"
            aria-label="控制器地址"
            placeholder="192.168.8.1"
          />
          <input
            v-model="form.port"
            class="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold outline-none"
            aria-label="控制器端口"
            placeholder="9090"
          />
          <input
            v-model="form.label"
            class="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold outline-none"
            aria-label="控制器名称"
            placeholder="OpenClash 主路由"
          />
          <input
            v-model="form.secondaryPath"
            class="col-span-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold outline-none"
            aria-label="Secondary path"
            placeholder="secondary path，可留空"
          />
          <input
            v-model="form.password"
            type="password"
            class="col-span-2 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold outline-none"
            aria-label="控制器密钥"
            placeholder="secret"
          />
        </div>

        <p
          v-if="formMessage"
          class="mt-3 rounded-2xl bg-rose-50 px-4 py-2 text-sm font-medium text-rose-500"
          aria-live="polite"
        >
          {{ formMessage }}
        </p>

        <div class="mt-5 grid grid-cols-[1fr_auto] gap-3">
          <button
            type="button"
            class="rounded-2xl bg-sky-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-sky-200 disabled:opacity-60"
            :disabled="submitting"
            @click="saveController"
          >
            {{ submitting ? '正在连接…' : '保存并连接' }}
          </button>
          <button
            v-if="editingUuid"
            type="button"
            class="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-500 disabled:opacity-50"
            :disabled="submitting"
            @click="deleteController"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ROUTE_NAME } from '@/constant'
import { getUrlFromBackend } from '@/helper/utils'
import router from '@/router'
import { activeUuid, addBackend, backendList, removeBackend, updateBackend } from '@/store/setup'
import type { Backend } from '@/types'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  GlobeAltIcon,
  PlusIcon,
  SwatchIcon,
  WifiIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'
import { computed, onMounted, reactive, ref } from 'vue'

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
const pendingControllerUuid = '__pending_app_controller__'
const visibleBackends = computed(() =>
  showAllControllers.value ? backendList.value : backendList.value.slice(0, 3),
)
const hiddenControllerCount = computed(() =>
  Math.max(backendList.value.length - visibleBackends.value.length, 0),
)
const form = reactive<Omit<Backend, 'uuid'>>({
  protocol: 'http',
  host: '192.168.8.1',
  port: '9090',
  secondaryPath: '',
  password: '',
  label: 'OpenClash 主路由',
})

const quickActions = [
  {
    label: '网页访问',
    description: '打开 ZashboardX 面板',
    route: ROUTE_NAME.proxies,
    icon: GlobeAltIcon,
    color: 'bg-violet-50 text-violet-500',
  },
  {
    label: '全局配置',
    description: '查看后端、显示和面板设置',
    route: ROUTE_NAME.settings,
    icon: Cog6ToothIcon,
    color: 'bg-sky-50 text-sky-500',
  },
  {
    label: '运行日志',
    description: '查看 Clash / Mihomo 日志',
    route: ROUTE_NAME.logs,
    icon: DocumentTextIcon,
    color: 'bg-amber-50 text-amber-500',
  },
  {
    label: '代理策略',
    description: '管理代理组和节点',
    route: ROUTE_NAME.proxies,
    icon: SwatchIcon,
    color: 'bg-emerald-50 text-emerald-500',
  },
]

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
    const version = typeof versionData.version === 'string' ? versionData.version.trim() : ''

    if (!version) {
      backendStatus[backend.uuid] = { online: false, checking: false }
      return
    }

    let mode = ''

    try {
      const configResponse = await fetch(`${getUrlFromBackend(backend)}/configs`, {
        headers,
        signal: controller.signal,
      })
      if (configResponse.ok) {
        const configData = await configResponse.json()
        mode = typeof configData.mode === 'string' ? configData.mode : ''
      }
    } catch {
      mode = ''
    }

    backendStatus[backend.uuid] = {
      online: true,
      checking: false,
      version,
      mode,
    }
  } catch {
    backendStatus[backend.uuid] = { online: false, checking: false }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const refreshBackends = () => {
  backendList.value.forEach((backend) => {
    testBackend(backend)
  })
}

const getControllerTitle = (backend: Backend) => {
  return backend.label || backend.host
}

const getModeLabel = (mode?: string) => {
  const normalizedMode = mode?.trim()
  const modeLabels: Record<string, string> = {
    direct: '直连模式',
    global: '全局模式',
    rule: '规则模式',
  }

  if (!normalizedMode) return '规则模式'
  return modeLabels[normalizedMode.toLowerCase()] || normalizedMode
}

const getControllerSubtitle = (backend: Backend) => {
  const status = backendStatus[backend.uuid]
  const base = `${backend.host}:${backend.port}`

  if (!status) return `${base} · 检测中`
  if (status.checking) return `${base} · 检测中`
  if (!status.online) return `${base} · 离线`

  return [base, status.version || 'Mihomo', getModeLabel(status.mode)].join(' · ')
}

const getStatusText = (backend: Backend) => {
  const status = backendStatus[backend.uuid]
  if (!status || status.checking) return '检测中'
  return status.online ? '运行正常' : '离线'
}

const getModeText = (backend: Backend) => {
  const status = backendStatus[backend.uuid]
  if (!status || status.checking) return '检测中'
  if (!status.online) return '等待连接'
  return getModeLabel(status.mode)
}

const openBackend = (uuid: string) => {
  activeUuid.value = uuid
  router.push({ name: ROUTE_NAME.proxies })
}

const openQuickAction = (route: ROUTE_NAME) => {
  if (!activeUuid.value && backendList.value[0]) {
    activeUuid.value = backendList.value[0].uuid
  }

  router.push({ name: route })
}

const resetForm = () => {
  form.protocol = 'http'
  form.host = '192.168.8.1'
  form.port = '9090'
  form.secondaryPath = ''
  form.password = ''
  form.label = 'OpenClash 主路由'
  formMessage.value = ''
  editingUuid.value = ''
}

const openCreateForm = () => {
  resetForm()
  showForm.value = true
}

const openEditForm = (uuid: string) => {
  const backend = backendList.value.find((item) => item.uuid === uuid)

  if (!backend) return

  form.protocol = backend.protocol
  form.host = backend.host
  form.port = backend.port
  form.secondaryPath = backend.secondaryPath
  form.password = backend.password
  form.label = backend.label || ''
  formMessage.value = ''
  editingUuid.value = uuid
  showForm.value = true
}

const closeForm = (force = false) => {
  if (submitting.value && !force) return

  showForm.value = false
  submitting.value = false
}

const saveController = async () => {
  const candidate: Omit<Backend, 'uuid'> = {
    protocol: form.protocol,
    host: form.host.trim(),
    port: form.port.trim(),
    secondaryPath: form.secondaryPath.trim(),
    password: form.password,
    label: (form.label || '').trim(),
  }

  if (!candidate.protocol || !candidate.host || !candidate.port) {
    formMessage.value = '请填写协议、地址和端口。'
    return
  }

  submitting.value = true
  formMessage.value = ''

  try {
    const backend: Backend = {
      ...candidate,
      uuid: pendingControllerUuid,
    }
    await testBackend(backend)
    const pendingStatus = backendStatus[pendingControllerUuid]

    if (!pendingStatus?.online) {
      formMessage.value = '连接失败。离家时请确认 Clash Party / TUN 已开启。'
      return
    }

    if (editingUuid.value) {
      updateBackend(editingUuid.value, candidate)
      activeUuid.value = editingUuid.value
      backendStatus[editingUuid.value] = { ...pendingStatus }
    } else {
      addBackend(candidate)
    }

    closeForm(true)
    refreshBackends()
  } finally {
    delete backendStatus[pendingControllerUuid]
    submitting.value = false
  }
}

const deleteController = () => {
  if (!editingUuid.value || submitting.value) return

  removeBackend(editingUuid.value)
  closeForm()
}

onMounted(refreshBackends)
</script>
