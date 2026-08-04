import type { ProxyMetricsTimelineResponse } from '@/api/metricsHelper'
import {
  buildProxyMetricsTimelineChartModel,
  getProxyMetricsTimelineHeight,
  getProxyMetricsTimelineTooltipMode,
} from '@/helper/proxyMetricsTimeline'

export type LatencyTimelineChartState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'empty'; timeline: ProxyMetricsTimelineResponse }
  | { status: 'ready'; timeline: ProxyMetricsTimelineResponse }

type LatencyTimelineChartOptions = {
  compact: boolean
  sourceLabel?: string
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
let chartId = 0

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

const appendEmptyState = (body: HTMLElement, message: string) => {
  const placeholder = document.createElement('div')

  placeholder.className =
    'flex h-full items-center justify-center border-y border-base-content/5 text-xs text-base-content/50'
  placeholder.textContent = message
  body.append(placeholder)
}

const appendTooltipLine = (tooltip: HTMLElement, label: string, value: string) => {
  const line = document.createElement('div')
  const name = document.createElement('span')
  const content = document.createElement('span')

  line.className = 'flex items-center justify-between gap-3'
  name.className = 'text-base-content/55'
  name.textContent = label
  content.className = 'font-semibold text-base-content'
  content.textContent = value
  line.append(name, content)
  tooltip.append(line)
}

export const createLatencyTimelineChartSection = (
  state: LatencyTimelineChartState,
  options: LatencyTimelineChartOptions,
): HTMLElement => {
  const section = document.createElement('section')
  const header = document.createElement('div')
  const title = document.createElement('span')
  const source = document.createElement('span')
  const body = document.createElement('div')
  const height = getProxyMetricsTimelineHeight(options.compact)

  section.className = 'mt-2 border-t border-base-content/10 pt-2'
  header.className = 'mb-1.5 flex min-w-0 items-center justify-between gap-2 text-xs'
  title.className = 'shrink-0 font-semibold text-base-content/80'
  title.textContent = '24h 延迟'
  source.className = 'truncate text-[10px] text-base-content/45'
  source.textContent = options.sourceLabel ? `来源 ${options.sourceLabel}` : ''
  header.append(title)
  if (source.textContent) {
    header.append(source)
  }

  body.className = 'relative'
  body.style.height = `${height}px`
  section.append(header, body)

  if (state.status === 'loading') {
    appendEmptyState(body, '正在读取 R5S 24h 趋势')
    return section
  }
  if (state.status === 'unavailable') {
    appendEmptyState(body, 'R5S 24h 趋势暂不可用')
    return section
  }
  const width = options.compact ? 360 : 420
  const timeline = state.timeline
  const tooltipMode = getProxyMetricsTimelineTooltipMode(options.compact)
  const model = buildProxyMetricsTimelineChartModel(timeline, {
    width,
    height,
    padding: {
      top: 8,
      right: 16,
      bottom: 20,
      left: 35,
    },
  })
  const svg = createSvgElement('svg', {
    'aria-label': `24 小时延迟趋势，${timeline.nodeName}`,
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

  plot.append(hoverLine, hoverPoint)
  svg.append(plot)

  for (const tick of model.axes.xTicks) {
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

  const tooltip = document.createElement('div')

  tooltip.dataset.mode = tooltipMode
  tooltip.className =
    'pointer-events-none mt-1 grid min-h-12 grid-cols-2 gap-x-3 gap-y-0.5 rounded-md border border-base-content/10 bg-base-100/70 px-2 py-1.5 text-[10px] text-base-content/70'

  body.append(svg)
  section.append(tooltip)

  if (state.status === 'empty') {
    const empty = document.createElement('div')

    empty.className =
      'pointer-events-none absolute inset-0 flex items-center justify-center pb-5 text-xs text-base-content/50'
    empty.textContent = '24h 趋势暂无样本'
    body.append(empty)
  }

  const renderBucket = (bucketIndex: number) => {
    const bucket = timeline.buckets[bucketIndex]
    const point = model.points[bucketIndex]
    const bucketCenter =
      model.axes.plotLeft +
      ((bucketIndex + 0.5) / timeline.buckets.length) * (model.axes.plotRight - model.axes.plotLeft)

    hoverLine.setAttribute('x1', String(bucketCenter))
    hoverLine.setAttribute('x2', String(bucketCenter))
    hoverLine.setAttribute('visibility', 'visible')

    if (point) {
      hoverPoint.setAttribute('cx', String(point.x))
      hoverPoint.setAttribute('cy', String(point.y))
      hoverPoint.setAttribute('visibility', 'visible')
    } else {
      hoverPoint.setAttribute('visibility', 'hidden')
    }

    tooltip.replaceChildren()
    const time = document.createElement('div')

    time.className = 'col-span-2 whitespace-nowrap font-semibold text-base-content'
    time.textContent = `${formatBucketTime(bucket.start)} - ${formatBucketTime(bucket.end)}`
    tooltip.append(time)

    if (bucket.successCount > 0) {
      appendTooltipLine(tooltip, '平均', `${Math.round(bucket.avgDelay ?? 0)}ms`)
      appendTooltipLine(tooltip, '范围', `${bucket.minDelay ?? 0}-${bucket.maxDelay ?? 0}ms`)
      appendTooltipLine(
        tooltip,
        '波动',
        bucket.jitter === null ? '--' : `${Math.round(bucket.jitter)}ms`,
      )
    } else {
      appendTooltipLine(tooltip, '延迟', bucket.sampleCount ? '测速失败' : '无样本')
    }
    appendTooltipLine(tooltip, '成功', `${bucket.successCount}/${bucket.sampleCount}`)
    appendTooltipLine(tooltip, '失败', String(bucket.failureCount))
  }

  const updateHover = (event: PointerEvent) => {
    const rect = svg.getBoundingClientRect()

    if (!rect.width) {
      return
    }

    const svgX = ((event.clientX - rect.left) / rect.width) * width
    const relativeX = (svgX - model.axes.plotLeft) / (model.axes.plotRight - model.axes.plotLeft)
    const bucketIndex = Math.max(
      0,
      Math.min(timeline.buckets.length - 1, Math.floor(relativeX * timeline.buckets.length)),
    )

    renderBucket(bucketIndex)
  }

  const clearHover = () => {
    hoverLine.setAttribute('visibility', 'hidden')
    hoverPoint.setAttribute('visibility', 'hidden')
  }

  svg.addEventListener('pointermove', updateHover)
  svg.addEventListener('pointerdown', updateHover)
  svg.addEventListener('pointerleave', clearHover)

  if (timeline.buckets.length) {
    let latestSampleIndex = timeline.buckets.length - 1

    for (let index = timeline.buckets.length - 1; index >= 0; index -= 1) {
      if (timeline.buckets[index].sampleCount > 0) {
        latestSampleIndex = index
        break
      }
    }

    renderBucket(latestSampleIndex)
  }

  return section
}
