export type ProxyMetricsNode = {
  availability: number | null
  coverageSeconds: number
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

export const fetchProxyMetricsHelperAPI = async (
  metricsWindow = '24h',
  timeout = 1500,
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

    return {
      windowSeconds: Number(data.windowSeconds) || 24 * 60 * 60,
      generatedAt: data.generatedAt || new Date().toISOString(),
      nodes: data.nodes,
    }
  } catch {
    return null
  } finally {
    window.clearTimeout(timeoutId)
  }
}
