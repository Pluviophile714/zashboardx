import { ref, shallowRef } from 'vue'
import {
  fetchProxyMetricsBucketSamplesAPI,
  fetchProxyMetricsDetailsAPI,
  fetchProxyMetricsHelperAPI,
  fetchProxyMetricsSamplesAPI,
  fetchProxyMetricsTimelineAPI,
  fetchProxyMetricsTimelineBundleAPI,
  openProxyMetricsEvents,
  type ProxyMetricsBucketSamplesResponse,
  type ProxyMetricsDetailsResponse,
  type ProxyMetricsEventSourceConstructor,
  type ProxyMetricsNode,
  type ProxyMetricsSample,
  type ProxyMetricsTimelineBundleResponse,
  type ProxyMetricsTimelineResponse,
  type ProxyMetricsTimelineWindow,
} from '../api/metricsHelper.ts'
import {
  mergeRollingMetricSamples,
  reconcileMetricsNodeRecentSamples,
  reconcileRecentSampleUpdate,
  type ProxyMetricsSampleUpdateKind,
} from '../helper/proxyMetricsRecentSamples.ts'

const PROXY_METRICS_CACHE_TTL = 30 * 1000
const PROXY_METRICS_SAMPLES_CACHE_TTL = 30 * 1000
const PROXY_METRICS_TIMELINE_CACHE_TTL = 30 * 1000
const PROXY_METRICS_BUCKET_SAMPLES_CACHE_TTL = 30 * 1000
const SHARED_RAW_SAMPLES_LIMIT = 200
const SHARED_RAW_SAMPLES_WINDOW = '1h'
const SHARED_RAW_SAMPLES_WINDOW_SECONDS = 60 * 60

let lastFetchTime = 0
let pendingRefresh: Promise<void> | undefined
const proxyMetricsSamplesFetchTimeMap = new Map<string, number>()
const pendingSamplesRefreshMap = new Map<string, Promise<ProxyMetricsSample[] | null>>()
const proxyMetricsDetailsFetchTimeMap = new Map<string, number>()
const pendingDetailsRefreshMap = new Map<string, Promise<ProxyMetricsDetailsResponse | null>>()
const proxyMetricsTimelineFetchTimeMap = new Map<string, number>()
const pendingTimelineRefreshMap = new Map<string, Promise<ProxyMetricsTimelineResponse | null>>()
const proxyMetricsTimelineBundleFetchTimeMap = new Map<string, number>()
const pendingTimelineBundleRefreshMap = new Map<
  string,
  Promise<ProxyMetricsTimelineBundleResponse | null>
>()
const proxyMetricsBucketSamplesFetchTimeMap = new Map<string, number>()
const pendingBucketSamplesRefreshMap = new Map<
  string,
  Promise<ProxyMetricsBucketSamplesResponse | null>
>()

export const proxyMetricsMap = shallowRef<Record<string, ProxyMetricsNode>>({})
export const proxyMetricsSamplesMap = shallowRef<Record<string, ProxyMetricsSample[]>>({})
export const proxyMetricsSamplesSnapshotMap = shallowRef<Record<string, string>>({})
export const proxyMetricsSamplesUpdateMap = shallowRef<
  Record<string, ProxyMetricsSampleUpdateKind>
>({})
export const proxyMetricsOneHourSamplesReadyMap = shallowRef<Record<string, true>>({})
export const proxyMetricsTimelineMap = shallowRef<Record<string, ProxyMetricsTimelineResponse>>({})
export const proxyMetricsDetailsMap = shallowRef<Record<string, ProxyMetricsDetailsResponse>>({})
export const proxyMetricsBucketSamplesMap = shallowRef<
  Record<string, ProxyMetricsBucketSamplesResponse>
>({})
export const proxyMetricsAvailable = ref(false)
export const proxyMetricsUpdatedAt = ref(0)
export const proxyMetricsRequestDurationMs = ref<number | null>(null)
export const proxyMetricsRequestFailed = ref(false)
export const proxyMetricsLastRequestAt = ref(0)
export const proxyMetricsLiveConnected = ref(false)
export const proxyMetricsLastEventAt = ref(0)

