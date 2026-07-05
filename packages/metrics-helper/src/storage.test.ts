import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { MetricsStorage } from './storage.js'
import type { ProbeSample } from './types.js'

const tempDirs: string[] = []
const at = (minute: number) => new Date(Date.UTC(2026, 6, 4, 0, minute, 0)).toISOString()

const createStorage = () => {
  const dir = mkdtempSync(join(tmpdir(), 'zashboardx-metrics-'))

  tempDirs.push(dir)

  const storage = new MetricsStorage(join(dir, 'metrics.sqlite'))

  storage.init()

  return storage
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stores probe samples and aggregates them by node', () => {
  const storage = createStorage()
  const samples: ProbeSample[] = [
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(0),
      delay: 80,
      success: true,
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(5),
      delay: null,
      success: false,
      errorType: 'timeout',
    },
    {
      nodeName: 'JP-01',
      testUrl: 'https://example.com',
      timestamp: at(10),
      delay: 120,
      success: true,
    },
  ]

  storage.recordNode('HK-01', 'ss')
  storage.recordNode('JP-01', 'vmess')
  samples.forEach((sample) => storage.insertProbeSample(sample))

  const metrics = storage.getNodeMetrics(24 * 60 * 60, Date.parse(at(30)))

  assert.equal(metrics['HK-01'].availability, 0.5)
  assert.equal(metrics['HK-01'].sampleCount, 2)
  assert.equal(metrics['HK-01'].failureCount, 1)
  assert.equal(metrics['JP-01'].availability, 1)
  assert.equal(metrics['JP-01'].lastDelay, 120)

  storage.close()
})

test('returns null for a single node without samples in the window', () => {
  const storage = createStorage()

  storage.recordNode('HK-01', 'ss')
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(0),
    delay: 80,
    success: true,
  })

  const metrics = storage.getSingleNodeMetrics('HK-01', 5 * 60, Date.parse(at(30)))

  assert.equal(metrics, null)
  storage.close()
})

test('ignores duplicate probe samples from repeated scrapes', () => {
  const storage = createStorage()
  const sample: ProbeSample = {
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(0),
    delay: 80,
    success: true,
  }

  assert.equal(storage.insertProbeSample(sample), true)
  assert.equal(storage.insertProbeSample(sample), false)

  const metrics = storage.getNodeMetrics(24 * 60 * 60, Date.parse(at(30)))

  assert.equal(metrics['HK-01'].sampleCount, 1)
  assert.equal(metrics['HK-01'].successCount, 1)

  storage.close()
})

test('prunes samples older than retention days', () => {
  const storage = createStorage()

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: new Date(Date.UTC(2026, 5, 20, 0, 0, 0)).toISOString(),
    delay: 80,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(0),
    delay: 100,
    success: true,
  })

  const pruned = storage.prune(7, Date.parse(at(30)))
  const metrics = storage.getNodeMetrics(24 * 60 * 60, Date.parse(at(30)))

  assert.equal(pruned, 1)
  assert.equal(metrics['HK-01'].sampleCount, 1)
  assert.equal(metrics['HK-01'].lastDelay, 100)

  storage.close()
})
