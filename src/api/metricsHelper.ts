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
  nodeName: string
  samples: ProxyMetricsSample[]
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
