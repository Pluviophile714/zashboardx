import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MetricsTimelineBundleCache,
  type MetricsTimelineBundleRequest,
  type MetricsTimelineBundleSnapshot,
} from './metricsTimelineBundleCache.js'

const baseNowMs = Date.UTC(2026, 7, 14, 8, 0, 0)

const request = (nodeName: string, nowMs = baseNowMs): MetricsTimelineBundleRequest => ({
  nodeName,
  nowMs,
})

const snapshot = (
  nodeName: string,
  nowMs: number,
  jitter: number,
): MetricsTimelineBundleSnapshot => {
  const snapshotAt = new Date(nowMs).toISOString()

  return {
    generatedAt: snapshotAt,
    nodeName,
    snapshotAt,
    timelines: {
      '6h': {
        bucketSeconds: 300,
        buckets: [],
        generatedAt: snapshotAt,
        jitter,
        nodeName,
        snapshotAt,
        windowSeconds: 21_600,
      },
      '24h': {
        bucketSeconds: 900,
        buckets: [],
        generatedAt: snapshotAt,
        jitter,
        nodeName,
        snapshotAt,
        windowSeconds: 86_400,
      },
    },
  }
}

const waitFor = async (predicate: () => boolean) => {
  for (let index = 0; index < 40; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  assert.fail('condition was not met')
}

test('returns a stale bundle while a dirty background refresh runs', async () => {
  let loadCount = 0
  let resolveRefresh: ((value: MetricsTimelineBundleSnapshot) => void) | undefined
  let nowMs = baseNowMs
  const first = snapshot('HK-01', baseNowMs, 10)
  const second = snapshot('HK-01', baseNowMs + 30_000, 20)
  const cache = new MetricsTimelineBundleCache({
    loader: async () => {
      loadCount += 1
      if (loadCount === 1) return first

      return new Promise<MetricsTimelineBundleSnapshot>((resolve) => {
        resolveRefresh = resolve
      })
    },
    now: () => nowMs,
    refreshDebounceMs: 0,
    ttlMs: 10_000,
  })

  assert.equal(await cache.get(request('HK-01')), first)
  nowMs += 30_000

  const refreshing = cache.markDirty()
  await waitFor(() => loadCount === 2)

  assert.equal(await cache.get(request('HK-01', nowMs)), first)

  resolveRefresh?.(second)
  await refreshing
  await waitFor(() => cache.peek('HK-01')?.snapshotAt === second.snapshotAt)

  assert.equal(cache.peek('HK-01'), second)
  cache.stop()
})

test('deduplicates concurrent cold bundle requests for one node', async () => {
  let loadCount = 0
  const first = snapshot('HK-01', baseNowMs, 10)
  const cache = new MetricsTimelineBundleCache({
    loader: async () => {
      loadCount += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return first
    },
    refreshDebounceMs: 0,
    ttlMs: 10_000,
  })

  const [left, right] = await Promise.all([
    cache.get(request('HK-01')),
    cache.get(request('HK-01')),
  ])

  assert.equal(left, first)
  assert.equal(right, first)
  assert.equal(loadCount, 1)
  cache.stop()
})

test('does not lose a dirty mark during an in-flight bundle refresh', async () => {
  let loadCount = 0
  let resolveSecond: ((value: MetricsTimelineBundleSnapshot) => void) | undefined
  let nowMs = baseNowMs
  const first = snapshot('HK-01', baseNowMs, 10)
  const second = snapshot('HK-01', baseNowMs + 30_000, 20)
  const third = snapshot('HK-01', baseNowMs + 60_000, 30)
  const cache = new MetricsTimelineBundleCache({
    loader: async () => {
      loadCount += 1
      if (loadCount === 1) return first
      if (loadCount === 2) {
        return new Promise<MetricsTimelineBundleSnapshot>((resolve) => {
          resolveSecond = resolve
        })
      }
      return third
    },
    now: () => nowMs,
    refreshDebounceMs: 0,
    ttlMs: 10_000,
  })

  await cache.get(request('HK-01'))
  nowMs += 30_000
  const firstRefresh = cache.markDirty()
  await waitFor(() => loadCount === 2)

  nowMs += 30_000
  const newerRefresh = cache.markDirty()
  resolveSecond?.(second)

  await Promise.all([firstRefresh, newerRefresh])
  await waitFor(() => loadCount === 3)
  await waitFor(() => cache.peek('HK-01')?.snapshotAt === third.snapshotAt)

  assert.equal(cache.peek('HK-01'), third)
  cache.stop()
})

test('evicts the least recently used bundle above the configured node limit', async () => {
  const loadCounts = new Map<string, number>()
  let nowMs = baseNowMs
  const cache = new MetricsTimelineBundleCache({
    loader: async (currentRequest) => {
      loadCounts.set(currentRequest.nodeName, (loadCounts.get(currentRequest.nodeName) ?? 0) + 1)
      return snapshot(currentRequest.nodeName, currentRequest.nowMs, 10)
    },
    maxEntries: 2,
    now: () => nowMs,
    refreshDebounceMs: 0,
    ttlMs: 60_000,
  })

  await cache.get(request('A', nowMs))
  nowMs += 1
  await cache.get(request('B', nowMs))
  nowMs += 1
  await cache.get(request('A', nowMs))
  nowMs += 1
  await cache.get(request('C', nowMs))
  nowMs += 1
  await cache.get(request('B', nowMs))

  assert.equal(loadCounts.get('A'), 1)
  assert.equal(loadCounts.get('B'), 2)
  assert.equal(loadCounts.get('C'), 1)
  cache.stop()
})
