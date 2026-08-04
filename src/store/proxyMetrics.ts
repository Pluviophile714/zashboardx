import { ref, shallowRef } from 'vue'
import {
  fetchProxyMetricsBucketSamplesAPI,
  fetchProxyMetricsHelperAPI,
  fetchProxyMetricsSamplesAPI,
  fetchProxyMetricsTimelineAPI,
  type ProxyMetricsBucketSamplesResponse,
  type ProxyMetricsNode,
  type ProxyMetricsSample,
  type ProxyMetricsTimelineResponse,
  type ProxyMetricsTimelineWindow,
} from '../api/metricsHelper.ts'

const PROXY_METRICS_CACHE_TTL = 30 * 1000
const PROXY_METRICS_SAMPLES_CACHE_TTL = 30 * 1000
const PROXY_METRICS_TIMELINE_CACHE_TTL = 30 * 1000
const PROXY_METRICS_BUCKET_SAMPLES_CACHE_TTL = 30 * 1000

let lastFetchTime = 0
let pendingRefresh: Promise<void> | undefined
const proxyMetricsSamplesFetchTimeMap = new Map<string, number>()
const pendingSamplesRefreshMap = new Map<string, Promise<ProxyMetricsSample[] | null>>()
const proxyMetricsTimelineFetchTimeMap = new Map<string, number>()
const pendingTimelineRefreshMap = new Map<string, Promise<ProxyMetricsTimelineResponse | null>>()
const proxyMetricsBucketSamplesFetchTimeMap = new Map<string, number>()
const pendingBucketSamplesRefreshMap = new Map<
  string,
  Promise<ProxyMetricsBucketSamplesResponse | null>
>()

export const proxyMetricsMap = shallowRef<Record<string, ProxyMetricsNode>>({})
export const proxyMetricsSamplesMap = shallowRef<Record<string, ProxyMetricsSample[]>>({})
export const proxyMetricsTimelineMap = shallowRef<Record<string, ProxyMetricsTimelineResponse>>({})
export const proxyMetricsBucketSamplesMap = shallowRef<
  Record<string, ProxyMetricsBucketSamplesResponse>
>({})
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

export const getProxyMetricsTimelineCacheKey = (nodeName: string, metricsWindow = '24h') =>
  `${metricsWindow}\n${nodeName}`

export const getProxyMetricsBucketSamplesCacheKey = (
  nodeName: string,
  start: string,
  end: string,
) => `${start}\n${end}\n${nodeName}`

export const refreshProxyMetricsTimeline = async (
  nodeName: string,
  options: { force?: boolean; window?: ProxyMetricsTimelineWindow } = {},
) => {
  if (!nodeName) {
    return null
  }

  const metricsWindow = options.window ?? '24h'
  const key = getProxyMetricsTimelineCacheKey(nodeName, metricsWindow)
  const now = Date.now()
  const cached = proxyMetricsTimelineMap.value[key]

  if (
    cached &&
    !options.force &&
    now - (proxyMetricsTimelineFetchTimeMap.get(key) ?? 0) < PROXY_METRICS_TIMELINE_CACHE_TTL
  ) {
    return cached
  }

  const pending = pendingTimelineRefreshMap.get(key)

  if (pending) {
    return pending
  }

  const request = (async () => {
    const response = await fetchProxyMetricsTimelineAPI(nodeName, metricsWindow)

    if (!response) {
      return null
    }

    proxyMetricsTimelineFetchTimeMap.set(key, Date.now())
    proxyMetricsTimelineMap.value = {
      ...proxyMetricsTimelineMap.value,
      [key]: response,
    }

    return response
  })().finally(() => {
    pendingTimelineRefreshMap.delete(key)
  })

  pendingTimelineRefreshMap.set(key, request)

  return request
}

export const refreshProxyMetricsBucketSamples = async (
  nodeName: string,
  start: string,
  end: string,
  options: { force?: boolean } = {},
) => {
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)

  if (!nodeName || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    return null
  }

  const normalizedStart = new Date(startMs).toISOString()
  const normalizedEnd = new Date(endMs).toISOString()
  const key = getProxyMetricsBucketSamplesCacheKey(nodeName, normalizedStart, normalizedEnd)
  const now = Date.now()
  const cached = proxyMetricsBucketSamplesMap.value[key]

  if (
    cached &&
    !options.force &&
    now - (proxyMetricsBucketSamplesFetchTimeMap.get(key) ?? 0) <
      PROXY_METRICS_BUCKET_SAMPLES_CACHE_TTL
  ) {
    return cached
  }

  const pending = pendingBucketSamplesRefreshMap.get(key)

  if (pending) {
    return pending
  }

  const request = (async () => {
    const response = await fetchProxyMetricsBucketSamplesAPI(
      nodeName,
      normalizedStart,
      normalizedEnd,
    )

    if (!response) {
      return null
    }

    proxyMetricsBucketSamplesFetchTimeMap.set(key, Date.now())
    proxyMetricsBucketSamplesMap.value = {
      ...proxyMetricsBucketSamplesMap.value,
      [key]: response,
    }

    return response
  })().finally(() => {
    pendingBucketSamplesRefreshMap.delete(key)
  })

  pendingBucketSamplesRefreshMap.set(key, request)

  return request
}

export const invalidateProxyMetricsTimeline = (nodeName: string) => {
  if (!nodeName) {
    return
  }

  for (const key of proxyMetricsTimelineFetchTimeMap.keys()) {
    if (key.endsWith(`\n${nodeName}`)) {
      proxyMetricsTimelineFetchTimeMap.delete(key)
    }
  }
}
