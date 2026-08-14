import type {
  ProxyMetricsSample,
  ProxyMetricsTimelineBucket,
  ProxyMetricsTimelineResponse,
  ProxyMetricsTimelineWindow,
} from '@/api/metricsHelper'
import {
  buildProxyMetricsSampleChartModel,
  buildProxyMetricsTimelineChartModel,
  getProxyMetricsSampleJitter,
  getProxyMetricsSampleWindow,
  getProxyMetricsTimelineHeight,
  getProxyMetricsTimelineTooltipMode,
  LATENCY_TIMELINE_WINDOWS,
} from '@/helper/proxyMetricsTimeline'

export type LatencyTimelineChartState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | {
      samples?: ProxyMetricsSample[]
      status: 'empty'
      timeline: ProxyMetricsTimelineResponse
    }
  | {
      samples?: ProxyMetricsSample[]
      status: 'ready'
      timeline: ProxyMetricsTimelineResponse
    }
  | {
      samples?: ProxyMetricsSample[]
      status: 'syncing'
      timeline: ProxyMetricsTimelineResponse
    }

export type LatencyTimelineInputMode = 'coarse' | 'fine'

export type LatencyTimelineChartOptions = {
  animateWindowTransition?: boolean
  compact: boolean
  inputMode: LatencyTimelineInputMode
  onBucketActivate?: (bucket: ProxyMetricsTimelineBucket) => void
  onBucketChange?: (bucket: ProxyMetricsTimelineBucket) => void
  onSampleActivate?: (sample: ProxyMetricsSample) => void
  onInteraction?: () => void
  onWindowChange?: (window: ProxyMetricsTimelineWindow) => void
  selectedBucket?: ProxyMetricsTimelineBucket
  selectedSample?: ProxyMetricsSample
  sourceLabel?: string
  window?: ProxyMetricsTimelineWindow
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const ACTIVATION_DRAG_THRESHOLD = 8
const LATENCY_TIMELINE_SECTION_HEIGHT = {
  compact: 360,
  desktop: 420,
} as const
let chartId = 0

export const getLatencyTimelineInputMode = (): LatencyTimelineInputMode => {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'
    } catch {
      // Fall through to touch-point detection when pointer media is unavailable.
    }
  }

  if (
    typeof navigator !== 'undefined' &&
    Number.isFinite(navigator.maxTouchPoints) &&
    navigator.maxTouchPoints > 0
  ) {
    return 'coarse'
  }

  return 'fine'
}

const createSvgElement = (tagName: string, attributes: Record<string, string | number> = {}) => {
  const element = document.createElementNS(SVG_NAMESPACE, tagName)

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value))
  }

  return element
}

