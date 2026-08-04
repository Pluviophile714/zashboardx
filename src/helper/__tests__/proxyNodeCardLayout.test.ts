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

test('keeps the latency range visible while lighter than the average line', () => {
  assert.match(timelineChartSource, /'fill-opacity': 0\.22/)
  assert.match(timelineChartSource, /'stroke-width': options\.compact \? 1\.5 : 1\.75/)
})

test('keeps the final timeline time label inside the mobile detail popover', () => {
  assert.match(proxyNodeCardSource, /w-\[calc\(100vw-0\.5rem\)\]/)
  assert.match(timelineChartSource, /right: 16/)
})

test('keeps node details accessible without a raw sample list', () => {
  assert.match(
    proxyNodeCardSource,
    /\? 'flex max-h-\[min\(68vh,28rem\)\].*touch-pan-y.*overflow-y-auto.*overscroll-contain/,
  )
  assert.match(proxyNodeCardSource, /w-\[28rem\]/)
  assert.doesNotMatch(proxyNodeCardSource, /const list = document\.createElement\('div'\)/)
  assert.match(proxyNodeCardSource, /content\.style\.padding = '0'/)
})

test('uses the same focused information hierarchy on desktop and mobile', () => {
  assert.doesNotMatch(proxyNodeCardSource, /availabilityLine\.append\(coverage, sampleDetail\)/)
  assert.match(
    proxyNodeCardSource,
    /const summaryLine = document\.createElement\('div'\)\r?\n\s*if \(stats\) \{/,
  )
  assert.doesNotMatch(proxyNodeCardSource, /const stabilityLine = document\.createElement/)
  assert.match(timelineChartSource, /getProxyMetricsTimelineHeight\(options\.compact\)/)
})

test('keeps 24h bucket details outside the plot on desktop and mobile', () => {
  assert.match(timelineChartSource, /getProxyMetricsTimelineTooltipMode\(options\.compact\)/)
  assert.match(timelineChartSource, /body\.append\(svg\)\r?\n\s*section\.append\(tooltip\)/)
  assert.doesNotMatch(timelineChartSource, /body\.append\(svg, tooltip\)/)
})

test('shows selected bucket jitter next to its range details', () => {
  assert.match(timelineChartSource, /'波动'/)
})

test('inspects recent samples by touch on mobile and hover on desktop', () => {
  assert.match(proxyNodeCardSource, /getLatencySampleIndexAtPointer/)
  assert.match(proxyNodeCardSource, /if \(summaryLine\) \{/)
  assert.match(proxyNodeCardSource, /strip\.addEventListener\('pointerdown', selectPointerSample\)/)
  assert.match(proxyNodeCardSource, /strip\.addEventListener\('pointermove', selectPointerSample\)/)
  assert.match(
    proxyNodeCardSource,
    /strip\.addEventListener\('pointerup', scheduleSummaryRestore\)/,
  )
  assert.match(proxyNodeCardSource, /strip\.addEventListener\('pointerleave', restoreSummary\)/)
  assert.match(proxyNodeCardSource, /LATENCY_SAMPLE_DETAIL_RESTORE_DELAY = 1000/)
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

test('uses cached R5S samples for the first-level latency stability bar', () => {
  assert.match(
    proxyNodeCardSource,
    /const getLatencyStabilityHistory = \(\) => \{[\s\S]*proxyMetricsSamplesMap\.value[\s\S]*return r5sSamples[\s\S]*getHistoryByName/,
  )
  assert.match(proxyNodeCardSource, /const history = getLatencyStabilityHistory\(\)/)
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
