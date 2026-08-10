export type ProxyMetricsNode = {
  availability: number | null
  coverageSeconds: number
  firstSampleAt: string | null
  lastSampleAt: string | null
  sampleCount: number
  successCount: number
  failureCount: number
  avgDelay: number | null
  minDelay: number | null
  maxDelay: number | null
  lastDelay: number | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lossRate: number | null
  lossSource: 'official' | 'probe' | 'log-inferred' | null
  recentSamples?: ProxyMetricsSample[]
}

export type ProxyMetricsResponse = {
  windowSeconds: number
  generatedAt: string
  nodes: Record<string, ProxyMetricsNode>
}

export type ProxyMetricsSample = {
  nodeName: string
  testUrl: string
  timestamp: string
  delay: number | null
  success: boolean
  errorType?: string
}

export type ProxyMetricsSamplesResponse = {
  windowSeconds: number
  generatedAt: string
  snapshotAt: string
  nodeName: string
  samples: ProxyMetricsSample[]
}

export type ProxyMetricsBucketSamplesResponse = {
  start: string
  end: string
  generatedAt: string
  snapshotAt: string
  nodeName: string
  samples: ProxyMetricsSample[]
  truncated: boolean
}

export type ProxyMetricsTimelineBucket = {
  start: string
  end: string
  sampleCount: number
  successCount: number
  failureCount: number
  avgDelay: number | null
  minDelay: number | null
  maxDelay: number | null
  jitter: number | null
}

export type ProxyMetricsTimelineWindow = '1h' | '6h' | '24h'

export const PROXY_METRICS_TIMELINE_PROFILES = {
  '1h': {
    bucketCount: 60,
    bucketSeconds: 60,
    windowSeconds: 3_600,
  },
  '6h': {
    bucketCount: 72,
    bucketSeconds: 300,
    windowSeconds: 21_600,
  },
  '24h': {
    bucketCount: 96,
    bucketSeconds: 900,
    windowSeconds: 86_400,
  },
} as const satisfies Record<
  ProxyMetricsTimelineWindow,
  { bucketCount: number; bucketSeconds: number; windowSeconds: number }
>

export const getProxyMetricsTimelineProfile = (window: ProxyMetricsTimelineWindow) =>
  PROXY_METRICS_TIMELINE_PROFILES[window]

export type ProxyMetricsTimelineResponse = {
  windowSeconds: number
  generatedAt: string
  snapshotAt: string
  nodeName: string
  bucketSeconds: number
  jitter: number | null
  buckets: ProxyMetricsTimelineBucket[]
}

export type ProxyMetricsDetailsResponse = {
  generatedAt: string
  snapshotAt: string
  nodeName: string
  samples: ProxyMetricsSample[]
  timeline: ProxyMetricsTimelineResponse
}

const proxyMetricsSampleQueue: ProxyMetricsSample[] = []
let proxyMetricsSampleFlushTimer: ReturnType<typeof window.setTimeout> | undefined

const parseTimestamp = (timestamp?: string | null) => {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN

  return Number.isFinite(parsed) ? parsed : null
}

const maxTimestamp = (...timestamps: (string | null | undefined)[]) => {
  const parsed = timestamps
    .map(parseTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== null)

  return parsed.length ? Math.max(...parsed) : null
}

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const normalizeTimelineDelay = (value: unknown) => {
  if (value === null) {
    return null
  }

  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export const normalizeMetricsTimelineBucket = (
  value: unknown,
): ProxyMetricsTimelineBucket | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const bucket = value as Record<string, unknown>
  const startMs = typeof bucket.start === 'string' ? Date.parse(bucket.start) : Number.NaN
  const endMs = typeof bucket.end === 'string' ? Date.parse(bucket.end) : Number.NaN

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null
  }
  if (
    !isNonNegativeInteger(bucket.sampleCount) ||
    !isNonNegativeInteger(bucket.successCount) ||
    !isNonNegativeInteger(bucket.failureCount) ||
    bucket.successCount + bucket.failureCount !== bucket.sampleCount
  ) {
    return null
  }

  const avgDelay = normalizeTimelineDelay(bucket.avgDelay)
  const minDelay = normalizeTimelineDelay(bucket.minDelay)
  const maxDelay = normalizeTimelineDelay(bucket.maxDelay)
  const jitter = bucket.jitter === undefined ? null : normalizeTimelineDelay(bucket.jitter)

  if (
    avgDelay === undefined ||
    minDelay === undefined ||
    maxDelay === undefined ||
    jitter === undefined
  ) {
    return null
  }
  if (bucket.successCount === 0) {
    if (avgDelay !== null || minDelay !== null || maxDelay !== null) {
      return null
    }
  } else if (
    avgDelay === null ||
    minDelay === null ||
    maxDelay === null ||
    minDelay > avgDelay ||
    avgDelay > maxDelay
  ) {
    return null
  }
  if (bucket.successCount < 2 && jitter !== null) {
    return null
  }

  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    sampleCount: bucket.sampleCount,
    successCount: bucket.successCount,
    failureCount: bucket.failureCount,
    avgDelay,
    minDelay,
    maxDelay,
    jitter,
  }
}

