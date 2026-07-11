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
  assert.equal(metrics['HK-01'].lastDelay, 80)
  assert.equal(metrics['HK-01'].lastSuccessAt, at(0))
  assert.equal(metrics['HK-01'].lastFailureAt, at(5))
  assert.equal(metrics['HK-01'].coverageSeconds, 5 * 60)
  assert.equal(metrics['HK-01'].firstSampleAt, at(0))
  assert.equal(metrics['HK-01'].lastSampleAt, at(5))
  assert.equal(metrics['JP-01'].availability, 1)
  assert.equal(metrics['JP-01'].lastDelay, 120)
  assert.equal(metrics['JP-01'].firstSampleAt, at(10))
  assert.equal(metrics['JP-01'].lastSampleAt, at(10))

  storage.close()
})

test('aggregates delay ranges from successful samples only', () => {
  const storage = createStorage()
  const samples: ProbeSample[] = [
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(0),
      delay: 100,
      success: true,
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(5),
      delay: 200,
      success: true,
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(10),
      delay: null,
      success: false,
      errorType: 'timeout',
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(15),
      delay: 99,
      success: true,
    },
  ]

  samples.forEach((sample) => storage.insertProbeSample(sample))

  const metrics = storage.getSingleNodeMetrics('HK-01', 24 * 60 * 60, Date.parse(at(30)))

  assert.ok(metrics)
  assert.equal(metrics.sampleCount, 4)
  assert.equal(metrics.successCount, 3)
  assert.equal(metrics.failureCount, 1)
  assert.equal(metrics.avgDelay, 133)
  assert.equal(metrics.minDelay, 99)
  assert.equal(metrics.maxDelay, 200)
  assert.equal(metrics.lastDelay, 99)
  assert.equal(metrics.firstSampleAt, at(0))
  assert.equal(metrics.lastSampleAt, at(15))
  assert.equal(metrics.lastSuccessAt, at(15))
  assert.equal(metrics.lastFailureAt, at(10))

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

test('keeps only the latest smart group sample in the same test round second', () => {
  const storage = createStorage()

  storage.recordNode('US-Smart', 'Smart')

  assert.equal(
    storage.insertProbeSample({
      nodeName: 'US-Smart',
      testUrl: 'https://example.com',
      timestamp: '2026-07-11T03:00:00.010Z',
      delay: 158,
      success: true,
    }),
    true,
  )
  assert.equal(
    storage.insertProbeSample({
      nodeName: 'US-Smart',
      testUrl: 'https://example.com',
      timestamp: '2026-07-11T03:00:00.030Z',
      delay: 170,
      success: true,
    }),
    true,
  )
  assert.equal(
    storage.insertProbeSample({
      nodeName: 'US-Smart',
      testUrl: 'https://example.com',
      timestamp: '2026-07-11T03:00:00.020Z',
      delay: 165,
      success: true,
    }),
    false,
  )

  assert.deepEqual(
    storage.getRecentProbeSamples('US-Smart', 60, 30, Date.parse('2026-07-11T03:00:30Z')),
    [
      {
        nodeName: 'US-Smart',
        testUrl: 'https://example.com',
        timestamp: '2026-07-11T03:00:00.030Z',
        delay: 170,
        success: true,
      },
    ],
  )

  storage.close()
})

test('keeps distinct same-second samples for non-smart nodes', () => {
  const storage = createStorage()

  storage.recordNode('US-01', 'ss')
  for (const [timestamp, delay] of [
    ['2026-07-11T03:00:00.010Z', 158],
    ['2026-07-11T03:00:00.030Z', 170],
  ] as const) {
    assert.equal(
      storage.insertProbeSample({
        nodeName: 'US-01',
        testUrl: 'https://example.com',
        timestamp,
        delay,
        success: true,
      }),
      true,
    )
  }

  assert.equal(
    storage.getRecentProbeSamples('US-01', 60, 30, Date.parse('2026-07-11T03:00:30Z')).length,
    2,
  )

  storage.close()
})

test('finds latest sample timestamp across all test urls for a node', () => {
  const storage = createStorage()

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com/a',
    timestamp: at(0),
    delay: 80,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com/b',
    timestamp: at(5),
    delay: 100,
    success: true,
  })

  assert.equal(storage.getLatestSampleTimestamp('HK-01'), Date.parse(at(5)))
  assert.equal(
    storage.getLatestSampleTimestamp('HK-01', 'https://example.com/a'),
    Date.parse(at(0)),
  )

  storage.close()
})

test('returns recent probe samples inside the requested window', () => {
  const storage = createStorage()

  for (const minute of [0, 5, 10, 15, 20]) {
    storage.insertProbeSample({
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(minute),
      delay: minute === 15 ? null : 80 + minute,
      success: minute !== 15,
      ...(minute === 15 ? { errorType: 'timeout' } : {}),
    })
  }

  storage.insertProbeSample({
    nodeName: 'JP-01',
    testUrl: 'https://example.com',
    timestamp: at(20),
    delay: 120,
    success: true,
  })

  const samples = storage.getRecentProbeSamples('HK-01', 15 * 60, 3, Date.parse(at(30)))

  assert.deepEqual(
    samples.map((sample) => ({
      delay: sample.delay,
      success: sample.success,
      timestamp: sample.timestamp,
    })),
    [
      { delay: null, success: false, timestamp: at(15) },
      { delay: 100, success: true, timestamp: at(20) },
    ],
  )

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