let stopLiveUpdates: (() => void) | undefined

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
    const recentSampleUpdates = reconcileMetricsNodeRecentSamples(
      proxyMetricsSamplesMap.value,
      response.nodes,
      (nodeName) =>
        getProxyMetricsSamplesCacheKey(
          nodeName,
          SHARED_RAW_SAMPLES_WINDOW,
          SHARED_RAW_SAMPLES_LIMIT,
        ),
      {
        limit: SHARED_RAW_SAMPLES_LIMIT,
        snapshotAt: response.generatedAt,
        windowSeconds: SHARED_RAW_SAMPLES_WINDOW_SECONDS,
      },
    )

    if (Object.keys(recentSampleUpdates).length) {
      const nextSamplesMap = { ...proxyMetricsSamplesMap.value }
      const nextUpdatesMap = { ...proxyMetricsSamplesUpdateMap.value }
      const updatedAt = Date.now()

      for (const [key, update] of Object.entries(recentSampleUpdates)) {
        nextSamplesMap[key] = update.samples
        nextUpdatesMap[key] = update.kind
        proxyMetricsSamplesFetchTimeMap.set(key, updatedAt)
      }

      proxyMetricsSamplesMap.value = nextSamplesMap
      proxyMetricsSamplesUpdateMap.value = nextUpdatesMap
      proxyMetricsSamplesSnapshotMap.value = {
        ...proxyMetricsSamplesSnapshotMap.value,
        ...Object.fromEntries(
          Object.keys(recentSampleUpdates).map((key) => [key, response.generatedAt]),
        ),
      }
    }

    proxyMetricsAvailable.value = true
    proxyMetricsRequestFailed.value = false
    proxyMetricsUpdatedAt.value = Date.parse(response.generatedAt) || Date.now()
  })().finally(() => {
    pendingRefresh = undefined
  })

  return pendingRefresh
}

export const startProxyMetricsLiveUpdates = (
  options: {
    EventSourceConstructor?: ProxyMetricsEventSourceConstructor
  } = {},
) => {
  if (stopLiveUpdates) {
    return stopLiveUpdates
  }

  const close = openProxyMetricsEvents(
    (event) => {
      const eventAt = Date.parse(event.snapshotAt)

      if (!Number.isFinite(eventAt)) {
        return
      }

      proxyMetricsLastEventAt.value = eventAt

      if (eventAt <= proxyMetricsUpdatedAt.value) {
        return
      }

      void refreshProxyMetrics({ force: true })
    },
    (connected) => {
      proxyMetricsLiveConnected.value = connected
    },
    options.EventSourceConstructor,
  )

  stopLiveUpdates = () => {
    close()
    proxyMetricsLiveConnected.value = false
    stopLiveUpdates = undefined
  }

  return stopLiveUpdates
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

    const previous = proxyMetricsSamplesMap.value[key]
    const previousLastTimestamp = Date.parse(previous?.at(-1)?.timestamp ?? '')
    const responseLastTimestamp = Date.parse(response.samples.at(-1)?.timestamp ?? '')

    if (
      previous?.length &&
      Number.isFinite(previousLastTimestamp) &&
      Number.isFinite(responseLastTimestamp) &&
      responseLastTimestamp < previousLastTimestamp
    ) {
      proxyMetricsSamplesFetchTimeMap.set(key, Date.now())
      proxyMetricsSamplesUpdateMap.value = {
        ...proxyMetricsSamplesUpdateMap.value,
        [key]: 'unchanged',
      }

      return previous
    }

    const update = reconcileRecentSampleUpdate(previous, response.samples)
    proxyMetricsSamplesFetchTimeMap.set(key, Date.now())
    proxyMetricsSamplesMap.value = {
      ...proxyMetricsSamplesMap.value,
      [key]: update.samples,
    }
    proxyMetricsSamplesSnapshotMap.value = {
      ...proxyMetricsSamplesSnapshotMap.value,
      [key]: response.snapshotAt,
    }
    proxyMetricsSamplesUpdateMap.value = {
      ...proxyMetricsSamplesUpdateMap.value,
      [key]: update.kind,
    }

    return update.samples
  })().finally(() => {
    pendingSamplesRefreshMap.delete(key)
  })

  pendingSamplesRefreshMap.set(key, request)

  return request
}

export const getProxyMetricsSamplesUpdateKind = (
  nodeName: string,
  metricsWindow = '24h',
  limit = 30,
) =>
  proxyMetricsSamplesUpdateMap.value[getProxyMetricsSamplesCacheKey(nodeName, metricsWindow, limit)]

export const getProxyMetricsSamplesCacheKey = (
  nodeName: string,
  metricsWindow = '24h',
  limit = 30,
) => `${metricsWindow}\n${limit}\n${nodeName}`

export const getProxyMetricsSamplesSnapshotAt = (
  nodeName: string,
  metricsWindow = '24h',
  limit = 30,
) =>
  proxyMetricsSamplesSnapshotMap.value[
    getProxyMetricsSamplesCacheKey(nodeName, metricsWindow, limit)
  ]

