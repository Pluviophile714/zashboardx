import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

test('includes the latest ten raw samples in node metrics in chronological order', () => {
  const storage = createStorage()

  for (let minute = 0; minute < 12; minute += 1) {
    storage.insertProbeSample({
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(minute),
      delay: minute === 8 ? null : 80 + minute,
      success: minute !== 8,
      ...(minute === 8 ? { errorType: 'timeout' } : {}),
    })
  }

  const metrics = storage.getNodeMetrics(24 * 60 * 60, Date.parse(at(20)))['HK-01']

  assert.deepEqual(
    metrics.recentSamples?.map((sample) => ({
      timestamp: sample.timestamp,
      delay: sample.delay,
      success: sample.success,
      errorType: sample.errorType,
    })),
    [
      ...Array.from({ length: 10 }, (_, index) => ({
        timestamp: at(index + 2),
        delay: index + 2 === 8 ? null : 80 + index + 2,
        success: index + 2 !== 8,
        errorType: index + 2 === 8 ? 'timeout' : undefined,
      })),
    ],
  )

  storage.close()
})

test('calculates window jitter across successful samples and ignores failures', () => {
  const storage = createStorage()

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(0),
    delay: 100,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(5),
    delay: null,
    success: false,
    errorType: 'timeout',
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(10),
    delay: 160,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(20),
    delay: 130,
    success: true,
  })

  assert.equal(storage.getNodeJitter('HK-01', 60 * 60, Date.parse(at(30))), 45)
  assert.equal(storage.getNodeJitter('HK-01', 60 * 60, Date.parse(at(1))), null)
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

test('keeps only the final fallback group sample from a two-second test round', () => {
  const storage = createStorage()

  storage.recordNode('SG-Fallback', 'Fallback')

  for (const [timestamp, delay] of [
    ['2026-07-11T03:00:00.010Z', 84],
    ['2026-07-11T03:00:00.410Z', 86],
    ['2026-07-11T03:01:30.000Z', 81],
  ] as const) {
    assert.equal(
      storage.insertProbeSample(
        {
          nodeName: 'SG-Fallback',
          testUrl: 'https://example.com',
          timestamp,
          delay,
          success: true,
        },
        { collapseFallbackRound: true },
      ),
      true,
    )
  }

  assert.deepEqual(
    storage.getRecentProbeSamples('SG-Fallback', 120, 30, Date.parse('2026-07-11T03:02:00Z')),
    [
      {
        nodeName: 'SG-Fallback',
        testUrl: 'https://example.com',
        timestamp: '2026-07-11T03:00:00.410Z',
        delay: 86,
        success: true,
      },
      {
        nodeName: 'SG-Fallback',
        testUrl: 'https://example.com',
        timestamp: '2026-07-11T03:01:30.000Z',
        delay: 81,
        success: true,
      },
    ],
  )

  storage.close()
})

test('keeps close fallback samples from ordinary writes as distinct measurements', () => {
  const storage = createStorage()

  storage.recordNode('SG-Fallback', 'Fallback')

  for (const [timestamp, delay] of [
    ['2026-07-11T03:00:00.010Z', 84],
    ['2026-07-11T03:00:00.410Z', 86],
  ] as const) {
    storage.insertProbeSample({
      nodeName: 'SG-Fallback',
      testUrl: 'https://example.com',
      timestamp,
      delay,
      success: true,
    })
  }

  assert.equal(
    storage.getRecentProbeSamples('SG-Fallback', 60, 30, Date.parse('2026-07-11T03:00:30Z')).length,
    2,
  )

  storage.close()
})

