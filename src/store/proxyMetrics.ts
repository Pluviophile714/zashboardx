import { fetchProxyMetricsHelperAPI, type ProxyMetricsNode } from '@/api/metricsHelper'
import { ref, shallowRef } from 'vue'

const PROXY_METRICS_CACHE_TTL = 30 * 1000

let lastFetchTime = 0
let pendingRefresh: Promise<void> | undefined

export const proxyMetricsMap = shallowRef<Record<string, ProxyMetricsNode>>({})
export const proxyMetricsAvailable = ref(false)
export const proxyMetricsUpdatedAt = ref(0)

export const refreshProxyMetrics = async (options: { force?: boolean } = {}) => {
  const now = Date.now()

  if (!options.force && now - lastFetchTime < PROXY_METRICS_CACHE_TTL) {
    return
  }

  if (pendingRefresh) {
    return pendingRefresh
  }

  lastFetchTime = now
  pendingRefresh = (async () => {
    const response = await fetchProxyMetricsHelperAPI('24h')

    if (!response) {
      proxyMetricsAvailable.value = false
      return
    }

    proxyMetricsMap.value = response.nodes
    proxyMetricsAvailable.value = true
    proxyMetricsUpdatedAt.value = Date.parse(response.generatedAt) || Date.now()
  })().finally(() => {
    pendingRefresh = undefined
  })

  return pendingRefresh
}