export const hasProxyMetricsOneHourSamplesReady = (nodeName: string) =>
  Boolean(
    proxyMetricsOneHourSamplesReadyMap.value[
      getProxyMetricsSamplesCacheKey(nodeName, SHARED_RAW_SAMPLES_WINDOW, SHARED_RAW_SAMPLES_LIMIT)
    ],
  )

export const getProxyMetricsTimelineCacheKey = (nodeName: string, metricsWindow = '24h') =>
  `${metricsWindow}\n${nodeName}`

export const getProxyMetricsDetailsCacheKey = (
  nodeName: string,
  metricsWindow: ProxyMetricsTimelineWindow = '24h',
) => `${metricsWindow}\n${nodeName}`

export const getProxyMetricsDetailsSnapshot = (
  nodeName: string,
  metricsWindow: ProxyMetricsTimelineWindow = '24h',
) => proxyMetricsDetailsMap.value[getProxyMetricsDetailsCacheKey(nodeName, metricsWindow)]

export const refreshProxyMetricsDetails = async (
  nodeName: string,
  options: {
    force?: boolean
    limit?: number
    snapshotAt?: string
    window?: ProxyMetricsTimelineWindow
  } = {},
) => {
  if (!nodeName) {
    return null
  }

  const metricsWindow = options.window ?? '24h'
  const limit = options.limit ?? 30
  const detailsKey = getProxyMetricsDetailsCacheKey(nodeName, metricsWindow)
  const now = Date.now()
  const cached = proxyMetricsDetailsMap.value[detailsKey]

  if (
    cached &&
    !options.force &&
    now - (proxyMetricsDetailsFetchTimeMap.get(detailsKey) ?? 0) < PROXY_METRICS_TIMELINE_CACHE_TTL
  ) {
    return cached
  }

  const pending = pendingDetailsRefreshMap.get(detailsKey)

  if (pending) {
    return pending
  }

  const requestedSnapshotAt = options.snapshotAt ?? new Date().toISOString()
  const request = (async () => {
    const response = await fetchProxyMetricsDetailsAPI(
      nodeName,
      metricsWindow,
      limit,
      requestedSnapshotAt,
    )

    if (!response || response.snapshotAt !== response.timeline.snapshotAt) {
      return null
    }

    const responseSnapshotAtMs = Date.parse(response.snapshotAt)
    const previousDetails = proxyMetricsDetailsMap.value[detailsKey]
    const previousDetailsSnapshotAtMs = Date.parse(previousDetails?.snapshotAt ?? '')
    const detailsIsCurrent =
      !previousDetails ||
      !Number.isFinite(previousDetailsSnapshotAtMs) ||
      !Number.isFinite(responseSnapshotAtMs) ||
      responseSnapshotAtMs >= previousDetailsSnapshotAtMs

    const samplesKey = getProxyMetricsSamplesCacheKey(
      nodeName,
      SHARED_RAW_SAMPLES_WINDOW,
      SHARED_RAW_SAMPLES_LIMIT,
    )
    const previousSamples = proxyMetricsSamplesMap.value[samplesKey]
    const previousLastTimestamp = Date.parse(previousSamples?.at(-1)?.timestamp ?? '')
    const responseSamples = mergeRollingMetricSamples(previousSamples, response.samples, {
      limit: SHARED_RAW_SAMPLES_LIMIT,
      snapshotAt: response.snapshotAt,
      windowSeconds: SHARED_RAW_SAMPLES_WINDOW_SECONDS,
    })
    const responseLastTimestamp = Date.parse(responseSamples.at(-1)?.timestamp ?? '')
    const sharedSnapshotAtMs = Date.parse(proxyMetricsSamplesSnapshotMap.value[samplesKey] ?? '')
    const snapshotIsCurrent =
      !Number.isFinite(sharedSnapshotAtMs) ||
      !Number.isFinite(responseSnapshotAtMs) ||
      responseSnapshotAtMs >= sharedSnapshotAtMs
    const samplesAreCurrent =
      !previousSamples?.length ||
      !Number.isFinite(previousLastTimestamp) ||
      !Number.isFinite(responseLastTimestamp) ||
      responseLastTimestamp >= previousLastTimestamp

    if (responseSamples.length && snapshotIsCurrent && samplesAreCurrent) {
      const update = reconcileRecentSampleUpdate(previousSamples, responseSamples)

      proxyMetricsSamplesFetchTimeMap.set(samplesKey, Date.now())
      proxyMetricsSamplesMap.value = {
        ...proxyMetricsSamplesMap.value,
        [samplesKey]: update.samples,
      }
      proxyMetricsSamplesSnapshotMap.value = {
        ...proxyMetricsSamplesSnapshotMap.value,
        [samplesKey]: response.snapshotAt,
      }
      proxyMetricsSamplesUpdateMap.value = {
        ...proxyMetricsSamplesUpdateMap.value,
        [samplesKey]: update.kind,
      }
    }

    if (metricsWindow === SHARED_RAW_SAMPLES_WINDOW && limit >= SHARED_RAW_SAMPLES_LIMIT) {
      proxyMetricsOneHourSamplesReadyMap.value = {
        ...proxyMetricsOneHourSamplesReadyMap.value,
        [samplesKey]: true,
      }
    }

    if (!detailsIsCurrent) {
      return previousDetails
    }

    const timelineKey = getProxyMetricsTimelineCacheKey(nodeName, metricsWindow)

    proxyMetricsDetailsFetchTimeMap.set(detailsKey, Date.now())
    proxyMetricsTimelineFetchTimeMap.set(timelineKey, Date.now())
    proxyMetricsTimelineMap.value = {
      ...proxyMetricsTimelineMap.value,
      [timelineKey]: response.timeline,
    }
    proxyMetricsDetailsMap.value = {
      ...proxyMetricsDetailsMap.value,
      [detailsKey]: {
        ...response,
        samples: response.samples,
      },
    }
    if (Number.isFinite(responseSnapshotAtMs)) {
      proxyMetricsUpdatedAt.value = Math.max(proxyMetricsUpdatedAt.value, responseSnapshotAtMs)
    }

    return proxyMetricsDetailsMap.value[detailsKey]
  })().finally(() => {
    pendingDetailsRefreshMap.delete(detailsKey)
  })

  pendingDetailsRefreshMap.set(detailsKey, request)

  return request
}

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

