import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getProxyMetricsTimelineProfile } from '../../api/metricsHelper.ts'
import {
  getProxyMetricsTimelineCacheKey,
  proxyMetricsTimelineMap,
  refreshProxyMetricsTimelineBundle,
} from '../../store/proxyMetrics.ts'

const createTimeline = (nodeName: string, window: '6h' | '24h', snapshotAt: string) => {
  const profile = getProxyMetricsTimelineProfile(window)
  const endMs = Date.parse(snapshotAt)

  return {
    bucketSeconds: profile.bucketSeconds,
    buckets: Array.from({ length: profile.bucketCount }, (_, index) => {
      const start = new Date(
        endMs - (profile.bucketCount - index) * profile.bucketSeconds * 1000,
      ).toISOString()
      const end = new Date(
        endMs - (profile.bucketCount - index - 1) * profile.bucketSeconds * 1000,
      ).toISOString()

      return {
        avgDelay: index === profile.bucketCount - 1 ? 80 : null,
        end,
        failureCount: 0,
        jitter: null,
        maxDelay: index === profile.bucketCount - 1 ? 80 : null,
        minDelay: index === profile.bucketCount - 1 ? 80 : null,
        sampleCount: index === profile.bucketCount - 1 ? 1 : 0,
        start,
        successCount: index === profile.bucketCount - 1 ? 1 : 0,
      }
    }),
    generatedAt: snapshotAt,
    jitter: null,
    nodeName,
    snapshotAt,
    windowSeconds: profile.windowSeconds,
  }
}

test('deduplicates bundle requests and populates both existing timeline cache keys', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  const nodeName = 'BUNDLE-CACHE-01'
  const snapshotAt = '2026-08-14T08:00:00.000Z'
  const bundle = {
    generatedAt: snapshotAt,
    nodeName,
    snapshotAt,
    timelines: {
      '6h': createTimeline(nodeName, '6h', snapshotAt),
      '24h': createTimeline(nodeName, '24h', snapshotAt),
    },
  }
  let fetchCount = 0

  Object.assign(globalThis, {
    fetch: async () => {
      fetchCount += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return new Response(JSON.stringify(bundle), { status: 200 })
    },
    window: globalThis,
  })

  try {
    const [left, right] = await Promise.all([
      refreshProxyMetricsTimelineBundle(nodeName, { force: true }),
      refreshProxyMetricsTimelineBundle(nodeName, { force: true }),
    ])

    assert.equal(fetchCount, 1)
    assert.equal(left, right)
    assert.equal(
      proxyMetricsTimelineMap.value[getProxyMetricsTimelineCacheKey(nodeName, '6h')]?.snapshotAt,
      snapshotAt,
    )
    assert.equal(
      proxyMetricsTimelineMap.value[getProxyMetricsTimelineCacheKey(nodeName, '24h')]?.snapshotAt,
      snapshotAt,
    )
  } finally {
    const nextTimelineMap = { ...proxyMetricsTimelineMap.value }
    delete nextTimelineMap[getProxyMetricsTimelineCacheKey(nodeName, '6h')]
    delete nextTimelineMap[getProxyMetricsTimelineCacheKey(nodeName, '24h')]
    proxyMetricsTimelineMap.value = nextTimelineMap
    Object.assign(globalThis, {
      fetch: originalFetch,
      window: originalWindow,
    })
  }
})
