import type { ProxyMetricsSample } from '../api/metricsHelper.ts'

export type ProxyMetricsSampleUpdateKind = 'initial' | 'unchanged' | 'appended' | 'replaced'

export const getProxyMetricsSampleIdentity = (sample: ProxyMetricsSample) =>
  [
    sample.nodeName,
    sample.testUrl,
    sample.timestamp,
    sample.delay ?? 'null',
    sample.success ? 'success' : 'failure',
    sample.errorType ?? '',
  ].join('\u001f')

const sameSampleSequence = (first: ProxyMetricsSample[], second: ProxyMetricsSample[]) =>
  first.length === second.length &&
  first.every(
    (sample, index) =>
      getProxyMetricsSampleIdentity(sample) === getProxyMetricsSampleIdentity(second[index]),
  )

const getTailPrefixOverlap = (previous: ProxyMetricsSample[], next: ProxyMetricsSample[]) => {
  const maximumOverlap = Math.min(previous.length, next.length)

  for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
    const previousTail = previous.slice(-overlap)
    const nextHead = next.slice(0, overlap)

    if (sameSampleSequence(previousTail, nextHead)) {
      return overlap
    }
  }

  return 0
}

export const classifyRecentSampleUpdate = (
  previous: ProxyMetricsSample[] | undefined,
  next: ProxyMetricsSample[],
): ProxyMetricsSampleUpdateKind => {
  if (!previous) {
    return 'initial'
  }

  if (sameSampleSequence(previous, next)) {
    return 'unchanged'
  }

  const previousLastTimestamp = Date.parse(previous.at(-1)?.timestamp ?? '')
  const nextLastTimestamp = Date.parse(next.at(-1)?.timestamp ?? '')
  const overlap = getTailPrefixOverlap(previous, next)

  if (
    overlap > 0 &&
    next.length > overlap &&
    Number.isFinite(previousLastTimestamp) &&
    Number.isFinite(nextLastTimestamp) &&
    nextLastTimestamp > previousLastTimestamp
  ) {
    return 'appended'
  }

  return 'replaced'
}

export const reconcileRecentSampleUpdate = (
  previous: ProxyMetricsSample[] | undefined,
  next: ProxyMetricsSample[],
) => {
  const kind = classifyRecentSampleUpdate(previous, next)

  return {
    kind,
    samples: kind === 'unchanged' && previous ? previous : next,
  }
}

export const mergeRollingMetricSamples = (
  previous: ProxyMetricsSample[] | undefined,
  incoming: ProxyMetricsSample[],
  options: {
    limit: number
    snapshotAt: string
    windowSeconds: number
  },
) => {
  const combined = [...(previous ?? []), ...incoming]
  const indexed = combined.flatMap((sample, index) => {
    const timestamp = Date.parse(sample.timestamp)

    return Number.isFinite(timestamp) ? [{ index, sample, timestamp }] : []
  })
  const snapshotAt = Date.parse(options.snapshotAt)
  const latestSampleAt = indexed.reduce(
    (latest, item) => Math.max(latest, item.timestamp),
    Number.NEGATIVE_INFINITY,
  )
  const windowEnd = Number.isFinite(snapshotAt)
    ? Math.max(snapshotAt, latestSampleAt)
    : latestSampleAt

  if (!Number.isFinite(windowEnd)) {
    return []
  }

  const windowStart = windowEnd - options.windowSeconds * 1000
  const unique = new Map<string, (typeof indexed)[number]>()

  for (const item of indexed) {
    if (item.timestamp < windowStart || item.timestamp > windowEnd) {
      continue
    }

    unique.set(getProxyMetricsSampleIdentity(item.sample), item)
  }

  return [...unique.values()]
    .sort((first, second) => first.timestamp - second.timestamp || first.index - second.index)
    .slice(-Math.max(0, options.limit))
    .map((item) => item.sample)
}

export const reconcileMetricsNodeRecentSamples = (
  previousSamplesByKey: Record<string, ProxyMetricsSample[]>,
  nodes: Record<string, { recentSamples?: ProxyMetricsSample[] }>,
  getCacheKey: (nodeName: string) => string,
  rollingOptions?: {
    limit: number
    snapshotAt: string
    windowSeconds: number
  },
) => {
  const updates: Record<
    string,
    { kind: ProxyMetricsSampleUpdateKind; samples: ProxyMetricsSample[] }
  > = {}

  for (const [nodeName, node] of Object.entries(nodes)) {
    if (!Array.isArray(node.recentSamples)) {
      continue
    }

    const key = getCacheKey(nodeName)
    const previous = previousSamplesByKey[key]
    const previousLastTimestamp = Date.parse(previous?.at(-1)?.timestamp ?? '')
    const nextLastTimestamp = Date.parse(node.recentSamples.at(-1)?.timestamp ?? '')

    if (
      previous?.length &&
      Number.isFinite(previousLastTimestamp) &&
      Number.isFinite(nextLastTimestamp) &&
      nextLastTimestamp < previousLastTimestamp
    ) {
      updates[key] = { kind: 'unchanged', samples: previous }
      continue
    }

    const samples = rollingOptions
      ? mergeRollingMetricSamples(previous, node.recentSamples, rollingOptions)
      : node.recentSamples

    updates[key] = reconcileRecentSampleUpdate(previous, samples)
  }

  return updates
}
