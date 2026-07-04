import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateNodeMetrics } from './aggregate.js'
import type { ProbeSample } from './types.js'

const at = (minute: number) => new Date(Date.UTC(2026, 6, 4, 0, minute, 0)).toISOString()

test('returns null availability when there are no samples', () => {
  const metrics = aggregateNodeMetrics([], Date.parse(at(30)), 24 * 60 * 60)

  assert.equal(metrics.availability, null)
  assert.equal(metrics.sampleCount, 0)
  assert.equal(metrics.successCount, 0)
  assert.equal(metrics.failureCount, 0)
  assert.equal(metrics.coverageSeconds, 0)
  assert.equal(metrics.lossRate, null)
  assert.equal(metrics.lossSource, null)
})

test('computes availability and delay stats inside the requested window', () => {
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
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(10),
      delay: 120,
      success: true,
    },
  ]

  const metrics = aggregateNodeMetrics(samples, Date.parse(at(30)), 24 * 60 * 60)

  assert.equal(metrics.availability, 2 / 3)
  assert.equal(metrics.coverageSeconds, 600)
  assert.equal(metrics.sampleCount, 3)
  assert.equal(metrics.successCount, 2)
  assert.equal(metrics.failureCount, 1)
  assert.equal(metrics.avgDelay, 100)
  assert.equal(metrics.minDelay, 80)
  assert.equal(metrics.maxDelay, 120)
  assert.equal(metrics.lastDelay, 120)
  assert.equal(metrics.lastSuccessAt, at(10))
  assert.equal(metrics.lastFailureAt, at(5))
})

test('ignores samples older than the requested window', () => {
  const samples: ProbeSample[] = [
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(0),
      delay: null,
      success: false,
      errorType: 'timeout',
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://example.com',
      timestamp: at(20),
      delay: 90,
      success: true,
    },
  ]

  const metrics = aggregateNodeMetrics(samples, Date.parse(at(30)), 5 * 60)

  assert.equal(metrics.availability, null)
  assert.equal(metrics.sampleCount, 0)
  assert.equal(metrics.coverageSeconds, 0)
})
