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
    window?: '1h' | '6h' | '24h'
  } = {},
) => {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: new TestDocument(),
  })

  const buckets = [createTimelineBucket(0, 0), createTimelineBucket(1, 1)]
  const section = createLatencyTimelineChartSection(
    {
      status: 'ready',
      samples: callbacks.samples,
      timeline: {
        bucketSeconds: 900,
        buckets,
        generatedAt: '2026-07-04T00:30:00.000Z',
        jitter: callbacks.jitter ?? null,
        nodeName: 'HK-01',
        windowSeconds: 86_400,
      },
    },
    {
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
  const samplePoint = findElements(
    section,
    (element) => element.dataset.role === '1h-sample-point',
  )[0]

  return { buttons, chartHitArea, samplePoint, section, selectedGuide, svg, tooltip }
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
  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  assert.equal(
    findElements(samplePoint, (element) => element.textContent.includes('331ms')).length,
    1,
  )
  assert.equal(
    findElements(section, (element) => element.dataset.role === '1h-summary-metrics').length,
    1,
  )
  chartHitArea.dispatchEvent(createEvent('click', { clientX: 300 }))
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

test('keeps bucket jitter details for longer timeline windows', () => {
  const { svg, tooltip } = renderTimelineChart({ window: '6h' })

  svg.dispatchEvent(createEvent('pointermove', { clientX: 300 }))
  assert.equal(findElements(tooltip, (element) => element.textContent === '波动').length, 1)
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

test('keeps the node title from shrinking when a detail popover is height constrained', () => {
  assert.match(
    proxyNodeCardSource,
    /title\.className = compact\r?\n\s*\? 'mb-1\.5 shrink-0 truncate/,
  )
})

test('uses the shared recent-30 R5S samples for the first-level latency stability bar', () => {
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
    /proxyMetricsSamplesMap\.value\[[\s\S]*getProxyMetricsSamplesCacheKey\(sourceName, '24h', LATENCY_DETAIL_SEGMENTS\)/,
  )
  assert.match(stabilitySource, /const r5s = getR5sLatencySamples\(\)/)
  assert.doesNotMatch(stabilitySource, /metrics\.recentSamples/)
  assert.match(proxyNodeCardSource, /const history = getLatencyStabilityHistory\(\)/)
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
  assert.match(detailsSource, /history: sharedSamples\.map/)
  assert.doesNotMatch(detailsSource, /detailsSamples/)
  assert.match(
    detailsSource,
    /if \(!sharedSamples\.length && !metricsResolution\) \{\s*return null/s,
  )
})

test('lets the 1h chart use the same shared snapshot when its detail response is stale', () => {
  const chartStart = proxyNodeCardSource.indexOf('const getLatencyTimelineChartState =')
  const chartEnd = proxyNodeCardSource.indexOf('const getLocalLatencyDetailsHistory =', chartStart)
  const chartSource = proxyNodeCardSource.slice(chartStart, chartEnd)

  assert.match(chartSource, /const sharedSamples =/)
  assert.match(chartSource, /sharedSamplesSnapshotAt === snapshot\?\.snapshotAt/)
  assert.match(chartSource, /sharedSnapshotMatchesDetails/)
  assert.match(chartSource, /sharedSnapshotMatchesDetails[\s\S]*snapshot\?\.samples/)
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
})

test('uses a short desktop hover delay without changing the mobile long-press trigger', () => {
  assert.match(proxyNodeCardSource, /delay: \[500, 120\]/)
  assert.match(proxyNodeCardSource, /touch: \['hold', 500\]/)
})

test('refreshes the open R5S detail snapshot when the shared metrics update', () => {
  assert.match(proxyNodeCardSource, /watch\(\s*proxyMetricsUpdatedAt/)
  assert.match(
    proxyNodeCardSource,
    /refreshLatencyDetailsTimeline\(sourceName, activeLatencyTimelineWindow\)/,
  )
  assert.match(proxyNodeCardSource, /instance\.setContent\(createLatencyDetailsTip\(\)\)/)
})

test('loads the full 1h raw sample window through one forced R5S detail request', () => {
  assert.match(
    proxyNodeCardSource,
    /const refreshR5sLatencyDetailsSnapshot = \([\s\S]*return refreshProxyMetricsDetails\(sourceName, \{[\s\S]*force,[\s\S]*limit: window === '1h' \? LATENCY_ONE_HOUR_RAW_LIMIT : LATENCY_DETAIL_SEGMENTS,[\s\S]*window/,
  )
  assert.match(proxyNodeCardSource, /const LATENCY_ONE_HOUR_RAW_LIMIT = 200/)
  assert.doesNotMatch(proxyNodeCardSource, /refreshProxyMetricsSamples/)
  assert.doesNotMatch(proxyNodeCardSource, /refreshProxyMetricsTimeline/)
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
    /if \(details\?\.timeline\) \{[\s\S]*clearLatencyTimelineRetry\(\)[\s\S]*unavailableLatencyTimelineKeys\.delete/,
  )
  assert.match(
    proxyNodeCardSource,
    /onDestroy:[\s\S]*clearLatencyTimelineRetry\(\)[\s\S]*resetLatencyBucketDrilldownState/,
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
  assert.match(proxyNodeCardSource, /preserveAll: isDrilldown/)
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
  assert.match(proxyNodeCardSource, /centerStableTracks: isDrilldown/)
})

test('shows a manual recent-30 restore control only during bucket drilldown', () => {
  assert.match(
    proxyNodeCardSource,
    /if \(options\.onRestoreRecent\) \{[\s\S]*restoreButton\.textContent = '返回近 30 次'[\s\S]*options\.onRestoreRecent\?\.\(\)/,
  )
  assert.match(
    proxyNodeCardSource,
    /onRestoreRecent: isDrilldown[\s\S]*\? \(\) => exitLatencyBucketDrilldown\(true\)[\s\S]*: undefined/,
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