const formatBucketTime = (timestamp: string) => {
  const date = new Date(timestamp)

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

const formatBucketDateTime = (timestamp: string) => {
  const date = new Date(timestamp)

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

const formatLatencyRange = (min: number | null, max: number | null) => {
  if (min === null || max === null) {
    return '--'
  }

  return min === max ? `${Math.round(min)}ms` : `${Math.round(min)}-${Math.round(max)}ms`
}

const appendWindowMetric = (grid: HTMLElement, label: string, value: string) => {
  const item = document.createElement('div')
  const name = document.createElement('div')
  const content = document.createElement('div')

  item.className = 'min-w-0 rounded-md border border-base-content/10 bg-base-200/30 p-2'
  name.className = 'text-[10px] text-base-content/55'
  name.textContent = label
  content.className = 'mt-0.5 truncate text-sm font-semibold text-base-content'
  content.textContent = value
  item.append(name, content)
  grid.append(item)
}

const appendEmptyState = (body: HTMLElement, message: string) => {
  const placeholder = document.createElement('div')

  placeholder.className =
    'flex h-full items-center justify-center border-y border-base-content/5 text-xs text-base-content/50'
  placeholder.textContent = message
  body.append(placeholder)
}

export const createLatencyTimelineChartSection = (
  state: LatencyTimelineChartState,
  options: LatencyTimelineChartOptions,
): HTMLElement => {
  const section = document.createElement('section')
  const header = document.createElement('div')
  const headerInfo = document.createElement('div')
  const title = document.createElement('span')
  const source = document.createElement('span')
  const rangeControl = document.createElement('div')
  const body = document.createElement('div')
  const height = getProxyMetricsTimelineHeight(options.compact)
  const isCoarseInput = options.inputMode === 'coarse'
  const selectedWindow = options.window ?? '1h'
  const showsBucketDetails = selectedWindow !== '1h'
  const usesInformationCardActivation = options.compact || isCoarseInput
  const isSyncing = state.status === 'syncing'

  section.className = 'mt-2 border-t border-base-content/10 pt-2'
  section.style.height = `${
    options.compact
      ? LATENCY_TIMELINE_SECTION_HEIGHT.compact
      : LATENCY_TIMELINE_SECTION_HEIGHT.desktop
  }px`
  header.className = 'mb-1.5 flex min-w-0 items-center justify-between gap-2 text-xs'
  headerInfo.className = 'flex min-w-0 flex-1 items-center gap-2'
  title.className = 'shrink-0 font-semibold text-base-content/80'
  title.textContent = `${selectedWindow} 延迟`
  source.className = 'min-w-0 flex-1 truncate text-[10px] text-base-content/45'
  source.textContent = options.sourceLabel ? `来源 ${options.sourceLabel}` : ''
  headerInfo.append(title)
  if (selectedWindow === '1h') {
    const jitter = document.createElement('span')
    const windowJitter =
      state.status === 'ready' || state.status === 'empty' || state.status === 'syncing'
        ? state.samples?.length
          ? getProxyMetricsSampleJitter(state.samples)
          : state.timeline.jitter
        : null

    jitter.className = 'shrink-0 text-[10px] text-base-content/55'
    jitter.textContent = `1h 抖动: ${windowJitter === null ? '--' : `${Math.round(windowJitter)}ms`}`
    headerInfo.append(jitter)
  }
  if (source.textContent) {
    headerInfo.append(source)
  }
  rangeControl.className =
    'inline-flex h-6 shrink-0 overflow-hidden rounded-md border border-base-content/15 bg-base-200/40'
  rangeControl.setAttribute('aria-label', '延迟时间范围')
  for (const window of LATENCY_TIMELINE_WINDOWS) {
    const button = document.createElement('button')

    button.type = 'button'
    button.className =
      'h-6 w-8 border-r border-base-content/10 text-[10px] last:border-r-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary'
    button.textContent = window
    button.setAttribute('aria-pressed', String(window === selectedWindow))
    button.setAttribute('aria-label', `${window} 延迟`)
    if (window === selectedWindow) {
      button.classList.add('bg-base-100', 'font-semibold', 'text-base-content')
    } else {
      button.classList.add('text-base-content/55')
    }
    button.addEventListener('click', () => {
      options.onInteraction?.()
      if (window !== selectedWindow) {
        options.onWindowChange?.(window)
      }
    })
    rangeControl.append(button)
  }
  header.append(headerInfo, rangeControl)

  body.className = 'relative'
  body.dataset.role = 'latency-timeline-visual'
  if (options.animateWindowTransition) {
    body.classList.add('latency-timeline-window-enter')
  }
  body.style.height = `${height}px`
  section.append(header)

  if (state.status === 'loading') {
    section.append(body)
    appendEmptyState(body, `正在读取 R5S ${selectedWindow} 延迟趋势`)
    return section
  }
  if (state.status === 'unavailable') {
    section.append(body)
    appendEmptyState(body, `R5S ${selectedWindow} 延迟趋势暂不可用`)
    return section
  }
  const width = options.compact ? 360 : 420
  const timeline = state.timeline
  const samples = selectedWindow === '1h' ? (state.samples ?? []) : []
  const usesRawSamples = selectedWindow === '1h'
  const sampleWindow = usesRawSamples
    ? getProxyMetricsSampleWindow(samples, timeline.windowSeconds)
    : undefined
  const sampleJitter = usesRawSamples ? getProxyMetricsSampleJitter(samples) : timeline.jitter
  if (isSyncing) {
    const syncStatus = document.createElement('div')
    const dataTimestamp = usesRawSamples
      ? samples.at(-1)?.timestamp
      : timeline.snapshotAt || timeline.generatedAt

    syncStatus.className =
      'mb-1 flex items-center justify-between gap-2 text-[10px] text-base-content/55'
    syncStatus.dataset.role = 'timeline-sync-status'
    syncStatus.textContent = `图表同步中${
      dataTimestamp ? ` · 数据截至 ${formatBucketDateTime(dataTimestamp)}` : ''
    }`
    body.classList.add('opacity-60', 'blur-[0.5px]')
    body.setAttribute('aria-busy', 'true')
    section.append(syncStatus)
  }
  section.append(body)
  const tooltipMode = getProxyMetricsTimelineTooltipMode(options.compact)
  const windowSummary = selectedWindow === '1h' ? document.createElement('div') : undefined
  const samplePoint = windowSummary ? document.createElement('div') : undefined
  const samplePointLabel = samplePoint ? document.createElement('span') : undefined
  const samplePointValue = samplePoint ? document.createElement('span') : undefined
  const metricsGrid = windowSummary ? document.createElement('div') : undefined

  if (windowSummary && samplePoint && samplePointLabel && samplePointValue && metricsGrid) {
    const successfulSamples = samples.filter(
      (sample) => sample.success && sample.delay !== null && Number.isFinite(sample.delay),
    )
    const successfulBuckets = timeline.buckets.filter(
      (bucket) =>
        bucket.successCount > 0 &&
        bucket.avgDelay !== null &&
        bucket.minDelay !== null &&
        bucket.maxDelay !== null,
    )
    const sampleCount = usesRawSamples
      ? samples.length
      : timeline.buckets.reduce((total, bucket) => total + bucket.sampleCount, 0)
    const successCount = usesRawSamples
      ? successfulSamples.length
      : timeline.buckets.reduce((total, bucket) => total + bucket.successCount, 0)
    const weightedAverage = usesRawSamples
      ? successfulSamples.length
        ? Math.round(
            successfulSamples.reduce((total, sample) => total + (sample.delay ?? 0), 0) /
              successfulSamples.length,
          )
        : null
      : successfulBuckets.length
        ? Math.round(
            successfulBuckets.reduce(
              (total, bucket) => total + (bucket.avgDelay ?? 0) * bucket.successCount,
              0,
            ) / Math.max(1, successCount),
          )
        : null
    const minDelay =
      successfulSamples.length && usesRawSamples
        ? Math.min(...successfulSamples.map((sample) => sample.delay as number))
        : successfulBuckets.length
          ? Math.min(...successfulBuckets.map((bucket) => bucket.minDelay as number))
          : null
    const maxDelay =
      successfulSamples.length && usesRawSamples
        ? Math.max(...successfulSamples.map((sample) => sample.delay as number))
        : successfulBuckets.length
          ? Math.max(...successfulBuckets.map((bucket) => bucket.maxDelay as number))
          : null

    windowSummary.className = 'mt-2 grid gap-1.5'
    samplePoint.className =
      'flex min-h-9 items-center justify-between gap-2 rounded-md border border-base-content/15 bg-base-200/30 px-2.5 py-1.5 text-xs'
    samplePoint.dataset.role = '1h-sample-point'
    samplePointLabel.className = 'shrink-0 text-base-content/55'
    samplePointLabel.textContent = '当前采样点'
    samplePointValue.className = 'truncate font-semibold text-base-content'
    metricsGrid.className = 'grid grid-cols-2 gap-1.5 sm:grid-cols-4'
    metricsGrid.dataset.role = '1h-summary-metrics'
    samplePointValue.textContent = '--'
    appendWindowMetric(
      metricsGrid,
      '平均延迟',
      weightedAverage === null ? '--' : `${weightedAverage}ms`,
    )
    appendWindowMetric(
      metricsGrid,
      '1h 抖动',
      sampleJitter === null ? '--' : `${Math.round(sampleJitter)}ms`,
    )
    appendWindowMetric(metricsGrid, '延迟范围', formatLatencyRange(minDelay, maxDelay))
    appendWindowMetric(
      metricsGrid,
      '可用率',
      sampleCount ? `${((successCount / sampleCount) * 100).toFixed(1)}%` : '--',
    )
    samplePoint.append(samplePointLabel, samplePointValue)
    windowSummary.append(samplePoint, metricsGrid)
  }
  const bucketModel = buildProxyMetricsTimelineChartModel(timeline, {
    width,
    height,
    padding: {
      top: 8,
      right: 16,
      bottom: 20,
      left: 35,
    },
  })
  const sampleModel = usesRawSamples
    ? buildProxyMetricsSampleChartModel(samples, {
        width,
        height,
        padding: {
          top: 8,
          right: 16,
          bottom: 20,
          left: 35,
        },
        windowEnd: sampleWindow?.end ?? timeline.buckets.at(-1)?.end ?? '',
        windowStart: sampleWindow?.start ?? timeline.buckets[0]?.start ?? '',
      })
    : undefined
  const model = sampleModel ?? bucketModel
  const svg = createSvgElement('svg', {
    'aria-label': `${selectedWindow} 延迟趋势，${timeline.nodeName}`,
    role: 'img',
    viewBox: `0 0 ${width} ${height}`,
  })

  svg.classList.add('block', 'h-full', 'w-full', 'touch-pan-y', 'select-none')

  const clipId = `proxy-latency-timeline-${(chartId += 1)}`
  const definitions = createSvgElement('defs')
  const clipPath = createSvgElement('clipPath', { id: clipId })
  const clipRect = createSvgElement('rect', {
    x: model.axes.plotLeft,
    y: model.axes.plotTop,
    width: model.axes.plotRight - model.axes.plotLeft,
    height: model.axes.plotBottom - model.axes.plotTop,
  })

  clipPath.append(clipRect)
  definitions.append(clipPath)
  svg.append(definitions)

  for (const tick of model.axes.yTicks) {
    const gridLine = createSvgElement('line', {
      x1: model.axes.plotLeft,
      x2: model.axes.plotRight,
      y1: tick.y,
      y2: tick.y,
      stroke: 'currentColor',
      'stroke-dasharray': '3 4',
      'stroke-opacity': 0.1,
    })
    const label = createSvgElement('text', {
      x: model.axes.plotLeft - 4,
      y: tick.y + 3,
      fill: 'currentColor',
      'fill-opacity': 0.5,
      'font-size': 9,
      'letter-spacing': 0,
      'text-anchor': 'end',
    })

    label.textContent = `${tick.value}ms`
    svg.append(gridLine, label)
  }

  const plot = createSvgElement('g', { 'clip-path': `url(#${clipId})` })

  for (const slice of model.statusSlices) {
    plot.append(
      createSvgElement('rect', {
        x: slice.x,
        y: model.axes.plotTop,
        width: Math.max(0.75, slice.width),
        height: model.axes.plotBottom - model.axes.plotTop,
        fill:
          slice.kind === 'failed'
            ? 'var(--color-high-latency, rgb(244, 96, 108))'
            : 'var(--color-medium-latency, rgb(250, 210, 75))',
        'fill-opacity': slice.opacity,
      }),
    )
  }

  for (const path of model.rangePaths) {
    plot.append(
      createSvgElement('path', {
        d: path,
        fill: 'var(--color-low-latency, oklch(0.648 0.15 160))',
        'fill-opacity': 0.22,
      }),
    )
  }

  for (const path of model.averagePaths) {
    plot.append(
      createSvgElement('path', {
        d: path,
        fill: 'none',
        stroke: 'var(--color-low-latency, oklch(0.648 0.15 160))',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-width': options.compact ? 1.5 : 1.75,
      }),
    )
  }

  const hoverLine = createSvgElement('line', {
    'data-selected-guide': 'true',
    y1: model.axes.plotTop,
    y2: model.axes.plotBottom,
    stroke: 'currentColor',
    'stroke-opacity': 0.22,
    'stroke-width': 1,
    visibility: 'hidden',
  })
  const hoverPoint = createSvgElement('circle', {
    r: options.compact ? 2.25 : 2.75,
    fill: 'var(--color-low-latency, oklch(0.648 0.15 160))',
    stroke: 'var(--color-base-200)',
    'stroke-width': 1.5,
    visibility: 'hidden',
  })
  const chartHitArea = createSvgElement('rect', {
    'data-chart-hit-target': 'true',
    fill: 'transparent',
    height: model.axes.plotBottom - model.axes.plotTop,
    'pointer-events': isSyncing ? 'none' : 'all',
    width: model.axes.plotRight - model.axes.plotLeft,
    x: model.axes.plotLeft,
    y: model.axes.plotTop,
  })

  plot.append(hoverLine, hoverPoint, chartHitArea)
  svg.append(plot)

  if (usesRawSamples && sampleModel) {
    for (const tick of sampleModel.axes.xTicks) {
      const label = createSvgElement('text', {
        x: tick.x,
        y: height - 5,
        fill: 'currentColor',
        'fill-opacity': 0.45,
        'font-size': 9,
        'letter-spacing': 0,
        'text-anchor': 'middle',
      })

      label.textContent = formatBucketTime(tick.timestamp)
      svg.append(label)
    }
  } else {
    for (const tick of bucketModel.axes.xTicks) {
      const bucket = timeline.buckets[tick.bucketIndex]
      const label = createSvgElement('text', {
        x: tick.x,
        y: height - 5,
        fill: 'currentColor',
        'fill-opacity': 0.45,
        'font-size': 9,
        'letter-spacing': 0,
        'text-anchor': 'middle',
      })

      label.textContent = formatBucketTime(bucket.start)
      svg.append(label)
    }
  }

  const tooltip = document.createElement('div')

  tooltip.dataset.mode = tooltipMode
  tooltip.dataset.role = 'bucket-summary'
  tooltip.className = 'mt-1 grid gap-1.5'

  body.append(svg)
  if (windowSummary) {
    section.append(windowSummary)
  }
  if (showsBucketDetails) {
    section.append(tooltip)
  }

  if (state.status === 'empty') {
    const empty = document.createElement('div')

    empty.className =
      'pointer-events-none absolute inset-0 flex items-center justify-center pb-5 text-xs text-base-content/50'
    empty.textContent = `${selectedWindow} 延迟趋势暂无样本`
    body.append(empty)
  }

  let selectedBucket: ProxyMetricsTimelineBucket | undefined
  let selectedBucketIndex = -1
  let selectedSample: ProxyMetricsSample | undefined
  let selectedSampleIndex = -1

  const renderBucket = (bucketIndex: number, guideX?: number) => {
    const bucket = timeline.buckets[bucketIndex]
    const point = model.points[bucketIndex]
    const bucketCenter =
      model.axes.plotLeft +
      ((bucketIndex + 0.5) / timeline.buckets.length) * (model.axes.plotRight - model.axes.plotLeft)

    hoverLine.setAttribute('x1', String(guideX ?? bucketCenter))
    hoverLine.setAttribute('x2', String(guideX ?? bucketCenter))
    hoverLine.setAttribute('visibility', 'visible')

    if (point) {
      hoverPoint.setAttribute('cx', String(point.x))
      hoverPoint.setAttribute('cy', String(point.y))
      hoverPoint.setAttribute('visibility', 'visible')
    } else {
      hoverPoint.setAttribute('visibility', 'hidden')
    }

    const canActivate = usesInformationCardActivation && bucket.sampleCount > 0

    if (showsBucketDetails) {
      tooltip.replaceChildren()
      const interval = document.createElement('div')
      const metricsGrid = document.createElement('div')
      const hasSuccessfulLatency =
        bucket.successCount > 0 &&
        bucket.avgDelay !== null &&
        bucket.minDelay !== null &&
        bucket.maxDelay !== null

      interval.dataset.role = 'bucket-summary-interval'
      interval.className =
        'flex min-h-9 items-center rounded-md border border-base-content/15 bg-base-200/30 px-2.5 py-1.5 text-xs font-semibold text-base-content'
      interval.textContent = `${formatBucketTime(bucket.start)} - ${formatBucketTime(bucket.end)}`
      metricsGrid.dataset.role = 'bucket-summary-metrics'
      metricsGrid.className = 'grid grid-cols-2 gap-1.5 sm:grid-cols-4'
      appendWindowMetric(
        metricsGrid,
        '平均延迟',
        hasSuccessfulLatency ? `${Math.round(bucket.avgDelay as number)}ms` : '--',
      )
      appendWindowMetric(
        metricsGrid,
        '桶内抖动',
        hasSuccessfulLatency && bucket.jitter !== null ? `${Math.round(bucket.jitter)}ms` : '--',
      )
      appendWindowMetric(
        metricsGrid,
        '延迟范围',
        hasSuccessfulLatency ? formatLatencyRange(bucket.minDelay, bucket.maxDelay) : '--',
      )
      appendWindowMetric(
        metricsGrid,
        '成功率',
        bucket.sampleCount
          ? `${((bucket.successCount / bucket.sampleCount) * 100).toFixed(1)}%`
          : '--',
      )
      tooltip.append(interval, metricsGrid)

      if (canActivate) {
        tooltip.setAttribute('aria-disabled', 'false')
        tooltip.setAttribute('aria-label', '查看此时间段的测速记录')
        tooltip.setAttribute('role', 'button')
        tooltip.tabIndex = 0
        tooltip.classList.add(
          'cursor-pointer',
          'focus-visible:outline-2',
          'focus-visible:outline-primary',
        )
      } else {
        tooltip.removeAttribute('aria-disabled')
        tooltip.removeAttribute('aria-label')
        tooltip.removeAttribute('role')
        tooltip.removeAttribute('tabindex')
        tooltip.classList.remove(
          'cursor-pointer',
          'focus-visible:outline-2',
          'focus-visible:outline-primary',
        )
      }
    }

    if (!showsBucketDetails && samplePoint) {
      if (canActivate) {
        samplePoint.setAttribute('aria-disabled', 'false')
        samplePoint.setAttribute('aria-label', '查看此时间段的测速记录')
        samplePoint.setAttribute('role', 'button')
        samplePoint.tabIndex = 0
        samplePoint.classList.add(
          'cursor-pointer',
          'focus-visible:outline-2',
          'focus-visible:outline-primary',
        )
      } else {
        samplePoint.removeAttribute('aria-disabled')
        samplePoint.removeAttribute('aria-label')
        samplePoint.removeAttribute('role')
        samplePoint.removeAttribute('tabindex')
        samplePoint.classList.remove(
          'cursor-pointer',
          'focus-visible:outline-2',
          'focus-visible:outline-primary',
        )
      }
    }

    selectedBucket = bucket
    selectedBucketIndex = bucketIndex
    if (samplePointValue) {
      const status =
        bucket.successCount > 0
          ? bucket.failureCount > 0
            ? '部分失败'
            : '成功'
          : bucket.sampleCount > 0
            ? '失败'
            : '无样本'
      const delay =
        bucket.successCount > 0 && bucket.avgDelay !== null
          ? `${Math.round(bucket.avgDelay)}ms`
          : '测速失败'

      samplePointValue.textContent = `${formatBucketDateTime(bucket.start)} · ${delay} · ${status}`
    }
    options.onBucketChange?.(bucket)
  }

  const getSampleGuideX = (sampleIndex: number) => {
    const point = sampleModel?.points[sampleIndex]

    if (point) {
      return point.x
    }

    const failureSlice = sampleModel?.statusSlices.find(
      (slice) => slice.sampleIndex === sampleIndex,
    )

    return failureSlice ? failureSlice.x + failureSlice.width / 2 : model.axes.plotLeft
  }

  const renderSample = (sampleIndex: number, guideX?: number) => {
    const sample = samples[sampleIndex]

    if (!sample || !sampleModel) {
      return
    }

    const point = sampleModel.points[sampleIndex]
    const sampleX = getSampleGuideX(sampleIndex)

    hoverLine.setAttribute('x1', String(guideX ?? sampleX))
    hoverLine.setAttribute('x2', String(guideX ?? sampleX))
    hoverLine.setAttribute('visibility', 'visible')

    if (point) {
      hoverPoint.setAttribute('cx', String(point.x))
      hoverPoint.setAttribute('cy', String(point.y))
      hoverPoint.setAttribute(
        'fill',
        sample.success
          ? 'var(--color-low-latency, oklch(0.648 0.15 160))'
          : 'var(--color-high-latency, rgb(244, 96, 108))',
      )
      hoverPoint.setAttribute('visibility', 'visible')
    } else {
      hoverPoint.setAttribute('visibility', 'hidden')
    }

    if (samplePoint) {
      samplePoint.setAttribute('aria-disabled', 'false')
      samplePoint.setAttribute('aria-label', '查看当前采样记录')
      samplePoint.setAttribute('role', 'button')
      samplePoint.tabIndex = 0
      samplePoint.classList.add(
        'cursor-pointer',
        'focus-visible:outline-2',
        'focus-visible:outline-primary',
      )
    }

    selectedSample = sample
    selectedSampleIndex = sampleIndex
    if (samplePointValue) {
      const success = sample.success && sample.delay !== null
      samplePointValue.textContent = `${formatBucketDateTime(sample.timestamp)} · ${
        success ? `${Math.round(sample.delay as number)}ms` : '测速失败'
      } · ${success ? '成功' : '失败'}`
    }
  }

  const getChartPosition = (clientX: number) => {
    const rect = svg.getBoundingClientRect()

    if (!rect.width) {
      return undefined
    }

    const svgX = ((clientX - rect.left) / rect.width) * width
    const guideX = Math.max(model.axes.plotLeft, Math.min(model.axes.plotRight, svgX))
    const relativeX = (guideX - model.axes.plotLeft) / (model.axes.plotRight - model.axes.plotLeft)

    if (usesRawSamples && sampleModel) {
      const windowStart = Date.parse(sampleWindow?.start ?? timeline.buckets[0]?.start ?? '')
      const windowEnd = Date.parse(sampleWindow?.end ?? timeline.buckets.at(-1)?.end ?? '')
      const timestamp = windowStart + (windowEnd - windowStart) * relativeX
      let sampleIndex = -1
      let closestDistance = Number.POSITIVE_INFINITY

      for (let index = 0; index < samples.length; index += 1) {
        const sampleTimestamp = Date.parse(samples[index].timestamp)
        const distance = Math.abs(sampleTimestamp - timestamp)

        if (Number.isFinite(distance) && distance < closestDistance) {
          closestDistance = distance
          sampleIndex = index
        }
      }

      return {
        guideX: sampleIndex >= 0 ? getSampleGuideX(sampleIndex) : guideX,
        sampleIndex,
      }
    }

    const bucketIndex = Math.max(
      0,
      Math.min(timeline.buckets.length - 1, Math.floor(relativeX * timeline.buckets.length)),
    )

    return { bucketIndex, guideX }
  }

  const updateHover = (event: Pick<PointerEvent, 'clientX'>) => {
    if (isSyncing) return

    options.onInteraction?.()
    const position = getChartPosition(event.clientX)

    if (position) {
      if (usesRawSamples && 'sampleIndex' in position) {
        const sampleIndex = position.sampleIndex

        if (typeof sampleIndex === 'number' && sampleIndex >= 0) {
          renderSample(sampleIndex, position.guideX)
        }
      } else if ('bucketIndex' in position) {
        const bucketIndex = position.bucketIndex

        if (typeof bucketIndex === 'number') {
          renderBucket(bucketIndex, position.guideX)
        }
      }
    }
  }

  const clearHover = () => {
    hoverLine.setAttribute('visibility', 'hidden')
    hoverPoint.setAttribute('visibility', 'hidden')
  }

  const activateSelectedPoint = () => {
    if (isSyncing) return

    if (usesRawSamples) {
      if (selectedSample) {
        options.onInteraction?.()
        options.onSampleActivate?.(selectedSample)
      }
      return
    }

    const bucket = selectedBucket

    if (bucket && bucket.sampleCount > 0) {
      options.onInteraction?.()
      options.onBucketActivate?.(bucket)
    }
  }

  let activeChartGesture:
    | { id: number; source: 'pointer' | 'touch'; startX: number; startY: number }
    | undefined
  let suppressNextChartClick = false

  const beginChartGesture = (
    source: 'pointer' | 'touch',
    id: number,
    clientX: number,
    clientY: number,
  ) => {
    suppressNextChartClick = false
    activeChartGesture = { id, source, startX: clientX, startY: clientY }
  }

  const updateChartGesture = (
    source: 'pointer' | 'touch',
    id: number,
    clientX: number,
    clientY: number,
  ) => {
    if (
      activeChartGesture?.source === source &&
      activeChartGesture.id === id &&
      Math.hypot(clientX - activeChartGesture.startX, clientY - activeChartGesture.startY) >=
        ACTIVATION_DRAG_THRESHOLD
    ) {
      suppressNextChartClick = true
    }
  }

  const endChartGesture = (source: 'pointer' | 'touch', id: number, cancelled = false) => {
    options.onInteraction?.()
    if (activeChartGesture?.source === source && activeChartGesture.id === id) {
      suppressNextChartClick ||= cancelled
      activeChartGesture = undefined
    }
  }

  let activeCardGesture:
    | { id: number; source: 'pointer' | 'touch'; startX: number; startY: number }
    | undefined
  let suppressNextCardClick = false
  let spacePressed = false

  const beginCardGesture = (
    source: 'pointer' | 'touch',
    id: number,
    clientX: number,
    clientY: number,
  ) => {
    options.onInteraction?.()
    suppressNextCardClick = false
    activeCardGesture = { id, source, startX: clientX, startY: clientY }
  }

  const updateCardGesture = (
    source: 'pointer' | 'touch',
    id: number,
    clientX: number,
    clientY: number,
  ) => {
    options.onInteraction?.()
    if (
      activeCardGesture?.source === source &&
      activeCardGesture.id === id &&
      Math.hypot(clientX - activeCardGesture.startX, clientY - activeCardGesture.startY) >=
        ACTIVATION_DRAG_THRESHOLD
    ) {
      suppressNextCardClick = true
    }
  }

  const endCardGesture = (source: 'pointer' | 'touch', id: number, cancelled = false) => {
    options.onInteraction?.()
    if (activeCardGesture?.source === source && activeCardGesture.id === id) {
      suppressNextCardClick ||= cancelled
      activeCardGesture = undefined
    }
  }

  const findTouch = (touches: TouchList, identifier: number) => {
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index)

      if (touch?.identifier === identifier) {
        return touch
      }
    }

    return undefined
  }

  if (!usesInformationCardActivation) {
    chartHitArea.addEventListener('click', (event) => {
      if (suppressNextChartClick) {
        suppressNextChartClick = false
        return
      }

      const position = getChartPosition(event.clientX)

      if (position && usesRawSamples && 'sampleIndex' in position) {
        const sampleIndex = position.sampleIndex

        if (
          typeof sampleIndex === 'number' &&
          sampleIndex >= 0 &&
          sampleIndex !== selectedSampleIndex
        ) {
          renderSample(sampleIndex, position.guideX)
        }
      } else if (position && 'bucketIndex' in position) {
        const bucketIndex = position.bucketIndex

        if (typeof bucketIndex === 'number' && bucketIndex !== selectedBucketIndex) {
          renderBucket(bucketIndex, position.guideX)
        }
      }
      activateSelectedPoint()
    })
  } else {
    const activationCard = showsBucketDetails ? tooltip : samplePoint

    if (!activationCard) {
      return section
    }

    activationCard.addEventListener('click', () => {
      if (suppressNextCardClick) {
        suppressNextCardClick = false
        return
      }

      activateSelectedPoint()
    })
    activationCard.addEventListener('pointerdown', (event) => {
      beginCardGesture('pointer', event.pointerId, event.clientX, event.clientY)
    })
    activationCard.addEventListener('pointermove', (event) => {
      updateCardGesture('pointer', event.pointerId, event.clientX, event.clientY)
    })
    activationCard.addEventListener('pointerup', (event) => {
      endCardGesture('pointer', event.pointerId)
    })
    activationCard.addEventListener('pointercancel', (event) => {
      endCardGesture('pointer', event.pointerId, true)
    })
    activationCard.addEventListener(
      'touchstart',
      (event) => {
        if (activeCardGesture?.source === 'pointer') {
          return
        }

        const touch = event.changedTouches.item(0)
        if (touch) {
          beginCardGesture('touch', touch.identifier, touch.clientX, touch.clientY)
        }
      },
      { passive: true },
    )
    activationCard.addEventListener(
      'touchmove',
      (event) => {
        if (activeCardGesture?.source !== 'touch') {
          return
        }

        const touch = findTouch(event.changedTouches, activeCardGesture.id)
        if (touch) {
          updateCardGesture('touch', touch.identifier, touch.clientX, touch.clientY)
        }
      },
      { passive: true },
    )
    activationCard.addEventListener(
      'touchend',
      (event) => {
        if (activeCardGesture?.source !== 'touch') {
          return
        }

        const touch = findTouch(event.changedTouches, activeCardGesture.id)
        if (touch) {
          endCardGesture('touch', touch.identifier)
        }
      },
      { passive: true },
    )
    activationCard.addEventListener(
      'touchcancel',
      () => {
        if (activeCardGesture?.source === 'touch') {
          endCardGesture('touch', activeCardGesture.id, true)
        }
      },
      { passive: true },
    )
    activationCard.addEventListener('keydown', (event) => {
      if (event.key === ' ') {
        event.preventDefault()
        if (!event.repeat) {
          spacePressed = true
        }
      } else if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault()
        activateSelectedPoint()
      }
    })
    activationCard.addEventListener('keyup', (event) => {
      if (event.key === ' ') {
        event.preventDefault()
        if (spacePressed) {
          spacePressed = false
          activateSelectedPoint()
        }
      }
    })
    activationCard.addEventListener('blur', () => {
      spacePressed = false
    })
  }
  svg.addEventListener('pointermove', (event) => {
    updateChartGesture('pointer', event.pointerId, event.clientX, event.clientY)
    updateHover(event)
  })
  svg.addEventListener('pointerdown', (event) => {
    beginChartGesture('pointer', event.pointerId, event.clientX, event.clientY)
    updateHover(event)
  })
  svg.addEventListener('pointerup', (event) => {
    endChartGesture('pointer', event.pointerId)
  })
  svg.addEventListener('pointercancel', (event) => {
    endChartGesture('pointer', event.pointerId, true)
  })
  svg.addEventListener(
    'touchstart',
    (event) => {
      if (activeChartGesture?.source === 'pointer') {
        return
      }

      const touch = event.changedTouches.item(0)
      if (touch) {
        beginChartGesture('touch', touch.identifier, touch.clientX, touch.clientY)
        updateHover(touch)
      }
    },
    { passive: true },
  )
  svg.addEventListener(
    'touchmove',
    (event) => {
      if (activeChartGesture?.source !== 'touch') {
        return
      }

      const touch = findTouch(event.changedTouches, activeChartGesture.id)
      if (touch) {
        updateChartGesture('touch', touch.identifier, touch.clientX, touch.clientY)
        updateHover(touch)
      }
    },
    { passive: true },
  )
  svg.addEventListener(
    'touchend',
    (event) => {
      if (activeChartGesture?.source !== 'touch') {
        return
      }

      const touch = findTouch(event.changedTouches, activeChartGesture.id)
      if (touch) {
        endChartGesture('touch', touch.identifier)
      }
    },
    { passive: true },
  )
  svg.addEventListener(
    'touchcancel',
    () => {
      if (activeChartGesture?.source === 'touch') {
        endChartGesture('touch', activeChartGesture.id, true)
      }
    },
    { passive: true },
  )
  if (!usesInformationCardActivation) {
    svg.addEventListener('pointerleave', clearHover)
  }

  if (usesRawSamples && sampleModel && samples.length) {
    const selectedSampleIndex = options.selectedSample
      ? samples.findIndex(
          (sample) =>
            sample.timestamp === options.selectedSample?.timestamp &&
            sample.success === options.selectedSample.success &&
            sample.delay === options.selectedSample.delay,
        )
      : -1

    renderSample(selectedSampleIndex >= 0 ? selectedSampleIndex : samples.length - 1)
  } else if (!usesRawSamples && timeline.buckets.length) {
    let latestSampleIndex = timeline.buckets.length - 1

    for (let index = timeline.buckets.length - 1; index >= 0; index -= 1) {
      if (timeline.buckets[index].sampleCount > 0) {
        latestSampleIndex = index
        break
      }
    }

    const activeBucketIndex = options.selectedBucket
      ? timeline.buckets.findIndex(
          (bucket) =>
            bucket.start === options.selectedBucket?.start &&
            bucket.end === options.selectedBucket.end,
        )
      : -1

    renderBucket(activeBucketIndex >= 0 ? activeBucketIndex : latestSampleIndex)
  }

  return section
}
