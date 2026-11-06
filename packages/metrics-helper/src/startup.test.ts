import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldRebuildMetricsRollups } from './startup.js'

test('skips the full rollup rebuild when persisted rollups are ready', () => {
  assert.equal(shouldRebuildMetricsRollups(true), false)
})

test('rebuilds rollups when persisted rollups are not ready', () => {
  assert.equal(shouldRebuildMetricsRollups(false), true)
})
