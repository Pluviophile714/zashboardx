<template>
  <div
    ref="cardRef"
    :class="
      twMerge(
        'bg-base-200 flex cursor-pointer flex-col items-start rounded-md hover:shadow-sm',
        active ? 'bg-primary sm:hover:bg-primary/95' : 'sm:hover:bg-base-300/50',
        isSmallCard ? 'gap-1 p-1' : 'gap-2 p-2',
        latencyTipAnimationClass,
      )
    "
    @contextmenu.stop.prevent="handlerLatencyTest"
  >
    <div
      class="w-full flex-1 text-sm"
      :class="truncateProxyName && 'truncate'"
      @mouseenter="checkNodeTextTruncation"
    >
      <ProxyIcon
        v-if="node?.icon"
        class="-mt-[2px] shrink-0 align-middle"
        :icon="node.icon"
        :fill="active ? 'fill-primary-content' : 'fill-base-content'"
      /><span
        v-if="active"
        class="text-primary-content"
        >{{ node.name }}</span
      ><span
        v-else
        class="text-base-content"
        >{{ node.name }}</span
      >
    </div>

    <div
      class="flex w-full items-end justify-between gap-1"
      :class="isSmallCard ? 'min-h-7' : 'min-h-8'"
    >
      <span
        :class="`truncate text-xs tracking-tight ${active ? 'text-primary-content' : 'text-base-content/60'}`"
        @mouseenter="checkNodeTextTruncation"
      >
        {{ typeDescription }}
      </span>
      <div class="flex shrink-0 flex-col items-end gap-0.5">
        <span
          v-if="cardAvailabilityLabel"
          :class="cardAvailabilityClass"
        >
          {{ cardAvailabilityLabel }}
        </span>
        <LatencyTag
          :class="[isSmallCard && 'h-4! w-8! rounded-md!', 'shrink-0']"
          :name="node.name"
          :loading="isLatencyTesting"
          :group-name="groupName"
          :disable-history-tip="true"
          @click.stop="handlerLatencyTest"
          @pointerenter.stop="handlerLatencyDetailsTip"
        />
      </div>
    </div>

    <div
      class="flex w-full gap-px overflow-hidden rounded-full"
      :class="isSmallCard ? 'h-1' : 'h-1.5'"
      aria-hidden="true"
    >
      <div
        v-for="(segment, index) in latencyStabilityBar"
        :key="index"
        class="h-full min-w-0 flex-1"
        :class="segment.class"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { NOT_CONNECTED, PROXY_CARD_SIZE, PROXY_SORT_TYPE } from '@/constant'
import { openWithDeferredRefresh } from '@/helper/deferredRefresh'
import {
  formatLatencyBucketTitle,
  getLatencyStripTargetCount,
  mapLatencyBucketSamplesToHistory,
  resolveLatencyStripHistory,
  type LatencyStripHistoryItem,
} from '@/helper/latencyBucketDrilldown'
import {
  getCompactLatencyDetailsPlacement,
  getLatencyDetailsViewportSize,
} from '@/helper/latencyDetailsViewport'
import { getLatencySampleIndexAtPointer } from '@/helper/latencySampleSelection'
import { checkTruncation, useTooltip } from '@/helper/tooltip'
import { scrollIntoCenter } from '@/helper/utils'
import {
  getDisplayHistoryByName,
  getHistoryByName,
  getIPv6ByName,
  getNowProxyNodeName,
  getTestUrl,
  proxyLatencyTest,
  proxyMap,
} from '@/assembly/proxies'
import {
  IPv6test,
  lowLatency,
  mediumLatency,
  proxyCardSize,
  proxySortType,
  truncateProxyName,
} from '@/store/settings'
import {
  getProxyMetricsSamplesCacheKey,
  getProxyMetricsTimelineCacheKey,
  invalidateProxyMetricsTimeline,
  proxyMetricsMap,
  proxyMetricsSamplesMap,
  proxyMetricsTimelineMap,
  proxyMetricsUpdatedAt,
  refreshProxyMetricsBucketSamples,
  refreshProxyMetricsSamples,
  refreshProxyMetricsTimeline,
} from '@/store/proxyMetrics'
import type { ProxyMetricsTimelineBucket, ProxyMetricsTimelineWindow } from '@/api/metricsHelper'
import { smartWeightsMap } from '@/store/smart'
import dayjs from 'dayjs'
import type { Instance } from 'tippy.js'
import { twMerge } from 'tailwind-merge'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LatencyTag from './LatencyTag.vue'
import {
  createLatencyTimelineChartSection,
  getLatencyTimelineInputMode,
  type LatencyTimelineChartState,
} from './latencyTimelineChart'
import ProxyIcon from './ProxyIcon.vue'
import { getSmartOutbound } from './smartOutbound'

const LATENCY_BAR_SEGMENTS = 10
const LATENCY_DETAIL_SEGMENTS = 30
const LATENCY_AVAILABILITY_MAX_SAMPLES = 1500
const LATENCY_AVAILABILITY_MIN_SAMPLES = 12
const LATENCY_AVAILABILITY_MIN_COVERAGE = 60 * 60 * 1000
const LATENCY_HISTORY_GAP_THRESHOLD = 10 * 60 * 1000
const LATENCY_DETAILS_R5S_PREFETCH_TIMEOUT = 350
const LATENCY_DETAILS_LOCAL_MAX_AGE = 24 * 60 * 60 * 1000
const LATENCY_SAMPLE_DETAIL_RESTORE_DELAY = 1000
const LATENCY_BUCKET_DRILLDOWN_RESET_DELAY = 8000
const { t } = useI18n()
const { hideTip, showTip } = useTooltip()
const props = defineProps<{
  name: string
  active?: boolean
  groupName?: string
}>()

