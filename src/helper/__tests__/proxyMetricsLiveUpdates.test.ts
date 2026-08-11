import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  openProxyMetricsEvents,
  type ProxyMetricsSnapshotReadyEvent,
} from '../../api/metricsHelper.ts'
import {
  proxyMetricsLiveConnected,
  proxyMetricsUpdatedAt,
  startProxyMetricsLiveUpdates,
} from '../../store/proxyMetrics.ts'

type Listener = (event: { data: string }) => void

class FakeEventSource {
  static latest: FakeEventSource | undefined
  readonly url: string
  readonly listeners = new Map<string, Listener[]>()
  closed = false
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeEventSource.latest = this
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) })
    }
  }
}

const proxiesPageSource = readFileSync(
  new URL('../../views/ProxiesPage.vue', import.meta.url),
  'utf8',
)

test('opens the metrics event stream and validates snapshot events', () => {
  const received: ProxyMetricsSnapshotReadyEvent[] = []
  const states: boolean[] = []
  const close = openProxyMetricsEvents(
    (event) => received.push(event),
    (connected) => states.push(connected),
    FakeEventSource,
  )
  const source = FakeEventSource.latest!

  assert.equal(source.url, '/api/metrics/events')
  source.onopen?.()
  source.emit('snapshot_ready', {
    snapshotAt: '2026-08-11T02:00:00.000Z',
    type: 'snapshot_ready',
    windowSeconds: 86_400,
  })
  source.emit('snapshot_ready', { type: 'snapshot_ready', windowSeconds: 86_400 })
  source.onerror?.()
  close()

  assert.deepEqual(received, [
    {
      snapshotAt: '2026-08-11T02:00:00.000Z',
      type: 'snapshot_ready',
      windowSeconds: 86_400,
    },
  ])
  assert.deepEqual(states, [true, false])
  assert.equal(source.closed, true)
})

test('refreshes the shared metrics snapshot only for newer live events', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let fetchCount = 0

  Object.assign(globalThis, {
    fetch: async () => {
      fetchCount += 1
      return new Response(
        JSON.stringify({
          generatedAt: '2026-08-11T02:03:00.000Z',
          nodes: {},
          windowSeconds: 86_400,
        }),
        { status: 200 },
      )
    },
    window: globalThis,
  })

  proxyMetricsUpdatedAt.value = Date.parse('2026-08-11T02:00:00.000Z')
  proxyMetricsLiveConnected.value = false
  const stop = startProxyMetricsLiveUpdates({ EventSourceConstructor: FakeEventSource })
  const source = FakeEventSource.latest!

  try {
    source.emit('snapshot_ready', {
      snapshotAt: '2026-08-11T01:59:00.000Z',
      type: 'snapshot_ready',
      windowSeconds: 86_400,
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fetchCount, 0)

    source.emit('snapshot_ready', {
      snapshotAt: '2026-08-11T02:03:00.000Z',
      type: 'snapshot_ready',
      windowSeconds: 86_400,
    })
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fetchCount, 1)
    assert.equal(proxyMetricsUpdatedAt.value, Date.parse('2026-08-11T02:03:00.000Z'))
  } finally {
    stop()
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
})

test('starts live metrics with the proxy page and keeps polling as fallback', () => {
  assert.match(proxiesPageSource, /refreshProxyMetrics/)
  assert.match(proxiesPageSource, /startProxyMetricsLiveUpdates/)
  assert.match(proxiesPageSource, /from '@\/store\/proxyMetrics'/)
  assert.match(proxiesPageSource, /stopMetricsLiveUpdates = startProxyMetricsLiveUpdates\(\)/)
  assert.match(proxiesPageSource, /metricsRefreshTimer = setInterval\([\s\S]*refreshProxyMetrics/)
  assert.match(proxiesPageSource, /stopMetricsLiveUpdates\?\.\(\)/)
})
