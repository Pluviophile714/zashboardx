import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  ProxyMetricsSample,
  ProxyMetricsTimelineBucket,
  ProxyMetricsTimelineResponse,
} from '../../api/metricsHelper.ts'
import {
  buildProxyMetricsSampleChartModel,
  buildProxyMetricsTimelineChartModel,
  getProxyMetricsTimelineHeight,
  getProxyMetricsTimelineTooltipMode,
  LATENCY_TIMELINE_WINDOWS,
} from '../proxyMetricsTimeline.ts'

const bucket = (
  index: number,
  values: Partial<ProxyMetricsTimelineBucket> = {},
): ProxyMetricsTimelineBucket => {
  const start = Date.parse('2026-07-04T00:00:00.000Z') + index * 15 * 60 * 1000

  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 15 * 60 * 1000).toISOString(),
    sampleCount: 1,
    successCount: 1,
    failureCount: 0,
    avgDelay: 100 + index,
    minDelay: 90 + index,
    maxDelay: 110 + index,
    jitter: 10,
    ...values,
  }
}

const timeline = (buckets: ProxyMetricsTimelineBucket[]): ProxyMetricsTimelineResponse => ({
  windowSeconds: 86_400,
  generatedAt: buckets.at(-1)?.end ?? '2026-07-05T00:00:00.000Z',
  nodeName: 'HK-01',
  bucketSeconds: 900,
  buckets,
})

const options = {
  width: 360,
  height: 150,
  padding: { top: 10, right: 8, bottom: 22, left: 34 },
}

const sample = (
  timestamp: string,
  delay: number | null,
  success = delay !== null,
): ProxyMetricsSample => ({
  delay,
  nodeName: 'HK-01',
  success,
  testUrl: 'https://example.com/generate_204',
  timestamp,
})

test('plots 1h raw samples on their real timestamps and aligns failures with the same sample', () => {
  const samples = [
    sample('2026-07-04T00:05:00.000Z', 100),
    sample('2026-07-04T00:25:00.000Z', null, false),
    sample('2026-07-04T00:55:00.000Z', 140),
  ]
  const model = buildProxyMetricsSampleChartModel(samples, {
    ...options,
    windowEnd: '2026-07-04T01:00:00.000Z',
    windowStart: '2026-07-04T00:00:00.000Z',
  })

  assert.equal(model.points.length, samples.length)
  assert.ok(model.points[0]!.x < model.points[2]!.x)
  assert.equal(model.points[1], null)
  assert.equal(model.statusSlices.length, 1)
  assert.equal(model.statusSlices[0].sampleIndex, 1)
  assert.ok(model.statusSlices[0].x > model.points[0]!.x)
  assert.ok(model.statusSlices[0].x < model.points[2]!.x)
  assert.equal(model.axes.xTicks[0].timestamp, '2026-07-04T00:00:00.000Z')
  assert.equal(model.axes.xTicks.at(-1)?.timestamp, '2026-07-04T01:00:00.000Z')
})

test('splits average and range paths at failed and empty buckets', () => {
  const response = timeline([
    bucket(0),
    bucket(1, { sampleCount: 2, successCount: 1, failureCount: 1 }),
    bucket(2, {
      sampleCount: 1,
      successCount: 0,
      failureCount: 1,
      avgDelay: null,
      minDelay: null,
      maxDelay: null,
    }),
    bucket(3, {
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      avgDelay: null,
      minDelay: null,
      maxDelay: null,
    }),
    bucket(4),
  ])

  const model = buildProxyMetricsTimelineChartModel(response, options)

  assert.equal(model.averagePaths.length, 2)
  assert.equal(model.rangePaths.length, 2)
  assert.equal(model.statusSlices[0].kind, 'mixed')
  assert.equal(model.statusSlices[1].kind, 'failed')
  assert.equal(model.points[2], null)
  assert.equal(model.points[3], null)
})

test('gives constant latency a finite non-zero y range', () => {
  const response = timeline([
    bucket(0, { avgDelay: 100, minDelay: 100, maxDelay: 100 }),
    bucket(1, { avgDelay: 100, minDelay: 100, maxDelay: 100 }),
  ])
  const model = buildProxyMetricsTimelineChartModel(response, options)

  assert.ok(model.axes.yMax > model.axes.yMin)
  assert.ok(model.averagePaths.every((path) => !path.includes('NaN')))
  assert.ok(model.rangePaths.every((path) => !path.includes('NaN')))
  assert.ok(
    model.points.every(
      (point) => point === null || (Number.isFinite(point.x) && Number.isFinite(point.y)),
    ),
  )
})

test('encodes failure ratios without treating empty buckets as failures', () => {
  const response = timeline([
    bucket(0, { sampleCount: 4, successCount: 3, failureCount: 1 }),
    bucket(1, {
      sampleCount: 2,
      successCount: 0,
      failureCount: 2,
      avgDelay: null,
      minDelay: null,
      maxDelay: null,
    }),
    bucket(2, {
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      avgDelay: null,
      minDelay: null,
      maxDelay: null,
    }),
  ])
  const model = buildProxyMetricsTimelineChartModel(response, options)

  assert.deepEqual(
    model.statusSlices.map(({ kind, failureRatio }) => ({ kind, failureRatio })),
    [
      { kind: 'mixed', failureRatio: 0.25 },
      { kind: 'failed', failureRatio: 1 },
    ],
  )
})

test('keeps five time ticks and latency ticks for an empty 24h timeline', () => {
  const response = timeline(
    Array.from({ length: 96 }, (_, index) =>
      bucket(index, {
        sampleCount: 0,
        successCount: 0,
        failureCount: 0,
        avgDelay: null,
        minDelay: null,
        maxDelay: null,
      }),
    ),
  )
  const model = buildProxyMetricsTimelineChartModel(response, options)

  assert.equal(model.axes.xTicks.length, 5)
  assert.equal(model.axes.yTicks.length, 3)
  assert.deepEqual(model.averagePaths, [])
})

test('keeps timeline details outside the plot on mobile and desktop', () => {
  assert.equal(getProxyMetricsTimelineTooltipMode(true), 'outside')
  assert.equal(getProxyMetricsTimelineTooltipMode(false), 'outside')
})

test('gives the wider desktop popover a taller timeline plot', () => {
  assert.equal(getProxyMetricsTimelineHeight(true), 96)
  assert.equal(getProxyMetricsTimelineHeight(false), 180)
})

test('exposes the supported timeline windows in compact control order', () => {
  assert.deepEqual(LATENCY_TIMELINE_WINDOWS, ['1h', '6h', '24h'])
})