const cardRef = ref()
const node = computed(() => proxyMap.value[props.name])
const isLatencyTesting = ref(false)
const typeFormatter = (type: string) => {
  type = type.toLowerCase()
  type = type.replace('shadowsocks', 'ss')
  type = type.replace('hysteria', 'hy')
  type = type.replace('wireguard', 'wg')

  return type
}
const isSmallCard = computed(() => proxyCardSize.value === PROXY_CARD_SIZE.SMALL)
const typeDescription = computed(() => {
  const type = typeFormatter(node.value.type)
  const smartUsage = smartWeightsMap.value[props.groupName ?? '']?.[props.name]
  const smartDesc = smartUsage ? t(smartUsage) : ''
  const isV6 = IPv6test.value && getIPv6ByName(node.value.name) ? 'IPv6' : ''
  const isUDP = node.value.udp ? (node.value.xudp ? 'xudp' : 'udp') : ''

  return [type, isUDP, smartDesc, isV6].filter(Boolean).join(isSmallCard.value ? '/' : ' / ')
})
const getLatencySegmentClass = (delay?: number) => {
  if (!delay || delay === NOT_CONNECTED) {
    return props.active ? 'bg-primary-content/30' : 'bg-base-content/25'
  }
  if (delay < lowLatency.value) {
    return 'bg-low-latency'
  }
  if (delay < mediumLatency.value) {
    return 'bg-medium-latency'
  }
  return 'bg-high-latency'
}

const hasLatencyDetailsHistory = () => {
  if (getSharedMetricsResolution()?.metrics?.sampleCount) {
    return true
  }

  return getLocalLatencyDetailsHistory().length > 0
}

const checkNodeTextTruncation = (e: Event) => {
  checkTruncation(e)
}

let latencyDetailsCloseTimer: ReturnType<typeof window.setTimeout> | undefined
let latencyDetailsTipCleanup: (() => void) | undefined
let activeLatencyDetailsTip: Instance | null = null
let activeLatencyDetailsSourceName = ''
let activeLatencyDetailsAnchor: HTMLElement | null = null
let activeLatencyDetailsCompact = false
let stopLatencyDetailsMetricsWatch: (() => void) | undefined
let latencyTimelineRequestGeneration = 0
let latencyBucketRequestGeneration = 0
let latencyBucketDrilldownResetTimer: ReturnType<typeof window.setTimeout> | undefined
let activeLatencyTimelineWindow: ProxyMetricsTimelineWindow = '24h'
let activeLatencyTimelineBucket: ProxyMetricsTimelineBucket | null = null
let latencyBucketHistory: LatencyStripHistoryItem[] = []
const unavailableLatencyTimelineKeys = new Set<string>()
const LATENCY_DETAILS_VIEWPORT_PADDING = 8
const LATENCY_DETAILS_POPOVER_GAP = 8

const clearLatencyDetailsCloseTimer = () => {
  if (!latencyDetailsCloseTimer) return

  window.clearTimeout(latencyDetailsCloseTimer)
  latencyDetailsCloseTimer = undefined
}

const clearLatencyBucketDrilldownResetTimer = () => {
  if (!latencyBucketDrilldownResetTimer) return

  window.clearTimeout(latencyBucketDrilldownResetTimer)
  latencyBucketDrilldownResetTimer = undefined
}

const resetLatencyBucketDrilldownState = () => {
  clearLatencyBucketDrilldownResetTimer()
  activeLatencyTimelineWindow = '24h'
  activeLatencyTimelineBucket = null
  latencyBucketHistory = []
  latencyBucketRequestGeneration += 1
  latencyTimelineRequestGeneration += 1
}

const isHoveringElement = (element?: Element | null) => {
  if (!element) return false

  try {
    return element.matches(':hover') || Boolean(element.querySelector(':hover'))
  } catch {
    return false
  }
}

const cleanupLatencyDetailsTip = () => {
  clearLatencyDetailsCloseTimer()
  latencyDetailsTipCleanup?.()
  latencyDetailsTipCleanup = undefined
}

const scheduleLatencyDetailsTipHide = (
  reference: HTMLElement,
  popper: HTMLElement,
  delay = 220,
) => {
  clearLatencyDetailsCloseTimer()
  latencyDetailsCloseTimer = window.setTimeout(() => {
    if (!isHoveringElement(reference) && !isHoveringElement(popper)) {
      hideTip()
    }
  }, delay)
}

const bindLatencyDetailsTipHoverBoundary = (
  reference: HTMLElement,
  popper: HTMLElement,
  compact: boolean,
) => {
  cleanupLatencyDetailsTip()

  if (compact) {
    const hideOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null

      if (target && (reference.contains(target) || popper.contains(target))) {
        clearLatencyDetailsCloseTimer()
        return
      }

      hideTip()
    }

    document.addEventListener('pointerdown', hideOnOutsidePointerDown, true)
    popper.addEventListener('pointerdown', clearLatencyDetailsCloseTimer)
    popper.addEventListener('pointermove', clearLatencyDetailsCloseTimer)
    popper.addEventListener('touchmove', clearLatencyDetailsCloseTimer, { passive: true })

    latencyDetailsTipCleanup = () => {
      document.removeEventListener('pointerdown', hideOnOutsidePointerDown, true)
      popper.removeEventListener('pointerdown', clearLatencyDetailsCloseTimer)
      popper.removeEventListener('pointermove', clearLatencyDetailsCloseTimer)
      popper.removeEventListener('touchmove', clearLatencyDetailsCloseTimer)
    }

    return
  }

  const hideDelay = compact ? 260 : 220
  const scheduleHide = () => scheduleLatencyDetailsTipHide(reference, popper, hideDelay)

  reference.addEventListener('pointerenter', clearLatencyDetailsCloseTimer)
  reference.addEventListener('pointerleave', scheduleHide)
  popper.addEventListener('pointerenter', clearLatencyDetailsCloseTimer)
  popper.addEventListener('pointerleave', scheduleHide)

  latencyDetailsTipCleanup = () => {
    reference.removeEventListener('pointerenter', clearLatencyDetailsCloseTimer)
    reference.removeEventListener('pointerleave', scheduleHide)
    popper.removeEventListener('pointerenter', clearLatencyDetailsCloseTimer)
    popper.removeEventListener('pointerleave', scheduleHide)
  }
}

