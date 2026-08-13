import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyRecentSampleUpdate,
  getProxyMetricsSampleIdentity,
  mergeRollingMetricSamples,
  reconcileMetricsNodeRecentSamples,
  reconcileRecentSampleUpdate,
} from '../proxyMetricsRecentSamples.ts'

const sample = (timestamp: string, delay: number | null = 100) => ({
  delay,
  nodeName: 'HK-01',
  success: delay !== null,
  testUrl: 'https://example.com',
  timestamp,
})

test('treats the first raw sample response as initial', () => {
  assert.equal(
    classifyRecentSampleUpdate(undefined, [sample('2026-08-06T10:00:00.000Z')]),
    'initial',
  )
})

test('treats the same raw sample sequence as unchanged', () => {
  const samples = [sample('2026-08-06T10:00:00.000Z'), sample('2026-08-06T10:01:00.000Z')]

  const next = samples.map((item) => ({ ...item }))

  assert.equal(classifyRecentSampleUpdate(samples, next), 'unchanged')
  assert.equal(reconcileRecentSampleUpdate(samples, next).samples, samples)
})

test('treats one newer tail sample as appended', () => {
  const previous = [sample('2026-08-06T10:00:00.000Z'), sample('2026-08-06T10:01:00.000Z')]
  const next = [...previous, sample('2026-08-06T10:02:00.000Z', 120)]

  assert.equal(classifyRecentSampleUpdate(previous, next), 'appended')
})

test('treats a full rolling window as appended when the oldest sample leaves', () => {
  const previous = Array.from({ length: 30 }, (_, index) =>
    sample(`2026-08-06T10:${String(index).padStart(2, '0')}:00.000Z`, 100 + index),
  )
  const next = [...previous.slice(1), sample('2026-08-06T10:30:00.000Z', 140)]

  assert.equal(classifyRecentSampleUpdate(previous, next), 'appended')
})

test('treats a non-tail change as replaced instead of animating the strip', () => {
  const previous = [sample('2026-08-06T10:00:00.000Z'), sample('2026-08-06T10:01:00.000Z')]
  const next = [sample('2026-08-06T09:59:00.000Z', 80), previous[1]]

  assert.equal(classifyRecentSampleUpdate(previous, next), 'replaced')
})

test('uses timestamp and outcome fields to identify a probe sample', () => {
  const first = sample('2026-08-06T10:00:00.000Z', 100)
  const second = sample('2026-08-06T10:00:00.000Z', null)

  assert.notEqual(getProxyMetricsSampleIdentity(first), getProxyMetricsSampleIdentity(second))
})

test('reconciles recent samples embedded in the metrics nodes response', () => {
  const cacheKey = '24h\n30\nHK-01'
  const previous = {
    [cacheKey]: [sample('2026-08-06T10:00:00.000Z'), sample('2026-08-06T10:01:00.000Z')],
  }
  const next = {
    'HK-01': {
      recentSamples: [sample('2026-08-06T10:01:00.000Z'), sample('2026-08-06T10:02:00.000Z', 120)],
    },
  }

  const updates = reconcileMetricsNodeRecentSamples(previous, next, (nodeName) => {
    return `24h\n30\n${nodeName}`
  })

  assert.equal(updates[cacheKey]?.kind, 'appended')
  assert.deepEqual(updates[cacheKey]?.samples, next['HK-01'].recentSamples)
})

test('merges a recent response into the existing one-hour sample list', () => {
  const previous = Array.from({ length: 45 }, (_, index) =>
    sample(`2026-08-13T10:${String(index).padStart(2, '0')}:00.000Z`, 100 + index),
  )
  const recent = [...previous.slice(-29), sample('2026-08-13T10:45:00.000Z', 145)]

  const merged = mergeRollingMetricSamples(previous, recent, {
    limit: 200,
    snapshotAt: '2026-08-13T10:45:00.000Z',
    windowSeconds: 3_600,
  })

  assert.equal(merged.length, 46)
  assert.equal(merged[0].timestamp, '2026-08-13T10:00:00.000Z')
  assert.equal(merged.at(-1)?.timestamp, '2026-08-13T10:45:00.000Z')
})

test('prunes the shared raw list by one-hour age and hard limit', () => {
  const previous = Array.from({ length: 205 }, (_, index) =>
    sample(new Date(Date.parse('2026-08-13T10:00:00.000Z') + index * 20_000).toISOString()),
  )
  const recent = [sample('2026-08-13T11:10:00.000Z', 120)]

  const merged = mergeRollingMetricSamples(previous, recent, {
    limit: 200,
    snapshotAt: '2026-08-13T11:10:00.000Z',
    windowSeconds: 3_600,
  })

  assert.ok(merged.length <= 200)
  assert.ok(
    merged.every((item) => Date.parse(item.timestamp) >= Date.parse('2026-08-13T10:10:00.000Z')),
  )
  assert.equal(merged.at(-1)?.timestamp, '2026-08-13T11:10:00.000Z')
})
