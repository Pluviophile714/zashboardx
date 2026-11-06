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

const {
  createLatencyTimelineChartSection,
  formatLatencyTimelineBucketRange,
  formatLatencyTimelineTick,
  getLatencyTimelineInputMode,
} = await import('../../components/proxies/latencyTimelineChart.ts')

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

const createTimelineBucket = (
  index: number,
  sampleCount: number,
  overrides: Partial<{
    avgDelay: number | null
    failureCount: number
    jitter: number | null
    maxDelay: number | null
    minDelay: number | null
    successCount: number
  }> = {},
) => {
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
    ...overrides,
  }
}

const createTimelineSample = (
  timestamp: string,
  delay: number | null,
  success = delay !== null,
) => ({
  delay,
  nodeName: 'HK-01',
  success,
  testUrl: 'https://example.com/generate_204',
  timestamp,
})

const renderTimelineChart = (
  callbacks: {
    animateWindowTransition?: boolean
    buckets?: ReturnType<typeof createTimelineBucket>[]
    onBucketActivate?: (bucket: { sampleCount: number }) => void
    onBucketChange?: (bucket: { sampleCount: number }) => void
    onSampleActivate?: (sample: { timestamp: string }) => void
    onInteraction?: () => void
    onWindowChange?: (window: '1h' | '6h' | '24h') => void
    compact?: boolean
    inputMode?: 'coarse' | 'fine'
    jitter?: number | null
    selectedBucketIndex?: number
    selectedSampleIndex?: number
    samples?: ReturnType<typeof createTimelineSample>[]
    status?: 'empty' | 'loading' | 'ready' | 'syncing' | 'unavailable'
    syncing?: boolean
    window?: '1h' | '6h' | '24h'
  } = {},
) => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: new TestDocument(),
  })

  const buckets = callbacks.buckets ?? [createTimelineBucket(0, 0), createTimelineBucket(1, 1)]
  const status = callbacks.status ?? (callbacks.syncing ? 'syncing' : 'ready')
  const timeline = {
    bucketSeconds: 900,
    buckets,
    generatedAt: '2026-07-04T00:30:00.000Z',
    jitter: callbacks.jitter ?? null,
    nodeName: 'HK-01',
    windowSeconds: 86_400,
  }
  const state =
    status === 'loading' || status === 'unavailable'
      ? { status }
      : {
          status,
          samples: callbacks.samples,
          timeline,
        }
  const section = createLatencyTimelineChartSection(state, {
    animateWindowTransition: callbacks.animateWindowTransition,
    compact: callbacks.compact ?? false,
    inputMode: callbacks.inputMode ?? 'fine',
    onBucketActivate: callbacks.onBucketActivate,
    onBucketChange: callbacks.onBucketChange,
    onSampleActivate: callbacks.onSampleActivate,
    onInteraction: callbacks.onInteraction,
    onWindowChange: callbacks.onWindowChange,
    selectedBucket:
      callbacks.selectedBucketIndex === undefined
        ? undefined
        : buckets[callbacks.selectedBucketIndex],
    selectedSample:
      callbacks.selectedSampleIndex === undefined
        ? undefined
        : callbacks.samples?.[callbacks.selectedSampleIndex],
    window: callbacks.window ?? '6h',
  }) as unknown as TestElement

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
  const bucketSummary = findElements(
    section,
    (element) => element.dataset.role === 'bucket-summary',
  )[0]
  const samplePoint = findElements(
    section,
    (element) => element.dataset.role === '1h-sample-point',
  )[0]

  return {
    bucketSummary,
    buttons,
    chartHitArea,
    samplePoint,
    section,
    selectedGuide,
    svg,
    tooltip: bucketSummary ?? tooltip,
  }
}

const proxyNodeCardSource = readFileSync(
  new URL('../../components/proxies/ProxyNodeCard.vue', import.meta.url),
  'utf8',
)
const timelineChartSource = readFileSync(
  new URL('../../components/proxies/latencyTimelineChart.ts', import.meta.url),
  'utf8',
)
const proxyMetricsTimelineSource = readFileSync(
  new URL('../proxyMetricsTimeline.ts', import.meta.url),
  'utf8',
)
const motionCssSource = readFileSync(
  new URL('../../assets/styles/motion.css', import.meta.url),
  'utf8',
)

test('uses the 24h chart as the only latency line chart in node details', () => {
  assert.match(proxyNodeCardSource, /createLatencyTimelineChartSection/)
  assert.match(proxyNodeCardSource, /buildLatencyStatusTimeline/)
  assert.doesNotMatch(proxyNodeCardSource, /buildSparklineSvg/)
})

test('renders empty timelines on the same concrete-time chart axes', () => {
  assert.match(timelineChartSource, /formatLatencyTimelineTick\(bucket\.start, selectedWindow\)/)
  assert.match(timelineChartSource, /state\.status === 'empty'/)
  assert.doesNotMatch(timelineChartSource, /24h前/)
})