const getLatencyTextClass = (delay: number) => {
  if (!delay || delay === NOT_CONNECTED) {
    return 'text-base-content/50'
  }
  if (delay < lowLatency.value) {
    return 'text-low-latency'
  }
  if (delay < mediumLatency.value) {
    return 'text-medium-latency'
  }
  return 'text-high-latency'
}

const getLatencyTimelineAccent = (delay?: number) => {
  if (delay === undefined) {
    return null
  }
  if (!delay || delay === NOT_CONNECTED) {
    return {
      color: 'rgb(244, 96, 108)',
      ratio: 0.82,
    }
  }
  if (delay < lowLatency.value) {
    return null
  }
  if (delay < mediumLatency.value) {
    const range = Math.max(1, mediumLatency.value - lowLatency.value)
    const progress = Math.min(1, Math.max(0, (delay - lowLatency.value) / range))

    return {
      color: 'rgb(250, 210, 75)',
      ratio: 0.18 + progress * 0.24,
    }
  }

  const range = Math.max(1, mediumLatency.value)
  const progress = Math.min(1, Math.max(0, (delay - mediumLatency.value) / range))

  return {
    color: 'rgb(244, 96, 108)',
    ratio: 0.44 + progress * 0.34,
  }
}

const getLatencyStats = (history: { delay: number }[], windowSize = LATENCY_BAR_SEGMENTS) => {
  const recent = history.slice(-windowSize)
  const successItems = recent.filter((item) => item.delay > NOT_CONNECTED)
  const delays = successItems.map((item) => item.delay)

  if (delays.length === 0) {
    return null
  }

  const min = Math.min(...delays)
  const max = Math.max(...delays)
  const avg = Math.round(delays.reduce((sum, delay) => sum + delay, 0) / delays.length)
  const variance = delays.reduce((sum, delay) => sum + (delay - avg) ** 2, 0) / delays.length

  return {
    avg,
    max,
    min,
    jitter: Math.round(Math.sqrt(variance)),
    successRate: Math.round((successItems.length / windowSize) * 100),
    successTests: successItems.length,
    totalTests: windowSize,
  }
}

const formatSharedMetricsAvailability = (metrics: (typeof proxyMetricsMap.value)[string]) => {
  if (metrics.availability === null || !metrics.sampleCount) {
    return '24h可用率: --'
  }

  if (
    metrics.sampleCount < LATENCY_AVAILABILITY_MIN_SAMPLES ||
    metrics.coverageSeconds < LATENCY_AVAILABILITY_MIN_COVERAGE / 1000
  ) {
    return '24h可用率: 样本不足'
  }

  return `24h可用率: ${(metrics.availability * 100).toFixed(1)}%`
}

const getSharedMetricsNote = (metrics: (typeof proxyMetricsMap.value)[string]) => {
  if (!metrics.sampleCount) {
    return {
      className: 'text-base-content/45',
      text: '暂无记录',
    }
  }

  if (metrics.failureCount > 0) {
    return {
      className: 'text-high-latency',
      text: `失败 ${metrics.failureCount} 次`,
    }
  }

  if (metrics.sampleCount < LATENCY_AVAILABILITY_MIN_SAMPLES || metrics.coverageSeconds < 3600) {
    return {
      className: 'text-medium-latency',
      text: '',
    }
  }

  return {
    className: 'text-base-content/45',
    text: '',
  }
}

const getSharedMetricsResolution = () => {
  const names: string[] = []
  const addName = (name?: string) => {
    if (name && !names.includes(name)) {
      names.push(name)
    }
  }
  const resolvedName = getNowProxyNodeName(props.name)
  const smartOutbound = getSmartOutbound(resolvedName || props.name) || getSmartOutbound(props.name)

  addName(props.name)
  addName(smartOutbound)
  addName(resolvedName !== props.name ? resolvedName : '')

  for (const name of names) {
    const metrics = proxyMetricsMap.value[name]

    if (metrics) {
      return {
        metrics,
        sourceName: name,
        usesResolvedNode: name !== props.name,
      }
    }
  }

  return null
}

const getMetricsCandidateNames = () => {
  const names: string[] = []
  const addName = (name?: string) => {
    if (name && !names.includes(name)) {
      names.push(name)
    }
  }
  const resolvedName = getNowProxyNodeName(props.name)
  const smartOutbound = getSmartOutbound(resolvedName || props.name) || getSmartOutbound(props.name)

  addName(props.name)
  addName(smartOutbound)
  addName(resolvedName !== props.name ? resolvedName : '')

  return names
}

const getR5sLatencySampleSourceName = () =>
  getSharedMetricsResolution()?.sourceName ?? getMetricsCandidateNames()[0] ?? props.name

const getLatencyStabilityHistory = () => {
  const sourceName = getR5sLatencySampleSourceName()
  const r5sSamples =
    proxyMetricsSamplesMap.value[
      getProxyMetricsSamplesCacheKey(sourceName, '24h', LATENCY_DETAIL_SEGMENTS)
    ]

  if (r5sSamples?.length) {
    return r5sSamples.map((sample) => ({
      delay: sample.success && sample.delay !== null ? sample.delay : NOT_CONNECTED,
    }))
  }

  return getHistoryByName(props.name, props.groupName) ?? []
}

const latencyStabilityBar = computed(() => {
  const history = getLatencyStabilityHistory()
  const recentHistory = history.slice(-LATENCY_BAR_SEGMENTS)
  const emptySegments: { delay?: number }[] = Array.from(
    { length: Math.max(0, LATENCY_BAR_SEGMENTS - recentHistory.length) },
    () => ({}),
  )
  const recentSegments = recentHistory.map((item) => ({ delay: item.delay }))

  return [...emptySegments, ...recentSegments].map((item) => ({
    class: getLatencySegmentClass(item?.delay),
  }))
})

