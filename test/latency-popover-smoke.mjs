import assert from 'node:assert/strict'
import { startHarness } from './lib/harness.mjs'
import { sleep } from './lib/cdp.mjs'

const harness = await startHarness({ groups: 60, nodes: 100, connections: 0 })
try {
  for (const mobile of [false, true]) {
    const page = await harness.openProxiesPage({
      viewport: mobile ? { width: 390, height: 844, mobile: true } : { width: 1440, height: 900 },
      settings: { 'config/two-columns': 'false', 'config/language': 'zh-CN' },
    })
    await page.waitForCards(1)
    await sleep(800)
    const hasNodes = await page.evaluate(`Boolean(document.querySelector('[data-group-name="Group-000"] .proxies-scrollable-parent .latency-tag'))`)
    if (!hasNodes) await page.clickSelector('[data-group-name="Group-000"] .collapse-motion-header')
    await sleep(1000)
    const tag = '[data-group-name="Group-000"] .proxies-scrollable-parent .latency-tag'
    const box = await page.boxOf(tag)
    assert.ok(box, 'node latency entry exists')
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y })
    await sleep(1500)
    const state = await page.evaluate(`(() => {
      const tip = [...document.querySelectorAll('[data-tippy-root]')].find(e => e.getBoundingClientRect().width > 200)
      const r = tip?.getBoundingClientRect()
      return { tip: Boolean(tip), rect: r ? { x:r.x, y:r.y, width:r.width, height:r.height } : null,
        overflow: document.documentElement.scrollWidth > innerWidth,
        strips: document.querySelectorAll('.latency-strip-track').length }
    })()`)
    await page.screenshot(mobile ? 'mobile-popover-verification.png' : 'desktop-popover-verification.png')
    console.log(JSON.stringify({ mobile, ...state }))
    assert.ok(state.strips > 0, 'latency strips rendered')
    assert.equal(state.overflow, false, 'no page horizontal overflow')
    if (state.rect) {
      assert.ok(state.rect.x >= -1 && state.rect.x + state.rect.width <= page.viewport.width + 1)
    }
    await page.evaluate(`location.hash = '#/settings'`)
    await sleep(1000)
    const orphan = await page.evaluate(`document.querySelectorAll('[data-tippy-root]').length`)
    console.log(JSON.stringify({ mobile, remainingTipsAfterRouteLeave: orphan,
      location: await page.evaluate('location.hash') }))
    assert.equal(orphan, 0, 'route leave removes tooltips')
    await page.close()
  }
} finally {
  await harness.close()
}
