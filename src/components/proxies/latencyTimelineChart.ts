import type {
  ProxyMetricsTimelineBucket,
  ProxyMetricsTimelineResponse,
  ProxyMetricsTimelineWindow,
} from '@/api/metricsHelper'
import {
  buildProxyMetricsTimelineChartModel,
  getProxyMetricsTimelineHeight,
  getProxyMetricsTimelineTooltipMode,
  LATENCY_TIMELINE_WINDOWS,
} from '@/helper/proxyMetricsTimeline'

export type LatencyTimelineChartState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'empty'; timeline: ProxyMetricsTimelineResponse }
  | { status: 'ready'; timeline: ProxyMetricsTimelineResponse }

export type LatencyTimelineInputMode = 'coarse' | 'fine'

export type LatencyTimelineChartOptions = {
  compact: boolean
  inputMode: LatencyTimelineInputMode
  onBucketActivate?: (bucket: ProxyMetricsTimelineBucket) => void
  onBucketChange?: (bucket: ProxyMetricsTimelineBucket) => void
  onInteraction?: () => void
  onWindowChange?: (window: ProxyMetricsTimelineWindow) => void
  selectedBucket?: ProxyMetricsTimelineBucket
  sourceLabel?: string
  window?: ProxyMetricsTimelineWindow
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const ACTIVATION_DRAG_THRESHOLD = 8
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
  const headerInfo = document.createElement('div')
  const title = document.createElement('span')
  const source = document.createElement('span')
  const rangeControl = document.createElement('div')
  const body = document.createElement('div')
  const height = getProxyMetricsTimelineHeight(options.compact)
  const isCoarseInput = options.inputMode === 'coarse'
  const usesInformationCardActivation = options.compact || isCoarseInput
  const selectedWindow = options.window ?? '24h'

  section.className = 'mt-2 border-t border-base-content/10 pt-2'
  header.className = 'mb-1.5 flex min-w-0 items-center justify-between gap-2 text-xs'
  headerInfo.className = 'flex min-w-0 flex-1 items-center gap-2'
  title.className = 'shrink-0 font-semibold text-base-content/80'
  title.textContent = `${selectedWindow} 延迟`
  source.className = 'min-w-0 flex-1 truncate text-[10px] text-base-content/45'
  source.textContent = options.sourceLabel ? `来源 ${options.sourceLabel}` : ''
  headerInfo.append(title)
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
  body.style.height = `${height}px`
  section.append(header, body)

  if (state.status === 'loading') {
    appendEmptyState(body, `正在读取 R5S ${selectedWindow} 延迟趋势`)
    return section
  }
  if (state.status === 'unavailable') {
    appendEmptyState(body, `R5S ${selectedWindow} 延迟趋势暂不可用`)
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
    'pointer-events': 'all',
    width: model.axes.plotRight - model.axes.plotLeft,
    x: model.axes.plotLeft,
    y: model.axes.plotTop,
  })

  plot.append(hoverLine, hoverPoint, chartHitArea)
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
    'mt-1 grid min-h-12 grid-cols-2 gap-x-3 gap-y-0.5 rounded-md border border-base-content/10 bg-base-100/70 px-2 py-1.5 text-[10px] text-base-content/70'

  body.append(svg)
  section.append(tooltip)

  if (state.status === 'empty') {
    const empty = document.createElement('div')

    empty.className =
      'pointer-events-none absolute inset-0 flex items-center justify-center pb-5 text-xs text-base-content/50'
    empty.textContent = `${selectedWindow} 延迟趋势暂无样本`
    body.append(empty)
  }

  let selectedBucket: ProxyMetricsTimelineBucket | undefined
  let selectedBucketIndex = -1

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

    selectedBucket = bucket
    selectedBucketIndex = bucketIndex
    const canActivate = usesInformationCardActivation && bucket.sampleCount > 0

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
    options.onBucketChange?.(bucket)
  }

  const getChartPosition = (clientX: number) => {
    const rect = svg.getBoundingClientRect()

    if (!rect.width) {
      return undefined
    }

    const svgX = ((clientX - rect.left) / rect.width) * width
    const guideX = Math.max(model.axes.plotLeft, Math.min(model.axes.plotRight, svgX))
    const relativeX = (guideX - model.axes.plotLeft) / (model.axes.plotRight - model.axes.plotLeft)
    const bucketIndex = Math.max(
      0,
      Math.min(timeline.buckets.length - 1, Math.floor(relativeX * timeline.buckets.length)),
    )

    return { bucketIndex, guideX }
  }

  const updateHover = (event: Pick<PointerEvent, 'clientX'>) => {
    options.onInteraction?.()
    const position = getChartPosition(event.clientX)

    if (position) {
      renderBucket(position.bucketIndex, position.guideX)
    }
  }

  const clearHover = () => {
    hoverLine.setAttribute('visibility', 'hidden')
    hoverPoint.setAttribute('visibility', 'hidden')
  }

  const activateSelectedBucket = () => {
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

      if (position && position.bucketIndex !== selectedBucketIndex) {
        renderBucket(position.bucketIndex, position.guideX)
      }
      activateSelectedBucket()
    })
  } else {
    tooltip.addEventListener('click', () => {
      if (suppressNextCardClick) {
        suppressNextCardClick = false
        return
      }

      activateSelectedBucket()
    })
    tooltip.addEventListener('pointerdown', (event) => {
      beginCardGesture('pointer', event.pointerId, event.clientX, event.clientY)
    })
    tooltip.addEventListener('pointermove', (event) => {
      updateCardGesture('pointer', event.pointerId, event.clientX, event.clientY)
    })
    tooltip.addEventListener('pointerup', (event) => {
      endCardGesture('pointer', event.pointerId)
    })
    tooltip.addEventListener('pointercancel', (event) => {
      endCardGesture('pointer', event.pointerId, true)
    })
    tooltip.addEventListener(
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
    tooltip.addEventListener(
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
    tooltip.addEventListener(
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
    tooltip.addEventListener(
      'touchcancel',
      () => {
        if (activeCardGesture?.source === 'touch') {
          endCardGesture('touch', activeCardGesture.id, true)
        }
      },
      { passive: true },
    )
    tooltip.addEventListener('keydown', (event) => {
      if (event.key === ' ') {
        event.preventDefault()
        if (!event.repeat) {
          spacePressed = true
        }
      } else if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault()
        activateSelectedBucket()
      }
    })
    tooltip.addEventListener('keyup', (event) => {
      if (event.key === ' ') {
        event.preventDefault()
        if (spacePressed) {
          spacePressed = false
          activateSelectedBucket()
        }
      }
    })
    tooltip.addEventListener('blur', () => {
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

  if (timeline.buckets.length) {
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