test('uses calendar dates for 7d axis labels and bucket details', () => {
  const start = new Date(2026, 10, 6, 15, 57)
  const end = new Date(2026, 10, 6, 16, 12)

  assert.equal(formatLatencyTimelineTick(start.toISOString(), '7d'), '11-06')
  assert.equal(
    formatLatencyTimelineBucketRange(start.toISOString(), end.toISOString(), '7d'),
    '11-06 15:57 - 16:12',
  )
})

test('keeps the latency range visible while lighter than the average line', () => {
  assert.match(timelineChartSource, /'fill-opacity': 0\.22/)
  assert.match(timelineChartSource, /'stroke-width': options\.compact \? 1\.5 : 1\.75/)
})

test('keeps the final timeline time label inside the mobile detail popover', () => {
  assert.match(proxyNodeCardSource, /w-\[calc\(100vw-0\.5rem\)\]/)
  assert.match(timelineChartSource, /right: 16/)
})

test('keeps a stale chart visible but disables inspection while it is syncing', () => {
  let activations = 0
  const { chartHitArea, section } = renderTimelineChart({
    onBucketActivate: () => {
      activations += 1
    },
    syncing: true,
  })
  const syncStatus = findElements(
    section,
    (element) => element.dataset.role === 'timeline-sync-status',
  )[0]

  assert.ok(chartHitArea)
  assert.equal(chartHitArea.getAttribute('pointer-events'), 'none')
  assert.match(syncStatus.textContent, /图表同步中/)
  assert.match(syncStatus.textContent, /数据截至/)
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  assert.equal(activations, 0)
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
    /const summaryLine = isDrilldown \? document\.createElement\('div'\) : undefined/,
  )
  assert.doesNotMatch(proxyNodeCardSource, /const stabilityLine = document\.createElement/)
  assert.match(timelineChartSource, /getProxyMetricsTimelineHeight\(options\.compact\)/)
})

