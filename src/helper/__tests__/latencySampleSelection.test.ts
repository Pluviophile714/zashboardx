import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getLatencySampleIndexAtPointer } from '../latencySampleSelection.ts'

test('maps clamped pointer positions to the matching recent latency sample', () => {
  assert.equal(getLatencySampleIndexAtPointer(90, 100, 300, 30), 0)
  assert.equal(getLatencySampleIndexAtPointer(100, 100, 300, 30), 0)
  assert.equal(getLatencySampleIndexAtPointer(255, 100, 300, 30), 15)
  assert.equal(getLatencySampleIndexAtPointer(399.9, 100, 300, 30), 29)
  assert.equal(getLatencySampleIndexAtPointer(410, 100, 300, 30), 29)
})

test('does not select a sample from invalid or empty geometry', () => {
  assert.equal(getLatencySampleIndexAtPointer(100, 100, 0, 30), null)
  assert.equal(getLatencySampleIndexAtPointer(100, 100, 300, 0), null)
  assert.equal(getLatencySampleIndexAtPointer(Number.NaN, 100, 300, 30), null)
})
