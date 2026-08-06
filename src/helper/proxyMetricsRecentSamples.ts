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
