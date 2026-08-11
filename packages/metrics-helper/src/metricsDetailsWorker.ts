import { parentPort, workerData } from 'node:worker_threads'
import { MetricsStorage } from './storage.js'
import type { ProbeSample, ProbeTimelineBucket } from './types.js'

type WorkerData = {
  bucketCount: number
  databasePath: string
  limit: number
  nodeName: string
  nowMs: number
  windowSeconds: number
}

type DetailsSnapshot = {
  generatedAt: string
  nodeName: string
  samples: ProbeSample[]
  snapshotAt: string
  timeline: {
    bucketSeconds: number
    buckets: ProbeTimelineBucket[]
    generatedAt: string
    jitter: number | null
    nodeName: string
    snapshotAt: string
    windowSeconds: number
  }
}

type WorkerResponse = { ok: true; snapshot: DetailsSnapshot } | { error: string; ok: false }

const respond = (message: WorkerResponse) => parentPort?.postMessage(message)

const run = () => {
  const request = workerData as WorkerData
  const storage = new MetricsStorage(request.databasePath)

  try {
    storage.init({ readonly: true })

    const details = storage.getNodeDetails(
      request.nodeName,
      request.windowSeconds,
      request.bucketCount,
      request.limit,
      request.nowMs,
    )
    const snapshotAt = new Date(request.nowMs).toISOString()

    respond({
      ok: true,
      snapshot: {
        generatedAt: snapshotAt,
        nodeName: request.nodeName,
        samples: details.samples,
        snapshotAt,
        timeline: {
          bucketSeconds: request.windowSeconds / request.bucketCount,
          buckets: details.buckets,
          generatedAt: snapshotAt,
          jitter: details.jitter,
          nodeName: request.nodeName,
          snapshotAt,
          windowSeconds: request.windowSeconds,
        },
      },
    })
  } catch (error) {
    respond({
      error: error instanceof Error ? error.message : 'metrics_details_worker_failed',
      ok: false,
    })
  } finally {
    storage.close()
  }
}

run()
