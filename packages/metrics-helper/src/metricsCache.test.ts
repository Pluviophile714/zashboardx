import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { MetricsAggregationCache } from './metricsCache.js'
import { MetricsStorage } from './storage.js'

const tempDirs: string[] = []
const at = (minute: number) => Date.UTC(2026, 6, 4, 0, minute, 0)

const createStorage = () => {
  const { storage } = createStorageWithPath()

  return storage
}

const createStorageWithPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'zashboardx-metrics-cache-'))

  tempDirs.push(dir)

  const databasePath = join(dir, 'metrics.sqlite')
  const storage = new MetricsStorage(databasePath)

  storage.init()

  return { databasePath, storage }
}

const waitFor = async (predicate: () => boolean) => {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) {
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  assert.fail('condition was not met')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('returns stale node metrics after ttl and refreshes asynchronously', async () => {
  let nowMs = at(30)
  const storage = createStorage()
  const cache = new MetricsAggregationCache({
    storage,
    defaultWindowSeconds: 24 * 60 * 60,
    ttlMs: 10_000,
    refreshDebounceMs: 0,
    now: () => nowMs,
  })

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: new Date(at(1)).toISOString(),
    delay: 80,
    success: true,
  })

  const first = cache.refresh()

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: new Date(at(2)).toISOString(),
    delay: 82,
    success: true,
  })

  nowMs += 5000
  const cached = cache.get()

  assert.ok(cached)
  assert.equal(cached.nodes['HK-01'].sampleCount, 1)
  assert.equal(cached.cacheGeneratedAt, first.cacheGeneratedAt)

  nowMs += 6000
  const stale = cache.get()

  assert.ok(stale)
  assert.equal(stale.nodes['HK-01'].sampleCount, 1)
  assert.equal(stale.cacheGeneratedAt, first.cacheGeneratedAt)

  await new Promise((resolve) => setTimeout(resolve, 10))

  const refreshed = cache.get()

  assert.ok(refreshed)
  assert.equal(refreshed.nodes['HK-01'].sampleCount, 2)
  assert.notEqual(refreshed.cacheGeneratedAt, first.cacheGeneratedAt)

  cache.stop()
  storage.close()
})

test('refreshes stale snapshots in a worker when a database path is provided', async () => {
  let nowMs = at(30)
  const { databasePath, storage } = createStorageWithPath()
  const cache = new MetricsAggregationCache({
    storage,
    databasePath,
    defaultWindowSeconds: 24 * 60 * 60,
    ttlMs: 10_000,
    refreshDebounceMs: 0,
    now: () => nowMs,
  })

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: new Date(at(1)).toISOString(),
    delay: 80,
    success: true,
  })

  const first = cache.refresh()

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: new Date(at(2)).toISOString(),
    delay: 82,
    success: true,
  })

  nowMs += 11_000
  const stale = cache.get()

  assert.ok(stale)
  assert.equal(stale.nodes['HK-01'].sampleCount, 1)
  assert.equal(stale.cacheGeneratedAt, first.cacheGeneratedAt)

  await waitFor(() => cache.get()?.nodes['HK-01'].sampleCount === 2)

  const refreshed = cache.get()

  assert.ok(refreshed)
  assert.notEqual(refreshed.cacheGeneratedAt, first.cacheGeneratedAt)

  cache.stop()
  storage.close()
})

test('does not synchronously aggregate when the cache has no snapshot', () => {
  const { databasePath, storage } = createStorageWithPath()
  const cache = new MetricsAggregationCache({
    storage,
    databasePath,
    defaultWindowSeconds: 24 * 60 * 60,
    refreshDebounceMs: 0,
    ttlMs: 10_000,
  })

  assert.equal(cache.get(), null)

  cache.stop()
  storage.close()
})
