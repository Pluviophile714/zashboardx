import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  openProxyMetricsEvents,
  type ProxyMetricsSnapshotReadyEvent,
} from '../../api/metricsHelper.ts'
import {
  hasProxyMetricsOneHourSamplesReady,
  proxyMetricsDetailsMap,
  proxyMetricsLiveConnected,
  proxyMetricsOneHourSamplesReadyMap,
  proxyMetricsSamplesMap,
  proxyMetricsSamplesSnapshotMap,
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
  timelineWindow: '1h' | '24h' = '24h',
) => {
  const endMs = Date.parse(snapshotAt)
  const profile =
    timelineWindow === '1h'
      ? { bucketCount: 60, bucketSeconds: 60, windowSeconds: 3_600 }
      : { bucketCount: 96, bucketSeconds: 15 * 60, windowSeconds: 86_400 }
  const buckets = Array.from({ length: profile.bucketCount }, (_, index) => {
    const start = new Date(
      endMs - (profile.bucketCount - index) * profile.bucketSeconds * 1000,
    ).toISOString()
    const end = new Date(
      endMs - (profile.bucketCount - index - 1) * profile.bucketSeconds * 1000,
    ).toISOString()
    const hasSample = index === profile.bucketCount - 1

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
      bucketSeconds: profile.bucketSeconds,
      buckets,
      generatedAt: snapshotAt,
      jitter: null,
      nodeName,
      snapshotAt,
      windowSeconds: profile.windowSeconds,
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
  const key = `1h\n200\n${nodeName}`
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
  const key = `1h\n200\n${nodeName}`
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

test('marks a one-hour raw list ready only after its complete detail snapshot arrives', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const nodeName = 'KUMA-ONE-HOUR-READY-01'
  const samplesKey = `1h\n200\n${nodeName}`
  const detailsKey = `1h\n${nodeName}`

  assert.equal(hasProxyMetricsOneHourSamplesReady(nodeName), false)

  Object.assign(globalThis, {
    fetch: async () =>
      new Response(
        JSON.stringify(
          detailsResponse(
            nodeName,
            '2026-08-11T09:04:00.000Z',
            63,
            '2026-08-11T09:04:00.000Z',
            '1h',
          ),
        ),
        { status: 200 },
      ),
    window: globalThis,
  })

  try {
    await refreshProxyMetricsDetails(nodeName, {
      force: true,
      limit: 200,
      snapshotAt: '2026-08-11T09:04:00.000Z',
      window: '1h',
    })

    assert.equal(proxyMetricsSamplesMap.value[samplesKey]?.at(-1)?.delay, 63)
    assert.equal(hasProxyMetricsOneHourSamplesReady(nodeName), true)
  } finally {
    delete proxyMetricsDetailsMap.value[detailsKey]
    delete proxyMetricsOneHourSamplesReadyMap.value[samplesKey]
    delete proxyMetricsSamplesMap.value[samplesKey]
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
})

test('does not mark a recent-only one-hour cache ready when an older full detail snapshot is rejected', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const nodeName = 'KUMA-ONE-HOUR-STALE-READY-01'
  const samplesKey = `1h\n200\n${nodeName}`
  const currentSample = {
    delay: 57,
    nodeName,
    success: true,
    testUrl: 'https://example.com',
    timestamp: '2026-08-11T09:05:00.000Z',
  }

  proxyMetricsSamplesMap.value = {
    ...proxyMetricsSamplesMap.value,
    [samplesKey]: [currentSample],
  }
  proxyMetricsSamplesSnapshotMap.value = {
    ...proxyMetricsSamplesSnapshotMap.value,
    [samplesKey]: '2026-08-11T09:05:00.000Z',
  }
  Object.assign(globalThis, {
    fetch: async () =>
      new Response(
        JSON.stringify(
          detailsResponse(
            nodeName,
            '2026-08-11T09:04:00.000Z',
            63,
            '2026-08-11T09:04:00.000Z',
            '1h',
          ),
        ),
        { status: 200 },
      ),
    window: globalThis,
  })

  try {
    await refreshProxyMetricsDetails(nodeName, {
      force: true,
      limit: 200,
      window: '1h',
    })

    assert.deepEqual(proxyMetricsSamplesMap.value[samplesKey], [currentSample])
    assert.equal(hasProxyMetricsOneHourSamplesReady(nodeName), false)
  } finally {
    delete proxyMetricsOneHourSamplesReadyMap.value[samplesKey]
    delete proxyMetricsSamplesMap.value[samplesKey]
    delete proxyMetricsSamplesSnapshotMap.value[samplesKey]
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
  const samplesKey = `1h\n200\n${nodeName}`
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

test('does not let an older detail response replace a newer cached detail snapshot', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const nodeName = 'KUMA-STALE-03'
  const detailsKey = `24h\n${nodeName}`
  const newerDetails = detailsResponse(nodeName, '2026-08-11T09:04:00.000Z', 64)

  proxyMetricsDetailsMap.value = {
    ...proxyMetricsDetailsMap.value,
    [detailsKey]: newerDetails,
  }
  Object.assign(globalThis, {
    fetch: async () =>
      new Response(JSON.stringify(detailsResponse(nodeName, '2026-08-11T09:03:00.000Z', 63)), {
        status: 200,
      }),
    window: globalThis,
  })

  try {
    const details = await refreshProxyMetricsDetails(nodeName, {
      force: true,
      snapshotAt: '2026-08-11T09:05:00.000Z',
      window: '24h',
    })

    assert.equal(details?.snapshotAt, '2026-08-11T09:04:00.000Z')
    assert.equal(details?.samples.at(-1)?.delay, 64)
  } finally {
    delete proxyMetricsDetailsMap.value[detailsKey]
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
})