const getLatencyTimelineChartState = (
  sourceName: string,
  window: ProxyMetricsTimelineWindow,
): LatencyTimelineChartState => {
  const cacheKey = getProxyMetricsTimelineCacheKey(sourceName, window)
  const timeline = proxyMetricsTimelineMap.value[cacheKey]

  if (timeline) {
    return timeline.buckets.some((bucket) => bucket.sampleCount > 0)
      ? { status: 'ready', timeline }
      : { status: 'empty', timeline }
  }

  return unavailableLatencyTimelineKeys.has(cacheKey)
    ? { status: 'unavailable' }
    : { status: 'loading' }
}

const getLocalLatencyDetailsHistory = () => {
  const cutoff = Date.now() - LATENCY_DETAILS_LOCAL_MAX_AGE

  return getDisplayHistoryByName(
    props.name,
    props.groupName,
    LATENCY_AVAILABILITY_MAX_SAMPLES,
  ).filter((item) => {
    const timestamp = Date.parse(item.time)

    return Number.isFinite(timestamp) && timestamp >= cutoff
  })
}

const getR5sLatencyHistory = () => {
  const metricsResolution = getSharedMetricsResolution()
  const sourceName = metricsResolution?.sourceName ?? getR5sLatencySampleSourceName()

  if (!sourceName) {
    return null
  }

  const samples =
    proxyMetricsSamplesMap.value[
      getProxyMetricsSamplesCacheKey(sourceName, '24h', LATENCY_DETAIL_SEGMENTS)
    ] ?? []

  if (!samples.length && !metricsResolution?.metrics?.sampleCount) {
    return null
  }

  return {
    history: samples.map((sample) => ({
      delay: sample.success && sample.delay ? sample.delay : NOT_CONNECTED,
      time: sample.timestamp,
    })),
    label: 'R5S近30次',
    sourceName,
  }
}

const getLatencyDetailsHistorySource = () => {
  const r5sHistory = getR5sLatencyHistory()

  if (r5sHistory) {
    return r5sHistory
  }

  return {
    history: getLocalLatencyDetailsHistory(),
    label: '本机近30次',
    sourceName: props.name,
  }
}

const refreshR5sLatencyDetailsSamples = (force = false) => {
  const sourceName = getR5sLatencySampleSourceName()

  if (!sourceName) {
    return Promise.resolve(null)
  }

  return refreshProxyMetricsSamples(sourceName, {
    force,
    limit: LATENCY_DETAIL_SEGMENTS,
    window: '24h',
  })
}

const getR5sLatencyDetailsSamplesRefresh = () => {
  const sourceName = getR5sLatencySampleSourceName()
  const metrics = getSharedMetricsResolution()?.metrics

  if (!sourceName || !metrics?.sampleCount) {
    return null
  }

  return refreshR5sLatencyDetailsSamples(true)
}

const refreshActiveR5sLatencyDetails = () => {
  const instance = activeLatencyDetailsTip
  const sourceName = activeLatencyDetailsSourceName
  const anchor = activeLatencyDetailsAnchor

  if (!instance || instance.state.isDestroyed || !sourceName || !anchor) {
    return
  }

  void refreshProxyMetricsSamples(sourceName, {
    force: true,
    limit: LATENCY_DETAIL_SEGMENTS,
    window: '24h',
  }).then(() => {
    if (
      activeLatencyDetailsTip !== instance ||
      activeLatencyDetailsSourceName !== sourceName ||
      instance.state.isDestroyed
    ) {
      return
    }

    instance.setContent(createLatencyDetailsTip())
    repositionLatencyDetailsTip(instance, anchor, activeLatencyDetailsCompact)
  })
}

const startActiveLatencyDetailsRefresh = () => {
  stopLatencyDetailsMetricsWatch?.()
  stopLatencyDetailsMetricsWatch = watch(proxyMetricsUpdatedAt, (updatedAt, previousUpdatedAt) => {
    if (!updatedAt || updatedAt === previousUpdatedAt) {
      return
    }

    refreshActiveR5sLatencyDetails()
  })
}

const stopActiveLatencyDetailsRefresh = () => {
  stopLatencyDetailsMetricsWatch?.()
  stopLatencyDetailsMetricsWatch = undefined
}

const formatCardAvailability = (availability: number) => {
  const percent = availability * 100

  if (percent >= 99.95) return '100%'
  if (percent >= 99) return `${percent.toFixed(1)}%`

  return `${percent.toFixed(1)}%`
}

const cardAvailabilityMetrics = computed(() => getSharedMetricsResolution()?.metrics)
const cardAvailabilityLabel = computed(() => {
  const metrics = cardAvailabilityMetrics.value

  if (
    !metrics ||
    metrics.availability === null ||
    !metrics.sampleCount ||
    metrics.sampleCount < LATENCY_AVAILABILITY_MIN_SAMPLES ||
    metrics.coverageSeconds < LATENCY_AVAILABILITY_MIN_COVERAGE / 1000
  ) {
    return ''
  }

  return `24h ${formatCardAvailability(metrics.availability)}`
})
const cardAvailabilityClass = computed(() => {
  const metrics = cardAvailabilityMetrics.value
  const baseClass = twMerge(
    'h-3 rounded-full px-1.5 text-[10px] leading-3 tracking-tight',
    isSmallCard.value && 'px-1 text-[9px]',
  )

  if (!metrics || metrics.availability === null) {
    return twMerge(
      baseClass,
      props.active
        ? 'bg-primary-content/10 text-primary-content/70'
        : 'bg-base-content/10 text-base-content/50',
    )
  }

  if (props.active) {
    return twMerge(baseClass, 'bg-primary-content/10 text-primary-content/80')
  }

  if (metrics.availability >= 0.99) {
    return twMerge(baseClass, 'bg-low-latency/10 text-low-latency')
  }

  if (metrics.availability >= 0.95) {
    return twMerge(baseClass, 'bg-medium-latency/10 text-medium-latency')
  }

  return twMerge(baseClass, 'bg-high-latency/10 text-high-latency')
})

const isCompactLatencyDetails = () => window.matchMedia('(max-width: 640px)').matches

