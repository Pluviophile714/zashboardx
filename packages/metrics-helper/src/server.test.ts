import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { MetricsAggregationCache } from './metricsCache.js'
import { MetricsDetailsCache } from './metricsDetailsCache.js'
import { MetricsUpdateHub } from './metricsEvents.js'
import { createMetricsServer } from './server.js'
import { MetricsStorage } from './storage.js'
import type { HelperHealth } from './types.js'

const tempDirs: string[] = []
const at = (minute: number) => new Date(Date.UTC(2026, 6, 4, 0, minute, 0)).toISOString()

const createStorage = () => {
  const dir = mkdtempSync(join(tmpdir(), 'zashboardx-metrics-server-'))

  tempDirs.push(dir)

  const storage = new MetricsStorage(join(dir, 'metrics.sqlite'))

  storage.init()
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(0),
    delay: 80,
    success: true,
  })

  return storage
}

const listen = async (server: ReturnType<typeof createMetricsServer>) =>
  new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (address && typeof address === 'object') {
        resolve(`http://127.0.0.1:${address.port}`)
      }
    })
  })

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('serves health and node metrics as JSON', async () => {
  const storage = createStorage()
  const health: HelperHealth = {
    ok: true,
    mihomoReachable: true,
    running: false,
    lastProbeAt: at(1),
    lastProbeError: null,
    lastProbeNodeCount: 1,
    version: '0.1.0',
  }
  const server = createMetricsServer({
    storage,
    health,
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const healthResponse = await fetch(`${baseUrl}/api/metrics/health`)
    const healthBody = (await healthResponse.json()) as HelperHealth

    assert.equal(healthResponse.status, 200)
    assert.equal(healthResponse.headers.get('cache-control'), 'no-store')
    assert.equal(healthBody.ok, true)
    assert.equal(healthBody.version, '0.1.0')

    const nodesResponse = await fetch(`${baseUrl}/api/metrics/nodes?window=24h`)
    const nodesBody = (await nodesResponse.json()) as {
      windowSeconds: number
      nodes: Record<
        string,
        {
          availability: number | null
          firstSampleAt: string | null
          lastSampleAt: string | null
          recentSamples?: { delay: number | null; success: boolean; timestamp: string }[]
          sampleCount: number
        }
      >
    }

    assert.equal(nodesResponse.status, 200)
    assert.equal(nodesBody.windowSeconds, 24 * 60 * 60)
    assert.equal(nodesBody.nodes['HK-01'].availability, 1)
    assert.equal(nodesBody.nodes['HK-01'].firstSampleAt, at(0))
    assert.equal(nodesBody.nodes['HK-01'].lastSampleAt, at(0))
    assert.equal(nodesBody.nodes['HK-01'].sampleCount, 1)
    assert.deepEqual(nodesBody.nodes['HK-01'].recentSamples, [
      {
        nodeName: 'HK-01',
        testUrl: 'https://example.com',
        timestamp: at(0),
        delay: 80,
        success: true,
      },
    ])

    const nodeResponse = await fetch(`${baseUrl}/api/metrics/nodes/HK-01?window=24h`)
    const nodeBody = (await nodeResponse.json()) as {
      name: string
      metrics: {
        availability: number | null
        firstSampleAt: string | null
        lastSampleAt: string | null
        sampleCount: number
      } | null
    }

    assert.equal(nodeResponse.status, 200)
    assert.equal(nodeBody.name, 'HK-01')
    assert.equal(nodeBody.metrics?.availability, 1)
    assert.equal(nodeBody.metrics?.firstSampleAt, at(0))
    assert.equal(nodeBody.metrics?.lastSampleAt, at(0))
  } finally {
    server.close()
    storage.close()
  }
})

test('streams ready and snapshot events to live metrics clients', async () => {
  const storage = createStorage()
  const updates = new MetricsUpdateHub()
  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 1,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    updates,
  })
  const baseUrl = await listen(server)
  const response = await fetch(`${baseUrl}/api/metrics/events`)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()

  try {
    assert.equal(response.status, 200)
    assert.match(decoder.decode((await reader.read()).value), /event: ready/)

    updates.publish({
      type: 'snapshot_ready',
      snapshotAt: at(2),
      windowSeconds: 24 * 60 * 60,
    })

    const eventChunk = decoder.decode((await reader.read()).value)
    assert.match(eventChunk, /event: snapshot_ready/)
    assert.match(eventChunk, /"snapshotAt":"2026-07-04T00:02:00.000Z"/)
  } finally {
    await reader.cancel()
    server.close()
    storage.close()
  }
})

