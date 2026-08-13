import { Worker } from 'node:worker_threads'
import type { ProbeSample, ProbeTimelineBucket } from './types.js'

export type MetricsDetailsRequest = {
  bucketCount: number
  limit: number
  nodeName: string
  nowMs: number
  windowSeconds: number
}

export type MetricsDetailsSnapshot = {
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

type MetricsDetailsCacheOptions = {
  activeRefreshMs?: number
  databasePath?: string
  loader?: (request: MetricsDetailsRequest) => Promise<MetricsDetailsSnapshot>
  now?: () => number
  refreshDebounceMs: number
  ttlMs: number
}

type WorkerResponse = { ok: true; snapshot: MetricsDetailsSnapshot } | { error: string; ok: false }

const getCacheKey = (request: MetricsDetailsRequest) =>
  `${request.windowSeconds}\n${request.bucketCount}\n${request.limit}\n${request.nodeName}`

export class MetricsDetailsCache {
  readonly #activeRefreshMs: number
  readonly #loader: (request: MetricsDetailsRequest) => Promise<MetricsDetailsSnapshot>
  readonly #now: () => number
  readonly #refreshDebounceMs: number
  readonly #ttlMs: number
  readonly #snapshots = new Map<string, MetricsDetailsSnapshot>()
  readonly #requests = new Map<string, MetricsDetailsRequest>()
  readonly #lastAccess = new Map<string, number>()
  readonly #pending = new Map<string, Promise<MetricsDetailsSnapshot>>()
  readonly #refreshTimers = new Map<string, NodeJS.Timeout>()
  readonly #workers = new Set<Worker>()
  readonly #dirty = new Set<string>()
  readonly #dirtyVersions = new Map<string, number>()

  constructor(options: MetricsDetailsCacheOptions) {
    if (!options.loader && !options.databasePath) {
      throw new Error('metrics details cache requires a loader or database path')
    }

    this.#now = options.now ?? Date.now
    this.#activeRefreshMs = options.activeRefreshMs ?? 5 * 60_000
    this.#refreshDebounceMs = options.refreshDebounceMs
    this.#ttlMs = options.ttlMs
    this.#loader =
      options.loader ?? ((request) => this.#loadInWorker(options.databasePath!, request))
  }

  async get(request: MetricsDetailsRequest) {
    const key = getCacheKey(request)
    const snapshot = this.#snapshots.get(key)
    const snapshotMs = Date.parse(snapshot?.snapshotAt ?? '')

    this.#requests.set(key, request)
    this.#lastAccess.set(key, this.#now())

    if (snapshot && Number.isFinite(snapshotMs) && snapshotMs <= request.nowMs) {
      if (this.#dirty.has(key) || request.nowMs - snapshotMs > this.#ttlMs) {
        this.#scheduleRefresh(key, { ...request, nowMs: this.#now() }, 0)
      }

      return snapshot
    }

    return this.#refresh(key, request)
  }

  peek(request: MetricsDetailsRequest) {
    return this.#snapshots.get(getCacheKey(request)) ?? null
  }

  markDirty() {
    const nowMs = this.#now()
    const refreshes: Promise<unknown>[] = []

    for (const [key, request] of this.#requests) {
      if (nowMs - (this.#lastAccess.get(key) ?? 0) > this.#activeRefreshMs) {
        continue
      }

      this.#dirty.add(key)
      this.#dirtyVersions.set(key, (this.#dirtyVersions.get(key) ?? 0) + 1)
      const timer = this.#refreshTimers.get(key)

      if (timer) {
        clearTimeout(timer)
        this.#refreshTimers.delete(key)
      }

      refreshes.push(this.#refresh(key, { ...request, nowMs }).catch(() => undefined))
    }

    return Promise.all(refreshes).then(() => undefined)
  }

  stop() {
    for (const timer of this.#refreshTimers.values()) {
      clearTimeout(timer)
    }
    this.#refreshTimers.clear()
    this.#lastAccess.clear()

    for (const worker of this.#workers) {
      void worker.terminate()
    }
    this.#workers.clear()
  }

  #scheduleRefresh(key: string, request: MetricsDetailsRequest, delayMs = this.#refreshDebounceMs) {
    if (this.#refreshTimers.has(key) || this.#pending.has(key)) return

    const timer = setTimeout(() => {
      this.#refreshTimers.delete(key)
      void this.#refresh(key, request).catch(() => undefined)
    }, delayMs)

    this.#refreshTimers.set(key, timer)
  }

  #refresh(key: string, request: MetricsDetailsRequest) {
    const existing = this.#pending.get(key)

    if (existing) return existing

    const dirtyVersion = this.#dirtyVersions.get(key) ?? 0
    this.#requests.set(key, request)
    const pending = this.#loader(request)
      .then((snapshot) => {
        this.#snapshots.set(key, snapshot)
        if ((this.#dirtyVersions.get(key) ?? 0) === dirtyVersion) {
          this.#dirty.delete(key)
        }
        return snapshot
      })
      .finally(() => {
        this.#pending.delete(key)

        if (this.#dirty.has(key) && (this.#dirtyVersions.get(key) ?? 0) !== dirtyVersion) {
          this.#scheduleRefresh(key, { ...request, nowMs: this.#now() }, 0)
        }
      })

    this.#pending.set(key, pending)
    return pending
  }

  #loadInWorker(databasePath: string, request: MetricsDetailsRequest) {
    return new Promise<MetricsDetailsSnapshot>((resolve, reject) => {
      const worker = new Worker(new URL('./metricsDetailsWorker.js', import.meta.url), {
        workerData: { databasePath, ...request },
      })
      let settled = false

      this.#workers.add(worker)
      worker.once('message', (message: WorkerResponse) => {
        settled = true
        if (message.ok) {
          resolve(message.snapshot)
        } else {
          reject(new Error(message.error))
        }
      })
      worker.once('error', (error) => {
        settled = true
        reject(error)
      })
      worker.once('exit', (code) => {
        this.#workers.delete(worker)
        if (!settled && code !== 0) {
          reject(new Error(`metrics details worker exited with code ${code}`))
        }
      })
    })
  }
}
