import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const proxyNodeCardSource = readFileSync(
  new URL('../../components/proxies/ProxyNodeCard.vue', import.meta.url),
  'utf8',
)
const timelineChartSource = readFileSync(
  new URL('../../components/proxies/latencyTimelineChart.ts', import.meta.url),
  'utf8',
)

test('uses the 24h chart as the only latency line chart in node details', () => {
  assert.match(proxyNodeCardSource, /createLatencyTimelineChartSection/)
  assert.match(proxyNodeCardSource, /buildLatencyStatusTimeline/)
  assert.doesNotMatch(proxyNodeCardSource, /buildSparklineSvg/)
})

test('renders empty timelines on the same concrete-time chart axes', () => {
  assert.match(timelineChartSource, /formatBucketTime\(bucket\.start\)/)
  assert.match(timelineChartSource, /state\.status === 'empty'/)
  assert.doesNotMatch(timelineChartSource, /24h前/)
})

test('keeps the final timeline time label inside the mobile detail popover', () => {
  assert.match(proxyNodeCardSource, /w-\[calc\(100vw-0\.5rem\)\]/)
  assert.match(timelineChartSource, /right: 16/)
})

test('repositions an expanded desktop detail popover within the available viewport space', () => {
  assert.match(proxyNodeCardSource, /repositionLatencyDetailsTip/)
  assert.match(proxyNodeCardSource, /instance\.setProps\(\{ placement \}\)/)
  assert.match(proxyNodeCardSource, /root\.style\.maxHeight/)
  assert.match(proxyNodeCardSource, /altAxis: true/)
})

test('keeps the node title from shrinking when a detail popover is height constrained', () => {
  assert.match(
    proxyNodeCardSource,
    /title\.className = compact\r?\n\s*\? 'mb-1\.5 shrink-0 truncate/,
  )
})

test('uses a short desktop hover delay without changing the mobile long-press trigger', () => {
  assert.match(proxyNodeCardSource, /delay: \[500, 120\]/)
  assert.match(proxyNodeCardSource, /touch: \['hold', 500\]/)
})