test('accepts frontend latency samples and deduplicates repeated posts', async () => {
  const storage = createStorage()
  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)
  const sample = {
    nodeName: 'JP-01',
    testUrl: 'https://www.gstatic.com/generate_204',
    timestamp: at(5),
    delay: 121,
    success: true,
  }

  try {
    const firstPost = await fetch(`${baseUrl}/api/metrics/samples`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ samples: [sample] }),
    })
    const firstBody = (await firstPost.json()) as { accepted: number; received: number }

    assert.equal(firstPost.status, 200)
    assert.equal(firstBody.received, 1)
    assert.equal(firstBody.accepted, 1)

    const duplicatePost = await fetch(`${baseUrl}/api/metrics/samples`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ samples: [sample] }),
    })
    const duplicateBody = (await duplicatePost.json()) as { accepted: number; received: number }

    assert.equal(duplicatePost.status, 200)
    assert.equal(duplicateBody.received, 1)
    assert.equal(duplicateBody.accepted, 0)

    const nodeResponse = await fetch(`${baseUrl}/api/metrics/nodes/JP-01?window=24h`)
    const nodeBody = (await nodeResponse.json()) as {
      metrics: {
        availability: number | null
        lastDelay: number | null
        sampleCount: number
      } | null
    }

    assert.equal(nodeBody.metrics?.availability, 1)
    assert.equal(nodeBody.metrics?.lastDelay, 121)
    assert.equal(nodeBody.metrics?.sampleCount, 1)
  } finally {
    server.close()
    storage.close()
  }
})

test('serves recent samples for one node from the requested window', async () => {
  const storage = createStorage()
  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(5),
    delay: 90,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(15),
    delay: null,
    success: false,
    errorType: 'timeout',
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(20),
    delay: 100,
    success: true,
  })

  try {
    const response = await fetch(
      `${baseUrl}/api/metrics/samples?node=${encodeURIComponent('HK-01')}&window=15m&limit=30`,
    )
    const body = (await response.json()) as {
      nodeName: string
      samples: { delay: number | null; success: boolean; timestamp: string }[]
      windowSeconds: number
    }

    assert.equal(response.status, 200)
    assert.equal(body.nodeName, 'HK-01')
    assert.equal(body.windowSeconds, 15 * 60)
    assert.deepEqual(
      body.samples.map((sample) => ({
        delay: sample.delay,
        success: sample.success,
        timestamp: sample.timestamp,
      })),
      [
        { delay: null, success: false, timestamp: at(15) },
        { delay: 100, success: true, timestamp: at(20) },
      ],
    )
  } finally {
    server.close()
    storage.close()
  }
})

test('serves recent samples and timeline from one explicit snapshot cutoff', async () => {
  const storage = createStorage()
  const snapshotAt = at(25)

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com/older-than-window',
    timestamp: at(-61),
    delay: 401,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com/inside',
    timestamp: at(20),
    delay: 92,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com/after',
    timestamp: at(26),
    delay: 180,
    success: true,
  })

  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(
      `${baseUrl}/api/metrics/details?node=HK-01&window=1h&limit=30&asOf=${encodeURIComponent(snapshotAt)}`,
    )
    const body = (await response.json()) as {
      generatedAt: string
      snapshotAt: string
      samples: { timestamp: string }[]
      timeline: { buckets: { sampleCount: number }[] }
    }

    assert.equal(response.status, 200)
    assert.equal(body.generatedAt, snapshotAt)
    assert.equal(body.snapshotAt, snapshotAt)
    assert.deepEqual(
      body.samples.map((sample) => sample.timestamp),
      [at(0), at(20)],
    )
    assert.equal(
      body.timeline.buckets.reduce((total, bucket) => total + bucket.sampleCount, 0),
      2,
    )
  } finally {
    server.close()
    storage.close()
  }
})

