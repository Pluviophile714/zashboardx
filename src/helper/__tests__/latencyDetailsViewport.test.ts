import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCompactLatencyDetailsPlacement,
  getDesktopLatencyDetailsPlacement,
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

test('keeps the current desktop detail placement while its content is replaced', () => {
  assert.deepEqual(
    getDesktopLatencyDetailsPlacement(
      { top: 180, right: 420, bottom: 216, left: 360 },
      { width: 1280, height: 800 },
      448,
      8,
      'bottom',
    ),
    { placement: 'bottom', maxHeight: 576 },
  )
})

test('chooses a desktop detail placement from available space when it is not locked', () => {
  assert.deepEqual(
    getDesktopLatencyDetailsPlacement(
      { top: 180, right: 420, bottom: 216, left: 360 },
      { width: 1280, height: 800 },
      448,
      8,
    ),
    { placement: 'right', maxHeight: 784 },
  )
})
