import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const helperSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
const proxyNodeCardSource = readFileSync(
  new URL('../../components/proxies/ProxyNodeCard.vue', import.meta.url),
  'utf8',
)

test('does not render the internal app route in browser navigation', () => {
  assert.match(helperSource, /if \(r === ROUTE_NAME\.app\) return false/)
})

test('uses the Mihomo-only latency test signature', () => {
  assert.doesNotMatch(
    proxyNodeCardSource,
    /proxyLatencyTest\(props\.name, getTestUrl\(props\.groupName\), undefined, props\.groupName\)/,
  )
})
