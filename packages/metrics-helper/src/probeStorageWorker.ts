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

type RebuildRollupsMessage = {
  id: number
  nowMs: number
  retentionDays: number
  type: 'rebuild_rollups'
}

type WorkerRequest = FinishRoundMessage | PrepareRoundMessage | RebuildRollupsMessage

type WorkerResponse =
  { id: number; ok: true; value: null | string[] } | { error: string; id: number; ok: false }

const databasePath = (workerData as { databasePath: string }).databasePath
const storage = new MetricsStorage(databasePath)

storage.init()

const respond = (response: WorkerResponse) => parentPort?.postMessage(response)

parentPort?.on('message', (message: WorkerRequest) => {
  try {
    if (message.type === 'prepare_round') {
      const changedTimestamps = new Map<string, string[]>()
      const fallbackNames = storage.transaction(() => {
        const names: string[] = []

        for (const node of message.nodes) {
          storage.recordNode(node.name, node.type)

          for (const sample of node.historySamples ?? []) {
            if (storage.insertProbeSample(sample, { collapseFallbackRound: true })) {
              const timestamps = changedTimestamps.get(sample.nodeName) ?? []

              timestamps.push(sample.timestamp)
              changedTimestamps.set(sample.nodeName, timestamps)
            }
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

      for (const [nodeName, timestamps] of changedTimestamps) {
        storage.refreshMetricsRollupBuckets(nodeName, timestamps)
      }

      respond({ id: message.id, ok: true, value: fallbackNames })
      return
    }

    if (message.type === 'rebuild_rollups') {
      storage.rebuildMetricsRollups(message.retentionDays, message.nowMs)
      respond({ id: message.id, ok: true, value: null })
      return
    }

    const changedTimestamps = new Map<string, string[]>()
    storage.transaction(() => {
      for (const sample of message.samples) {
        if (storage.insertProbeSample(sample)) {
          const timestamps = changedTimestamps.get(sample.nodeName) ?? []

          timestamps.push(sample.timestamp)
          changedTimestamps.set(sample.nodeName, timestamps)
        }
      }

      storage.prune(message.retentionDays, message.nowMs)
    })
    for (const [nodeName, timestamps] of changedTimestamps) {
      storage.refreshMetricsRollupBuckets(nodeName, timestamps)
    }
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
