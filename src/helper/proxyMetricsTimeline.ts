import type { ProxyMetricsTimelineResponse } from '@/api/metricsHelper'

export type ProxyMetricsTimelineChartPoint = {
  bucketIndex: number
  x: number
  y: number
}

export type ProxyMetricsTimelineStatusSlice = {
  bucketIndex: number
  failureRatio: number
  kind: 'mixed' | 'failed'
  opacity: number
  width: number
  x: number
}

export type ProxyMetricsTimelineChartModel = {
  axes: {
    plotBottom: number
    plotLeft: number
    plotRight: number
    plotTop: number
    xTicks: { bucketIndex: number; x: number }[]
    yMax: number
    yMin: number
    yTicks: { value: number; y: number }[]
  }
  averagePaths: string[]
  points: (ProxyMetricsTimelineChartPoint | null)[]
  rangePaths: string[]
  statusSlices: ProxyMetricsTimelineStatusSlice[]
}

type TimelineChartOptions = {
  height: number
  padding: {
    bottom: number
    left: number
    right: number
    top: number
  }
  width: number
}

type RangePoint = ProxyMetricsTimelineChartPoint & {
  maxY: number
  minY: number
}

export const getProxyMetricsTimelineTooltipMode = (compact: boolean) => {
  void compact
  return 'outside' as const
}

export const getProxyMetricsTimelineHeight = (compact: boolean) => (compact ? 96 : 180)

const coordinate = (value: number) => Number(value.toFixed(2))

const createPathRuns = <T>(points: (T | null)[], createPath: (run: T[]) => string): string[] => {
  const paths: string[] = []
  let run: T[] = []

  const flush = () => {
    if (run.length) {
      paths.push(createPath(run))
      run = []
    }
  }

  for (const point of points) {
    if (point === null) {
      flush()
      continue
    }

    run.push(point)
  }

  flush()
  return paths
}

export const buildProxyMetricsTimelineChartModel = (
  timeline: ProxyMetricsTimelineResponse,
  options: TimelineChartOptions,
): ProxyMetricsTimelineChartModel => {
  const plotLeft = options.padding.left
  const plotRight = Math.max(plotLeft + 1, options.width - options.padding.right)
  const plotTop = options.padding.top
  const plotBottom = Math.max(plotTop + 1, options.height - options.padding.bottom)
  const plotWidth = plotRight - plotLeft
  const plotHeight = plotBottom - plotTop
  const bucketCount = Math.max(1, timeline.buckets.length)
  const bucketWidth = plotWidth / bucketCount
  const successfulDelays = timeline.buckets.flatMap((bucket) =>
    bucket.successCount > 0 &&
    bucket.avgDelay !== null &&
    bucket.minDelay !== null &&
    bucket.maxDelay !== null
      ? [bucket.minDelay, bucket.avgDelay, bucket.maxDelay]
      : [],
  )
  const rawMin = successfulDelays.length ? Math.min(...successfulDelays) : 0
  const rawMax = successfulDelays.length ? Math.max(...successfulDelays) : 100
  const midpoint = (rawMin + rawMax) / 2
  const minimumSpan = Math.max(20, midpoint * 0.2)
  const expandedMin = rawMax - rawMin < minimumSpan ? midpoint - minimumSpan / 2 : rawMin
  const expandedMax = rawMax - rawMin < minimumSpan ? midpoint + minimumSpan / 2 : rawMax
  const padding = Math.max(2, (expandedMax - expandedMin) * 0.08)
  const yMin = Math.max(0, Math.floor(expandedMin - padding))
  const yMax = Math.max(yMin + 1, Math.ceil(expandedMax + padding))
  const yRange = yMax - yMin
  const toY = (delay: number) =>
    coordinate(plotBottom - ((Math.min(yMax, Math.max(yMin, delay)) - yMin) / yRange) * plotHeight)
  const points: (ProxyMetricsTimelineChartPoint | null)[] = []
  const rangePoints: (RangePoint | null)[] = []
  const statusSlices: ProxyMetricsTimelineStatusSlice[] = []

  timeline.buckets.forEach((bucket, bucketIndex) => {
    const x = coordinate(plotLeft + bucketWidth * (bucketIndex + 0.5))
    const hasLatency =
      bucket.successCount > 0 &&
      bucket.avgDelay !== null &&
      bucket.minDelay !== null &&
      bucket.maxDelay !== null

    points.push(
      hasLatency
        ? {
            bucketIndex,
            x,
            y: toY(bucket.avgDelay as number),
          }
        : null,
    )
    rangePoints.push(
      hasLatency
        ? {
            bucketIndex,
            x,
            y: toY(bucket.avgDelay as number),
            minY: toY(bucket.minDelay as number),
            maxY: toY(bucket.maxDelay as number),
          }
        : null,
    )

    if (bucket.failureCount > 0 && bucket.sampleCount > 0) {
      const failureRatio = bucket.failureCount / bucket.sampleCount
      const kind = bucket.successCount > 0 ? 'mixed' : 'failed'

      statusSlices.push({
        bucketIndex,
        failureRatio,
        kind,
        opacity: kind === 'failed' ? 0.3 : 0.1 + failureRatio * 0.22,
        width: coordinate(bucketWidth),
        x: coordinate(plotLeft + bucketIndex * bucketWidth),
      })
    }
  })

  const averagePaths = createPathRuns(points, (run) =>
    run.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
  )
  const rangePaths = createPathRuns(rangePoints, (run) => {
    const upper = run
      .map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.maxY}`)
      .join(' ')
    const lower = [...run]
      .reverse()
      .map((point) => `L ${point.x} ${point.minY}`)
      .join(' ')

    return `${upper} ${lower} Z`
  })
  const yTickValues = [yMin, Math.round((yMin + yMax) / 2), yMax]
  const xTickIndices = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => Math.round((bucketCount - 1) * ratio))
    .filter((value, index, values) => values.indexOf(value) === index)

  return {
    axes: {
      plotBottom,
      plotLeft,
      plotRight,
      plotTop,
      xTicks: xTickIndices.map((bucketIndex) => ({
        bucketIndex,
        x: coordinate(plotLeft + bucketWidth * (bucketIndex + 0.5)),
      })),
      yMax,
      yMin,
      yTicks: yTickValues.map((value) => ({ value, y: toY(value) })),
    },
    averagePaths,
    points,
    rangePaths,
    statusSlices,
  }
}