const repositionLatencyDetailsTip = (instance: Instance, anchor: HTMLElement, compact: boolean) => {
  window.requestAnimationFrame(() => {
    if (instance.state.isDestroyed) return

    const anchorRect = anchor.getBoundingClientRect()
    const viewport = getLatencyDetailsViewportSize(
      window.innerWidth,
      window.innerHeight,
      window.visualViewport,
    )
    const content = instance.popper.querySelector('.tippy-content') as HTMLElement | null
    const root = instance.popper.querySelector('.tippy-content > div') as HTMLElement | null

    if (compact) {
      if (content) {
        content.style.padding = '0'
      }

      const { placement, maxHeight } = getCompactLatencyDetailsPlacement(
        anchorRect,
        viewport,
        LATENCY_DETAILS_VIEWPORT_PADDING,
        LATENCY_DETAILS_POPOVER_GAP,
      )

      if (root) {
        root.style.maxHeight = `${maxHeight}px`
      }

      instance.setProps({ placement })
    } else {
      const availableAbove = Math.max(0, anchorRect.top - LATENCY_DETAILS_VIEWPORT_PADDING)
      const availableBelow = Math.max(
        0,
        viewport.height - anchorRect.bottom - LATENCY_DETAILS_VIEWPORT_PADDING,
      )
      const availableLeft = Math.max(0, anchorRect.left - LATENCY_DETAILS_VIEWPORT_PADDING)
      const availableRight = Math.max(
        0,
        viewport.width - anchorRect.right - LATENCY_DETAILS_VIEWPORT_PADDING,
      )

      if (root) {
        root.style.maxHeight = `${viewport.height - LATENCY_DETAILS_VIEWPORT_PADDING * 2}px`
      }

      const contentWidth = root?.getBoundingClientRect().width ?? 0
      const placement: 'top' | 'bottom' | 'right' | 'left' =
        availableRight >= contentWidth
          ? 'right'
          : availableLeft >= contentWidth
            ? 'left'
            : availableAbove >= availableBelow
              ? 'top'
              : 'bottom'
      const maxHeight =
        placement === 'top'
          ? availableAbove
          : placement === 'bottom'
            ? availableBelow
            : viewport.height - LATENCY_DETAILS_VIEWPORT_PADDING * 2

      if (root) {
        root.style.maxHeight = `${Math.floor(maxHeight)}px`
      }

      instance.setProps({ placement })
    }

    void instance.popperInstance?.update()
  })
}

const renderActiveLatencyDetailsTip = () => {
  const instance = activeLatencyDetailsTip
  const anchor = activeLatencyDetailsAnchor

  if (!instance || instance.state.isDestroyed || !anchor) {
    return
  }

  instance.setContent(createLatencyDetailsTip())
  repositionLatencyDetailsTip(instance, anchor, activeLatencyDetailsCompact)
}

const exitLatencyBucketDrilldown = (updateContent = false) => {
  clearLatencyBucketDrilldownResetTimer()
  activeLatencyTimelineBucket = null
  latencyBucketHistory = []
  latencyBucketRequestGeneration += 1

  if (updateContent) {
    renderActiveLatencyDetailsTip()
  }
}

const restartLatencyBucketDrilldownResetTimer = () => {
  clearLatencyBucketDrilldownResetTimer()

  if (!activeLatencyTimelineBucket || !activeLatencyDetailsTip) {
    return
  }

  latencyBucketDrilldownResetTimer = window.setTimeout(
    () => exitLatencyBucketDrilldown(true),
    LATENCY_BUCKET_DRILLDOWN_RESET_DELAY,
  )
}

const refreshLatencyDetailsTimeline = (sourceName: string, window: ProxyMetricsTimelineWindow) => {
  const timelineCacheKey = getProxyMetricsTimelineCacheKey(sourceName, window)
  const requestGeneration = (latencyTimelineRequestGeneration += 1)
  const request = refreshProxyMetricsTimeline(sourceName, { window })

  void request.then((timeline) => {
    if (
      requestGeneration !== latencyTimelineRequestGeneration ||
      activeLatencyTimelineWindow !== window ||
      activeLatencyDetailsSourceName !== sourceName
    ) {
      return
    }

    if (timeline) {
      unavailableLatencyTimelineKeys.delete(timelineCacheKey)
    } else {
      unavailableLatencyTimelineKeys.add(timelineCacheKey)
    }

    renderActiveLatencyDetailsTip()
  })

  return request
}

const changeLatencyTimelineWindow = (window: ProxyMetricsTimelineWindow) => {
  if (window === activeLatencyTimelineWindow) {
    return
  }

  exitLatencyBucketDrilldown()
  activeLatencyTimelineWindow = window
  renderActiveLatencyDetailsTip()

  const sourceName = activeLatencyDetailsSourceName

  if (sourceName) {
    void refreshLatencyDetailsTimeline(sourceName, window)
  }
}

const activateLatencyTimelineBucket = async (bucket: ProxyMetricsTimelineBucket) => {
  if (bucket.sampleCount <= 0) {
    return
  }

  if (activeLatencyTimelineBucket) {
    exitLatencyBucketDrilldown(true)
    return
  }

  const instance = activeLatencyDetailsTip
  const sourceName = activeLatencyDetailsSourceName

  if (!instance || instance.state.isDestroyed || !sourceName) {
    return
  }

  clearLatencyBucketDrilldownResetTimer()
  const requestGeneration = (latencyBucketRequestGeneration += 1)
  const response = await refreshProxyMetricsBucketSamples(sourceName, bucket.start, bucket.end)

  if (
    requestGeneration !== latencyBucketRequestGeneration ||
    activeLatencyDetailsTip !== instance ||
    activeLatencyDetailsSourceName !== sourceName ||
    instance.state.isDestroyed ||
    !response
  ) {
    return
  }

  activeLatencyTimelineBucket = bucket
  latencyBucketHistory = mapLatencyBucketSamplesToHistory(response.samples, NOT_CONNECTED)
  restartLatencyBucketDrilldownResetTimer()
  renderActiveLatencyDetailsTip()
}

