import type { MetricsHelperConfig } from './config.js'
import type { MihomoClient } from './mihomoClient.js'
import type { MetricsStorage } from './storage.js'
import type { HelperHealth } from './types.js'

type ProbeRunnerOptions = {
  client: MihomoClient
  storage: MetricsStorage
  config: MetricsHelperConfig
  health: HelperHealth
}

const runBounded = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) => {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]

      cursor += 1
      await worker(item)
    }
  })

  await Promise.all(workers)
}

export class ProbeRunner {
  readonly #client: MihomoClient
  readonly #storage: MetricsStorage
  readonly #config: MetricsHelperConfig
  readonly #health: HelperHealth
  #timer?: NodeJS.Timeout
  #running = false

  constructor(options: ProbeRunnerOptions) {
    this.#client = options.client
    this.#storage = options.storage
    this.#config = options.config
    this.#health = options.health
  }

  async runOnce() {
    if (this.#running) {
      return
    }

    this.#running = true
    this.#health.running = true

    try {
      const nodes = await this.#client.discoverProxyNodes(this.#config.probeTestUrl)
      const fallbackNodes = []
      const nowMs = Date.now()
      const staleMs = this.#config.fallbackProbeStaleSeconds * 1000

      for (const node of nodes) {
        this.#storage.recordNode(node.name, node.type)

        if (node.historySamples?.length) {
          node.historySamples.forEach((sample) => this.#storage.insertProbeSample(sample))
        }

        const latestSampleAt = this.#storage.getLatestSampleTimestamp(node.name)

        if (latestSampleAt === null || nowMs - latestSampleAt > staleMs) {
          fallbackNodes.push(node)
        }
      }

      await runBounded(fallbackNodes, this.#config.probeConcurrency, async (node) => {
        const sample = await this.#client.probeNode(
          node.name,
          this.#config.probeTestUrl,
          this.#config.probeTimeoutMs,
        )

        this.#storage.insertProbeSample(sample)
      })

      this.#storage.prune(this.#config.retentionDays)
      this.#health.ok = true
      this.#health.mihomoReachable = true
      this.#health.lastProbeAt = new Date().toISOString()
      this.#health.lastProbeError = null
      this.#health.lastProbeNodeCount = nodes.length
    } catch (error) {
      this.#health.ok = false
      this.#health.mihomoReachable = false
      this.#health.lastProbeError = error instanceof Error ? error.message : String(error)
    } finally {
      this.#running = false
      this.#health.running = false
    }
  }

  start() {
    void this.runOnce()
    this.#timer = setInterval(() => {
      void this.runOnce()
    }, this.#config.probeIntervalSeconds * 1000)
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = undefined
    }
  }
}
