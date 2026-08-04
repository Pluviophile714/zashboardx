import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return {
        shortCircuit: true,
        url: new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href,
      }
    }

    return nextResolve(specifier, context)
  },
})

const { createLatencyTimelineChartSection, getLatencyTimelineInputMode } =
  await import('../../components/proxies/latencyTimelineChart.ts')

type TestEvent = {
  clientX?: number
  clientY?: number
  changedTouches?: TestTouchList
  defaultPrevented: boolean
  key?: string
  pointerId?: number
  repeat?: boolean
  type: string
  preventDefault: () => void
}

type TestTouch = { clientX: number; clientY: number; identifier: number }
type TestTouchList = { item: (index: number) => TestTouch | null; length: number }

class TestElement {
  attributes = new Map<string, string>()
  children: TestElement[] = []
  classList = {
    add: (...tokens: string[]) => tokens.forEach((token) => this.classNames.add(token)),
    remove: (...tokens: string[]) => tokens.forEach((token) => this.classNames.delete(token)),
  }
  dataset: Record<string, string> = {}
  private classNames = new Set<string>()
  private listeners = new Map<string, ((event: TestEvent) => void)[]>()
  style: Record<string, string> = {}
  tabIndex = -1
  tagName: string
  textContent = ''
  type = ''

  constructor(tagName: string) {
    this.tagName = tagName
  }

  get className() {
    return [...this.classNames].join(' ')
  }

  set className(value: string) {
    this.classNames = new Set(value.split(/\s+/).filter(Boolean))
  }

  addEventListener(type: string, listener: (event: TestEvent) => void) {
    const listeners = this.listeners.get(type) ?? []

    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  append(...children: TestElement[]) {
    this.children.push(...children)
  }

  dispatchEvent(event: TestEvent) {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event)
    }

    return !event.defaultPrevented
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  getBoundingClientRect() {
    return { left: 0, width: 360 }
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }

  replaceChildren(...children: TestElement[]) {
    this.children = children
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
}

class TestDocument {
  createElement(tagName: string) {
    return new TestElement(tagName)
  }

  createElementNS(_namespace: string, tagName: string) {
    return new TestElement(tagName)
  }
}

const createEvent = (
  type: string,
  properties: Omit<Partial<TestEvent>, 'type'> = {},
): TestEvent => {
  const event: TestEvent = {
    defaultPrevented: false,
    preventDefault: () => {
      event.defaultPrevented = true
    },
    type,
    ...properties,
  }

  return event
}

const createTouchList = (...touches: TestTouch[]): TestTouchList => ({
  item: (index) => touches[index] ?? null,
  length: touches.length,
})

const findElements = (element: TestElement, predicate: (element: TestElement) => boolean) => {
  const found = predicate(element) ? [element] : []

  return element.children.reduce(
    (elements, child) => elements.concat(findElements(child, predicate)),
    found,
  )
}

const createTimelineBucket = (index: number, sampleCount: number) => {
  const start = Date.parse('2026-07-04T00:00:00.000Z') + index * 15 * 60 * 1000
  const successCount = sampleCount ? 1 : 0

  return {
    avgDelay: sampleCount ? 100 + index : null,
    end: new Date(start + 15 * 60 * 1000).toISOString(),
    failureCount: 0,
    jitter: null,
    maxDelay: sampleCount ? 110 + index : null,
    minDelay: sampleCount ? 90 + index : null,
    sampleCount,
    start: new Date(start).toISOString(),
    successCount,
  }
}

const renderTimelineChart = (
  callbacks: {
    onBucketActivate?: (bucket: { sampleCount: number }) => void
    onBucketChange?: (bucket: { sampleCount: number }) => void
    onInteraction?: () => void
    onWindowChange?: (window: '1h' | '6h' | '24h') => void
    compact?: boolean
    inputMode?: 'coarse' | 'fine'
  } = {},
) => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: new TestDocument(),
  })

  const section = createLatencyTimelineChartSection(
    {
      status: 'ready',
      timeline: {
        bucketSeconds: 900,
        buckets: [createTimelineBucket(0, 0), createTimelineBucket(1, 1)],
        generatedAt: '2026-07-04T00:30:00.000Z',
        nodeName: 'HK-01',
        windowSeconds: 86_400,
      },
    },
    {
      compact: callbacks.compact ?? false,
      inputMode: callbacks.inputMode ?? 'fine',
      onBucketActivate: callbacks.onBucketActivate,
      onBucketChange: callbacks.onBucketChange,
      onInteraction: callbacks.onInteraction,
      onWindowChange: callbacks.onWindowChange,
      window: '6h',
    },
  ) as unknown as TestElement

  const buttons = findElements(section, (element) => element.tagName === 'button')
  const svg = findElements(section, (element) => element.tagName === 'svg')[0]
  const chartHitArea = findElements(
    section,
    (element) => element.getAttribute('data-chart-hit-target') === 'true',
  )[0]
  const selectedGuide = findElements(
    section,
    (element) => element.getAttribute('data-selected-guide') === 'true',
  )[0]
  const tooltip = findElements(section, (element) => element.className.includes('min-h-12'))[0]

  return { buttons, chartHitArea, section, selectedGuide, svg, tooltip }
}

