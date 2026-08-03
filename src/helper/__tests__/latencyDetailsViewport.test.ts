import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCompactLatencyDetailsPlacement,
  getLatencyDetailsViewportSize,
} from '../latencyDetailsViewport.ts'

test('prefers the mobile visual viewport over the larger layout viewport', () => {
  assert.deepEqual(getLatencyDetailsViewportSize(393, 805, { width: 393, height: 600 }), {
    width: 393,
    height: 600,
  })
})

test('caps a compact detail popover to the visible space below its latency tag', () => {
  assert.deepEqual(
    getCompactLatencyDetailsPlacement({ top: 118, bottom: 154 }, { width: 393, height: 600 }, 8, 8),
    { placement: 'bottom', maxHeight: 430 },
  )
})

test('moves a compact detail popover above its latency tag when the browser bottom bar leaves less space', () => {
  assert.deepEqual(
    getCompactLatencyDetailsPlacement({ top: 470, bottom: 506 }, { width: 393, height: 600 }, 8, 8),
    { placement: 'top', maxHeight: 454 },
  )
})
