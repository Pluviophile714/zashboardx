import { loadConfig } from './config.js'
import { MetricsAggregationCache } from './metricsCache.js'
import { MetricsDetailsCache } from './metricsDetailsCache.js'
import { MetricsUpdateHub } from './metricsEvents.js'
import { MetricsTimelineBundleCache } from './metricsTimelineBundleCache.js'
import { MihomoClient } from './mihomoClient.js'
import { ProbeRunner } from './prober.js'
import { ProbeStorageWorkerClient } from './probeStorageWorkerClient.js'
import { createMetricsServer } from './server.js'
import { shouldRebuildMetricsRollups } from './startup.js'
import { MetricsStorage } from './storage.js'
import type { HelperHealth } from './types.js'

const version = '0.2.0'
const ONE_HOUR_SECONDS = 60 * 60
const SECONDARY_METRICS_PREWARM_DELAY_MS = 2_000
const config = loadConfig()
const health: HelperHealth = {
  ok: false,
  mihomoReachable: false,
  running: false,
  lastProbeAt: null,
  lastProbeError: null,
  lastProbeNodeCount: 0,
  version,
}
const storage = new MetricsStorage(config.databasePath)
const updates = new MetricsUpdateHub()

storage.init()

const metricsCache = new MetricsAggregationCache({
  storage,
  databasePath: config.databasePath,
  defaultWindowSeconds: config.probeWindowHours * 60 * 60,
  refreshDebounceMs: config.metricsCacheRefreshDebounceMs,
  ttlMs: config.metricsCacheTtlSeconds * 1000,
  onSnapshotReady: (event) => updates.publish(event),
})
const detailsCache = new MetricsDetailsCache({
  databasePath: config.databasePath,
  refreshDebounceMs: config.metricsCacheRefreshDebounceMs,
  ttlMs: config.metricsCacheTtlSeconds * 1000,
})
const timelineBundleCache = new MetricsTimelineBundleCache({
  databasePath: config.databasePath,
  maxEntries: 32,
  refreshDebounceMs: config.metricsCacheRefreshDebounceMs,
  ttlMs: config.metricsCacheTtlSeconds * 1000,
})
const storageWorker =
  config.databasePath === ':memory:' ? undefined : new ProbeStorageWorkerClient(config.databasePath)
let secondaryMetricsPrewarmTimer: NodeJS.Timeout | undefined

const client = new MihomoClient({
  baseUrl: config.mihomoBaseUrl,
  secret: config.mihomoSecret,
})
const runner = new ProbeRunner({
  client,
  storage,
  config,
  health,
  onAfterRun: async () => {
    await Promise.all([detailsCache.markDirty(), timelineBundleCache.markDirty()])
    metricsCache.markDirty()
  },
  storageWorker,
})
const server = createMetricsServer({
  storage,
  detailsCache,
  health,
  defaultWindowSeconds: config.probeWindowHours * 60 * 60,
  metricsCache,
  timelineBundleCache,
  updates,
})

server.listen(config.port, config.bindHost, () => {
  console.log(
    `zashboardx-metrics listening on ${config.bindHost}:${config.port}, mihomo=${config.mihomoBaseUrl}`,
  )
  // The 1h path is the user-facing live view; warm it before the heavier default window.
  metricsCache.scheduleRefresh(0, ONE_HOUR_SECONDS)
  secondaryMetricsPrewarmTimer = setTimeout(() => {
    secondaryMetricsPrewarmTimer = undefined
    metricsCache.scheduleRefresh(0)
  }, SECONDARY_METRICS_PREWARM_DELAY_MS)
  if (storageWorker && shouldRebuildMetricsRollups(storage.getMetricsRollupState().ready)) {
    void storageWorker.rebuildMetricsRollups(config.retentionDays).catch((error) => {
      console.error('metrics rollup rebuild failed', error)
    })
  }
})
runner.start()

const shutdown = () => {
  runner.stop()
  if (secondaryMetricsPrewarmTimer) {
    clearTimeout(secondaryMetricsPrewarmTimer)
    secondaryMetricsPrewarmTimer = undefined
  }
  detailsCache.stop()
  timelineBundleCache.stop()
  metricsCache.stop()
  updates.close()
  server.close(async () => {
    await storageWorker?.stop()
    storage.close()
    process.exit(0)
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
