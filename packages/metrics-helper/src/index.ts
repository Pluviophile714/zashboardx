import { loadConfig } from './config.js'
import { MetricsAggregationCache } from './metricsCache.js'
import { MetricsDetailsCache } from './metricsDetailsCache.js'
import { MetricsUpdateHub } from './metricsEvents.js'
import { MihomoClient } from './mihomoClient.js'
import { ProbeRunner } from './prober.js'
import { ProbeStorageWorkerClient } from './probeStorageWorkerClient.js'
import { createMetricsServer } from './server.js'
import { MetricsStorage } from './storage.js'
import type { HelperHealth } from './types.js'

const version = '0.1.0'
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
const storageWorker =
  config.databasePath === ':memory:' ? undefined : new ProbeStorageWorkerClient(config.databasePath)

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
    await detailsCache.markDirty()
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
  updates,
})

server.listen(config.port, config.bindHost, () => {
  console.log(
    `zashboardx-metrics listening on ${config.bindHost}:${config.port}, mihomo=${config.mihomoBaseUrl}`,
  )
  metricsCache.scheduleRefresh(0)
})
runner.start()

const shutdown = () => {
  runner.stop()
  detailsCache.stop()
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
