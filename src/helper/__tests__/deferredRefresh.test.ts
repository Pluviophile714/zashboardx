import assert from 'node:assert/strict'
import test from 'node:test'
import { openWithDeferredRefresh } from '../deferredRefresh.ts'

test('updates an already opened view when a slow refresh finishes', async () => {
  let resolveRefresh: (() => void) | undefined
  const refresh = new Promise<void>((resolve) => {
    resolveRefresh = resolve
  })
  let ready = false
  const rendered: string[] = []

  await openWithDeferredRefresh({
    refresh,
    waitMs: 0,
    open: () => {
      rendered.push(ready ? 'ready' : 'loading')
      return { active: true }
    },
    isActive: (view) => view.active,
    update: () => rendered.push(ready ? 'ready' : 'loading'),
  })

  assert.deepEqual(rendered, ['loading'])

  ready = true
  resolveRefresh?.()
  await refresh
  await Promise.resolve()

  assert.deepEqual(rendered, ['loading', 'ready'])
})

test('does not update a view that closed before refresh finished', async () => {
  let resolveRefresh: (() => void) | undefined
  const refresh = new Promise<void>((resolve) => {
    resolveRefresh = resolve
  })
  const view = { active: true }
  let updates = 0

  await openWithDeferredRefresh({
    refresh,
    waitMs: 0,
    open: () => view,
    isActive: (currentView) => currentView.active,
    update: () => {
      updates += 1
    },
  })

  view.active = false
  resolveRefresh?.()
  await refresh
  await Promise.resolve()

  assert.equal(updates, 0)
})