test('serves detail snapshots from the asynchronous detail cache', async () => {
  const storage = createStorage()
  const snapshotAt = at(25)
  const detailsCache = new MetricsDetailsCache({
    loader: async (request) => ({
      generatedAt: snapshotAt,
      nodeName: request.nodeName,
      samples: storage.getRecentProbeSamples(
        request.nodeName,
        request.windowSeconds,
        request.limit,
        request.nowMs,
      ),
      snapshotAt,
      timeline: {
        bucketSeconds: request.windowSeconds / request.bucketCount,
        buckets: storage.getNodeTimeline(
          request.nodeName,
          request.windowSeconds,
          request.bucketCount,
          request.nowMs,
        ),
        generatedAt: snapshotAt,
        jitter: storage.getNodeJitter(request.nodeName, request.windowSeconds, request.nowMs),
        nodeName: request.nodeName,
        snapshotAt,
        windowSeconds: request.windowSeconds,
      },
    }),
    refreshDebounceMs: 0,
    ttlMs: 10_000,
  })
  const originalGetNodeDetails = storage.getNodeDetails.bind(storage)

  storage.getNodeDetails = () => {
    throw new Error('synchronous details read should not run')
  }

  const server = createMetricsServer({
    storage,
    detailsCache,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(snapshotAt),
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/metrics/details?node=HK-01&window=1h&limit=30`)
    const body = (await response.json()) as { snapshotAt: string; samples: unknown[] }

    assert.equal(response.status, 200)
    assert.equal(body.snapshotAt, snapshotAt)
    assert.equal(body.samples.length, 1)
  } finally {
    storage.getNodeDetails = originalGetNodeDetails
    detailsCache.stop()
    server.close()
    storage.close()
  }
})

test('serves cached node metrics and refreshes cache after accepted frontend samples', async () => {
  const storage = createStorage()
  const metricsCache = new MetricsAggregationCache({
    storage,
    defaultWindowSeconds: 24 * 60 * 60,
    refreshDebounceMs: 0,
    ttlMs: 10_000,
    now: () => Date.parse(at(30)),
  })

  metricsCache.refresh()

  const server = createMetricsServer({
    storage,
    metricsCache,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const firstResponse = await fetch(`${baseUrl}/api/metrics/nodes?window=24h`)
    const firstBody = (await firstResponse.json()) as {
      cached: boolean
      cacheGeneratedAt: string
      computeMs: number
      nodes: Record<string, { sampleCount: number }>
    }

    assert.equal(firstBody.cached, true)
    assert.equal(firstBody.nodes['HK-01'].sampleCount, 1)
    assert.equal(firstBody.nodes['JP-01'], undefined)
    assert.equal(typeof firstBody.cacheGeneratedAt, 'string')
    assert.equal(typeof firstBody.computeMs, 'number')

    await fetch(`${baseUrl}/api/metrics/samples`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        samples: [
          {
            nodeName: 'JP-01',
            testUrl: 'https://www.gstatic.com/generate_204',
            timestamp: at(5),
            delay: 121,
            success: true,
          },
        ],
      }),
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    const refreshedResponse = await fetch(`${baseUrl}/api/metrics/nodes?window=24h`)
    const refreshedBody = (await refreshedResponse.json()) as {
      nodes: Record<string, { sampleCount: number }>
    }

    assert.equal(refreshedBody.nodes['JP-01'].sampleCount, 1)
  } finally {
    metricsCache.stop()
    server.close()
    storage.close()
  }
})

test('returns a warming response while the metrics cache is still cold', async () => {
  const storage = createStorage()
  const metricsCache = new MetricsAggregationCache({
    storage,
    defaultWindowSeconds: 24 * 60 * 60,
    refreshDebounceMs: 0,
    ttlMs: 10_000,
  })
  const server = createMetricsServer({
    storage,
    metricsCache,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/metrics/nodes?window=24h`)
    const body = (await response.json()) as { error: string; retryAfterMs: number }

    assert.equal(response.status, 503)
    assert.equal(body.error, 'metrics_warming_up')
    assert.equal(body.retryAfterMs, 1000)
  } finally {
    metricsCache.stop()
    server.close()
    storage.close()
  }
})