test('removes legacy fallback duplicates without removing ordinary node samples', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zashboardx-metrics-'))

  tempDirs.push(dir)

  const databasePath = join(dir, 'metrics.sqlite')
  const database = new DatabaseSync(databasePath)

  database.exec(`
    CREATE TABLE nodes (
      node_name TEXT PRIMARY KEY,
      type TEXT,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
    CREATE TABLE probe_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_name TEXT NOT NULL,
      test_url TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      delay INTEGER,
      success INTEGER NOT NULL,
      error_type TEXT
    );
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  database
    .prepare('INSERT INTO nodes (node_name, type, first_seen, last_seen) VALUES (?, ?, ?, ?)')
    .run('SG-Fallback', 'Fallback', at(0), at(0))
  database
    .prepare('INSERT INTO nodes (node_name, type, first_seen, last_seen) VALUES (?, ?, ?, ?)')
    .run('SG-01', 'ss', at(0), at(0))
  const insert = database.prepare(
    'INSERT INTO probe_samples (node_name, test_url, timestamp, delay, success) VALUES (?, ?, ?, ?, ?)',
  )

  insert.run('SG-Fallback', 'https://example.com', '2026-07-11T03:00:00.010Z', 84, 1)
  insert.run('SG-Fallback', 'https://example.com', '2026-07-11T03:00:00.410Z', 86, 1)
  insert.run('SG-01', 'https://example.com', '2026-07-11T03:00:00.010Z', 84, 1)
  insert.run('SG-01', 'https://example.com', '2026-07-11T03:00:00.410Z', 86, 1)
  database.close()

  const storage = new MetricsStorage(databasePath)

  storage.init()

  assert.equal(
    storage.getRecentProbeSamples('SG-Fallback', 60, 30, Date.parse('2026-07-11T03:00:30Z')).length,
    1,
  )
  assert.equal(
    storage.getRecentProbeSamples('SG-01', 60, 30, Date.parse('2026-07-11T03:00:30Z')).length,
    2,
  )

  storage.close()
})

test('runs the legacy fallback cleanup only once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zashboardx-metrics-'))

  tempDirs.push(dir)

  const databasePath = join(dir, 'metrics.sqlite')
  const firstStorage = new MetricsStorage(databasePath)

  firstStorage.init()
  firstStorage.recordNode('SG-Fallback', 'Fallback')
  firstStorage.insertProbeSample({
    nodeName: 'SG-Fallback',
    testUrl: 'https://example.com',
    timestamp: '2026-07-11T03:00:00.010Z',
    delay: 84,
    success: true,
  })
  firstStorage.insertProbeSample({
    nodeName: 'SG-Fallback',
    testUrl: 'https://example.com',
    timestamp: '2026-07-11T03:00:00.410Z',
    delay: 86,
    success: true,
  })
  firstStorage.close()

  const reopenedStorage = new MetricsStorage(databasePath)

  reopenedStorage.init()

  assert.equal(
    reopenedStorage.getRecentProbeSamples('SG-Fallback', 60, 30, Date.parse('2026-07-11T03:00:30Z'))
      .length,
    2,
  )

  reopenedStorage.close()
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

test('aggregates one node into ordered timeline buckets and preserves gaps', () => {
  const storage = createStorage()
  const nowMs = Date.parse('2026-07-05T00:00:00.000Z')

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-04T00:02:00.000Z',
    delay: 80,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-04T00:06:00.000Z',
    delay: 120,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-04T00:08:00.000Z',
    delay: null,
    success: false,
    errorType: 'timeout',
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-04T00:31:00.000Z',
    delay: null,
    success: false,
    errorType: 'timeout',
  })
  storage.insertProbeSample({
    nodeName: 'JP-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-04T00:08:00.000Z',
    delay: 60,
    success: true,
  })

  const buckets = storage.getNodeTimeline('HK-01', 24 * 60 * 60, 96, nowMs)

  assert.equal(buckets.length, 96)
  assert.deepEqual(buckets[0], {
    start: '2026-07-04T00:00:00.000Z',
    end: '2026-07-04T00:15:00.000Z',
    sampleCount: 3,
    successCount: 2,
    failureCount: 1,
    avgDelay: 100,
    minDelay: 80,
    maxDelay: 120,
    jitter: 40,
  })
  assert.deepEqual(buckets[1], {
    start: '2026-07-04T00:15:00.000Z',
    end: '2026-07-04T00:30:00.000Z',
    sampleCount: 0,
    successCount: 0,
    failureCount: 0,
    avgDelay: null,
    minDelay: null,
    maxDelay: null,
    jitter: null,
  })
  assert.deepEqual(buckets[2], {
    start: '2026-07-04T00:30:00.000Z',
    end: '2026-07-04T00:45:00.000Z',
    sampleCount: 1,
    successCount: 0,
    failureCount: 1,
    avgDelay: null,
    minDelay: null,
    maxDelay: null,
    jitter: null,
  })
  storage.close()
})

test('includes exact window endpoints in timeline buckets', () => {
  const storage = createStorage()
  const nowMs = Date.parse('2026-07-05T00:00:00.000Z')

  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-04T00:00:00.000Z',
    delay: 75,
    success: true,
  })
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: '2026-07-05T00:00:00.000Z',
    delay: 125,
    success: true,
  })

  const buckets = storage.getNodeTimeline('HK-01', 24 * 60 * 60, 96, nowMs)

  assert.equal(buckets[0].start, '2026-07-04T00:00:00.000Z')
  assert.equal(buckets[0].sampleCount, 1)
  assert.equal(buckets[95].end, '2026-07-05T00:00:00.000Z')
  assert.equal(buckets[95].sampleCount, 1)
  assert.equal(buckets[95].avgDelay, 125)
  storage.close()
})

test('supports fixed timeline profile geometry and boundary placement', () => {
  const profiles = [
    { windowSeconds: 3_600, bucketCount: 60, bucketSeconds: 60 },
    { windowSeconds: 21_600, bucketCount: 72, bucketSeconds: 300 },
    { windowSeconds: 86_400, bucketCount: 96, bucketSeconds: 900 },
  ]
  const nowMs = Date.parse('2026-07-05T00:00:00.000Z')

  for (const [index, profile] of profiles.entries()) {
    const storage = createStorage()
    const nodeName = `PROFILE-${index}`
    const windowStart = new Date(nowMs - profile.windowSeconds * 1000).toISOString()

    storage.insertProbeSample({
      nodeName,
      testUrl: 'https://example.com',
      timestamp: windowStart,
      delay: 75,
      success: true,
    })
    storage.insertProbeSample({
      nodeName,
      testUrl: 'https://example.com',
      timestamp: new Date(nowMs).toISOString(),
      delay: 125,
      success: true,
    })

    const buckets = storage.getNodeTimeline(
      nodeName,
      profile.windowSeconds,
      profile.bucketCount,
      nowMs,
    )

    assert.equal(buckets.length, profile.bucketCount)
    assert.equal(
      Date.parse(buckets[0].end) - Date.parse(buckets[0].start),
      profile.bucketSeconds * 1000,
    )
    assert.equal(buckets[0].sampleCount, 1)
    assert.equal(buckets[profile.bucketCount - 1].sampleCount, 1)
    storage.close()
  }
})

test('returns raw samples in a half-open interval ordered by timestamp and database id', () => {
  const storage = createStorage()
  const start = '2026-07-04T00:10:00.000Z'
  const end = '2026-07-04T00:15:00.000Z'

  const samples: ProbeSample[] = [
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com/start',
      timestamp: start,
      delay: 51,
      success: true,
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com/first',
      timestamp: '2026-07-04T00:12:00.000Z',
      delay: 52,
      success: true,
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com/second',
      timestamp: '2026-07-04T00:12:00.000Z',
      delay: 53,
      success: true,
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com/end',
      timestamp: end,
      delay: 54,
      success: true,
    },
  ]

  samples.forEach((sample) => storage.insertProbeSample(sample))

  const result = storage.getProbeSamplesBetween('HK-01', Date.parse(start), Date.parse(end), 200)

  assert.deepEqual(
    result.samples.map((sample) => sample.delay),
    [51, 52, 53],
  )
  assert.equal(result.truncated, false)
  storage.close()
})

test('marks raw sample intervals as truncated when more rows match than the limit', () => {
  const storage = createStorage()
  const start = '2026-07-04T00:10:00.000Z'
  const end = '2026-07-04T00:15:00.000Z'

  for (const [index, delay] of [51, 52, 53].entries()) {
    storage.insertProbeSample({
      nodeName: 'HK-01',
      testUrl: `https://example.com/${index}`,
      timestamp: new Date(Date.parse(start) + index * 60_000).toISOString(),
      delay,
      success: true,
    })
  }

  const result = storage.getProbeSamplesBetween('HK-01', Date.parse(start), Date.parse(end), 2)

  assert.deepEqual(
    result.samples.map((sample) => sample.delay),
    [51, 52],
  )
  assert.equal(result.truncated, true)
  storage.close()
})
