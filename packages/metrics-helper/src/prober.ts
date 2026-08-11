import type { MetricsHelperConfig } from './config.js'
import type { MihomoClient } from './mihomoClient.js'
import type { ProbeStorageWorkerClient } from './probeStorageWorkerClient.js'
import type { MetricsStorage } from './storage.js'
import type { HelperHealth, ProbeSample } from './types.js'

type ProbeRunnerOptions = {
  client: MihomoClient
  storage: MetricsStorage
  config: MetricsHelperConfig
  health: HelperHealth
  onAfterRun?: () => Promise<void> | void
  storageWorker?: ProbeStorageWorkerClient
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
  readonly #onAfterRun?: () => Promise<void> | void
  readonly #storageWorker?: ProbeStorageWorkerClient
  #timer?: NodeJS.Timeout
  #running = false

  constructor(options: ProbeRunnerOptions) {
    this.#client = options.client
    this.#storage = options.storage
    this.#config = options.config
    this.#health = options.health
    this.#onAfterRun = options.onAfterRun
    this.#storageWorker = options.storageWorker
  }

  async runOnce() {
    if (this.#running) {
      return
    }

    this.#running = true
    this.#health.running = true

    try {
      const nodes = await this.#client.discoverProxyNodes(this.#config.probeTestUrl)
      const nowMs = Date.now()
      const staleMs = this.#config.fallbackProbeStaleSeconds * 1000
      const fallbackNodeNames = this.#storageWorker
        ? new Set(await this.#storageWorker.prepareRound(nodes, nowMs, staleMs))
        : null
      const fallbackNodes = []

      for (const node of nodes) {
        if (fallbackNodeNames) {
          if (fallbackNodeNames.has(node.name)) fallbackNodes.push(node)
          continue
        }

        this.#storage.recordNode(node.name, node.type)

        for (const sample of node.historySamples ?? []) {
          this.#storage.insertProbeSample(sample, { collapseFallbackRound: true })
        }

        const latestSampleAt = this.#storage.getLatestSampleTimestamp(node.name)

        if (
          node.probeable !== false &&
          (latestSampleAt === null || nowMs - latestSampleAt > staleMs)
        ) {
          fallbackNodes.push(node)
        }
      }

      const fallbackSamples: ProbeSample[] = []
      await runBounded(fallbackNodes, this.#config.probeConcurrency, async (node) => {
        const sample = await this.#client.probeNode(
          node.name,
          this.#config.probeTestUrl,
          this.#config.probeTimeoutMs,
        )

        if (this.#storageWorker) {
          fallbackSamples.push(sample)
        } else {
          this.#storage.insertProbeSample(sample)
        }
      })

      if (this.#storageWorker) {
        await this.#storageWorker.finishRound(fallbackSamples, this.#config.retentionDays, nowMs)
      } else {
        this.#storage.prune(this.#config.retentionDays, nowMs)
      }
      this.#health.ok = true
      this.#health.mihomoReachable = true
      this.#health.lastProbeAt = new Date().toISOString()
      this.#health.lastProbeError = null
      this.#health.lastProbeNodeCount = nodes.length
      await this.#onAfterRun?.()
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