test('serves fixed timeline profiles for a Unicode node name', async () => {
  const storage = createStorage()
  const nodeName = '\ud83c\udded\ud83c\uddf0 HKG \u9999\u6e2f 07 [\u4e3b]'

  storage.insertProbeSample({
    nodeName,
    testUrl: 'https://example.com',
    timestamp: at(30),
    delay: 95,
    success: true,
  })
  storage.insertProbeSample({
    nodeName,
    testUrl: 'https://example.com',
    timestamp: at(29),
    delay: 85,
    success: true,
  })

  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 15 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const cases = [
      { window: '1h', windowSeconds: 3_600, bucketSeconds: 60, bucketCount: 60 },
      { window: '6h', windowSeconds: 21_600, bucketSeconds: 300, bucketCount: 72 },
      { window: '24h', windowSeconds: 86_400, bucketSeconds: 900, bucketCount: 96 },
    ]

    for (const timelineCase of cases) {
      const response = await fetch(
        `${baseUrl}/api/metrics/timeline?node=${encodeURIComponent(nodeName)}&window=${timelineCase.window}`,
      )
      const body = (await response.json()) as {
        bucketSeconds: number
        buckets: { sampleCount: number }[]
        generatedAt: string
        jitter: number | null
        nodeName: string
        windowSeconds: number
      }

      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(body.windowSeconds, timelineCase.windowSeconds)
      assert.equal(body.generatedAt, at(30))
      assert.equal(body.nodeName, nodeName)
      assert.equal(body.jitter, 10)
      assert.equal(body.bucketSeconds, timelineCase.bucketSeconds)
      assert.equal(body.buckets.length, timelineCase.bucketCount)
      assert.equal(body.buckets[timelineCase.bucketCount - 1].sampleCount, 2)
    }
  } finally {
    server.close()
    storage.close()
  }
})

test('validates timeline requests and retains the global method check', async () => {
  const storage = createStorage()
  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const missingNodeResponse = await fetch(`${baseUrl}/api/metrics/timeline?window=24h`)
    const missingNodeBody = (await missingNodeResponse.json()) as { error: string }

    assert.equal(missingNodeResponse.status, 400)
    assert.equal(missingNodeResponse.headers.get('cache-control'), 'no-store')
    assert.equal(missingNodeBody.error, 'invalid_node')

    const longNodeResponse = await fetch(
      `${baseUrl}/api/metrics/timeline?node=${'x'.repeat(513)}&window=24h`,
    )
    const longNodeBody = (await longNodeResponse.json()) as { error: string }

    assert.equal(longNodeResponse.status, 400)
    assert.equal(longNodeBody.error, 'invalid_node')

    const unsupportedWindowResponse = await fetch(
      `${baseUrl}/api/metrics/timeline?node=HK-01&window=7d`,
    )
    const unsupportedWindowBody = (await unsupportedWindowResponse.json()) as { error: string }

    assert.equal(unsupportedWindowResponse.status, 400)
    assert.equal(unsupportedWindowBody.error, 'unsupported_window')

    const postResponse = await fetch(`${baseUrl}/api/metrics/timeline?node=HK-01&window=24h`, {
      method: 'POST',
    })
    const postBody = (await postResponse.json()) as { error: string }

    assert.equal(postResponse.status, 405)
    assert.equal(postResponse.headers.get('cache-control'), 'no-store')
    assert.equal(postBody.error, 'method_not_allowed')
  } finally {
    server.close()
    storage.close()
  }
})