const proxyNodeCardSource = readFileSync(
  new URL('../../components/proxies/ProxyNodeCard.vue', import.meta.url),
  'utf8',
)
const timelineChartSource = readFileSync(
  new URL('../../components/proxies/latencyTimelineChart.ts', import.meta.url),
  'utf8',
)

test('uses the 24h chart as the only latency line chart in node details', () => {
  assert.match(proxyNodeCardSource, /createLatencyTimelineChartSection/)
  assert.match(proxyNodeCardSource, /buildLatencyStatusTimeline/)
  assert.doesNotMatch(proxyNodeCardSource, /buildSparklineSvg/)
})

test('renders empty timelines on the same concrete-time chart axes', () => {
  assert.match(timelineChartSource, /formatBucketTime\(bucket\.start\)/)
  assert.match(timelineChartSource, /state\.status === 'empty'/)
  assert.doesNotMatch(timelineChartSource, /24h前/)
})

test('keeps the latency range visible while lighter than the average line', () => {
  assert.match(timelineChartSource, /'fill-opacity': 0\.22/)
  assert.match(timelineChartSource, /'stroke-width': options\.compact \? 1\.5 : 1\.75/)
})

test('keeps the final timeline time label inside the mobile detail popover', () => {
  assert.match(proxyNodeCardSource, /w-\[calc\(100vw-0\.5rem\)\]/)
  assert.match(timelineChartSource, /right: 16/)
})

test('keeps node details accessible without a raw sample list', () => {
  assert.match(
    proxyNodeCardSource,
    /\? 'flex max-h-\[min\(68vh,28rem\)\].*touch-pan-y.*overflow-y-auto.*overscroll-contain/,
  )
  assert.match(proxyNodeCardSource, /w-\[28rem\]/)
  assert.doesNotMatch(proxyNodeCardSource, /const list = document\.createElement\('div'\)/)
  assert.match(proxyNodeCardSource, /content\.style\.padding = '0'/)
})

