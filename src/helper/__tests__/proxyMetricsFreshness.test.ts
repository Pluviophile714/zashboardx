import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getProxyMetricsFreshness } from '../proxyMetricsFreshness.ts'

const now = Date.parse('2026-08-11T02:00:00.000Z')

test('marks a recent sample as live when the event stream is connected', () => {
  assert.deepEqual(getProxyMetricsFreshness('2026-08-11T01:59:30.000Z', true, now), {
    ageSeconds: 30,
    state: 'live',
  })
})

test('falls back to polling when the event stream is unavailable', () => {
  assert.deepEqual(getProxyMetricsFreshness('2026-08-11T01:59:30.000Z', false, now), {
    ageSeconds: 30,
    state: 'polling',
  })
})

test('marks samples older than two probe cycles as stale', () => {
  assert.deepEqual(getProxyMetricsFreshness('2026-08-11T01:57:59.000Z', true, now), {
    ageSeconds: 121,
    state: 'stale',
  })
})
