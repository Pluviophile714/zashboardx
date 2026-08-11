import { parentPort, workerData } from 'node:worker_threads'
import { MetricsStorage } from './storage.js'
import type { DiscoveredProxyNode, ProbeSample } from './types.js'

type PrepareRoundMessage = {
  id: number
  nodes: DiscoveredProxyNode[]
  nowMs: number
  staleMs: number
  type: 'prepare_round'
}

type FinishRoundMessage = {
  id: number
  nowMs: number
  retentionDays: number
  samples: ProbeSample[]
  type: 'finish_round'
}

type WorkerRequest = FinishRoundMessage | PrepareRoundMessage

type WorkerResponse =
  | { id: number; ok: true; value: null | string[] }
  | { error: string; id: number; ok: false }

const databasePath = (workerData as { databasePath: string }).databasePath
const storage = new MetricsStorage(databasePath)

storage.init()

const respond = (response: WorkerResponse) => parentPort?.postMessage(response)

parentPort?.on('message', (message: WorkerRequest) => {
  try {
    if (message.type === 'prepare_round') {
      const fallbackNames = storage.transaction(() => {
        const names: string[] = []

        for (const node of message.nodes) {
          storage.recordNode(node.name, node.type)

          for (const sample of node.historySamples ?? []) {
            storage.insertProbeSample(sample, { collapseFallbackRound: true })
          }

          const latestSampleAt = storage.getLatestSampleTimestamp(node.name)

          if (
            node.probeable !== false &&
            (latestSampleAt === null || message.nowMs - latestSampleAt > message.staleMs)
          ) {
            names.push(node.name)
          }
        }

        return names
      })

      respond({ id: message.id, ok: true, value: fallbackNames })
      return
    }

    storage.transaction(() => {
      for (const sample of message.samples) {
        storage.insertProbeSample(sample)
      }

      storage.prune(message.retentionDays, message.nowMs)
    })
    respond({ id: message.id, ok: true, value: null })
  } catch (error) {
    respond({
      error: error instanceof Error ? error.message : 'probe_storage_worker_failed',
      id: message.id,
      ok: false,
    })
  }
})

parentPort?.once('close', () => storage.close())