test('does not render the redundant static min avg max line below the chart', () => {
  assert.doesNotMatch(proxyNodeCardSource, /const getLatencyStats =/)
  assert.doesNotMatch(proxyNodeCardSource, /avg: \$\{stats\.avg\}/)
  assert.match(proxyNodeCardSource, /if \(summaryLine\) \{[\s\S]*chart\.append\(summaryLine\)/)
  assert.match(proxyNodeCardSource, /summaryLine\.style\.display = 'none'/)
})

test('uses the shared recent 30 samples for the first-level latency strip', () => {
  assert.match(proxyNodeCardSource, /const LATENCY_BAR_SEGMENTS = LATENCY_DETAIL_SEGMENTS/)
  assert.match(proxyNodeCardSource, /history\.slice\(-LATENCY_BAR_SEGMENTS\)/)
})

test('does not duplicate the recent 30 strip in the normal secondary popover', () => {
  assert.match(proxyNodeCardSource, /if \(isDrilldown\) \{\r?\n\s*chart\.append\(/)
  assert.match(proxyNodeCardSource, /buildLatencyStatusTimeline\(/)
})

test('gives the timeline chart more room after removing the duplicate strip', () => {
  assert.match(timelineChartSource, /compact: 360,[\s\S]*desktop: 420/)
  assert.match(
    proxyMetricsTimelineSource,
    /getProxyMetricsTimelineHeight = \(compact: boolean\) => \(compact \? 140 : 252\)/,
  )
})

test('wires input capability independently from compact layout', () => {
  assert.match(proxyNodeCardSource, /inputMode: getLatencyTimelineInputMode\(\)/)
  assert.match(timelineChartSource, /options\.inputMode === 'coarse'/)
})

test('keeps 24h bucket details outside the plot on desktop and mobile', () => {
  assert.match(timelineChartSource, /getProxyMetricsTimelineTooltipMode\(options\.compact\)/)
  assert.match(
    timelineChartSource,
    /if \(showsBucketDetails\) \{\r?\n\s*section\.append\(tooltip\)/,
  )
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

  assert.equal(buttons.length, 4)
  assert.deepEqual(
    buttons.map((button) => button.textContent),
    ['1h', '6h', '24h', '7d'],
  )
  assert.deepEqual(
    buttons.map((button) => button.getAttribute('aria-pressed')),
    ['false', 'true', 'false', 'false'],
  )

  buttons[0].dispatchEvent(createEvent('click'))
  svg.dispatchEvent(createEvent('pointermove', { clientX: 40 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 40 }))
  svg.dispatchEvent(createEvent('pointermove', { clientX: 350 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 350 }))

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

test('uses the information card for compact layouts or coarse pointers', () => {
  const compactFineActivations: number[] = []
  const compactFine = renderTimelineChart({
    compact: true,
    inputMode: 'fine',
    onBucketActivate: (bucket) => compactFineActivations.push(bucket.sampleCount),
  })

  compactFine.svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  compactFine.chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  compactFine.tooltip.dispatchEvent(createEvent('click'))
  assert.deepEqual(compactFineActivations, [1])
  assert.equal(compactFine.tooltip.getAttribute('role'), 'button')

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

  const wideFineActivations: number[] = []
  const wideFine = renderTimelineChart({
    compact: false,
    inputMode: 'fine',
    onBucketActivate: (bucket) => wideFineActivations.push(bucket.sampleCount),
  })

  wideFine.svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  wideFine.chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  assert.deepEqual(wideFineActivations, [1])
  assert.equal(wideFine.tooltip.getAttribute('role'), null)
})

test('keeps the selected guide latched on mobile after the pointer leaves', () => {
  const mobile = renderTimelineChart({ compact: true, inputMode: 'fine' })

  mobile.svg.dispatchEvent(createEvent('pointermove', { clientX: 120 }))
  mobile.svg.dispatchEvent(createEvent('pointerleave'))
  assert.equal(mobile.selectedGuide.getAttribute('visibility'), 'visible')

  const desktop = renderTimelineChart({ compact: false, inputMode: 'fine' })

  desktop.svg.dispatchEvent(createEvent('pointermove', { clientX: 120 }))
  desktop.svg.dispatchEvent(createEvent('pointerleave'))
  assert.equal(desktop.selectedGuide.getAttribute('visibility'), 'hidden')
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

test('shows 1h jitter in the header and hides the bucket details card', () => {
  const { section } = renderTimelineChart({ jitter: 23, window: '1h' })

  assert.equal(
    findElements(section, (element) => element.textContent === '1h 抖动: 23ms').length,
    1,
  )
  assert.equal(findElements(section, (element) => element.textContent === '当前采样点').length, 1)
  assert.equal(findElements(section, (element) => element.textContent === '平均延迟').length, 1)
  assert.equal(findElements(section, (element) => element.textContent === '1h 抖动').length, 1)
  assert.equal(findElements(section, (element) => element.textContent === '延迟范围').length, 1)
  assert.equal(findElements(section, (element) => element.textContent === '可用率').length, 1)
  assert.equal(findElements(section, (element) => element.className.includes('min-h-12')).length, 0)
})

test('uses exact raw samples for 1h selection and activation', () => {
  const samples = [
    createTimelineSample('2026-07-04T00:05:11.000Z', 101),
    createTimelineSample('2026-07-04T00:25:14.000Z', 331),
  ]
  const activations: string[] = []
  const { chartHitArea, samplePoint, section, svg } = renderTimelineChart({
    onSampleActivate: (sample) => activations.push(sample.timestamp),
    samples,
    selectedSampleIndex: 0,
    window: '1h',
  })

  assert.equal(
    findElements(samplePoint, (element) => element.textContent.includes('101ms')).length,
    1,
  )
  svg.dispatchEvent(createEvent('pointermove', { clientX: 350 }))
  assert.equal(
    findElements(samplePoint, (element) => element.textContent.includes('331ms')).length,
    1,
  )
  assert.equal(
    findElements(section, (element) => element.dataset.role === '1h-summary-metrics').length,
    1,
  )
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 350 }))
  assert.deepEqual(activations, ['2026-07-04T00:25:14.000Z'])
})

test('does not fall back to minute buckets when 1h raw samples are unavailable', () => {
  const bucketActivations: number[] = []
  const { chartHitArea, svg } = renderTimelineChart({
    onBucketActivate: (bucket) => bucketActivations.push(bucket.sampleCount),
    window: '1h',
  })

  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
  assert.deepEqual(bucketActivations, [])
})

test('uses the 1h current sample row as the mobile raw-sample activation target', () => {
  const activations: string[] = []
  const samples = [createTimelineSample('2026-07-04T00:25:14.000Z', 331)]
  const { samplePoint } = renderTimelineChart({
    compact: true,
    inputMode: 'coarse',
    onSampleActivate: (sample) => activations.push(sample.timestamp),
    samples,
    window: '1h',
  })

  assert.equal(samplePoint.getAttribute('role'), 'button')
  samplePoint.dispatchEvent(createEvent('click'))
  assert.deepEqual(activations, ['2026-07-04T00:25:14.000Z'])
})

test('renders a selected long-window bucket as an interval row and four metric cards', () => {
  const buckets = [
    createTimelineBucket(0, 0),
    createTimelineBucket(1, 5, {
      avgDelay: 107,
      failureCount: 1,
      jitter: 113,
      maxDelay: 278,
      minDelay: 53,
      successCount: 4,
    }),
  ]
  const { section, svg } = renderTimelineChart({ buckets, window: '6h' })

  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  const summaries = findElements(section, (element) => element.dataset.role === 'bucket-summary')
  const metrics = findElements(
    section,
    (element) => element.dataset.role === 'bucket-summary-metrics',
  )

  assert.equal(summaries.length, 1)
  assert.equal(metrics.length, 1)
  assert.equal(
    findElements(summaries[0], (element) => element.dataset.role === 'bucket-summary-interval')
      .length,
    1,
  )
  for (const label of ['平均延迟', '桶内抖动', '延迟范围', '成功率']) {
    assert.equal(findElements(metrics[0], (element) => element.textContent === label).length, 1)
  }
  for (const value of ['107ms', '113ms', '53-278ms', '80.0%']) {
    assert.equal(findElements(metrics[0], (element) => element.textContent === value).length, 1)
  }
})

test('keeps unavailable latency metrics empty for a fully failed bucket', () => {
  const buckets = [
    createTimelineBucket(0, 0),
    createTimelineBucket(1, 2, {
      avgDelay: null,
      failureCount: 2,
      jitter: null,
      maxDelay: null,
      minDelay: null,
      successCount: 0,
    }),
  ]
  const { section } = renderTimelineChart({ buckets, selectedBucketIndex: 1, window: '24h' })
  const metrics = findElements(
    section,
    (element) => element.dataset.role === 'bucket-summary-metrics',
  )[0]

  assert.ok(metrics)
  assert.equal(findElements(metrics, (element) => element.textContent === '--').length, 3)
  assert.equal(findElements(metrics, (element) => element.textContent === '0.0%').length, 1)
})

test('restores the active bucket instead of resetting the guide to the latest sample', () => {
  const selectedSampleCounts: number[] = []

  renderTimelineChart({
    onBucketChange: (bucket) => selectedSampleCounts.push(bucket.sampleCount),
    selectedBucketIndex: 0,
  })

  assert.deepEqual(selectedSampleCounts, [0])
  assert.match(proxyNodeCardSource, /selectedBucket: activeLatencyTimelineBucket \?\? undefined/)
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

test('sets the initial detail popover direction and height before it becomes visible', () => {
  const handlerStart = proxyNodeCardSource.indexOf('const handlerLatencyDetailsTip = async')
  const handlerEnd = proxyNodeCardSource.indexOf('const latencyTipAnimationClass', handlerStart)
  const handlerSource = proxyNodeCardSource.slice(handlerStart, handlerEnd)

  assert.match(
    handlerSource,
    /const initialLayout =[\s\S]*getCompactLatencyDetailsPlacement[\s\S]*getDesktopLatencyDetailsPlacement/,
  )
  assert.match(
    handlerSource,
    /const initialRoot = createLatencyDetailsTip\(\)[\s\S]*initialRoot\.style\.maxHeight = `\$\{initialLayout\.maxHeight\}px`[\s\S]*showTip\(tipEvent, initialRoot/,
  )
  assert.match(handlerSource, /activeLatencyDetailsPlacement = initialLayout\.placement/)
  assert.match(handlerSource, /name: 'flip',[\s\S]*enabled: false/)
})

test('locks the desktop detail direction across range changes and recalculates it on resize', () => {
  const rangeChangeStart = proxyNodeCardSource.indexOf('const changeLatencyTimelineWindow =')
  const rangeChangeEnd = proxyNodeCardSource.indexOf(
    'const activateLatencyTimelineBucket =',
    rangeChangeStart,
  )
  const rangeChangeSource = proxyNodeCardSource.slice(rangeChangeStart, rangeChangeEnd)

  assert.match(proxyNodeCardSource, /activeLatencyDetailsPlacement/)
  assert.match(proxyNodeCardSource, /name: 'flip',[\s\S]*enabled: false/)
  assert.match(
    proxyNodeCardSource,
    /const handleLatencyDetailsViewportChange = \(\) => \{[\s\S]*activeLatencyDetailsPlacement = undefined[\s\S]*repositionLatencyDetailsTip/,
  )
  assert.match(
    proxyNodeCardSource,
    /const bindLatencyDetailsViewportChange = \(\) => \{[\s\S]*addEventListener\('resize',[\s\S]*latencyDetailsViewportCleanup/,
  )
  assert.match(proxyNodeCardSource, /onShown:[\s\S]*bindLatencyDetailsViewportChange\(\)/)
  assert.doesNotMatch(rangeChangeSource, /activeLatencyDetailsPlacement = undefined/)
})

test('preserves the visible popover height while replacing latency detail content', () => {
  assert.match(
    proxyNodeCardSource,
    /const renderActiveLatencyDetailsTip = \([^)]*\) => \{[\s\S]*currentRoot\?\.style\.maxHeight[\s\S]*nextRoot\.style\.maxHeight = currentMaxHeight[\s\S]*instance\.setContent\(nextRoot\)/,
  )
})

test('keeps the node title from shrinking when a detail popover is height constrained', () => {
  assert.match(
    proxyNodeCardSource,
    /title\.className = compact\r?\n\s*\? 'mb-1\.5 shrink-0 truncate/,
  )
})

test('derives latest latency, recent 10, recent 30, and the 1h chart from one shared raw list', () => {
  const sharedSamplesSourceStart = proxyNodeCardSource.indexOf('const getR5sLatencySamples =')
  const stabilitySourceStart = proxyNodeCardSource.indexOf('const getLatencyStabilityHistory =')
  const stabilitySourceEnd = proxyNodeCardSource.indexOf(
    'const latencyStabilityBar =',
    stabilitySourceStart,
  )
  const sharedSamplesSource = proxyNodeCardSource.slice(
    sharedSamplesSourceStart,
    stabilitySourceStart,
  )
  const stabilitySource = proxyNodeCardSource.slice(stabilitySourceStart, stabilitySourceEnd)

  assert.match(
    sharedSamplesSource,
    /proxyMetricsSamplesMap\.value\[[\s\S]*getProxyMetricsSamplesCacheKey\(sourceName, '1h', LATENCY_ONE_HOUR_RAW_LIMIT\)/,
  )
  assert.match(stabilitySource, /const r5s = getR5sLatencySamples\(\)/)
  assert.doesNotMatch(stabilitySource, /metrics\.recentSamples/)
  assert.match(proxyNodeCardSource, /const history = getLatencyStabilityHistory\(\)/)
  assert.match(proxyNodeCardSource, /const recentHistory = history\.slice\(-LATENCY_BAR_SEGMENTS\)/)

  const detailsStart = proxyNodeCardSource.indexOf('const getR5sLatencyHistory =')
  const detailsEnd = proxyNodeCardSource.indexOf(
    'const getLatencyDetailsHistorySource =',
    detailsStart,
  )
  const detailsSource = proxyNodeCardSource.slice(detailsStart, detailsEnd)
  const chartStart = proxyNodeCardSource.indexOf('const getLatencyTimelineChartState =')
  const chartEnd = proxyNodeCardSource.indexOf('const getLocalLatencyDetailsHistory =', chartStart)
  const chartSource = proxyNodeCardSource.slice(chartStart, chartEnd)

  assert.match(detailsSource, /sharedSamples\.slice\(-LATENCY_DETAIL_SEGMENTS\)/)
  assert.match(chartSource, /window === '1h' \? sharedSamples : undefined/)
  assert.doesNotMatch(
    chartSource,
    /snapshot\?\.samples\?\.length \? snapshot\.samples : sharedSamples/,
  )
})

test('uses the shared R5S latest sample for the first-level latency tag', () => {
  assert.match(proxyNodeCardSource, /<LatencyTag[\s\S]*:latency-override="cardLatencyOverride"/)

  const overrideSourceStart = proxyNodeCardSource.indexOf('const cardLatencyOverride = computed')
  const overrideSourceEnd = proxyNodeCardSource.indexOf(
    'const getLatencyTimelineChartState =',
    overrideSourceStart,
  )
  const overrideSource = proxyNodeCardSource.slice(overrideSourceStart, overrideSourceEnd)

  assert.match(overrideSource, /getR5sLatencySamples\(\)\?\.samples\.at\(-1\)/)
  assert.match(overrideSource, /latest\.success && latest\.delay !== null/)
  assert.doesNotMatch(overrideSource, /metrics\.lastDelay/)
  assert.match(overrideSource, /return NOT_CONNECTED/)
})

test('does not fall back to local or detail history while the shared R5S snapshot is warming up', () => {
  const stabilityStart = proxyNodeCardSource.indexOf('const getLatencyStabilityHistory =')
  const stabilityEnd = proxyNodeCardSource.indexOf('const latencyStabilityBar =', stabilityStart)
  const stabilitySource = proxyNodeCardSource.slice(stabilityStart, stabilityEnd)
  const detailsStart = proxyNodeCardSource.indexOf('const getR5sLatencyHistory =')
  const detailsEnd = proxyNodeCardSource.indexOf(
    'const getLatencyDetailsHistorySource =',
    detailsStart,
  )
  const detailsSource = proxyNodeCardSource.slice(detailsStart, detailsEnd)

  assert.match(stabilitySource, /if \(r5s\?\.samples\.length\)/)
  assert.match(stabilitySource, /return \[\]/)
  assert.match(stabilitySource, /if \(getSharedMetricsResolution\(\)\) \{[\s\S]*return \[\]/)
  assert.match(detailsSource, /history: sharedSamples\.slice\(-LATENCY_DETAIL_SEGMENTS\)\.map/)
  assert.doesNotMatch(detailsSource, /detailsSamples/)
  assert.match(
    detailsSource,
    /if \(!sharedSamples\.length && !metricsResolution\) \{\s*return null/s,
  )
})

test('uses only the shared rolling raw list for the 1h chart', () => {
  const chartStart = proxyNodeCardSource.indexOf('const getLatencyTimelineChartState =')
  const chartEnd = proxyNodeCardSource.indexOf('const getLocalLatencyDetailsHistory =', chartStart)
  const chartSource = proxyNodeCardSource.slice(chartStart, chartEnd)

  assert.match(chartSource, /const sharedSamples =/)
  assert.match(chartSource, /const samples = window === '1h' \? sharedSamples : undefined/)
  assert.doesNotMatch(chartSource, /snapshot\?\.samples/)
})

test('waits for the complete one-hour raw cache before plotting the shared samples', () => {
  const chartStart = proxyNodeCardSource.indexOf('const getLatencyTimelineChartState =')
  const chartEnd = proxyNodeCardSource.indexOf('const getLocalLatencyDetailsHistory =', chartStart)
  const chartSource = proxyNodeCardSource.slice(chartStart, chartEnd)

  assert.match(proxyNodeCardSource, /hasProxyMetricsOneHourSamplesReady/)
  assert.match(
    chartSource,
    /if \(window === '1h' && !hasProxyMetricsOneHourSamplesReady\(sourceName\)\) \{\s*return \{ status: 'loading' \}/s,
  )
  assert.match(chartSource, /const samples = window === '1h' \? sharedSamples : undefined/)
})

test('animates first-level latency samples by translating one fixed track', () => {
  assert.doesNotMatch(proxyNodeCardSource, /<TransitionGroup[\s\S]*name="latency-strip"/)
  assert.match(proxyNodeCardSource, /class="latency-strip-track"/)
  assert.match(proxyNodeCardSource, /latency-strip-track--appending/)
  assert.match(proxyNodeCardSource, /latency-strip-track--sliding/)
  assert.match(proxyNodeCardSource, /:key="segment\.identity"/)
  assert.match(proxyNodeCardSource, /requestAnimationFrame/)
  assert.match(proxyNodeCardSource, /@transitionend="finishLatencyStripAnimation"/)
  assert.match(proxyNodeCardSource, /translate3d/)
  assert.match(proxyNodeCardSource, /IntersectionObserver/)
  assert.match(proxyNodeCardSource, /prefers-reduced-motion/)
  assert.match(proxyNodeCardSource, /class="latency-strip-pill[^\"]*"/)
  assert.match(proxyNodeCardSource, /:class="isSmallCard \? 'h-5' : 'h-6'"/)
  assert.match(proxyNodeCardSource, /LATENCY_STRIP_ANIMATION_FALLBACK_DELAY = 300/)
  assert.match(proxyNodeCardSource, /gap: 2px/)
  assert.match(proxyNodeCardSource, /border-radius: 3px/)
  assert.match(proxyNodeCardSource, /justify-items: center/)
  assert.match(proxyNodeCardSource, /width: min\(45%, 8px\)/)
  assert.match(proxyNodeCardSource, /const accent = getLatencyTimelineAccent\(item\.delay\)/)
  assert.match(proxyNodeCardSource, /latency-strip-pill-accent/)
  assert.doesNotMatch(proxyNodeCardSource, /\.latency-strip-pill \{[\s\S]*border-radius: 999px/)
  assert.match(proxyNodeCardSource, /transition: transform 250ms ease-in-out/)
  assert.match(
    proxyNodeCardSource,
    /\.latency-strip-pill:hover[\s\S]*transform: translateY\(-1px\) scaleY\(1\.08\)/,
  )
  assert.doesNotMatch(proxyNodeCardSource, /latencyHeartbeatAgo/)
})

test('uses a short desktop hover delay without changing the mobile long-press trigger', () => {
  assert.match(proxyNodeCardSource, /delay: \[500, 120\]/)
  assert.match(proxyNodeCardSource, /touch: \['hold', 500\]/)
})

test('prefetches the 6h and 24h bundle before waiting for the active detail refresh', () => {
  const handlerStart = proxyNodeCardSource.indexOf('const handlerLatencyDetailsTip = async')
  const handlerEnd = proxyNodeCardSource.indexOf('const latencyTipAnimationClass', handlerStart)
  const handlerSource = proxyNodeCardSource.slice(handlerStart, handlerEnd)
  const bundleStart = handlerSource.indexOf(
    'refreshProxyMetricsTimelineBundle(timelineSourceName, { force: true })',
  )
  const activeRefreshStart = handlerSource.indexOf(
    'refreshLatencyDetailsTimeline(timelineSourceName, activeLatencyTimelineWindow)',
  )

  assert.match(proxyNodeCardSource, /refreshProxyMetricsTimelineBundle/)
  assert.ok(bundleStart >= 0)
  assert.ok(activeRefreshStart > bundleStart)
})

test('refreshes the open R5S detail snapshot when the shared metrics update', () => {
  assert.match(proxyNodeCardSource, /watch\(\s*proxyMetricsUpdatedAt/)
  assert.match(
    proxyNodeCardSource,
    /refreshLatencyDetailsTimeline\(sourceName, activeLatencyTimelineWindow\)/,
  )
  assert.match(proxyNodeCardSource, /renderActiveLatencyDetailsTip\(\)/)
})

test('loads the full 1h raw sample window through one forced R5S detail request', () => {
  assert.match(
    proxyNodeCardSource,
    /const refreshR5sLatencyDetailsSnapshot = \([\s\S]*return refreshProxyMetricsDetails\(sourceName, \{[\s\S]*force,[\s\S]*limit: window === '1h' \? LATENCY_ONE_HOUR_RAW_LIMIT : LATENCY_DETAIL_SEGMENTS,[\s\S]*window/,
  )
  assert.match(proxyNodeCardSource, /const LATENCY_ONE_HOUR_RAW_LIMIT = 200/)
  assert.doesNotMatch(proxyNodeCardSource, /refreshProxyMetricsSamples/)
  assert.doesNotMatch(proxyNodeCardSource, /refreshProxyMetricsTimeline\(/)
})

test('opens and closes latency details with a fresh 1h range state', () => {
  assert.match(proxyNodeCardSource, /let activeLatencyTimelineWindow[^\n]*= '1h'/)
  assert.match(
    proxyNodeCardSource,
    /const resetLatencyBucketDrilldownState = \([\s\S]*activeLatencyTimelineWindow = '1h'/,
  )
  assert.match(
    proxyNodeCardSource,
    /const handlerLatencyDetailsTip = async[\s\S]*resetLatencyBucketDrilldownState\(\)/,
  )
  assert.match(proxyNodeCardSource, /onDestroy:[\s\S]*resetLatencyBucketDrilldownState\(\)/)
})

test('keeps the latency chart section at one fixed height across ranges and loading states', () => {
  const desktopSections = [
    renderTimelineChart({ status: 'loading', window: '1h' }).section,
    renderTimelineChart({ window: '1h' }).section,
    renderTimelineChart({ syncing: true, window: '1h' }).section,
    renderTimelineChart({ window: '6h' }).section,
    renderTimelineChart({ window: '24h' }).section,
  ]
  const compactSections = [
    renderTimelineChart({ compact: true, status: 'loading', window: '1h' }).section,
    renderTimelineChart({ compact: true, window: '1h' }).section,
    renderTimelineChart({ compact: true, syncing: true, window: '24h' }).section,
    renderTimelineChart({ compact: true, window: '6h' }).section,
  ]

  assert.deepEqual(
    new Set(desktopSections.map((section) => section.style.height)),
    new Set(['420px']),
  )
  assert.deepEqual(
    new Set(compactSections.map((section) => section.style.height)),
    new Set(['360px']),
  )
})

test('animates only an explicit latency timeline window change', () => {
  const animatedSection = renderTimelineChart({ animateWindowTransition: true }).section
  const staticSection = renderTimelineChart().section
  const animatedVisual = findElements(
    animatedSection,
    (element) => element.dataset.role === 'latency-timeline-visual',
  )[0]
  const staticVisual = findElements(
    staticSection,
    (element) => element.dataset.role === 'latency-timeline-visual',
  )[0]

  assert.ok(animatedVisual)
  assert.ok(staticVisual)
  assert.match(animatedVisual.className, /latency-timeline-window-enter/)
  assert.doesNotMatch(staticVisual.className, /latency-timeline-window-enter/)
  assert.match(
    proxyNodeCardSource,
    /changeLatencyTimelineWindow[\s\S]*renderActiveLatencyDetailsTip\(\{[\s\S]*animateTimelineWindowTransition: true/,
  )
  assert.match(
    proxyNodeCardSource,
    /animateWindowTransition: renderOptions\.animateTimelineWindowTransition/,
  )
})

test('keeps the window transition armed until the selected async refresh renders', () => {
  const refreshStart = proxyNodeCardSource.indexOf('const refreshLatencyDetailsTimeline =')
  const refreshEnd = proxyNodeCardSource.indexOf(
    'const scheduleLatencyTimelineRetry =',
    refreshStart,
  )
  const refreshSource = proxyNodeCardSource.slice(refreshStart, refreshEnd)
  const rangeChangeStart = proxyNodeCardSource.indexOf('const changeLatencyTimelineWindow =')
  const rangeChangeEnd = proxyNodeCardSource.indexOf(
    'const activateLatencyTimelineBucket =',
    rangeChangeStart,
  )
  const rangeChangeSource = proxyNodeCardSource.slice(rangeChangeStart, rangeChangeEnd)

  assert.match(
    proxyNodeCardSource,
    /let latencyTimelineWindowTransitionTarget: ProxyMetricsTimelineWindow \| null = null/,
  )
  assert.match(
    proxyNodeCardSource,
    /resetLatencyBucketDrilldownState[\s\S]*latencyTimelineWindowTransitionTarget = null/,
  )
  assert.match(
    rangeChangeSource,
    /latencyTimelineWindowTransitionTarget = window[\s\S]*renderActiveLatencyDetailsTip\(\{[\s\S]*animateTimelineWindowTransition: true/,
  )
  assert.match(
    refreshSource,
    /const animateTimelineWindowTransition = latencyTimelineWindowTransitionTarget === window[\s\S]*latencyTimelineWindowTransitionTarget = null[\s\S]*renderActiveLatencyDetailsTip\(\{[\s\S]*animateTimelineWindowTransition/,
  )
})

test('uses a 150ms chart-only fade and disables it for reduced motion', () => {
  assert.match(
    motionCssSource,
    /\.latency-timeline-window-enter\s*\{[\s\S]*animation:\s*latencyTimelineWindowEnter 150ms ease-out/,
  )
  assert.match(
    motionCssSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.latency-timeline-window-enter[\s\S]*animation:\s*none/,
  )
  assert.match(
    motionCssSource,
    /@keyframes latencyTimelineWindowEnter\s*\{\s*from\s*\{\s*opacity:\s*0\.35;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}/,
  )
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
    /getProxyMetricsTimelineCacheKey\(sourceName, window\)[\s\S]*refreshR5sLatencyDetailsSnapshot\(sourceName, window, true\)/,
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

test('keeps the last chart and retries an active detail request after a transient failure', () => {
  assert.match(proxyNodeCardSource, /let latencyTimelineRetryTimer:/)
  assert.match(proxyNodeCardSource, /const scheduleLatencyTimelineRetry =/)
  assert.match(
    proxyNodeCardSource,
    /getProxyMetricsDetailsSnapshot\(sourceName, window\)[\s\S]*unavailableLatencyTimelineKeys\.add/,
  )
  assert.match(
    proxyNodeCardSource,
    /window\.setTimeout\([\s\S]*refreshLatencyDetailsTimeline\(sourceName, window\)/,
  )
  assert.match(
    proxyNodeCardSource,
    /if \(details\?\.timeline\) \{[\s\S]*unavailableLatencyTimelineKeys\.delete/,
  )
  assert.match(
    proxyNodeCardSource,
    /onDestroy:[\s\S]*clearLatencyTimelineRetry\(\)[\s\S]*resetLatencyBucketDrilldownState/,
  )
})

test('keeps showing a stale detail snapshot while retrying until it catches up', () => {
  const chartStart = proxyNodeCardSource.indexOf('const getLatencyTimelineChartState =')
  const chartEnd = proxyNodeCardSource.indexOf('const getLocalLatencyDetailsHistory =', chartStart)
  const chartSource = proxyNodeCardSource.slice(chartStart, chartEnd)
  const refreshStart = proxyNodeCardSource.indexOf('const refreshLatencyDetailsTimeline =')
  const refreshEnd = proxyNodeCardSource.indexOf(
    'const changeLatencyTimelineWindow =',
    refreshStart,
  )
  const refreshSource = proxyNodeCardSource.slice(refreshStart, refreshEnd)

  assert.match(chartSource, /const samples = window === '1h' \? sharedSamples : undefined/)
  assert.match(chartSource, /\? 'syncing'[\s\S]*: 'ready'/)
  assert.match(
    chartSource,
    /if \(timeline\) \{[\s\S]*window !== '1h' && snapshot && !isLatencyTimelineSnapshotCurrent\(sourceName, snapshot\)[\s\S]*\? 'syncing'[\s\S]*: 'ready'/,
  )
  assert.match(
    chartSource,
    /if \(timeline\) \{[\s\S]*\}[\s\S]*return unavailableLatencyTimelineKeys\.has\(cacheKey\)[\s\S]*\? \{ status: 'unavailable' \}[\s\S]*: \{ status: 'loading' \}/,
  )
  assert.match(proxyNodeCardSource, /const isLatencyTimelineSnapshotCurrent =/)
  assert.match(
    refreshSource,
    /if \(details\?\.timeline\) \{[\s\S]*isLatencyTimelineSnapshotCurrent\(sourceName, details\)[\s\S]*clearLatencyTimelineRetry\(\)[\s\S]*else \{[\s\S]*scheduleLatencyTimelineRetry\(sourceName, window\)/,
  )
  assert.match(
    proxyNodeCardSource,
    /sharedLatestTimestamp[\s\S]*detailsLatestTimestamp[\s\S]*detailsLatestTimestamp >= sharedLatestTimestamp/,
  )
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
    /resolveLatencyStripHistory\(\{[\s\S]*mode: isDrilldown \? 'bucket' : 'recent'/,
  )
})

test('renders every raw bucket record and uses its exact interval title', () => {
  assert.match(
    proxyNodeCardSource,
    /formatLatencyBucketTitle\(activeLatencyTimelineBucket, latencyBucketHistory\.length\)/,
  )
  assert.match(proxyNodeCardSource, /preserveAll: true/)
  assert.match(
    proxyNodeCardSource,
    /const displayedHistory = options\.preserveAll\s*\? history\s*:\s*history\.slice\(-LATENCY_DETAIL_SEGMENTS\)/,
  )
})

test('centers small bucket histories with the same tracks and spacing as recent 30', () => {
  assert.match(
    proxyNodeCardSource,
    /getLatencyStripPlaceholderCounts\([\s\S]*displayedHistory\.length[\s\S]*LATENCY_DETAIL_SEGMENTS[\s\S]*options\.centerStableTracks/,
  )
  assert.match(
    proxyNodeCardSource,
    /const timelineItems = \[\.\.\.leadingEmptySegments, \.\.\.displayedHistory, \.\.\.trailingEmptySegments\]/,
  )
  assert.match(
    proxyNodeCardSource,
    /targetSegmentCount <= LATENCY_DETAIL_SEGMENTS \? 'gap-1' : 'gap-px'/,
  )
  assert.match(
    proxyNodeCardSource,
    /item\.delay === undefined && options\.centerStableTracks[\s\S]*segment\.style\.visibility = 'hidden'/,
  )
  assert.match(proxyNodeCardSource, /centerStableTracks: true/)
})

test('shows a manual recent-30 restore control only during bucket drilldown', () => {
  assert.match(
    proxyNodeCardSource,
    /if \(options\.onRestoreRecent\) \{[\s\S]*restoreButton\.textContent = '返回近 30 次'[\s\S]*options\.onRestoreRecent\?\.\(\)/,
  )
  assert.match(proxyNodeCardSource, /onRestoreRecent: \(\) => exitLatencyBucketDrilldown\(true\)/)
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