export const refreshProxyMetricsTimelineBundle = async (
  nodeName: string,
  options: { force?: boolean } = {},
) => {
  if (!nodeName) return null

  const now = Date.now()
  const sixHourKey = getProxyMetricsTimelineCacheKey(nodeName, '6h')
  const dayKey = getProxyMetricsTimelineCacheKey(nodeName, '24h')

  if (
    proxyMetricsTimelineMap.value[sixHourKey] &&
    proxyMetricsTimelineMap.value[dayKey] &&
    !options.force &&
    now - (proxyMetricsTimelineBundleFetchTimeMap.get(nodeName) ?? 0) <
      PROXY_METRICS_TIMELINE_CACHE_TTL
  ) {
    const snapshotAt = proxyMetricsTimelineMap.value[dayKey].snapshotAt

    return {
      generatedAt: snapshotAt,
      nodeName,
      snapshotAt,
      timelines: {
        '6h': proxyMetricsTimelineMap.value[sixHourKey],
        '24h': proxyMetricsTimelineMap.value[dayKey],
      },
    } satisfies ProxyMetricsTimelineBundleResponse
  }

  const pending = pendingTimelineBundleRefreshMap.get(nodeName)

  if (pending) return pending

  const request = (async () => {
    const response = await fetchProxyMetricsTimelineBundleAPI(nodeName)

    if (!response) return null

    const nextTimelineMap = { ...proxyMetricsTimelineMap.value }

    for (const metricsWindow of ['6h', '24h'] as const) {
      const key = getProxyMetricsTimelineCacheKey(nodeName, metricsWindow)
      const previousSnapshotMs = Date.parse(nextTimelineMap[key]?.snapshotAt ?? '')
      const responseSnapshotMs = Date.parse(response.timelines[metricsWindow].snapshotAt)

      if (
        !Number.isFinite(previousSnapshotMs) ||
        !Number.isFinite(responseSnapshotMs) ||
        responseSnapshotMs >= previousSnapshotMs
      ) {
        nextTimelineMap[key] = response.timelines[metricsWindow]
        proxyMetricsTimelineFetchTimeMap.set(key, Date.now())
      }
    }

    proxyMetricsTimelineBundleFetchTimeMap.set(nodeName, Date.now())
    proxyMetricsTimelineMap.value = nextTimelineMap
    return response
  })().finally(() => {
    pendingTimelineBundleRefreshMap.delete(nodeName)
  })

  pendingTimelineBundleRefreshMap.set(nodeName, request)
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

  proxyMetricsTimelineBundleFetchTimeMap.delete(nodeName)
}
