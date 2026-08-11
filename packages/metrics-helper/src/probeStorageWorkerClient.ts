import { Worker } from 'node:worker_threads'
import type { DiscoveredProxyNode, ProbeSample } from './types.js'

type WorkerResponse =
  | { id: number; ok: true; value: null | string[] }
  | { error: string; id: number; ok: false }

type PendingRequest = {
  reject: (error: Error) => void
  resolve: (value: null | string[]) => void
}

export class ProbeStorageWorkerClient {
  readonly #worker: Worker
  readonly #pending = new Map<number, PendingRequest>()
  #nextId = 1
  #stopped = false

  constructor(databasePath: string) {
    this.#worker = new Worker(new URL('./probeStorageWorker.js', import.meta.url), {
      workerData: { databasePath },
    })
    this.#worker.on('message', (message: WorkerResponse) => {
      const pending = this.#pending.get(message.id)

      if (!pending) return

      this.#pending.delete(message.id)
      if (message.ok) {
        pending.resolve(message.value)
      } else {
        pending.reject(new Error(message.error))
      }
    })
    this.#worker.on('error', (error) =>
      this.#failPending(error instanceof Error ? error : new Error(String(error))),
    )
    this.#worker.on('exit', (code) => {
      if (!this.#stopped && code !== 0) {
        this.#failPending(new Error(`probe storage worker exited with code ${code}`))
      }
    })
  }

  async prepareRound(nodes: DiscoveredProxyNode[], nowMs: number, staleMs: number) {
    const value = await this.#request({ nodes, nowMs, staleMs, type: 'prepare_round' })

    return value ?? []
  }

  async finishRound(samples: ProbeSample[], retentionDays: number, nowMs = Date.now()) {
    await this.#request({ nowMs, retentionDays, samples, type: 'finish_round' })
  }

  async stop() {
    if (this.#stopped) return

    this.#stopped = true
    this.#failPending(new Error('probe storage worker stopped'))
    await this.#worker.terminate()
  }

  #request(message: Record<string, unknown>) {
    if (this.#stopped) {
      return Promise.reject(new Error('probe storage worker stopped'))
    }

    const id = this.#nextId

    this.#nextId += 1

    return new Promise<null | string[]>((resolve, reject) => {
      this.#pending.set(id, { reject, resolve })
      this.#worker.postMessage({ ...message, id })
    })
  }

  #failPending(error: Error) {
    for (const pending of this.#pending.values()) {
      pending.reject(error)
    }
    this.#pending.clear()
  }
}
