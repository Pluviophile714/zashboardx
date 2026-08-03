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

test('keeps compact node details accessible without the desktop-only sample list', () => {
  assert.match(
    proxyNodeCardSource,
    /\? 'flex max-h-\[min\(68vh,28rem\)\].*touch-pan-y.*overflow-y-auto.*overscroll-contain/,
  )
  assert.match(proxyNodeCardSource, /if \(compact\) return root\r?\n\r?\n\s*const list/)
  assert.match(proxyNodeCardSource, /list\.className =\s*\r?\n\s*'mt-2 flex min-h-20 max-h-52/)
  assert.match(proxyNodeCardSource, /content\.style\.padding = '0'/)
})

test('keeps compact node details focused on the chart instead of desktop metadata', () => {
  assert.match(
    proxyNodeCardSource,
    /if \(!compact\) \{\r?\n\s*availabilityLine\.append\(coverage, sampleDetail\)/,
  )
  assert.match(proxyNodeCardSource, /if \(stats\) \{\r?\n\s*const statLine/)
  assert.match(proxyNodeCardSource, /if \(stats && !compact\) \{\r?\n\s*const stabilityLine/)
  assert.match(timelineChartSource, /options\.compact \? 'relative h-\[96px\]'/)
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

test('refreshes the open R5S detail list when the shared 24h metrics update', () => {
  assert.match(proxyNodeCardSource, /watch\(\s*proxyMetricsUpdatedAt/)
  assert.match(proxyNodeCardSource, /refreshProxyMetricsSamples\(sourceName, \{[\s\S]*force: true/)
  assert.match(proxyNodeCardSource, /instance\.setContent\(createLatencyDetailsTip\(\)\)/)
})

test('forces a fresh R5S sample request whenever node details open', () => {
  assert.match(
    proxyNodeCardSource,
    /const getR5sLatencyDetailsSamplesRefresh = \(\) => \{[\s\S]*return refreshR5sLatencyDetailsSamples\(true\)/,
  )
})
