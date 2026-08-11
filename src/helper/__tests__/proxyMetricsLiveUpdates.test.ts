import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  openProxyMetricsEvents,
  type ProxyMetricsSnapshotReadyEvent,
} from '../../api/metricsHelper.ts'
import {
  proxyMetricsDetailsMap,
  proxyMetricsLiveConnected,
  proxyMetricsSamplesMap,
  proxyMetricsUpdatedAt,
  refreshProxyMetricsDetails,
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

const detailsResponse = (
  nodeName: string,
  snapshotAt: string,
  delay: number,
  sampleTimestamp = '2026-08-11T08:55:34.000Z',
) => {
  const endMs = Date.parse(snapshotAt)
  const bucketSeconds = 15 * 60
  const buckets = Array.from({ length: 96 }, (_, index) => {
    const start = new Date(endMs - (96 - index) * bucketSeconds * 1000).toISOString()
    const end = new Date(endMs - (95 - index) * bucketSeconds * 1000).toISOString()
    const hasSample = index === 95

    return {
      avgDelay: hasSample ? delay : null,
      end,
      failureCount: 0,
      jitter: null,
      maxDelay: hasSample ? delay : null,
      minDelay: hasSample ? delay : null,
      sampleCount: hasSample ? 1 : 0,
      start,
      successCount: hasSample ? 1 : 0,
    }
  })

  return {
    generatedAt: snapshotAt,
    nodeName,
    samples: [
      {
        delay,
        nodeName,
        success: true,
        testUrl: 'https://example.com',
        timestamp: sampleTimestamp,
      },
    ],
    snapshotAt,
    timeline: {
      bucketSeconds,
      buckets,
      generatedAt: snapshotAt,
      jitter: null,
      nodeName,
      snapshotAt,
      windowSeconds: 86_400,
    },
  }
}

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

test('does not let a detail refresh replace the shared recent samples', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const nodeName = 'KUMA-STALE-01'
  const key = `24h\n30\n${nodeName}`
  const currentSample = {
    delay: 57,
    nodeName,
    success: true,
    testUrl: 'https://example.com',
    timestamp: '2026-08-11T09:02:00.000Z',
  }

  proxyMetricsSamplesMap.value = {
    ...proxyMetricsSamplesMap.value,
    [key]: [currentSample],
  }

  Object.assign(globalThis, {
    fetch: async () =>
      new Response(JSON.stringify(detailsResponse(nodeName, '2026-08-11T09:03:00.000Z', 63)), {
        status: 200,
      }),
    window: globalThis,
  })

  try {
    await refreshProxyMetricsDetails(nodeName, {
      force: true,
      snapshotAt: '2026-08-11T09:03:00.000Z',
      window: '24h',
    })

    assert.equal(proxyMetricsSamplesMap.value[key]?.at(-1)?.delay, 57)
  } finally {
    delete proxyMetricsSamplesMap.value[key]
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
})

test('promotes a newer detail snapshot into the shared recent samples', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const nodeName = 'KUMA-LIVE-01'
  const key = `24h\n30\n${nodeName}`
  const currentSample = {
    delay: 57,
    nodeName,
    success: true,
    testUrl: 'https://example.com',
    timestamp: '2026-08-11T09:02:00.000Z',
  }

  proxyMetricsSamplesMap.value = {
    ...proxyMetricsSamplesMap.value,
    [key]: [currentSample],
  }

  Object.assign(globalThis, {
    fetch: async () =>
      new Response(
        JSON.stringify(
          detailsResponse(nodeName, '2026-08-11T09:04:00.000Z', 63, '2026-08-11T09:04:00.000Z'),
        ),
        { status: 200 },
      ),
    window: globalThis,
  })

  try {
    await refreshProxyMetricsDetails(nodeName, {
      force: true,
      snapshotAt: '2026-08-11T09:04:00.000Z',
      window: '24h',
    })

    assert.equal(proxyMetricsSamplesMap.value[key]?.at(-1)?.delay, 63)
  } finally {
    delete proxyMetricsSamplesMap.value[key]
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
})

test('keeps an older complete detail snapshot for the chart without rolling back shared samples', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const nodeName = 'KUMA-STALE-02'
  const detailsKey = `24h\n${nodeName}`
  const samplesKey = `24h\n30\n${nodeName}`
  const currentSample = {
    delay: 57,
    nodeName,
    success: true,
    testUrl: 'https://example.com',
    timestamp: '2026-08-11T09:02:00.000Z',
  }

  proxyMetricsUpdatedAt.value = Date.parse('2026-08-11T09:02:00.000Z')
  proxyMetricsSamplesMap.value = {
    ...proxyMetricsSamplesMap.value,
    [samplesKey]: [currentSample],
  }
  Object.assign(globalThis, {
    fetch: async () =>
      new Response(JSON.stringify(detailsResponse(nodeName, '2026-08-11T09:01:00.000Z', 63)), {
        status: 200,
      }),
    window: globalThis,
  })

  try {
    const details = await refreshProxyMetricsDetails(nodeName, {
      force: true,
      snapshotAt: '2026-08-11T09:02:00.000Z',
      window: '24h',
    })

    assert.equal(details?.snapshotAt, '2026-08-11T09:01:00.000Z')
    assert.equal(proxyMetricsDetailsMap.value[detailsKey]?.timeline.buckets.length, 96)
    assert.equal(proxyMetricsSamplesMap.value[samplesKey]?.at(-1)?.delay, 57)
  } finally {
    delete proxyMetricsDetailsMap.value[detailsKey]
    delete proxyMetricsSamplesMap.value[samplesKey]
    proxyMetricsUpdatedAt.value = 0
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
})
