import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  fetchProxyMetricsTimelineAPI,
  getProxyMetricsTimelineProfile,
  normalizeMetricsTimelineBucket,
  type ProxyMetricsTimelineWindow,
} from '../../api/metricsHelper.ts'

const validBucket = {
  start: '2026-07-04T00:00:00.000Z',
  end: '2026-07-04T00:15:00.000Z',
  sampleCount: 3,
  successCount: 2,
  failureCount: 1,
  avgDelay: 100,
  minDelay: 80,
  maxDelay: 120,
  jitter: 40,
}

const createTimelineResponse = (
  window: ProxyMetricsTimelineWindow,
  overrides: Record<string, unknown> = {},
) => {
  const profile = getProxyMetricsTimelineProfile(window)
  const startMs = Date.parse('2026-07-04T00:00:00.000Z')
  const buckets = Array.from({ length: profile.bucketCount }, (_, index) => {
    const bucketStartMs = startMs + index * profile.bucketSeconds * 1000
    const bucketEndMs = bucketStartMs + profile.bucketSeconds * 1000

    return {
      ...validBucket,
      start: new Date(bucketStartMs).toISOString(),
      end: new Date(bucketEndMs).toISOString(),
    }
  })

  return {
    bucketSeconds: profile.bucketSeconds,
    buckets,
    generatedAt: new Date(startMs + profile.windowSeconds * 1000).toISOString(),
    jitter: 23,
    nodeName: 'HK-01',
    windowSeconds: profile.windowSeconds,
    ...overrides,
  }
}

const withTimelineResponse = async (
  response: Record<string, unknown>,
  callback: () => Promise<void>,
) => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window

  Object.assign(globalThis, {
    fetch: async () => new Response(JSON.stringify(response), { status: 200 }),
    window: globalThis,
  })

  try {
    await callback()
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
}

test('normalizes a valid timeline bucket', () => {
  assert.deepEqual(normalizeMetricsTimelineBucket(validBucket), validBucket)
})

test('rejects inconsistent or invalid timeline counts', () => {
  assert.equal(
    normalizeMetricsTimelineBucket({
      ...validBucket,
      successCount: 3,
    }),
    null,
  )
  assert.equal(normalizeMetricsTimelineBucket({ ...validBucket, sampleCount: -1 }), null)
  assert.equal(normalizeMetricsTimelineBucket({ ...validBucket, failureCount: 0.5 }), null)
})

test('rejects invalid or reversed timeline timestamps', () => {
  assert.equal(normalizeMetricsTimelineBucket({ ...validBucket, start: 'not-a-date' }), null)
  assert.equal(
    normalizeMetricsTimelineBucket({
      ...validBucket,
      end: validBucket.start,
    }),
    null,
  )
})

test('rejects inconsistent timeline latency values', () => {
  assert.equal(normalizeMetricsTimelineBucket({ ...validBucket, avgDelay: Number.NaN }), null)
  assert.equal(
    normalizeMetricsTimelineBucket({
      ...validBucket,
      avgDelay: 70,
      minDelay: 80,
    }),
    null,
  )
  assert.equal(
    normalizeMetricsTimelineBucket({
      ...validBucket,
      successCount: 0,
      failureCount: 3,
    }),
    null,
  )
  assert.deepEqual(
    normalizeMetricsTimelineBucket({
      ...validBucket,
      successCount: 0,
      failureCount: 3,
      avgDelay: null,
      minDelay: null,
      maxDelay: null,
      jitter: null,
    }),
    {
      ...validBucket,
      successCount: 0,
      failureCount: 3,
      avgDelay: null,
      minDelay: null,
      maxDelay: null,
      jitter: null,
    },
  )
})

test('defaults jitter to null for a timeline response from an older helper', () => {
  assert.deepEqual(normalizeMetricsTimelineBucket({ ...validBucket, jitter: undefined }), {
    ...validBucket,
    jitter: null,
  })
})

test('rejects a bucket jitter without at least two successful samples', () => {
  assert.equal(
    normalizeMetricsTimelineBucket({
      ...validBucket,
      successCount: 1,
      failureCount: 2,
      jitter: 10,
    }),
    null,
  )
})

test('exposes the fixed timeline response profiles', () => {
  assert.equal(getProxyMetricsTimelineProfile('1h').bucketCount, 60)
  assert.equal(getProxyMetricsTimelineProfile('6h').bucketSeconds, 300)
  assert.equal(getProxyMetricsTimelineProfile('24h').windowSeconds, 86_400)
})

for (const window of ['1h', '6h', '24h'] as const) {
  test(`normalizes the expected ${window} timeline response geometry`, async () => {
    await withTimelineResponse(createTimelineResponse(window), async () => {
      const result = await fetchProxyMetricsTimelineAPI('HK-01', window)

      assert.equal(result?.windowSeconds, getProxyMetricsTimelineProfile(window).windowSeconds)
      assert.equal(result?.bucketSeconds, getProxyMetricsTimelineProfile(window).bucketSeconds)
      assert.equal(result?.buckets.length, getProxyMetricsTimelineProfile(window).bucketCount)
      assert.equal(result?.jitter, 23)
    })
  })

  test(`rejects an incorrect ${window} timeline bucket count`, async () => {
    const response = createTimelineResponse(window)
    response.buckets = (response.buckets as unknown[]).slice(1)

    await withTimelineResponse(response, async () => {
      assert.equal(await fetchProxyMetricsTimelineAPI('HK-01', window), null)
    })
  })

  test(`rejects an incorrect ${window} timeline bucket duration`, async () => {
    const response = createTimelineResponse(window)
    response.bucketSeconds = Number(response.bucketSeconds) + 1

    await withTimelineResponse(response, async () => {
      assert.equal(await fetchProxyMetricsTimelineAPI('HK-01', window), null)
    })
  })

  test(`rejects an incorrect ${window} timeline window duration`, async () => {
    const response = createTimelineResponse(window)
    response.windowSeconds = Number(response.windowSeconds) + 1

    await withTimelineResponse(response, async () => {
      assert.equal(await fetchProxyMetricsTimelineAPI('HK-01', window), null)
    })
  })
}

test('defaults missing window jitter to null for an older helper response', async () => {
  const response = createTimelineResponse('1h')
  delete response.jitter

  await withTimelineResponse(response, async () => {
    assert.equal((await fetchProxyMetricsTimelineAPI('HK-01', '1h'))?.jitter, null)
  })
})