test('uses the same focused information hierarchy on desktop and mobile', () => {
  assert.doesNotMatch(proxyNodeCardSource, /availabilityLine\.append\(coverage, sampleDetail\)/)
  assert.match(
    proxyNodeCardSource,
    /const summaryLine = document\.createElement\('div'\)\r?\n\s*if \(stats\) \{/,
  )
  assert.doesNotMatch(proxyNodeCardSource, /const stabilityLine = document\.createElement/)
  assert.match(timelineChartSource, /getProxyMetricsTimelineHeight\(options\.compact\)/)
})

test('wires input capability independently from compact layout', () => {
  assert.match(proxyNodeCardSource, /inputMode: getLatencyTimelineInputMode\(\)/)
  assert.match(timelineChartSource, /options\.inputMode === 'coarse'/)
})

test('keeps 24h bucket details outside the plot on desktop and mobile', () => {
  assert.match(timelineChartSource, /getProxyMetricsTimelineTooltipMode\(options\.compact\)/)
  assert.match(timelineChartSource, /body\.append\(svg\)\r?\n\s*section\.append\(tooltip\)/)
  assert.doesNotMatch(timelineChartSource, /body\.append\(svg, tooltip\)/)
})

test('dispatches renderer callbacks through the range control and selected chart point', () => {
  const windowChanges: string[] = []
  const bucketChanges: number[] = []
  const bucketActivations: number[] = []
  let interactions = 0
  const { buttons, chartHitArea, svg } = renderTimelineChart({
    onBucketActivate: (bucket) => bucketActivations.push(bucket.sampleCount),
    onBucketChange: (bucket) => bucketChanges.push(bucket.sampleCount),
    onInteraction: () => {
      interactions += 1
    },
    onWindowChange: (window) => windowChanges.push(window),
  })

  assert.equal(buttons.length, 3)
  assert.deepEqual(
    buttons.map((button) => button.textContent),
    ['1h', '6h', '24h'],
  )
  assert.deepEqual(
    buttons.map((button) => button.getAttribute('aria-pressed')),
    ['false', 'true', 'false'],
  )

  buttons[0].dispatchEvent(createEvent('click'))
  svg.dispatchEvent(createEvent('pointermove', { clientX: 40 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 40 }))
  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))

  assert.deepEqual(windowChanges, ['1h'])
  assert.deepEqual(bucketChanges, [1, 0, 1])
  assert.deepEqual(bucketActivations, [1])
  assert.equal(interactions, 4)
})

test('blocks activation for an empty selected chart bucket', () => {
  const bucketActivations: number[] = []
  const { chartHitArea, svg } = renderTimelineChart({
    onBucketActivate: (bucket) => bucketActivations.push(bucket.sampleCount),
  })

  svg.dispatchEvent(createEvent('pointermove', { clientX: 40 }))
  svg.dispatchEvent(createEvent('pointerdown', { clientX: 40, clientY: 10, pointerId: 1 }))
  svg.dispatchEvent(createEvent('pointerup', { clientX: 40, clientY: 10, pointerId: 1 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 40 }))

  assert.deepEqual(bucketActivations, [])
})

