import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProxyMetricsSample, ProxyMetricsTimelineBucket } from '../../api/metricsHelper.ts'
import {
  formatLatencyBucketTitle,
  mapLatencyBucketSamplesToHistory,
  resolveLatencyStripHistory,
} from '../latencyBucketDrilldown.ts'

const createBucket = (
  start = '2026-08-04T15:45:00',
  end = '2026-08-04T16:00:00',
): ProxyMetricsTimelineBucket => ({
  avgDelay: 88,
  end,
  failureCount: 1,
  jitter: 4,
  maxDelay: 96,
  minDelay: 80,
  sampleCount: 17,
  start,
  successCount: 16,
})

const createSample = (
  index: number,
  overrides: Partial<ProxyMetricsSample> = {},
): ProxyMetricsSample => ({
  delay: 70 + index,
  nodeName: 'HK-01',
  success: true,
  testUrl: 'https://www.gstatic.com/generate_204',
  timestamp: new Date(Date.parse('2026-08-04T15:45:00.000Z') + index * 1_000).toISOString(),
  ...overrides,
})

test('uses recent history while bucket drilldown is inactive', () => {
  const recent = [{ delay: 51, time: '2026-08-04T15:44:00.000Z' }]
  const bucket = [{ delay: 71, time: '2026-08-04T15:45:00.000Z' }]

  assert.equal(resolveLatencyStripHistory({ mode: 'recent', recent, bucket }), recent)
  assert.equal(resolveLatencyStripHistory({ mode: 'recent', recent, bucket: [] }), recent)
})

for (const recordCount of [14, 17, 34]) {
  test(`returns all ${recordCount} bucket records without truncation`, () => {
    const recent = Array.from({ length: 30 }, (_, index) => ({ delay: index + 1 }))
    const bucket = Array.from({ length: recordCount }, (_, index) => ({ delay: index + 101 }))

    const resolved = resolveLatencyStripHistory({ mode: 'bucket', recent, bucket })

    assert.equal(resolved, bucket)
    assert.equal(resolved.length, recordCount)
    assert.deepEqual(
      resolved.map((item) => item.delay),
      Array.from({ length: recordCount }, (_, index) => index + 101),
    )
  })
}

test('maps raw bucket samples in response order and preserves failures', () => {
  const samples = [
    createSample(0),
    createSample(1, { delay: null, errorType: 'timeout', success: false }),
    createSample(2),
  ]

  assert.deepEqual(mapLatencyBucketSamplesToHistory(samples), [
    { delay: 70, time: samples[0].timestamp },
    { delay: 0, time: samples[1].timestamp },
    { delay: 72, time: samples[2].timestamp },
  ])
})

test('formats the exact bucket interval with the actual record count', () => {
  assert.equal(formatLatencyBucketTitle(createBucket(), 17), '15:45 - 16:00 · 17 records')
})
