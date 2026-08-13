import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MetricsDetailsCache,
  type MetricsDetailsRequest,
  type MetricsDetailsSnapshot,
} from './metricsDetailsCache.js'

const request: MetricsDetailsRequest = {
  bucketCount: 60,
  limit: 120,
  nodeName: 'HK-01',
  nowMs: Date.UTC(2026, 7, 11, 8, 0, 0),
  windowSeconds: 3_600,
}

const snapshot = (generatedAt: string, delay: number): MetricsDetailsSnapshot => ({
  generatedAt,
  nodeName: request.nodeName,
  samples: [
    {
      nodeName: request.nodeName,
      testUrl: 'https://example.com',
      timestamp: generatedAt,
      delay,
      success: true,
    },
  ],
  snapshotAt: generatedAt,
  timeline: {
    bucketSeconds: 60,
    buckets: [],
    generatedAt,
    jitter: null,
    nodeName: request.nodeName,
    snapshotAt: generatedAt,
    windowSeconds: request.windowSeconds,
  },
})

const waitFor = async (predicate: () => boolean) => {
  for (let index = 0; index < 40; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  assert.fail('condition was not met')
}

test('returns the last complete detail snapshot while a dirty refresh runs', async () => {
  let loadCount = 0
  let resolveRefresh: ((value: MetricsDetailsSnapshot) => void) | undefined
  const first = snapshot(new Date(request.nowMs).toISOString(), 80)
  const second = snapshot(new Date(request.nowMs + 30_000).toISOString(), 90)
  const cache = new MetricsDetailsCache({
    loader: async () => {
      loadCount += 1

      if (loadCount === 1) return first

      return new Promise<MetricsDetailsSnapshot>((resolve) => {
        resolveRefresh = resolve
      })
    },
    now: () => request.nowMs + 30_000,
    refreshDebounceMs: 0,
    ttlMs: 10_000,
  })

  assert.equal(await cache.get(request), first)

  const refreshing = cache.markDirty()

  assert.ok(refreshing instanceof Promise)
  await waitFor(() => loadCount === 2)

  const stale = await cache.get({ ...request, nowMs: request.nowMs + 30_000 })

  assert.equal(stale, first)

  resolveRefresh?.(second)
  await refreshing
  await waitFor(() => cache.peek(request)?.snapshotAt === second.snapshotAt)

  assert.equal(cache.peek(request), second)
  cache.stop()
})

test('coalesces concurrent cold detail loads for the same key', async () => {
  let loadCount = 0
  const first = snapshot(new Date(request.nowMs).toISOString(), 80)
  const cache = new MetricsDetailsCache({
    loader: async () => {
      loadCount += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return first
    },
    refreshDebounceMs: 0,
    ttlMs: 10_000,
  })

  const [left, right] = await Promise.all([cache.get(request), cache.get(request)])

  assert.equal(left, first)
  assert.equal(right, first)
  assert.equal(loadCount, 1)
  cache.stop()
})

test('starts refreshing an expired detail snapshot immediately after returning it', async () => {
  let loadCount = 0
  const first = snapshot(new Date(request.nowMs).toISOString(), 80)
  const cache = new MetricsDetailsCache({
    loader: async () => {
      loadCount += 1
      return first
    },
    now: () => request.nowMs + 30_000,
    refreshDebounceMs: 1_500,
    ttlMs: 10_000,
  })

  assert.equal(await cache.get(request), first)
  assert.equal(await cache.get({ ...request, nowMs: request.nowMs + 30_000 }), first)
  await new Promise((resolve) => setTimeout(resolve, 25))

  assert.equal(loadCount, 2)
  cache.stop()
})