test('activates a selected chart bucket after a stationary click', () => {
  const bucketActivations: number[] = []
  const { chartHitArea, svg } = renderTimelineChart({
    onBucketActivate: (bucket) => bucketActivations.push(bucket.sampleCount),
  })

  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  svg.dispatchEvent(createEvent('pointerdown', { clientX: 300, clientY: 10, pointerId: 1 }))
  svg.dispatchEvent(createEvent('pointerup', { clientX: 300, clientY: 10, pointerId: 1 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))

  assert.deepEqual(bucketActivations, [1])
})

test('suppresses a selected chart bucket click generated after a drag or cancellation', () => {
  const bucketActivations: number[] = []
  let interactions = 0
  const { chartHitArea, svg } = renderTimelineChart({
    onBucketActivate: (bucket) => bucketActivations.push(bucket.sampleCount),
    onInteraction: () => {
      interactions += 1
    },
  })

  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  svg.dispatchEvent(createEvent('pointerdown', { clientX: 300, clientY: 10, pointerId: 1 }))
  svg.dispatchEvent(createEvent('pointermove', { clientX: 330, clientY: 10, pointerId: 1 }))
  svg.dispatchEvent(createEvent('pointerup', { clientX: 330, clientY: 10, pointerId: 1 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 330 }))
  svg.dispatchEvent(createEvent('pointerdown', { clientX: 300, clientY: 10, pointerId: 2 }))
  svg.dispatchEvent(createEvent('pointercancel', { pointerId: 2 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  svg.dispatchEvent(
    createEvent('touchstart', {
      changedTouches: createTouchList({ clientX: 10, clientY: 10, identifier: 3 }),
    }),
  )
  svg.dispatchEvent(
    createEvent('touchmove', {
      changedTouches: createTouchList({ clientX: 30, clientY: 10, identifier: 3 }),
    }),
  )
  svg.dispatchEvent(
    createEvent('touchend', {
      changedTouches: createTouchList({ clientX: 30, clientY: 10, identifier: 3 }),
    }),
  )
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 30 }))

  assert.deepEqual(bucketActivations, [])
  assert.equal(interactions, 9)
})

test('keeps the selected bucket information card display-only', () => {
  const bucketActivations: number[] = []
  const { svg, tooltip } = renderTimelineChart({
    onBucketActivate: (bucket) => bucketActivations.push(bucket.sampleCount),
  })

  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  tooltip.dispatchEvent(createEvent('click'))
  tooltip.dispatchEvent(createEvent('keydown', { key: 'Enter', repeat: false }))
  tooltip.dispatchEvent(createEvent('keyup', { key: ' ' }))

  assert.equal(tooltip.getAttribute('role'), null)
  assert.equal(tooltip.tabIndex, -1)
  assert.deepEqual(bucketActivations, [])
})

test('uses the populated information card as the mobile activation target', () => {
  const bucketActivations: number[] = []
  const { chartHitArea, svg, tooltip } = renderTimelineChart({
    compact: true,
    inputMode: 'coarse',
    onBucketActivate: (bucket) => bucketActivations.push(bucket.sampleCount),
  })

  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  assert.equal(tooltip.getAttribute('role'), 'button')
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  assert.deepEqual(bucketActivations, [])

  tooltip.dispatchEvent(createEvent('pointerdown', { clientX: 20, clientY: 20, pointerId: 1 }))
  tooltip.dispatchEvent(createEvent('pointerup', { clientX: 20, clientY: 20, pointerId: 1 }))
  tooltip.dispatchEvent(createEvent('click'))
  assert.deepEqual(bucketActivations, [1])
})

test('keeps mobile chart drags from activating while preserving card tap entry', () => {
  const bucketActivations: number[] = []
  const { chartHitArea, svg, tooltip } = renderTimelineChart({
    compact: true,
    inputMode: 'coarse',
    onBucketActivate: (bucket) => bucketActivations.push(bucket.sampleCount),
  })

  svg.dispatchEvent(createEvent('pointerdown', { clientX: 300, clientY: 10, pointerId: 1 }))
  svg.dispatchEvent(createEvent('pointermove', { clientX: 330, clientY: 10, pointerId: 1 }))
  svg.dispatchEvent(createEvent('pointerup', { clientX: 330, clientY: 10, pointerId: 1 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  assert.deepEqual(bucketActivations, [])

  tooltip.dispatchEvent(
    createEvent('touchstart', {
      changedTouches: createTouchList({ clientX: 20, clientY: 20, identifier: 2 }),
    }),
  )
  tooltip.dispatchEvent(
    createEvent('touchend', {
      changedTouches: createTouchList({ clientX: 20, clientY: 20, identifier: 2 }),
    }),
  )
  tooltip.dispatchEvent(createEvent('click'))
  assert.deepEqual(bucketActivations, [1])
})

test('selects activation surface from pointer capability instead of compact layout', () => {
  const narrowFineDesktop = renderTimelineChart({
    compact: true,
    inputMode: 'fine',
  })
  const fineActivations: number[] = []
  const fineChart = renderTimelineChart({
    compact: true,
    inputMode: 'fine',
    onBucketActivate: (bucket) => fineActivations.push(bucket.sampleCount),
  })

  fineChart.svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  fineChart.chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  assert.deepEqual(fineActivations, [1])
  assert.equal(narrowFineDesktop.tooltip.getAttribute('role'), null)

  const coarseWideTouchActivations: number[] = []
  const coarseWideTouch = renderTimelineChart({
    compact: false,
    inputMode: 'coarse',
    onBucketActivate: (bucket) => coarseWideTouchActivations.push(bucket.sampleCount),
  })

  coarseWideTouch.svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  coarseWideTouch.chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  coarseWideTouch.tooltip.dispatchEvent(createEvent('click'))
  assert.deepEqual(coarseWideTouchActivations, [1])
  assert.equal(coarseWideTouch.tooltip.getAttribute('role'), 'button')
})

test('derives coarse input safely from pointer media and touch points', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { matchMedia: () => ({ matches: true }) },
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { maxTouchPoints: 0 },
    })
    assert.equal(getLatencyTimelineInputMode(), 'coarse')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { matchMedia: () => ({ matches: false }) },
    })
    assert.equal(getLatencyTimelineInputMode(), 'fine')

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {},
    })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { maxTouchPoints: 2 },
    })
    assert.equal(getLatencyTimelineInputMode(), 'coarse')
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete (globalThis as { window?: unknown }).window
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete (globalThis as { navigator?: unknown }).navigator
  }
})

