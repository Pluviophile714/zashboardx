export type ProxyMetricsFreshnessState = 'live' | 'polling' | 'stale' | 'unknown'

export type ProxyMetricsFreshness = {
  state: ProxyMetricsFreshnessState
  ageSeconds: number | null
}

export const getProxyMetricsFreshness = (
  lastSampleAt: string | null | undefined,
  liveConnected: boolean,
  nowMs = Date.now(),
): ProxyMetricsFreshness => {
  const sampleAtMs = lastSampleAt ? Date.parse(lastSampleAt) : Number.NaN

  if (!Number.isFinite(sampleAtMs)) {
    return { ageSeconds: null, state: 'unknown' }
  }

  const ageSeconds = Math.max(0, Math.floor((nowMs - sampleAtMs) / 1000))

  if (ageSeconds > 120) {
    return { ageSeconds, state: 'stale' }
  }

  return { ageSeconds, state: liveConnected ? 'live' : 'polling' }
}