const buildLatencyStatusTimeline = (
  history: { delay: number; time?: string }[],
  compact = false,
  sourceLabel = '本机近30次',
  summaryLine?: HTMLElement,
  options: { onInteraction?: () => void; preserveAll?: boolean } = {},
) => {
  const displayedHistory = options.preserveAll ? history : history.slice(-LATENCY_DETAIL_SEGMENTS)
  const targetSegmentCount = getLatencyStripTargetCount(
    displayedHistory.length,
    LATENCY_DETAIL_SEGMENTS,
  )
  const emptySegments: { delay?: number; time?: string }[] = Array.from(
    { length: Math.max(0, targetSegmentCount - displayedHistory.length) },
    () => ({}),
  )
  const timeline = document.createElement('div')
  const header = document.createElement('div')
  const strip = document.createElement('div')
  const sampleCount = displayedHistory.length
  const successTests = displayedHistory.filter((item) => item.delay > NOT_CONNECTED).length
  const sampledSuccessRate = sampleCount > 0 ? Math.round((successTests / sampleCount) * 100) : 0
  const timelineItems = [...emptySegments, ...displayedHistory]
  const segments: HTMLElement[] = []

  timeline.className = compact
    ? 'mt-2 rounded-md bg-base-200/40 p-1.5'
    : 'mt-2.5 rounded-lg bg-base-200/40 p-2'
  header.className = compact
    ? 'mb-1 flex items-center justify-between text-[10px] text-base-content/55'
    : 'mb-1.5 flex items-center justify-between text-[11px] text-base-content/55'

  const oldestLabel = document.createElement('span')
  oldestLabel.className = 'min-w-0 truncate'
  oldestLabel.textContent = sourceLabel
  oldestLabel.title = sourceLabel
  const successLabel = document.createElement('span')
  successLabel.className =
    sampleCount && sampledSuccessRate >= 80
      ? 'text-low-latency'
      : sampleCount && sampledSuccessRate >= 50
        ? 'text-medium-latency'
        : sampleCount
          ? 'text-high-latency'
          : 'text-base-content/45'
  successLabel.textContent = sampleCount
    ? options.preserveAll
      ? `${sampledSuccessRate}% 可用 · ${sampleCount} 记录`
      : `${sampledSuccessRate}% 可用 · ${sampleCount}/${LATENCY_DETAIL_SEGMENTS} 记录`
    : '暂无记录'
  const newestLabel = document.createElement('span')
  const newestTimestamp = displayedHistory.at(-1)?.time
  newestLabel.textContent = newestTimestamp
    ? `最后 ${dayjs(newestTimestamp).format('MM-DD HH:mm')}`
    : '暂无'
  header.append(oldestLabel, successLabel, newestLabel)

  strip.className = `flex w-full items-end ${options.preserveAll ? 'gap-px' : 'gap-1'} ${
    compact ? 'touch-pan-y select-none' : ''
  }`
  const reportInteraction = () => options.onInteraction?.()

  strip.addEventListener('pointerdown', reportInteraction)
  strip.addEventListener('pointermove', reportInteraction)
  strip.addEventListener('touchmove', reportInteraction, { passive: true })

  let previousTimestamp: number | undefined

  for (const item of timelineItems) {
    const segment = document.createElement('div')
    const timestamp = item.time ? Date.parse(item.time) : undefined
    const accent = getLatencyTimelineAccent(item.delay)

    segment.className = 'relative min-w-0 flex-1 overflow-hidden'
    segment.style.height = compact ? '18px' : '24px'
    segment.style.borderRadius = compact ? '3px' : '4px'
    segment.style.backgroundColor =
      item.delay === undefined
        ? 'color-mix(in oklch, var(--color-base-content) 12%, transparent)'
        : item.delay > NOT_CONNECTED
          ? 'oklch(0.648 0.15 160)'
          : 'color-mix(in oklch, var(--color-base-content) 18%, transparent)'
    segment.style.opacity = item.delay === undefined ? '0.7' : '1'

    if (
      previousTimestamp &&
      timestamp &&
      Number.isFinite(timestamp) &&
      timestamp - previousTimestamp > LATENCY_HISTORY_GAP_THRESHOLD
    ) {
      segment.style.marginLeft = compact ? '3px' : '4px'
    }

    if (item.time) {
      segment.title =
        item.delay && item.delay > NOT_CONNECTED
          ? `${dayjs(item.time).format('YYYY-MM-DD HH:mm:ss')} ${item.delay}ms`
          : `${dayjs(item.time).format('YYYY-MM-DD HH:mm:ss')} ---`
    }

    if (accent) {
      const accentElement = document.createElement('span')
      const segmentHeight = compact ? 18 : 24

      accentElement.className = 'absolute inset-x-0 bottom-0'
      accentElement.style.height = `${Math.max(2, Math.round(segmentHeight * accent.ratio))}px`
      accentElement.style.backgroundColor = accent.color
      accentElement.style.opacity = '0.95'
      segment.append(accentElement)
    }

    if (timestamp && Number.isFinite(timestamp)) {
      previousTimestamp = timestamp
    }

    strip.append(segment)
    segments.push(segment)
  }

  if (summaryLine) {
    const summaryNodes = Array.from(summaryLine.childNodes)
    let activePointerId: number | null = null
    let restoreTimer: ReturnType<typeof window.setTimeout> | undefined

    const clearRestoreTimer = () => {
      if (!restoreTimer) return

      window.clearTimeout(restoreTimer)
      restoreTimer = undefined
    }
    const clearSelectedSegment = () => {
      for (const segment of segments) {
        segment.style.outline = ''
        segment.style.outlineOffset = ''
      }
    }
    const restoreSummary = () => {
      clearSelectedSegment()
      summaryLine.replaceChildren(...summaryNodes)
    }
    const showSample = (index: number) => {
      const item = timelineItems[index]

      if (!item?.time || item.delay === undefined) {
        restoreSummary()
        return
      }

      clearSelectedSegment()
      const selectedSegment = segments[index]
      selectedSegment.style.outline =
        '1px solid color-mix(in oklch, var(--color-base-content) 70%, transparent)'
      selectedSegment.style.outlineOffset = '1px'

      const time = document.createElement('time')
      const delay = document.createElement('span')
      const status = document.createElement('span')
      const statusDot = document.createElement('span')
      const success = item.delay > NOT_CONNECTED

      time.className = 'text-base-content/60'
      time.textContent = dayjs(item.time).format('MM-DD HH:mm:ss')
      delay.className = `font-semibold ${getLatencyTextClass(item.delay)}`
      delay.textContent = success ? `${item.delay}ms` : '---'
      status.className = `inline-flex items-center gap-1 ${
        success ? 'text-low-latency' : 'text-high-latency'
      }`
      statusDot.className = `size-1.5 rounded-full ${
        success ? 'bg-low-latency' : 'bg-high-latency'
      }`
      status.append(statusDot, document.createTextNode(success ? '成功' : '失败'))
      summaryLine.replaceChildren(time, delay, status)
    }
    const selectPointerSample = (event: PointerEvent) => {
      if (compact && event.type === 'pointerdown') {
        activePointerId = event.pointerId
        clearRestoreTimer()
        strip.setPointerCapture?.(event.pointerId)
      } else if (compact && activePointerId !== event.pointerId) {
        return
      }

      const rect = strip.getBoundingClientRect()
      const index = getLatencySampleIndexAtPointer(
        event.clientX,
        rect.left,
        rect.width,
        timelineItems.length,
      )

      if (index !== null) {
        showSample(index)
      }
    }
    const scheduleSummaryRestore = (event: PointerEvent) => {
      if (activePointerId !== event.pointerId) return

      activePointerId = null
      clearRestoreTimer()
      restoreTimer = window.setTimeout(restoreSummary, LATENCY_SAMPLE_DETAIL_RESTORE_DELAY)
    }

    strip.addEventListener('pointermove', selectPointerSample)
    if (compact) {
      strip.addEventListener('pointerdown', selectPointerSample)
      strip.addEventListener('pointerup', scheduleSummaryRestore)
      strip.addEventListener('pointercancel', scheduleSummaryRestore)
    } else {
      strip.addEventListener('pointerleave', restoreSummary)
    }
  }

  timeline.append(header, strip)
  return timeline
}

