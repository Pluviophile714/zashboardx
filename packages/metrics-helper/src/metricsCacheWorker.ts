import { parentPort, workerData } from 'node:worker_threads'
import { MetricsStorage } from './storage.js'
import type { NodeMetrics } from './types.js'

type WorkerData = {
  databasePath: string
  nowMs: number
  windowSeconds: number
}

type WorkerSuccess = {
  ok: true
  snapshot: {
    cached: true
    cacheGeneratedAt: string
    computeMs: number
    generatedAt: string
    nodes: Record<string, NodeMetrics>
    windowSeconds: number
  }
}

type WorkerFailure = {
  error: string
  ok: false
}

const postMessage = (message: WorkerSuccess | WorkerFailure) => {
  parentPort?.postMessage(message)
}

const run = () => {
  const { databasePath, nowMs, windowSeconds } = workerData as WorkerData
  const storage = new MetricsStorage(databasePath)

  try {
    storage.init({ readonly: true })

    const startedAt = performance.now()
    const nodes = storage.getNodeMetrics(windowSeconds, nowMs)
    const generatedAt = new Date(nowMs).toISOString()

    postMessage({
      ok: true,
      snapshot: {
        cached: true,
        cacheGeneratedAt: generatedAt,
        computeMs: Math.max(0, Math.round(performance.now() - startedAt)),
        generatedAt,
        nodes,
        windowSeconds,
      },
    })
  } catch (error) {
    postMessage({
      error: error instanceof Error ? error.message : 'metrics_worker_failed',
      ok: false,
    })
  } finally {
    storage.close()
  }
}

run()
