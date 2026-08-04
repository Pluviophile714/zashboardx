import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchProxyMetricsBucketSamplesAPI } from '../../api/metricsHelper.ts'
import {
  getProxyMetricsBucketSamplesCacheKey,
  proxyMetricsBucketSamplesMap,
  proxyMetricsSamplesMap,
  refreshProxyMetricsBucketSamples,
} from '../../store/proxyMetrics.ts'

const nodeName = 'HK-01'
const start = '2026-07-04T00:00:00.000Z'
const end = '2026-07-04T00:15:00.000Z'

const createBucketSamplesResponse = (overrides: Record<string, unknown> = {}) => ({
  end,
  generatedAt: '2026-07-04T00:15:01.000Z',
  nodeName,
  samples: [
    {
      delay: 82,
      nodeName,
      success: true,
      testUrl: 'https://example.com/generate_204',
      timestamp: '2026-07-04T00:01:00Z',
    },
    {
      delay: null,
      errorType: 'timeout',
      nodeName,
      success: false,
      testUrl: 'https://example.com/generate_204',
      timestamp: '2026-07-04T00:02:00Z',
    },
  ],
  start,
  truncated: true,
  ...overrides,
})

const withFetchResponse = async (
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

test('normalizes bucket samples with their requested interval identity', async () => {
  await withFetchResponse(createBucketSamplesResponse(), async () => {
    const result = await fetchProxyMetricsBucketSamplesAPI(nodeName, start, end)

    assert.deepEqual(result, {
      end,
      generatedAt: '2026-07-04T00:15:01.000Z',
      nodeName,
      samples: [
        {
          delay: 82,
          nodeName,
          success: true,
          testUrl: 'https://example.com/generate_204',
          timestamp: '2026-07-04T00:01:00.000Z',
        },
        {
          delay: null,
          errorType: 'timeout',
          nodeName,
          success: false,
          testUrl: 'https://example.com/generate_204',
          timestamp: '2026-07-04T00:02:00.000Z',
        },
      ],
      start,
      truncated: true,
    })
  })
})

test('rejects bucket samples with a mismatched response identity', async () => {
  for (const response of [
    createBucketSamplesResponse({ nodeName: 'JP-01' }),
    createBucketSamplesResponse({ start: '2026-07-04T00:01:00.000Z' }),
    createBucketSamplesResponse({ end: '2026-07-04T00:14:00.000Z' }),
  ]) {
    await withFetchResponse(response, async () => {
      assert.equal(await fetchProxyMetricsBucketSamplesAPI(nodeName, start, end), null)
    })
  }
})

test('rejects bucket samples with malformed or out-of-interval records', async () => {
  const malformed = createBucketSamplesResponse({
    samples: [
      {
        delay: 82,
        nodeName,
        success: true,
        testUrl: 'https://example.com/generate_204',
        timestamp: 'not-a-timestamp',
      },
    ],
  })
  const outsideInterval = createBucketSamplesResponse({
    samples: [
      {
        delay: 82,
        nodeName,
        success: true,
        testUrl: 'https://example.com/generate_204',
        timestamp: end,
      },
    ],
  })

  for (const response of [malformed, outsideInterval]) {
    await withFetchResponse(response, async () => {
      assert.equal(await fetchProxyMetricsBucketSamplesAPI(nodeName, start, end), null)
    })
  }
})

test('caches exact normalized bucket intervals separately from recent samples', async () => {
  const cacheNodeName = 'HK-01 cache'
  const cacheStart = '2026-07-04T01:00:00Z'
  const cacheEnd = '2026-07-04T01:15:00Z'
  const response = createBucketSamplesResponse({
    end: '2026-07-04T01:15:00.000Z',
    nodeName: cacheNodeName,
    samples: createBucketSamplesResponse().samples.map((sample) => ({
      ...sample,
      nodeName: cacheNodeName,
      timestamp: sample.timestamp.replace('00:', '01:'),
    })),
    start: '2026-07-04T01:00:00.000Z',
  })
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let fetchCount = 0

  Object.assign(globalThis, {
    fetch: async () => {
      fetchCount += 1
      return new Response(JSON.stringify(response), { status: 200 })
    },
    window: globalThis,
  })

  try {
    const first = await refreshProxyMetricsBucketSamples(cacheNodeName, cacheStart, cacheEnd)
    const second = await refreshProxyMetricsBucketSamples(cacheNodeName, cacheStart, cacheEnd)
    const key = getProxyMetricsBucketSamplesCacheKey(
      cacheNodeName,
      '2026-07-04T01:00:00.000Z',
      '2026-07-04T01:15:00.000Z',
    )

    assert.equal(fetchCount, 1)
    assert.equal(second, first)
    assert.equal(proxyMetricsBucketSamplesMap.value[key], first)
    assert.equal(proxyMetricsSamplesMap.value[key], undefined)
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
})

test('deduplicates pending bucket interval requests', async () => {
  const pendingNodeName = 'HK-01 pending'
  const pendingStart = '2026-07-04T02:00:00.000Z'
  const pendingEnd = '2026-07-04T02:15:00.000Z'
  const response = createBucketSamplesResponse({
    end: pendingEnd,
    nodeName: pendingNodeName,
    samples: createBucketSamplesResponse().samples.map((sample) => ({
      ...sample,
      nodeName: pendingNodeName,
      timestamp: sample.timestamp.replace('00:', '02:'),
    })),
    start: pendingStart,
  })
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  let fetchCount = 0
  let resolveResponse: ((response: Response) => void) | undefined

  Object.assign(globalThis, {
    fetch: () => {
      fetchCount += 1
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve
      })
    },
    window: globalThis,
  })

  try {
    const first = refreshProxyMetricsBucketSamples(pendingNodeName, pendingStart, pendingEnd)
    const second = refreshProxyMetricsBucketSamples(pendingNodeName, pendingStart, pendingEnd)

    assert.equal(fetchCount, 1)
    resolveResponse?.(new Response(JSON.stringify(response), { status: 200 }))
    assert.deepEqual(await second, await first)
  } finally {
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
})