const createLatencyDetailsTip = () => {
  const compact = isCompactLatencyDetails()
  const detailHistorySource = getLatencyDetailsHistorySource()
  const recentHistory = detailHistorySource.history.slice(-LATENCY_DETAIL_SEGMENTS)
  const history = resolveLatencyStripHistory({
    mode: activeLatencyTimelineBucket ? 'bucket' : 'recent',
    recent: recentHistory,
    bucket: latencyBucketHistory,
  })
  const stats = getLatencyStats(
    history,
    activeLatencyTimelineBucket ? history.length : LATENCY_DETAIL_SEGMENTS,
  )
  const sharedMetricsResolution = getSharedMetricsResolution()
  const sharedMetrics = sharedMetricsResolution?.metrics
  const timelineSourceName = getR5sLatencySampleSourceName()
  const root = document.createElement('div')

  root.className = compact
    ? 'flex max-h-[min(68vh,28rem)] w-[calc(100vw-0.5rem)] touch-pan-y flex-col overflow-y-auto overscroll-contain rounded-lg border border-base-content/10 bg-base-200 p-2 text-base-content shadow-2xl'
    : 'flex max-h-[calc(100vh-1rem)] w-[28rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-base-content/10 bg-base-200 p-3 text-base-content shadow-2xl'

  const title = document.createElement('div')
  title.className = compact
    ? 'mb-1.5 shrink-0 truncate text-center text-sm font-bold'
    : 'mb-2 shrink-0 truncate text-center text-base font-bold'
  title.textContent = node.value?.name ?? props.name
  root.append(title)

  if (stats || history.length || sharedMetrics) {
    const chart = document.createElement('div')
    chart.className = compact
      ? 'shrink-0 rounded-lg bg-base-300/50 p-1.5'
      : 'shrink-0 rounded-lg bg-base-300/50 p-2'

    const availabilityLine = document.createElement('div')
    const availabilityMain = document.createElement('div')
    const availability = document.createElement('span')
    const failure = document.createElement('span')
    const availabilityNote = sharedMetrics
      ? getSharedMetricsNote(sharedMetrics)
      : {
          className: 'text-medium-latency',
          text: '采集中',
        }

    availabilityLine.className = 'grid gap-0.5 text-xs text-base-content/65'
    availabilityMain.className = 'flex items-center justify-between gap-2'
    availability.textContent = sharedMetrics
      ? formatSharedMetricsAvailability(sharedMetrics)
      : '24h可用率: --'
    availability.title = sharedMetrics
      ? sharedMetricsResolution?.usesResolvedNode
        ? `基于当前最终节点 ${sharedMetricsResolution.sourceName} 的 R5S 指标助手记录`
        : '基于 R5S 指标助手长期采集记录'
      : 'R5S 指标助手暂无该节点记录，本机近30次只用于短期状态'
    failure.className = availabilityNote.className
    failure.textContent = availabilityNote.text
    availabilityMain.append(availability)
    if (failure.textContent) {
      availabilityMain.append(failure)
    }
    availabilityLine.append(availabilityMain)
    chart.append(availabilityLine)
    chart.append(
      createLatencyTimelineChartSection(
        getLatencyTimelineChartState(timelineSourceName, activeLatencyTimelineWindow),
        {
          compact,
          inputMode: getLatencyTimelineInputMode(),
          onBucketActivate: activateLatencyTimelineBucket,
          onInteraction: restartLatencyBucketDrilldownResetTimer,
          onWindowChange: changeLatencyTimelineWindow,
          sourceLabel: timelineSourceName !== props.name ? timelineSourceName : undefined,
          window: activeLatencyTimelineWindow,
        },
      ),
    )

    const summaryLine = document.createElement('div')
    if (stats) {
      summaryLine.className = 'mt-1 flex items-center justify-between text-xs text-base-content/75'

      const min = document.createElement('span')
      min.textContent = `${stats.min}ms`
      const avg = document.createElement('span')
      avg.textContent = `avg: ${stats.avg}ms`
      const max = document.createElement('span')
      max.textContent = `${stats.max}ms`
      summaryLine.append(min, avg, max)
    } else {
      summaryLine.className = 'mt-1 text-center text-xs text-base-content/55'
      summaryLine.textContent = history.length
        ? activeLatencyTimelineBucket
          ? '该时段暂无成功测速'
          : '近30次暂无成功测速'
        : activeLatencyTimelineBucket
          ? '该时段暂无记录'
          : 'R5S近30次等待样本'
    }

    chart.append(
      buildLatencyStatusTimeline(
        history,
        compact,
        activeLatencyTimelineBucket
          ? formatLatencyBucketTitle(activeLatencyTimelineBucket, latencyBucketHistory.length)
          : detailHistorySource.label,
        summaryLine,
        {
          onInteraction: restartLatencyBucketDrilldownResetTimer,
          preserveAll: Boolean(activeLatencyTimelineBucket),
        },
      ),
      summaryLine,
    )

    root.append(chart)
  }

  return root
}