test('reports mobile information-card pointer and touch gesture activity', () => {
  let interactions = 0
  const { tooltip } = renderTimelineChart({
    compact: false,
    inputMode: 'coarse',
    onInteraction: () => {
      interactions += 1
    },
  })

  tooltip.dispatchEvent(createEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 1 }))
  tooltip.dispatchEvent(createEvent('pointermove', { clientX: 30, clientY: 10, pointerId: 1 }))
  tooltip.dispatchEvent(createEvent('pointercancel', { pointerId: 1 }))
  assert.equal(interactions, 3)

  interactions = 0
  tooltip.dispatchEvent(
    createEvent('touchstart', {
      changedTouches: createTouchList({ clientX: 10, clientY: 10, identifier: 2 }),
    }),
  )
  tooltip.dispatchEvent(
    createEvent('touchmove', {
      changedTouches: createTouchList({ clientX: 30, clientY: 10, identifier: 2 }),
    }),
  )
  tooltip.dispatchEvent(
    createEvent('touchend', {
      changedTouches: createTouchList({ clientX: 30, clientY: 10, identifier: 2 }),
    }),
  )
  assert.equal(interactions, 3)
})

test('activates the bucket represented by the current guide through the chart-wide hit layer', () => {
  const bucketActivations: number[] = []
  const { chartHitArea, selectedGuide, svg } = renderTimelineChart({
    onBucketActivate: (bucket) => bucketActivations.push(bucket.sampleCount),
  })

  svg.dispatchEvent(createEvent('pointermove', { clientX: 40 }))
  assert.equal(selectedGuide.getAttribute('visibility'), 'visible')
  assert.equal(Number(selectedGuide.getAttribute('x1')), (40 / 360) * 420)
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 40 }))
  assert.deepEqual(bucketActivations, [])

  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  assert.equal(Number(selectedGuide.getAttribute('x1')), (300 / 360) * 420)
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  assert.deepEqual(bucketActivations, [1])
})

test('shows selected bucket jitter next to its range details', () => {
  assert.match(timelineChartSource, /'波动'/)
})

