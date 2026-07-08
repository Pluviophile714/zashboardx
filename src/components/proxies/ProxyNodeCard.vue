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
import {
  formatSmartLossRate,
  getPrimarySmartLossRate,
  getSmartLossRateClass,
  resolveSmartLossMetric,
} from '@/helper/smartLossMetrics'
import { checkTruncation, useTooltip } from '@/helper/tooltip'
import { scrollIntoCenter } from '@/helper/utils'
import {
  getDisplayHistoryByName,
  getHistoryByName,
  getIPv6ByName,
  getNowProxyNodeName,
  getTestUrl,
  hasDisplayHistoryByName,
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
import { proxyMetricsMap, proxyMetricsUpdatedAt } from '@/store/proxyMetrics'
import { smartLossMetricsByNameMap, smartLossMetricsMap, smartWeightsMap } from '@/store/smart'
import dayjs from 'dayjs'
import { twMerge } from 'tailwind-merge'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LatencyTag from './LatencyTag.vue'
import ProxyIcon from './ProxyIcon.vue'
import { getSmartOutbound } from './smartOutbound'

const LATENCY_BAR_SEGMENTS = 10
const LATENCY_DETAIL_SEGMENTS = 30
const LATENCY_AVAILABILITY_MAX_SAMPLES = 1500
const LATENCY_AVAILABILITY_MIN_SAMPLES = 12
const LATENCY_AVAILABILITY_MIN_COVERAGE = 60 * 60 * 1000
const LATENCY_HISTORY_GAP_THRESHOLD = 10 * 60 * 1000
const CHART_WIDTH = 160
const CHART_HEIGHT = 58
const CHART_PADDING_X = 8
const CHART_PADDING_Y = 8
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
const getSmartLossMetric = () =>
  resolveSmartLossMetric(
    smartLossMetricsMap.value,
    smartLossMetricsByNameMap.value,
    props.groupName,
    props.name,
  )

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

const latencyStabilityBar = computed(() => {
  const history = getHistoryByName(props.name, props.groupName) ?? []
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

const hasLatencyDetailsHistory = () => hasDisplayHistoryByName(props.name, props.groupName)

const checkNodeTextTruncation = (e: Event) => {
  checkTruncation(e)
}

let latencyDetailsCloseTimer: ReturnType<typeof window.setTimeout> | undefined
let latencyDetailsTipCleanup: (() => void) | undefined

const clearLatencyDetailsCloseTimer = () => {
  if (!latencyDetailsCloseTimer) return

  window.clearTimeout(latencyDetailsCloseTimer)
  latencyDetailsCloseTimer = undefined
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

const getLatencyColorValue = (delay: number) => {
  if (!delay || delay === NOT_CONNECTED) {
    return 'color-mix(in oklch, var(--color-base-content) 45%, transparent)'
  }
  if (delay < lowLatency.value) {
    return 'oklch(0.648 0.15 160)'
  }
  if (delay < mediumLatency.value) {
    return 'rgb(250, 210, 75)'
  }
  return 'rgb(244, 96, 108)'
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

const formatLatencyHistoryGap = (gap: number) => {
  const minutes = Math.max(1, Math.round(gap / 60000))

  if (minutes < 60) {
    return `${minutes} 分钟`
  }

  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60

  return restMinutes ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`
}

const formatLatencyAvailabilityCoverage = (coverage: number, totalCount: number) => {
  if (!totalCount) {
    return '覆盖 --'
  }

  if (coverage < 60000) {
    return '覆盖不足 1 分钟'
  }

  return `覆盖 ${formatLatencyHistoryGap(coverage)}`
}

const formatMetricTimestamp = (timestamp?: string | number | null) => {
  const parsed =
    typeof timestamp === 'number' ? timestamp : timestamp ? Date.parse(timestamp) : Number.NaN

  if (!Number.isFinite(parsed)) {
    return '--'
  }

  const date = dayjs(parsed)
  const format = date.year() === dayjs().year() ? 'MM-DD HH:mm' : 'YYYY-MM-DD HH:mm'

  return date.format(format)
}

const formatMetricSampleRange = (
  source: string,
  firstTimestamp?: string | number | null,
  lastTimestamp?: string | number | null,
) => {
  const first = formatMetricTimestamp(firstTimestamp)
  const last = formatMetricTimestamp(lastTimestamp)

  if (first === '--' && last === '--') {
    return `${source}首样本 -- · 最后 --`
  }

  if (first === last) {
    return `${source}样本 ${first}`
  }

  return `${source}首样本 ${first} · 最后 ${last}`
}

const formatMetricUpdatedAt = (timestamp?: string | number | null) =>
  `更新 ${formatMetricTimestamp(timestamp)}`

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

const buildSparklineSvg = (
  history: { delay: number }[],
  windowSize = LATENCY_BAR_SEGMENTS,
  compact = false,
) => {
  const recent = history.slice(-windowSize)
  const stats = getLatencyStats(history, windowSize)

  if (!stats || stats.successTests < 2) {
    return null
  }

  const successfulRecent = recent.filter((item) => item.delay > NOT_CONNECTED)
  const visualRange = Math.max(stats.max - stats.min, 80, Math.round(stats.avg * 0.25))
  let lowerBound = Math.max(0, stats.avg - visualRange / 2)
  let upperBound = lowerBound + visualRange

  if (lowerBound > stats.min) {
    lowerBound = stats.min
    upperBound = lowerBound + visualRange
  }
  if (upperBound < stats.max) {
    upperBound = stats.max
    lowerBound = Math.max(0, upperBound - visualRange)
  }

  const chartHeight = compact ? 12 : CHART_HEIGHT
  const chartPaddingY = compact ? 2 : CHART_PADDING_Y
  const plotWidth = CHART_WIDTH - CHART_PADDING_X * 2
  const plotHeight = chartHeight - chartPaddingY * 2
  const xStep = plotWidth / (successfulRecent.length - 1)
  const points = successfulRecent.map((item, index) => {
    const normalized = (item.delay - lowerBound) / (upperBound - lowerBound || 1)
    const clamped = Math.min(1, Math.max(0, normalized))

    return {
      x: CHART_PADDING_X + index * xStep,
      y: chartPaddingY + (1 - clamped) * plotHeight,
      delay: item.delay,
    }
  })

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')

  const areaPath = `${path} L ${CHART_WIDTH - CHART_PADDING_X} ${chartHeight - chartPaddingY} L ${CHART_PADDING_X} ${chartHeight - chartPaddingY} Z`
  const color = getLatencyColorValue(stats.avg)
  const circles = points
    .map(
      (point) =>
        `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${compact ? '0.9' : '1.45'}" fill="${color}" fill-opacity="${compact ? '0.9' : '1'}" />`,
    )
    .join('')

  return `
    <svg viewBox="0 0 ${CHART_WIDTH} ${chartHeight}" class="${compact ? 'h-6' : 'h-14'} w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="latency-area-${props.name.replace(/[^a-zA-Z0-9_-]/g, '-')}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.1" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <line x1="${CHART_PADDING_X}" y1="${chartHeight / 2}" x2="${CHART_WIDTH - CHART_PADDING_X}" y2="${chartHeight / 2}" stroke="currentColor" stroke-opacity="${compact ? '0.08' : '0.12'}" stroke-dasharray="4 4" />
      ${compact ? '' : `<path d="${areaPath}" fill="url(#latency-area-${props.name.replace(/[^a-zA-Z0-9_-]/g, '-')})" />`}
      <path d="${path}" fill="none" stroke="${color}" stroke-width="${compact ? '1' : '1.25'}" stroke-opacity="${compact ? '0.9' : '1'}" stroke-linecap="round" stroke-linejoin="round" />
      ${circles}
    </svg>
  `
}

const buildLatencyStatusTimeline = (
  history: { delay: number; time?: string }[],
  compact = false,
) => {
  const recentHistory = history.slice(-LATENCY_DETAIL_SEGMENTS)
  const emptySegments: { delay?: number; time?: string }[] = Array.from(
    { length: Math.max(0, LATENCY_DETAIL_SEGMENTS - recentHistory.length) },
    () => ({}),
  )
  const timeline = document.createElement('div')
  const header = document.createElement('div')
  const strip = document.createElement('div')
  const stats = getLatencyStats(history, LATENCY_DETAIL_SEGMENTS)
  const sampleCount = recentHistory.length
  const sampledSuccessRate =
    stats && sampleCount ? Math.round((stats.successTests / sampleCount) * 100) : 0

  timeline.className = compact
    ? 'mt-2 rounded-md bg-base-200/40 p-1.5'
    : 'mt-2.5 rounded-lg bg-base-200/40 p-2'
  header.className = compact
    ? 'mb-1 flex items-center justify-between text-[10px] text-base-content/55'
    : 'mb-1.5 flex items-center justify-between text-[11px] text-base-content/55'

  const oldestLabel = document.createElement('span')
  oldestLabel.textContent = '本机近30次'
  const successLabel = document.createElement('span')
  successLabel.className =
    stats && sampledSuccessRate >= 80
      ? 'text-low-latency'
      : stats && sampledSuccessRate >= 50
        ? 'text-medium-latency'
        : 'text-high-latency'
  successLabel.textContent = stats
    ? `${sampledSuccessRate}% 可用 · ${sampleCount}/${stats.totalTests} 记录`
    : '暂无记录'
  const newestLabel = document.createElement('span')
  newestLabel.textContent = '现在'
  header.append(oldestLabel, successLabel, newestLabel)

  strip.className = 'flex w-full items-end gap-1'

  let previousTimestamp: number | undefined

  for (const item of [...emptySegments, ...recentHistory]) {
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
  }

  timeline.append(header, strip)
  return timeline
}

const createLatencyDetailsTip = () => {
  const compact = isCompactLatencyDetails()
  const availabilityHistory = getDisplayHistoryByName(
    props.name,
    props.groupName,
    LATENCY_AVAILABILITY_MAX_SAMPLES,
  )
  const history = availabilityHistory.slice(-LATENCY_DETAIL_SEGMENTS)
  const newestFirst = [...history].reverse()
  const stats = getLatencyStats(history, LATENCY_DETAIL_SEGMENTS)
  const root = document.createElement('div')

  root.className = compact
    ? 'max-h-[min(68vh,28rem)] w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-base-content/10 bg-base-200 p-2 text-base-content shadow-2xl'
    : 'w-76 max-w-[calc(100vw-2rem)] rounded-xl border border-base-content/10 bg-base-200 p-3 text-base-content shadow-2xl'

  const title = document.createElement('div')
  title.className = compact
    ? 'mb-1.5 truncate text-center text-sm font-bold'
    : 'mb-2 truncate text-center text-base font-bold'
  title.textContent = node.value?.name ?? props.name
  root.append(title)

  if (stats) {
    const chart = document.createElement('div')
    chart.className = compact ? 'rounded-lg bg-base-300/50 p-1.5' : 'rounded-lg bg-base-300/50 p-2'

    const statLine = document.createElement('div')
    statLine.className = 'mb-1 flex items-center justify-between text-xs text-base-content/75'

    const min = document.createElement('span')
    min.textContent = `${stats.min}ms`
    const avg = document.createElement('span')
    avg.textContent = `avg: ${stats.avg}ms`
    const max = document.createElement('span')
    max.textContent = `${stats.max}ms`
    statLine.append(min, avg, max)
    chart.append(statLine)

    const svg = buildSparklineSvg(history, LATENCY_DETAIL_SEGMENTS, compact)
    const sparkline = document.createElement('div')

    sparkline.className = compact ? 'text-base-content/60' : 'text-base-content/80'
    sparkline.innerHTML =
      svg ??
      `<div class="flex ${compact ? 'h-6' : 'h-14'} items-center justify-center text-xs text-base-content/50">not enough data</div>`
    chart.append(sparkline)

    chart.append(buildLatencyStatusTimeline(history, compact))

    const stabilityLine = document.createElement('div')
    const jitter = document.createElement('span')
    jitter.textContent = `jitter: ${stats.jitter}ms`

    const lossMetric = getSmartLossMetric()
    const lossRate = getPrimarySmartLossRate(lossMetric)

    const loss = document.createElement('span')

    stabilityLine.className =
      'mt-1 flex items-center justify-between gap-2 text-xs text-base-content/75'
    jitter.className = 'justify-self-start'
    loss.className = `font-semibold ${getSmartLossRateClass(lossMetric)}`
    loss.textContent = `loss: ${formatSmartLossRate(lossRate)}`
    if (lossMetric?.current !== undefined && lossMetric?.cumulative !== undefined) {
      loss.title = `当前 ${formatSmartLossRate(lossMetric.current)} · 累计 ${formatSmartLossRate(lossMetric.cumulative)}`
    }
    stabilityLine.append(jitter, loss)

    chart.append(stabilityLine)

    const sharedMetricsResolution = getSharedMetricsResolution()
    const sharedMetrics = sharedMetricsResolution?.metrics
    const availabilityLine = document.createElement('div')
    const availabilityMain = document.createElement('div')
    const coverage = document.createElement('div')
    const sampleDetail = document.createElement('div')
    const availability = document.createElement('span')
    const failure = document.createElement('span')
    const availabilityNote = sharedMetrics
      ? getSharedMetricsNote(sharedMetrics)
      : {
          className: 'text-medium-latency',
          text: '采集中',
        }

    availabilityLine.className = 'mt-1 grid gap-0.5 text-xs text-base-content/65'
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
    coverage.className = compact
      ? 'text-[10px] text-base-content/45'
      : 'text-[11px] text-base-content/45'
    sampleDetail.className = coverage.className
    coverage.textContent = sharedMetrics
      ? formatMetricSampleRange('R5S', sharedMetrics.firstSampleAt, sharedMetrics.lastSampleAt)
      : formatMetricSampleRange('R5S', null, null)
    sampleDetail.textContent = sharedMetrics
      ? `R5S样本 ${sharedMetrics.successCount}/${sharedMetrics.sampleCount} · ${formatMetricUpdatedAt(proxyMetricsUpdatedAt.value)}`
      : `R5S样本 0/0 · ${formatMetricUpdatedAt(proxyMetricsUpdatedAt.value)}`
    coverage.title = sharedMetrics
      ? `${formatLatencyAvailabilityCoverage(sharedMetrics.coverageSeconds * 1000, sharedMetrics.sampleCount)} · ${formatMetricUpdatedAt(proxyMetricsUpdatedAt.value)}`
      : `等待 R5S 指标助手采集 · ${formatMetricUpdatedAt(proxyMetricsUpdatedAt.value)}`
    sampleDetail.title = coverage.title
    availabilityMain.append(availability)
    if (failure.textContent) {
      availabilityMain.append(failure)
    }
    availabilityLine.append(availabilityMain, coverage, sampleDetail)
    chart.append(availabilityLine)
    root.append(chart)
  }

  const list = document.createElement('div')
  list.className = compact
    ? 'mt-1.5 flex max-h-32 flex-col gap-0.5 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:color-mix(in_oklch,var(--color-base-content)_30%,transparent)_transparent]'
    : 'mt-2 flex max-h-52 flex-col gap-1 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:color-mix(in_oklch,var(--color-base-content)_30%,transparent)_transparent]'

  if (!newestFirst.length) {
    const empty = document.createElement('div')
    empty.className = 'py-4 text-center text-sm text-base-content/60'
    empty.textContent = t('noLatencyHistory')
    list.append(empty)
  }

  let previousTimestamp: number | undefined

  for (const item of newestFirst) {
    const timestamp = Date.parse(item.time)

    if (
      previousTimestamp &&
      Number.isFinite(timestamp) &&
      previousTimestamp - timestamp > LATENCY_HISTORY_GAP_THRESHOLD
    ) {
      const gap = document.createElement('div')
      gap.className = compact
        ? 'grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 px-1 py-0.5 text-[10px] text-base-content/45'
        : 'grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-1.5 py-0.5 text-[11px] text-base-content/45'

      const before = document.createElement('span')
      before.className = 'h-px bg-base-content/10'
      const label = document.createElement('span')
      label.textContent = `间隔 ${formatLatencyHistoryGap(previousTimestamp - timestamp)}`
      const after = document.createElement('span')
      after.className = 'h-px bg-base-content/10'

      gap.append(before, label, after)
      list.append(gap)
    }

    if (Number.isFinite(timestamp)) {
      previousTimestamp = timestamp
    }

    const row = document.createElement('div')
    row.className = compact
      ? 'grid grid-cols-[auto_1fr_auto] items-center gap-1.5 rounded-md px-1 py-1 hover:bg-base-300/60'
      : 'grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-base-300/60'

    const status = document.createElement('span')
    status.className =
      item.delay > NOT_CONNECTED
        ? `${compact ? 'size-2' : 'size-2.5'} rounded-full bg-low-latency`
        : `${compact ? 'size-2' : 'size-2.5'} rounded-full bg-base-content/35`

    const time = document.createElement('time')
    time.className = `${compact ? 'text-[11px]' : 'text-xs'} truncate text-base-content/75`
    time.textContent = dayjs(item.time).format('YYYY-MM-DD HH:mm:ss')

    const delay = document.createElement('span')
    delay.className = `${compact ? 'text-[11px]' : 'text-xs'} font-semibold ${getLatencyTextClass(item.delay)}`
    delay.textContent = item.delay > NOT_CONNECTED ? `${item.delay}ms` : '---'

    row.append(status, time, delay)
    list.append(row)
  }

  root.append(list)
  return root
}

const handlerLatencyDetailsTip = (e: Event) => {
  if (!hasLatencyDetailsHistory()) return

  const compact = isCompactLatencyDetails()
  const anchor = e.currentTarget as HTMLElement | null

  if (!anchor) return

  const tipEvent = Object.create(e, {
    currentTarget: {
      value: anchor,
    },
  }) as Event
  const cardRect = (cardRef.value as HTMLElement | undefined)?.getBoundingClientRect()
  const mobilePlacement = cardRect && cardRect.top < window.innerHeight * 0.42 ? 'bottom' : 'top'
  const placement = compact ? mobilePlacement : 'top'

  showTip(tipEvent, createLatencyDetailsTip(), {
    animation: 'fade',
    appendTo: document.body,
    delay: [0, 120],
    duration: [70, 50],
    interactive: true,
    interactiveBorder: compact ? 10 : 8,
    interactiveDebounce: 40,
    hideOnClick: false,
    maxWidth: 'none',
    offset: [0, 8],
    onShown: (instance) => {
      bindLatencyDetailsTipHoverBoundary(anchor, instance.popper, compact)
    },
    onDestroy: cleanupLatencyDetailsTip,
    placement,
    popperOptions: {
      strategy: 'fixed',
      modifiers: [
        {
          name: 'preventOverflow',
          options: {
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
}

const latencyTipAnimationClass = ref<string[]>([])
const handlerLatencyTest = async () => {
  if (isLatencyTesting.value) return

  isLatencyTesting.value = true
  try {
    await proxyLatencyTest(props.name, getTestUrl(props.groupName), undefined, props.groupName)
    isLatencyTesting.value = false
  } catch {
    isLatencyTesting.value = false
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

onUnmounted(cleanupLatencyDetailsTip)
</script>

<style scoped>
.tooltip:before {
  z-index: 20;
}
</style>