test('serves bounded raw bucket samples for a Unicode node name', async () => {
  const storage = createStorage()
  const nodeName = '\ud83c\udded\ud83c\uddf0 HKG \u9999\u6e2f 07 [\u4e3b]'
  const start = at(10)
  const end = at(15)

  storage.insertProbeSample({
    nodeName,
    testUrl: 'https://example.com/start',
    timestamp: start,
    delay: 51,
    success: true,
  })
  storage.insertProbeSample({
    nodeName,
    testUrl: 'https://example.com/inside',
    timestamp: at(12),
    delay: 52,
    success: true,
  })
  storage.insertProbeSample({
    nodeName,
    testUrl: 'https://example.com/end',
    timestamp: end,
    delay: 53,
    success: true,
  })

  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(
      `${baseUrl}/api/metrics/bucket-samples?node=${encodeURIComponent(nodeName)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    )
    const body = (await response.json()) as {
      end: string
      generatedAt: string
      nodeName: string
      samples: { delay: number | null; timestamp: string }[]
      start: string
      truncated: boolean
    }

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(body.nodeName, nodeName)
    assert.equal(body.start, start)
    assert.equal(body.end, end)
    assert.equal(body.generatedAt, at(30))
    assert.deepEqual(
      body.samples.map((sample) => ({ delay: sample.delay, timestamp: sample.timestamp })),
      [
        { delay: 51, timestamp: start },
        { delay: 52, timestamp: at(12) },
      ],
    )
    assert.equal(body.truncated, false)
  } finally {
    server.close()
    storage.close()
  }
})

test('validates bounded raw bucket sample requests and retains the global method check', async () => {
  const storage = createStorage()
  const start = at(10)
  const end = at(15)
  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const emptyResponse = await fetch(
      `${baseUrl}/api/metrics/bucket-samples?node=Empty&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    )
    const emptyBody = (await emptyResponse.json()) as {
      samples: unknown[]
      truncated: boolean
    }

    assert.equal(emptyResponse.status, 200)
    assert.equal(emptyResponse.headers.get('cache-control'), 'no-store')
    assert.deepEqual(emptyBody.samples, [])
    assert.equal(emptyBody.truncated, false)

    const invalidTimestampResponse = await fetch(
      `${baseUrl}/api/metrics/bucket-samples?node=HK-01&start=not-a-timestamp&end=${encodeURIComponent(end)}`,
    )
    const reversedBoundsResponse = await fetch(
      `${baseUrl}/api/metrics/bucket-samples?node=HK-01&start=${encodeURIComponent(end)}&end=${encodeURIComponent(start)}`,
    )
    const oversizedIntervalResponse = await fetch(
      `${baseUrl}/api/metrics/bucket-samples?node=HK-01&start=${encodeURIComponent(at(0))}&end=${encodeURIComponent(at(16))}`,
    )
    const missingNodeResponse = await fetch(
      `${baseUrl}/api/metrics/bucket-samples?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    )
    const longNodeResponse = await fetch(
      `${baseUrl}/api/metrics/bucket-samples?node=${'x'.repeat(513)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    )
    const postResponse = await fetch(
      `${baseUrl}/api/metrics/bucket-samples?node=HK-01&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      { method: 'POST' },
    )

    for (const response of [
      invalidTimestampResponse,
      reversedBoundsResponse,
      oversizedIntervalResponse,
      missingNodeResponse,
      longNodeResponse,
    ]) {
      assert.equal(response.status, 400)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    assert.equal(postResponse.status, 405)
    assert.equal(postResponse.headers.get('cache-control'), 'no-store')
  } finally {
    server.close()
    storage.close()
  }
})

test('rejects parseable non-ISO and rollover-invalid bucket sample bounds', async () => {
  const storage = createStorage()
  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const responses = await Promise.all([
      fetch(
        `${baseUrl}/api/metrics/bucket-samples?node=HK-01&start=${encodeURIComponent('July 4, 2026 00:10:00 UTC')}&end=${encodeURIComponent(at(15))}`,
      ),
      fetch(
        `${baseUrl}/api/metrics/bucket-samples?node=HK-01&start=${encodeURIComponent('2026-02-30T00:00:00.000Z')}&end=${encodeURIComponent('2026-03-02T00:15:00.000Z')}`,
      ),
    ])

    for (const response of responses) {
      assert.equal(response.status, 400)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
  } finally {
    server.close()
    storage.close()
  }
})

test('limits raw bucket sample responses to 200 records', async () => {
  const storage = createStorage()
  const start = at(10)
  const end = at(15)

  for (let index = 0; index < 201; index += 1) {
    storage.insertProbeSample({
      nodeName: 'HK-01',
      testUrl: `https://example.com/${index}`,
      timestamp: start,
      delay: index + 1,
      success: true,
    })
  }

  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(
      `${baseUrl}/api/metrics/bucket-samples?node=HK-01&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    )
    const body = (await response.json()) as {
      samples: { delay: number | null }[]
      truncated: boolean
    }

    assert.equal(response.status, 200)
    assert.equal(body.samples.length, 200)
    assert.equal(body.samples[0].delay, 1)
    assert.equal(body.samples[199].delay, 200)
    assert.equal(body.truncated, true)
  } finally {
    server.close()
    storage.close()
  }
})

test('returns 404 for unknown metric routes', async () => {
  const storage = createStorage()
  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/metrics/unknown`)

    assert.equal(response.status, 404)
  } finally {
    server.close()
    storage.close()
  }
})