test('inspects recent samples by touch on mobile and hover on desktop', () => {
  assert.match(proxyNodeCardSource, /getLatencySampleIndexAtPointer/)
  assert.match(proxyNodeCardSource, /if \(summaryLine\) \{/)
  assert.match(proxyNodeCardSource, /strip\.addEventListener\('pointerdown', selectPointerSample\)/)
  assert.match(proxyNodeCardSource, /strip\.addEventListener\('pointermove', selectPointerSample\)/)
  assert.match(
    proxyNodeCardSource,
    /strip\.addEventListener\('pointerup', scheduleSummaryRestore\)/,
  )
  assert.match(proxyNodeCardSource, /strip\.addEventListener\('pointerleave', restoreSummary\)/)
  assert.match(proxyNodeCardSource, /LATENCY_SAMPLE_DETAIL_RESTORE_DELAY = 1000/)
})

test('repositions an expanded desktop detail popover within the available viewport space', () => {
  assert.match(proxyNodeCardSource, /repositionLatencyDetailsTip/)
  assert.match(proxyNodeCardSource, /instance\.setProps\(\{ placement \}\)/)
  assert.match(proxyNodeCardSource, /root\.style\.maxHeight/)
  assert.match(proxyNodeCardSource, /altAxis: true/)
})

test('keeps the node title from shrinking when a detail popover is height constrained', () => {
  assert.match(
    proxyNodeCardSource,
    /title\.className = compact\r?\n\s*\? 'mb-1\.5 shrink-0 truncate/,
  )
})

test('uses cached R5S samples for the first-level latency stability bar', () => {
  assert.match(
    proxyNodeCardSource,
    /const getLatencyStabilityHistory = \(\) => \{[\s\S]*proxyMetricsSamplesMap\.value[\s\S]*return r5sSamples[\s\S]*getHistoryByName/,
  )
  assert.match(proxyNodeCardSource, /const history = getLatencyStabilityHistory\(\)/)
})

test('uses a short desktop hover delay without changing the mobile long-press trigger', () => {
  assert.match(proxyNodeCardSource, /delay: \[500, 120\]/)
  assert.match(proxyNodeCardSource, /touch: \['hold', 500\]/)
})

test('refreshes the open R5S detail list when the shared 24h metrics update', () => {
  assert.match(proxyNodeCardSource, /watch\(\s*proxyMetricsUpdatedAt/)
  assert.match(proxyNodeCardSource, /refreshProxyMetricsSamples\(sourceName, \{[\s\S]*force: true/)
  assert.match(proxyNodeCardSource, /instance\.setContent\(createLatencyDetailsTip\(\)\)/)
})

test('forces a fresh R5S sample request whenever node details open', () => {
  assert.match(
    proxyNodeCardSource,
    /const getR5sLatencyDetailsSamplesRefresh = \(\) => \{[\s\S]*return refreshR5sLatencyDetailsSamples\(true\)/,
  )
})

test('opens and closes latency details with a fresh 24h range state', () => {
  assert.match(proxyNodeCardSource, /let activeLatencyTimelineWindow[^\n]*= '24h'/)
  assert.match(
    proxyNodeCardSource,
    /const resetLatencyBucketDrilldownState = \([\s\S]*activeLatencyTimelineWindow = '24h'/,
  )
  assert.match(
    proxyNodeCardSource,
    /const handlerLatencyDetailsTip = async[\s\S]*resetLatencyBucketDrilldownState\(\)/,
  )
  assert.match(proxyNodeCardSource, /onDestroy:[\s\S]*resetLatencyBucketDrilldownState\(\)/)
})

test('range changes exit drilldown and request the selected timeline', () => {
  assert.match(
    proxyNodeCardSource,
    /const changeLatencyTimelineWindow = \([\s\S]*exitLatencyBucketDrilldown\(\)[\s\S]*activeLatencyTimelineWindow = window[\s\S]*refreshLatencyDetailsTimeline\([^)]*window/,
  )
  assert.match(
    proxyNodeCardSource,
    /createLatencyTimelineChartSection\([\s\S]*onWindowChange: changeLatencyTimelineWindow/,
  )
  assert.match(proxyNodeCardSource, /window: activeLatencyTimelineWindow/)
  assert.match(
    proxyNodeCardSource,
    /getProxyMetricsTimelineCacheKey\(sourceName, window\)[\s\S]*refreshProxyMetricsTimeline\(sourceName, \{ window \}\)/,
  )
})

test('guards stale timeline responses before mutating unavailable state', () => {
  const refreshStart = proxyNodeCardSource.indexOf('const refreshLatencyDetailsTimeline =')
  const refreshEnd = proxyNodeCardSource.indexOf(
    'const changeLatencyTimelineWindow =',
    refreshStart,
  )
  const refreshSource = proxyNodeCardSource.slice(refreshStart, refreshEnd)
  const guardIndex = refreshSource.indexOf('requestGeneration !== latencyTimelineRequestGeneration')
  const deleteIndex = refreshSource.indexOf('unavailableLatencyTimelineKeys.delete')
  const addIndex = refreshSource.indexOf('unavailableLatencyTimelineKeys.add')

  assert.ok(guardIndex >= 0)
  assert.ok(deleteIndex > guardIndex)
  assert.ok(addIndex > guardIndex)
})

test('enters bucket drilldown only after a successful exact-interval response', () => {
  assert.match(
    proxyNodeCardSource,
    /refreshProxyMetricsBucketSamples\(sourceName, bucket\.start, bucket\.end\)/,
  )
  assert.match(
    proxyNodeCardSource,
    /if \([\s\S]*!response[\s\S]*\) \{\s*return\s*\}[\s\S]*activeLatencyTimelineBucket = bucket[\s\S]*mapLatencyBucketSamplesToHistory\(response\.samples, NOT_CONNECTED\)[\s\S]*restartLatencyBucketDrilldownResetTimer\(\)/,
  )
  assert.match(
    proxyNodeCardSource,
    /resolveLatencyStripHistory\(\{[\s\S]*mode: activeLatencyTimelineBucket \? 'bucket' : 'recent'/,
  )
})

test('renders every raw bucket record and uses its exact interval title', () => {
  assert.match(
    proxyNodeCardSource,
    /formatLatencyBucketTitle\(activeLatencyTimelineBucket, latencyBucketHistory\.length\)/,
  )
  assert.match(proxyNodeCardSource, /preserveAll: Boolean\(activeLatencyTimelineBucket\)/)
  assert.match(
    proxyNodeCardSource,
    /const displayedHistory = options\.preserveAll\s*\? history\s*:\s*history\.slice\(-LATENCY_DETAIL_SEGMENTS\)/,
  )
})

test('restarts the eight-second drilldown timer from chart and strip activity', () => {
  assert.match(proxyNodeCardSource, /const LATENCY_BUCKET_DRILLDOWN_RESET_DELAY = 8000/)
  assert.match(
    proxyNodeCardSource,
    /latencyBucketDrilldownResetTimer = window\.setTimeout\([\s\S]*LATENCY_BUCKET_DRILLDOWN_RESET_DELAY/,
  )
  assert.match(
    proxyNodeCardSource,
    /createLatencyTimelineChartSection\([\s\S]*onInteraction: restartLatencyBucketDrilldownResetTimer/,
  )
  assert.match(
    proxyNodeCardSource,
    /buildLatencyStatusTimeline\([\s\S]*onInteraction: restartLatencyBucketDrilldownResetTimer/,
  )
})

test('a second activation exits immediately and teardown clears timer and requests', () => {
  assert.match(
    proxyNodeCardSource,
    /const activateLatencyTimelineBucket = async[\s\S]*if \(activeLatencyTimelineBucket\) \{\s*exitLatencyBucketDrilldown\(true\)\s*return/,
  )
  assert.match(
    proxyNodeCardSource,
    /const resetLatencyBucketDrilldownState = \([\s\S]*clearLatencyBucketDrilldownResetTimer\(\)[\s\S]*latencyBucketRequestGeneration \+= 1/,
  )
  assert.match(
    proxyNodeCardSource,
    /onUnmounted\(\(\) => \{[\s\S]*resetLatencyBucketDrilldownState\(\)/,
  )
})
