import { parentPort, workerData } from 'node:worker_threads'
import type {
  MetricsTimelineBundleSnapshot,
  MetricsTimelineSnapshot,
} from './metricsTimelineBundleCache.js'
import { MetricsStorage } from './storage.js'
import type { ProbeTimeline } from './types.js'

type WorkerData = {
  databasePath: string
  nodeName: string
  nowMs: number
}

type WorkerResponse =
  | { ok: true; snapshot: MetricsTimelineBundleSnapshot }
  | { error: string; ok: false }

const respond = (message: WorkerResponse) => parentPort?.postMessage(message)

const withMetadata = (
  timeline: ProbeTimeline,
  nodeName: string,
  snapshotAt: string,
): MetricsTimelineSnapshot => ({
  ...timeline,
  generatedAt: snapshotAt,
  nodeName,
  snapshotAt,
})

const run = () => {
  const request = workerData as WorkerData
  const storage = new MetricsStorage(request.databasePath)

  try {
    storage.init({ readonly: true })
    const timelines = storage.getNodeTimelineBundle(request.nodeName, request.nowMs)
    const snapshotAt = new Date(request.nowMs).toISOString()

    respond({
      ok: true,
      snapshot: {
        generatedAt: snapshotAt,
        nodeName: request.nodeName,
        snapshotAt,
        timelines: {
          '6h': withMetadata(timelines['6h'], request.nodeName, snapshotAt),
          '24h': withMetadata(timelines['24h'], request.nodeName, snapshotAt),
        },
      },
    })
  } catch (error) {
    respond({
      error: error instanceof Error ? error.message : 'metrics_timeline_bundle_worker_failed',
      ok: false,
    })
  } finally {
    storage.close()
  }
}

run()