const normalizeMetricsNode = (node: ProxyMetricsNode, generatedAt: string): ProxyMetricsNode => {
  const explicitFirstSampleAt = parseTimestamp(node.firstSampleAt)
  const explicitLastSampleAt = parseTimestamp(node.lastSampleAt)
  const fallbackLastSampleAt =
    explicitLastSampleAt ??
    maxTimestamp(node.lastSuccessAt, node.lastFailureAt) ??
    (node.sampleCount ? parseTimestamp(generatedAt) : null)
  const fallbackFirstSampleAt =
    explicitFirstSampleAt ??
    (fallbackLastSampleAt !== null && node.sampleCount
      ? Math.max(0, fallbackLastSampleAt - Math.max(0, node.coverageSeconds) * 1000)
      : null)

  return {
    ...node,
    firstSampleAt:
      explicitFirstSampleAt !== null
        ? node.firstSampleAt
        : fallbackFirstSampleAt === null
          ? null
          : new Date(fallbackFirstSampleAt).toISOString(),
    lastSampleAt:
      explicitLastSampleAt !== null
        ? node.lastSampleAt
        : fallbackLastSampleAt === null
          ? null
          : new Date(fallbackLastSampleAt).toISOString(),
  }
}

export const fetchProxyMetricsHelperAPI = async (
  metricsWindow = '24h',
  timeout = 6000,
): Promise<ProxyMetricsResponse | null> => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(`/api/metrics/nodes?window=${encodeURIComponent(metricsWindow)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as Partial<ProxyMetricsResponse>

    if (!data.nodes || typeof data.nodes !== 'object') {
      return null
    }

    const generatedAt = data.generatedAt || new Date().toISOString()

    return {
      windowSeconds: Number(data.windowSeconds) || 24 * 60 * 60,
      generatedAt,
      nodes: Object.fromEntries(
        Object.entries(data.nodes).map(([name, node]) => [
          name,
          normalizeMetricsNode(node as ProxyMetricsNode, generatedAt),
        ]),
      ),
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const normalizeMetricsSample = (sample: unknown): ProxyMetricsSample | null => {
  if (!sample || typeof sample !== 'object') {
    return null
  }

  const raw = sample as Partial<ProxyMetricsSample>
  const nodeName = typeof raw.nodeName === 'string' ? raw.nodeName : ''
  const testUrl = typeof raw.testUrl === 'string' ? raw.testUrl : ''
  const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : ''
  const timestampMs = Date.parse(timestamp)
  const delay = typeof raw.delay === 'number' && Number.isFinite(raw.delay) ? raw.delay : null

  if (!nodeName || !testUrl || !Number.isFinite(timestampMs)) {
    return null
  }

  return {
    nodeName,
    testUrl,
    timestamp: new Date(timestampMs).toISOString(),
    delay,
    success: raw.success === true,
    ...(typeof raw.errorType === 'string' && raw.errorType ? { errorType: raw.errorType } : {}),
  }
}

export const fetchProxyMetricsSamplesAPI = async (
  nodeName: string,
  metricsWindow = '24h',
  limit = 30,
  timeout = 3000,
): Promise<ProxyMetricsSamplesResponse | null> => {
  if (!nodeName) {
    return null
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeout)

  try {
    const params = new URLSearchParams({
      limit: String(limit),
      node: nodeName,
      window: metricsWindow,
    })
    const response = await fetch(`/api/metrics/samples?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as Partial<ProxyMetricsSamplesResponse>
    const samples = Array.isArray(data.samples)
      ? data.samples.map(normalizeMetricsSample).filter((sample): sample is ProxyMetricsSample => {
          return sample !== null
        })
      : []

    return {
      generatedAt: data.generatedAt || new Date().toISOString(),
      snapshotAt: data.snapshotAt || data.generatedAt || new Date().toISOString(),
      nodeName: typeof data.nodeName === 'string' ? data.nodeName : nodeName,
      samples,
      windowSeconds: Number(data.windowSeconds) || 24 * 60 * 60,
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export const fetchProxyMetricsBucketSamplesAPI = async (
  nodeName: string,
  start: string,
  end: string,
  timeout = 3000,
): Promise<ProxyMetricsBucketSamplesResponse | null> => {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)

  if (!nodeName || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return null
  }

  const normalizedStart = new Date(startMs).toISOString()
  const normalizedEnd = new Date(endMs).toISOString()
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeout)

  try {
    const params = new URLSearchParams({
      end: normalizedEnd,
      node: nodeName,
      start: normalizedStart,
    })
    const response = await fetch(`/api/metrics/bucket-samples?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as Partial<ProxyMetricsBucketSamplesResponse>
    const generatedAtMs =
      typeof data.generatedAt === 'string' ? Date.parse(data.generatedAt) : Number.NaN

    if (
      data.nodeName !== nodeName ||
      data.start !== normalizedStart ||
      data.end !== normalizedEnd ||
      !Number.isFinite(generatedAtMs) ||
      typeof data.truncated !== 'boolean' ||
      !Array.isArray(data.samples)
    ) {
      return null
    }

    const samples = data.samples.map(normalizeMetricsSample)

    if (samples.some((sample) => sample === null)) {
      return null
    }

    const normalizedSamples = samples as ProxyMetricsSample[]
    let previousTimestampMs = startMs

    for (const sample of normalizedSamples) {
      const timestampMs = Date.parse(sample.timestamp)

      if (
        sample.nodeName !== nodeName ||
        timestampMs < startMs ||
        timestampMs >= endMs ||
        timestampMs < previousTimestampMs
      ) {
        return null
      }

      previousTimestampMs = timestampMs
    }

    return {
      start: normalizedStart,
      end: normalizedEnd,
      generatedAt: new Date(generatedAtMs).toISOString(),
      snapshotAt:
        typeof data.snapshotAt === 'string' && Number.isFinite(Date.parse(data.snapshotAt))
          ? new Date(Date.parse(data.snapshotAt)).toISOString()
          : new Date(generatedAtMs).toISOString(),
      nodeName,
      samples: normalizedSamples,
      truncated: data.truncated,
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export const fetchProxyMetricsTimelineAPI = async (
  nodeName: string,
  metricsWindow: ProxyMetricsTimelineWindow = '24h',
  timeout = 3000,
): Promise<ProxyMetricsTimelineResponse | null> => {
  if (!nodeName) {
    return null
  }

  const profile = getProxyMetricsTimelineProfile(metricsWindow)

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeout)

  try {
    const params = new URLSearchParams({
      node: nodeName,
      window: metricsWindow,
    })
    const response = await fetch(`/api/metrics/timeline?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as Partial<ProxyMetricsTimelineResponse>
    const generatedAtMs =
      typeof data.generatedAt === 'string' ? Date.parse(data.generatedAt) : Number.NaN

    if (
      data.windowSeconds !== profile.windowSeconds ||
      data.bucketSeconds !== profile.bucketSeconds ||
      data.nodeName !== nodeName ||
      !Number.isFinite(generatedAtMs) ||
      !Array.isArray(data.buckets) ||
      data.buckets.length !== profile.bucketCount
    ) {
      return null
    }

    const buckets = data.buckets.map(normalizeMetricsTimelineBucket)

    if (buckets.some((bucket) => bucket === null)) {
      return null
    }

    const normalizedBuckets = buckets as ProxyMetricsTimelineBucket[]
    const jitter = data.jitter === undefined ? null : normalizeTimelineDelay(data.jitter)

    if (jitter === undefined) {
      return null
    }

    const successCount = normalizedBuckets.reduce((total, bucket) => total + bucket.successCount, 0)

    if (successCount < 2 && jitter !== null) {
      return null
    }

    for (let index = 0; index < normalizedBuckets.length; index += 1) {
      const bucket = normalizedBuckets[index]
      const startMs = Date.parse(bucket.start)
      const endMs = Date.parse(bucket.end)

      if (
        endMs - startMs !== profile.bucketSeconds * 1000 ||
        (index > 0 && normalizedBuckets[index - 1].end !== bucket.start)
      ) {
        return null
      }
    }

    if (
      Date.parse(normalizedBuckets.at(-1)!.end) - Date.parse(normalizedBuckets[0].start) !==
      profile.windowSeconds * 1000
    ) {
      return null
    }

    return {
      windowSeconds: data.windowSeconds,
      generatedAt: new Date(generatedAtMs).toISOString(),
      snapshotAt:
        typeof data.snapshotAt === 'string' && Number.isFinite(Date.parse(data.snapshotAt))
          ? new Date(Date.parse(data.snapshotAt)).toISOString()
          : new Date(generatedAtMs).toISOString(),
      nodeName: data.nodeName,
      bucketSeconds: data.bucketSeconds,
      jitter,
      buckets: normalizedBuckets,
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export const fetchProxyMetricsDetailsAPI = async (
  nodeName: string,
  metricsWindow: ProxyMetricsTimelineWindow = '24h',
  limit = 30,
  snapshotAt?: string,
  timeout = 3000,
): Promise<ProxyMetricsDetailsResponse | null> => {
  if (!nodeName) {
    return null
  }

  const profile = getProxyMetricsTimelineProfile(metricsWindow)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeout)

  try {
    const params = new URLSearchParams({
      limit: String(limit),
      node: nodeName,
      window: metricsWindow,
    })

    if (snapshotAt) {
      params.set('asOf', snapshotAt)
    }

    const response = await fetch(`/api/metrics/details?${params.toString()}`, {
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as Partial<ProxyMetricsDetailsResponse> & {
      timeline?: Partial<ProxyMetricsTimelineResponse>
    }
    const generatedAtMs =
      typeof data.generatedAt === 'string' ? Date.parse(data.generatedAt) : Number.NaN
    const snapshotAtMs =
      typeof data.snapshotAt === 'string' ? Date.parse(data.snapshotAt) : Number.NaN
    const timeline = data.timeline

    if (
      data.nodeName !== nodeName ||
      !Number.isFinite(generatedAtMs) ||
      !Number.isFinite(snapshotAtMs) ||
      new Date(generatedAtMs).toISOString() !== new Date(snapshotAtMs).toISOString() ||
      !timeline ||
      timeline.windowSeconds !== profile.windowSeconds ||
      timeline.bucketSeconds !== profile.bucketSeconds ||
      timeline.nodeName !== nodeName ||
      !Array.isArray(timeline.buckets) ||
      timeline.buckets.length !== profile.bucketCount
    ) {
      return null
    }

    const samples = Array.isArray(data.samples)
      ? data.samples.map(normalizeMetricsSample).filter((sample): sample is ProxyMetricsSample => {
          return sample !== null
        })
      : []
    const buckets = timeline.buckets.map(normalizeMetricsTimelineBucket)
    const jitter = timeline.jitter === undefined ? null : normalizeTimelineDelay(timeline.jitter)

    if (buckets.some((bucket) => bucket === null) || jitter === undefined) {
      return null
    }

    const normalizedBuckets = buckets as ProxyMetricsTimelineBucket[]
    const successCount = normalizedBuckets.reduce((total, bucket) => total + bucket.successCount, 0)

    if (successCount < 2 && jitter !== null) {
      return null
    }

    for (let index = 0; index < normalizedBuckets.length; index += 1) {
      const bucket = normalizedBuckets[index]
      const startMs = Date.parse(bucket.start)
      const endMs = Date.parse(bucket.end)

      if (
        endMs - startMs !== profile.bucketSeconds * 1000 ||
        (index > 0 && normalizedBuckets[index - 1].end !== bucket.start)
      ) {
        return null
      }
    }

    if (
      Date.parse(normalizedBuckets.at(-1)!.end) - Date.parse(normalizedBuckets[0].start) !==
      profile.windowSeconds * 1000
    ) {
      return null
    }

    const normalizedGeneratedAt = new Date(generatedAtMs).toISOString()
    const normalizedSnapshotAt = new Date(snapshotAtMs).toISOString()

    return {
      generatedAt: normalizedGeneratedAt,
      snapshotAt: normalizedSnapshotAt,
      nodeName,
      samples,
      timeline: {
        windowSeconds: timeline.windowSeconds,
        generatedAt: normalizedGeneratedAt,
        snapshotAt: normalizedSnapshotAt,
        nodeName,
        bucketSeconds: timeline.bucketSeconds,
        jitter,
        buckets: normalizedBuckets,
      },
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const sendProxyMetricsSamplesAPI = async (samples: ProxyMetricsSample[], timeout = 3000) => {
  if (!samples.length) {
    return
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeout)

  try {
    await fetch('/api/metrics/samples', {
      body: JSON.stringify({ samples }),
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    })
  } catch {
    // Metrics collection is best-effort; latency testing should never block on it.
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const flushProxyMetricsSampleQueue = (timeout = 3000) => {
  if (proxyMetricsSampleFlushTimer) {
    window.clearTimeout(proxyMetricsSampleFlushTimer)
    proxyMetricsSampleFlushTimer = undefined
  }

  const samples = proxyMetricsSampleQueue.splice(0, 1000)

  void sendProxyMetricsSamplesAPI(samples, timeout)

  if (proxyMetricsSampleQueue.length) {
    proxyMetricsSampleFlushTimer = window.setTimeout(() => {
      flushProxyMetricsSampleQueue(timeout)
    }, 500)
  }
}

export const postProxyMetricsSamplesAPI = async (samples: ProxyMetricsSample[], timeout = 3000) => {
  if (!samples.length) {
    return
  }

  proxyMetricsSampleQueue.push(...samples)

  if (proxyMetricsSampleQueue.length >= 100) {
    flushProxyMetricsSampleQueue(timeout)
    return
  }

  if (!proxyMetricsSampleFlushTimer) {
    proxyMetricsSampleFlushTimer = window.setTimeout(() => {
      flushProxyMetricsSampleQueue(timeout)
    }, 500)
  }
}
