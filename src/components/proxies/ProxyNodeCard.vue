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
    @pointermove="handlerLatencyDetailsTip"
    @contextmenu.stop.prevent="handlerLatencyTest"
  >
    <div
      class="w-full flex-1 text-sm"
      :class="truncateProxyName && 'truncate'"
      @mouseenter="checkTruncation"
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

    <div class="flex h-4 w-full items-center justify-between">
      <span
        :class="`truncate text-xs tracking-tight ${active ? 'text-primary-content' : 'text-base-content/60'}`"
        @mouseenter="checkTruncation"
      >
        {{ typeDescription }}
      </span>
      <LatencyTag
        :class="[isSmallCard && 'h-4! w-8! rounded-md!', 'shrink-0']"
        :name="node.name"
        :loading="isLatencyTesting"
        :group-name="groupName"
        :disable-history-tip="true"
        @click.stop="handlerLatencyTest"
      />
    </div>

    <div
      class="flex w-full gap-px overflow-hidden rounded-full"
      :class="isSmallCard ? 'h-1' : 'h-1.5'"
      aria-hidden="true"
      @pointermove.stop="handlerLatencyDetailsTip"
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
import { checkTruncation, useTooltip } from '@/helper/tooltip'
import { scrollIntoCenter } from '@/helper/utils'
import {
  getDisplayHistoryByName,
  getHistoryByName,
  getIPv6ByName,
  getTestUrl,
  proxyLatencyTest,
  proxyMap,
} from '@/store/proxies'
import {
  IPv6test,
  lowLatency,
  mediumLatency,
  proxyCardSize,
  proxySortType,
  truncateProxyName,
} from '@/store/settings'
import { smartWeightsMap } from '@/store/smart'
import dayjs from 'dayjs'
import { twMerge } from 'tailwind-merge'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LatencyTag from './LatencyTag.vue'
import ProxyIcon from './ProxyIcon.vue'

const LATENCY_BAR_SEGMENTS = 10
const LATENCY_DETAIL_SEGMENTS = 30
const CHART_WIDTH = 160
const CHART_HEIGHT = 58
const CHART_PADDING_X = 8
const CHART_PADDING_Y = 8
const { t } = useI18n()
const { showTip } = useTooltip()
const MOBILE_LATENCY_DETAILS_BACKDROP_ID = 'proxy-latency-mobile-details-backdrop'
const MOBILE_LATENCY_DETAILS_SHEET_ID = 'proxy-latency-mobile-details-sheet'
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

const buildLatencyHistoryStrip = (history: { delay: number; time?: string }[], compact = false) => {
  const recentHistory = history.slice(-LATENCY_DETAIL_SEGMENTS)
  const emptySegments: { delay?: number; time?: string }[] = Array.from(
    { length: Math.max(0, LATENCY_DETAIL_SEGMENTS - recentHistory.length) },
    () => ({}),
  )
  const strip = document.createElement('div')

  strip.className = 'mt-2 flex w-full gap-1'

  for (const item of [...emptySegments, ...recentHistory]) {
    const segment = document.createElement('div')

    segment.className = 'min-w-0 flex-1'
    segment.style.height = compact ? '14px' : '18px'
    segment.style.borderRadius = '2px'
    segment.style.backgroundColor =
      item.delay === undefined
        ? 'color-mix(in oklch, var(--color-base-content) 14%, transparent)'
        : getLatencyColorValue(item.delay)
    segment.style.opacity = item.delay === undefined ? '0.75' : '1'

    if (item.time) {
      segment.title =
        item.delay && item.delay > NOT_CONNECTED
          ? `${dayjs(item.time).format('YYYY-MM-DD HH:mm:ss')} ${item.delay}ms`
          : `${dayjs(item.time).format('YYYY-MM-DD HH:mm:ss')} ---`
    }

    strip.append(segment)
  }

  return strip
}

const createLatencyDetailsTip = () => {
  const compact = isCompactLatencyDetails()
  const history = getDisplayHistoryByName(props.name, props.groupName, LATENCY_DETAIL_SEGMENTS)
  const recent = history.slice(-LATENCY_BAR_SEGMENTS)
  const newestFirst = [...recent].reverse()
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

    chart.append(buildLatencyHistoryStrip(history, compact))

    const stabilityLine = document.createElement('div')
    stabilityLine.className = 'mt-1 flex items-center justify-between text-xs text-base-content/75'
    const jitter = document.createElement('span')
    jitter.textContent = `jitter: ${stats.jitter}ms`
    const success = document.createElement('span')
    success.textContent = `${stats.successTests}/${stats.totalTests} (${stats.successRate}%)`
    stabilityLine.append(jitter, success)
    chart.append(stabilityLine)
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

  for (const item of newestFirst) {
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

const showMobileLatencyDetailsTip = () => {
  const key = `${props.groupName ?? ''}\n${props.name}`
  const existingSheet = document.getElementById(MOBILE_LATENCY_DETAILS_SHEET_ID)

  if (existingSheet?.dataset.latencyKey === key) return

  document.getElementById(MOBILE_LATENCY_DETAILS_BACKDROP_ID)?.remove()

  const backdrop = document.createElement('div')
  const sheet = createLatencyDetailsTip()

  backdrop.id = MOBILE_LATENCY_DETAILS_BACKDROP_ID
  backdrop.className = 'fixed inset-0 z-9999 bg-transparent'
  backdrop.style.zIndex = '9999'
  backdrop.addEventListener('pointerdown', () => backdrop.remove())

  sheet.id = MOBILE_LATENCY_DETAILS_SHEET_ID
  sheet.dataset.latencyKey = key
  sheet.style.position = 'fixed'
  sheet.style.left = '8px'
  sheet.style.right = '8px'
  sheet.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 5rem)'
  sheet.style.width = 'auto'
  sheet.style.maxHeight = 'min(52dvh, 26rem)'
  sheet.style.zIndex = '10000'
  sheet.addEventListener('pointerdown', (event) => event.stopPropagation())

  backdrop.append(sheet)
  document.body.append(backdrop)
}

const handlerLatencyDetailsTip = (e: Event) => {
  if (!getDisplayHistoryByName(props.name, props.groupName, LATENCY_DETAIL_SEGMENTS).length) return

  if (isCompactLatencyDetails()) {
    showMobileLatencyDetailsTip()
    return
  }

  const tipEvent = Object.create(e, {
    currentTarget: {
      value: cardRef.value ?? e.currentTarget,
    },
  }) as Event

  showTip(tipEvent, createLatencyDetailsTip(), {
    appendTo: document.body,
    delay: [350, 180],
    interactive: true,
    interactiveBorder: 24,
    interactiveDebounce: 120,
    hideOnClick: false,
    maxWidth: 'none',
    offset: [0, 8],
    placement: 'top',
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
            fallbackPlacements: ['top', 'bottom', 'right', 'left'],
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
    await proxyLatencyTest(props.name, getTestUrl(props.groupName))
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
</script>

<style scoped>
.tooltip:before {
  z-index: 20;
}
</style>