const handlerLatencyDetailsTip = async (e: Event) => {
  if (!hasLatencyDetailsHistory()) return

  const compact = isCompactLatencyDetails()
  const anchor = e.currentTarget as HTMLElement | null

  if (!anchor) return

  resetLatencyBucketDrilldownState()

  const tipEvent = Object.create(e, {
    currentTarget: {
      value: anchor,
    },
  }) as Event
  const viewport = getLatencyDetailsViewportSize(
    window.innerWidth,
    window.innerHeight,
    window.visualViewport,
  )
  const mobilePlacement = getCompactLatencyDetailsPlacement(
    anchor.getBoundingClientRect(),
    viewport,
    LATENCY_DETAILS_VIEWPORT_PADDING,
    LATENCY_DETAILS_POPOVER_GAP,
  ).placement
  const placement = compact ? mobilePlacement : 'top'
  const refresh = getR5sLatencyDetailsSamplesRefresh() ?? Promise.resolve(null)
  const timelineSourceName = getR5sLatencySampleSourceName()

  void refreshLatencyDetailsTimeline(timelineSourceName, activeLatencyTimelineWindow)

  await openWithDeferredRefresh({
    refresh,
    waitMs: LATENCY_DETAILS_R5S_PREFETCH_TIMEOUT,
    open: () => {
      if (!hasLatencyDetailsHistory()) return null
      if (!compact && !isHoveringElement(anchor) && !isHoveringElement(cardRef.value)) return null

      const instance = showTip(tipEvent, createLatencyDetailsTip(), {
        animation: 'fade',
        appendTo: document.body,
        delay: [500, 120],
        duration: [70, 50],
        interactive: true,
        interactiveBorder: compact ? 10 : 8,
        interactiveDebounce: 40,
        hideOnClick: false,
        maxWidth: 'none',
        offset: [0, LATENCY_DETAILS_POPOVER_GAP],
        onShown: (instance) => {
          bindLatencyDetailsTipHoverBoundary(anchor, instance.popper, compact)
          repositionLatencyDetailsTip(instance, anchor, compact)
        },
        onDestroy: (destroyedInstance) => {
          if (activeLatencyDetailsTip === destroyedInstance) {
            activeLatencyDetailsTip = null
            activeLatencyDetailsSourceName = ''
            activeLatencyDetailsAnchor = null
            stopActiveLatencyDetailsRefresh()
            resetLatencyBucketDrilldownState()
          }
          cleanupLatencyDetailsTip()
        },
        placement,
        popperOptions: {
          strategy: 'fixed',
          modifiers: [
            {
              name: 'preventOverflow',
              options: {
                altAxis: true,
                boundary: 'viewport',
                padding: 8,
                tether: false,
              },
            },
            {
              name: 'flip',
              options: {
                boundary: 'viewport',
                fallbackPlacements:
                  compact && placement === 'bottom'
                    ? ['bottom', 'top', 'right', 'left']
                    : ['top', 'bottom', 'right', 'left'],
                padding: 8,
              },
            },
          ],
        },
        trigger: 'mouseenter',
        touch: ['hold', 500],
      })

      activeLatencyDetailsTip = instance
      activeLatencyDetailsSourceName = timelineSourceName
      activeLatencyDetailsAnchor = anchor
      activeLatencyDetailsCompact = compact
      startActiveLatencyDetailsRefresh()
      return instance
    },
    isActive: (instance) => Boolean(instance && !instance.state.isDestroyed),
    update: (instance) => {
      instance?.setContent(createLatencyDetailsTip())
      if (instance) {
        repositionLatencyDetailsTip(instance, anchor, compact)
      }
    },
  })
}

const latencyTipAnimationClass = ref<string[]>([])
const handlerLatencyTest = async () => {
  if (isLatencyTesting.value) return

  isLatencyTesting.value = true
  try {
    await proxyLatencyTest(props.name, getTestUrl(props.groupName), undefined, props.groupName)
  } catch {
    // The existing latency notification reports the failure.
  } finally {
    isLatencyTesting.value = false
    for (const name of getMetricsCandidateNames()) {
      invalidateProxyMetricsTimeline(name)
    }
  }

  if (
    [PROXY_SORT_TYPE.LATENCY_ASC, PROXY_SORT_TYPE.LATENCY_DESC].includes(proxySortType.value) &&
    cardRef.value
  ) {
    const classList = ['bg-info/20!', 'transition-colors', 'duration-1500']

    scrollIntoCenter(cardRef.value)
    latencyTipAnimationClass.value = classList
    setTimeout(() => {
      latencyTipAnimationClass.value = []
    }, 1500)
  }
}

onMounted(() => {
  if (props.active) {
    setTimeout(() => {
      scrollIntoCenter(cardRef.value)
    }, 300)
  }
})

onUnmounted(() => {
  stopActiveLatencyDetailsRefresh()
  resetLatencyBucketDrilldownState()
  cleanupLatencyDetailsTip()
})
</script>

<style scoped>
.tooltip:before {
  z-index: 20;
}
</style>
