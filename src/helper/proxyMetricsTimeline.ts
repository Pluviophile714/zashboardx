import type {
  ProxyMetricsSample,
  ProxyMetricsTimelineResponse,
  ProxyMetricsTimelineWindow,
} from '@/api/metricsHelper'

export const LATENCY_TIMELINE_WINDOWS: readonly ProxyMetricsTimelineWindow[] = ['1h', '6h', '24h']

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

export type ProxyMetricsSampleChartPoint = {
  sampleIndex: number
  x: number
  y: number
}

export type ProxyMetricsSampleStatusSlice = {
  failureRatio: number
  kind: 'failed'
  opacity: number
  sampleIndex: number
  width: number
  x: number
}

export type ProxyMetricsSampleChartModel = {
  axes: {
    plotBottom: number
    plotLeft: number
    plotRight: number
    plotTop: number
    xTicks: { sampleIndex: number; timestamp: string; x: number }[]
    yMax: number
    yMin: number
    yTicks: { value: number; y: number }[]
  }
  averagePaths: string[]
  points: (ProxyMetricsSampleChartPoint | null)[]
  rangePaths: string[]
  statusSlices: ProxyMetricsSampleStatusSlice[]
}

type SampleChartOptions = TimelineChartOptions & {
  windowEnd: string
  windowStart: string
}

export const getProxyMetricsSampleWindow = (
  samples: ProxyMetricsSample[],
  windowSeconds: number,
) => {
  const endMs = samples.reduce((latest, sample) => {
    const timestamp = Date.parse(sample.timestamp)

    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest
  }, Number.NEGATIVE_INFINITY)

  if (!Number.isFinite(endMs)) {
    return undefined
  }

  return {
    end: new Date(endMs).toISOString(),
    start: new Date(endMs - windowSeconds * 1000).toISOString(),
  }
}

export const getProxyMetricsSampleJitter = (samples: ProxyMetricsSample[]) => {
  const delays = samples.flatMap((sample) =>
    sample.success && sample.delay !== null && Number.isFinite(sample.delay) ? [sample.delay] : [],
  )

  if (delays.length < 2) {
    return null
  }

  let total = 0

  for (let index = 1; index < delays.length; index += 1) {
    total += Math.abs(delays[index] - delays[index - 1])
  }

  return total / (delays.length - 1)
}

type RangePoint = ProxyMetricsTimelineChartPoint & {
  maxY: number
  minY: number
}

export const getProxyMetricsTimelineTooltipMode = (compact: boolean) => {
  void compact
  return 'outside' as const
}

export const getProxyMetricsTimelineHeight = (compact: boolean) => (compact ? 108 : 192)

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

export const buildProxyMetricsSampleChartModel = (
  samples: ProxyMetricsSample[],
  options: SampleChartOptions,
): ProxyMetricsSampleChartModel => {
  const plotLeft = options.padding.left
  const plotRight = Math.max(plotLeft + 1, options.width - options.padding.right)
  const plotTop = options.padding.top
  const plotBottom = Math.max(plotTop + 1, options.height - options.padding.bottom)
  const plotWidth = plotRight - plotLeft
  const plotHeight = plotBottom - plotTop
  const sampleTimes = samples.map((sample) => Date.parse(sample.timestamp))
  const validSampleTimes = sampleTimes.filter(Number.isFinite)
  const parsedWindowStart = Date.parse(options.windowStart)
  const parsedWindowEnd = Date.parse(options.windowEnd)
  const fallbackStart = validSampleTimes.length ? Math.min(...validSampleTimes) : Date.now()
  const fallbackEnd = validSampleTimes.length
    ? Math.max(...validSampleTimes)
    : fallbackStart + 60_000
  const windowStart = Number.isFinite(parsedWindowStart) ? parsedWindowStart : fallbackStart
  const windowEndCandidate = Number.isFinite(parsedWindowEnd) ? parsedWindowEnd : fallbackEnd
  const windowEnd = windowEndCandidate > windowStart ? windowEndCandidate : windowStart + 60_000
  const windowDuration = windowEnd - windowStart
  const successfulDelays = samples.flatMap((sample) =>
    sample.success && sample.delay !== null && Number.isFinite(sample.delay) ? [sample.delay] : [],
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
  const toX = (timestamp: number) =>
    coordinate(
      plotLeft +
        ((Math.min(windowEnd, Math.max(windowStart, timestamp)) - windowStart) / windowDuration) *
          plotWidth,
    )
  const toY = (delay: number) =>
    coordinate(plotBottom - ((Math.min(yMax, Math.max(yMin, delay)) - yMin) / yRange) * plotHeight)
  const points: (ProxyMetricsSampleChartPoint | null)[] = samples.map((sample, sampleIndex) => {
    const timestamp = sampleTimes[sampleIndex]

    return sample.success &&
      sample.delay !== null &&
      Number.isFinite(sample.delay) &&
      Number.isFinite(timestamp)
      ? {
          sampleIndex,
          x: toX(timestamp),
          y: toY(sample.delay),
        }
      : null
  })
  const sampleXs = samples.map((sample, sampleIndex) => {
    const timestamp = sampleTimes[sampleIndex]

    return Number.isFinite(timestamp) ? toX(timestamp) : plotLeft
  })
  const statusSlices: ProxyMetricsSampleStatusSlice[] = samples.flatMap((sample, sampleIndex) => {
    if (sample.success || !Number.isFinite(sampleTimes[sampleIndex])) {
      return []
    }

    const x = sampleXs[sampleIndex]
    const left = sampleIndex === 0 ? plotLeft : (sampleXs[sampleIndex - 1] + x) / 2
    const right =
      sampleIndex === samples.length - 1 ? plotRight : (x + sampleXs[sampleIndex + 1]) / 2

    return [
      {
        failureRatio: 1,
        kind: 'failed' as const,
        opacity: 0.3,
        sampleIndex,
        width: coordinate(Math.max(0.75, right - left)),
        x: coordinate(left),
      },
    ]
  })
  const averagePaths = createPathRuns(points, (run) =>
    run.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
  )
  const yTickValues = [yMin, Math.round((yMin + yMax) / 2), yMax]
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const timestamp = new Date(windowStart + windowDuration * ratio).toISOString()
    const x = coordinate(plotLeft + plotWidth * ratio)
    let sampleIndex = -1
    let closestDistance = Number.POSITIVE_INFINITY

    for (let index = 0; index < sampleTimes.length; index += 1) {
      const distance = Math.abs(sampleTimes[index] - (windowStart + windowDuration * ratio))

      if (Number.isFinite(distance) && distance < closestDistance) {
        closestDistance = distance
        sampleIndex = index
      }
    }

    return { sampleIndex, timestamp, x }
  })

  return {
    axes: {
      plotBottom,
      plotLeft,
      plotRight,
      plotTop,
      xTicks,
      yMax,
      yMin,
      yTicks: yTickValues.map((value) => ({ value, y: toY(value) })),
    },
    averagePaths,
    points,
    rangePaths: [],
    statusSlices,
  }
}
