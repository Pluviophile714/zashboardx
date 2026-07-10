import {
  fetchProxyMetricsHelperAPI,
  fetchProxyMetricsSamplesAPI,
  type ProxyMetricsNode,
  type ProxyMetricsSample,
} from '@/api/metricsHelper'
import { ref, shallowRef } from 'vue'

const PROXY_METRICS_CACHE_TTL = 30 * 1000
const PROXY_METRICS_SAMPLES_CACHE_TTL = 30 * 1000

let lastFetchTime = 0
let pendingRefresh: Promise<void> | undefined
const proxyMetricsSamplesFetchTimeMap = new Map<string, number>()
const pendingSamplesRefreshMap = new Map<string, Promise<ProxyMetricsSample[] | null>>()

export const proxyMetricsMap = shallowRef<Record<string, ProxyMetricsNode>>({})
export const proxyMetricsSamplesMap = shallowRef<Record<string, ProxyMetricsSample[]>>({})
export const proxyMetricsAvailable = ref(false)
export const proxyMetricsUpdatedAt = ref(0)
export const proxyMetricsRequestDurationMs = ref<number | null>(null)
export const proxyMetricsRequestFailed = ref(false)
export const proxyMetricsLastRequestAt = ref(0)

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
    const startedAt = performance.now()
    const response = await fetchProxyMetricsHelperAPI('24h')
    proxyMetricsRequestDurationMs.value = Math.round(performance.now() - startedAt)
    proxyMetricsLastRequestAt.value = Date.now()

    if (!response) {
      proxyMetricsAvailable.value = false
      proxyMetricsRequestFailed.value = true
      return
    }

    proxyMetricsMap.value = response.nodes
    proxyMetricsAvailable.value = true
    proxyMetricsRequestFailed.value = false
    proxyMetricsUpdatedAt.value = Date.parse(response.generatedAt) || Date.now()
  })().finally(() => {
    pendingRefresh = undefined
  })

  return pendingRefresh
}

export const refreshProxyMetricsSamples = async (
  nodeName: string,
  options: { force?: boolean; limit?: number; window?: string } = {},
) => {
  if (!nodeName) {
    return null
  }

  const metricsWindow = options.window ?? '24h'
  const limit = options.limit ?? 30
  const key = `${metricsWindow}\n${limit}\n${nodeName}`
  const now = Date.now()
  const cached = proxyMetricsSamplesMap.value[key]

  if (
    cached &&
    !options.force &&
    now - (proxyMetricsSamplesFetchTimeMap.get(key) ?? 0) < PROXY_METRICS_SAMPLES_CACHE_TTL
  ) {
    return cached
  }

  const pending = pendingSamplesRefreshMap.get(key)

  if (pending) {
    return pending
  }

  const request = (async () => {
    const response = await fetchProxyMetricsSamplesAPI(nodeName, metricsWindow, limit)

    if (!response) {
      return null
    }

    proxyMetricsSamplesFetchTimeMap.set(key, Date.now())
    proxyMetricsSamplesMap.value = {
      ...proxyMetricsSamplesMap.value,
      [key]: response.samples,
    }

    return response.samples
  })().finally(() => {
    pendingSamplesRefreshMap.delete(key)
  })

  pendingSamplesRefreshMap.set(key, request)

  return request
}

export const getProxyMetricsSamplesCacheKey = (
  nodeName: string,
  metricsWindow = '24h',
  limit = 30,
) => `${metricsWindow}\n${limit}\n${nodeName}`
