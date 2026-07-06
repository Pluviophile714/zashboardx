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
