import { loadConfig } from './config.js'
import { MihomoClient } from './mihomoClient.js'
import { ProbeRunner } from './prober.js'
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

storage.init()

const client = new MihomoClient({
  baseUrl: config.mihomoBaseUrl,
  secret: config.mihomoSecret,
})
const runner = new ProbeRunner({
  client,
  storage,
  config,
  health,
})
const server = createMetricsServer({
  storage,
  health,
  defaultWindowSeconds: config.probeWindowHours * 60 * 60,
})

server.listen(config.port, config.bindHost, () => {
  console.log(
    `zashboardx-metrics listening on ${config.bindHost}:${config.port}, mihomo=${config.mihomoBaseUrl}`,
  )
})
runner.start()

const shutdown = () => {
  runner.stop()
  server.close(() => {
    storage.close()
    process.exit(0)
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
