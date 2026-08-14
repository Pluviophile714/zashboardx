import { Worker } from 'node:worker_threads'
import type { ProbeTimelineBucket } from './types.js'

export type MetricsTimelineBundleRequest = {
  nodeName: string
  nowMs: number
}

export type MetricsTimelineSnapshot = {
  bucketSeconds: number
  buckets: ProbeTimelineBucket[]
  generatedAt: string
  jitter: number | null
  nodeName: string
  snapshotAt: string
  windowSeconds: number
}

export type MetricsTimelineBundleSnapshot = {
  generatedAt: string
  nodeName: string
  snapshotAt: string
  timelines: {
    '6h': MetricsTimelineSnapshot
    '24h': MetricsTimelineSnapshot
  }
}

type MetricsTimelineBundleCacheOptions = {
  activeRefreshMs?: number
  databasePath?: string
  loader?: (request: MetricsTimelineBundleRequest) => Promise<MetricsTimelineBundleSnapshot>
  maxEntries?: number
  now?: () => number
  refreshDebounceMs: number
  ttlMs: number
}

type WorkerResponse =
  | { ok: true; snapshot: MetricsTimelineBundleSnapshot }
  | { error: string; ok: false }

export class MetricsTimelineBundleCache {
  readonly #activeRefreshMs: number
  readonly #loader: (
    request: MetricsTimelineBundleRequest,
  ) => Promise<MetricsTimelineBundleSnapshot>
  readonly #maxEntries: number
  readonly #now: () => number
  readonly #refreshDebounceMs: number
  readonly #ttlMs: number
  readonly #snapshots = new Map<string, MetricsTimelineBundleSnapshot>()
  readonly #requests = new Map<string, MetricsTimelineBundleRequest>()
  readonly #lastAccess = new Map<string, number>()
  readonly #pending = new Map<string, Promise<MetricsTimelineBundleSnapshot>>()
  readonly #refreshTimers = new Map<string, NodeJS.Timeout>()
  readonly #workers = new Set<Worker>()
  readonly #dirty = new Set<string>()
  readonly #dirtyVersions = new Map<string, number>()

  constructor(options: MetricsTimelineBundleCacheOptions) {
    if (!options.loader && !options.databasePath) {
      throw new Error('metrics timeline bundle cache requires a loader or database path')
    }

    this.#activeRefreshMs = options.activeRefreshMs ?? 5 * 60_000
    this.#loader =
      options.loader ?? ((request) => this.#loadInWorker(options.databasePath!, request))
    this.#maxEntries = options.maxEntries ?? 32
    this.#now = options.now ?? Date.now
    this.#refreshDebounceMs = options.refreshDebounceMs
    this.#ttlMs = options.ttlMs
  }

  async get(request: MetricsTimelineBundleRequest) {
    const key = request.nodeName
    const snapshot = this.#snapshots.get(key)
    const snapshotMs = Date.parse(snapshot?.snapshotAt ?? '')

    this.#requests.set(key, request)
    this.#lastAccess.set(key, this.#now())
    this.#evictLeastRecentlyUsed(key)

    if (snapshot && Number.isFinite(snapshotMs) && snapshotMs <= request.nowMs) {
      if (this.#dirty.has(key) || request.nowMs - snapshotMs > this.#ttlMs) {
        this.#scheduleRefresh(key, { ...request, nowMs: this.#now() }, 0)
      }

      return snapshot
    }

    return this.#refresh(key, request)
  }

  peek(nodeName: string) {
    return this.#snapshots.get(nodeName) ?? null
  }

  markDirty() {
    const nowMs = this.#now()
    const refreshes: Promise<unknown>[] = []

    for (const [key, request] of this.#requests) {
      if (nowMs - (this.#lastAccess.get(key) ?? 0) > this.#activeRefreshMs) continue

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
    for (const timer of this.#refreshTimers.values()) clearTimeout(timer)
    this.#refreshTimers.clear()
    this.#lastAccess.clear()

    for (const worker of this.#workers) void worker.terminate()
    this.#workers.clear()
  }

  #deleteEntry(key: string) {
    const timer = this.#refreshTimers.get(key)

    if (timer) clearTimeout(timer)
    this.#refreshTimers.delete(key)
    this.#snapshots.delete(key)
    this.#requests.delete(key)
    this.#lastAccess.delete(key)
    this.#dirty.delete(key)
    this.#dirtyVersions.delete(key)
  }

  #evictLeastRecentlyUsed(protectedKey: string) {
    while (this.#requests.size > this.#maxEntries) {
      let oldestKey: string | undefined
      let oldestAccess = Number.POSITIVE_INFINITY

      for (const [key, lastAccess] of this.#lastAccess) {
        if (key === protectedKey || this.#pending.has(key)) continue
        if (lastAccess < oldestAccess) {
          oldestAccess = lastAccess
          oldestKey = key
        }
      }

      if (!oldestKey) return
      this.#deleteEntry(oldestKey)
    }
  }

  #scheduleRefresh(
    key: string,
    request: MetricsTimelineBundleRequest,
    delayMs = this.#refreshDebounceMs,
  ) {
    if (this.#refreshTimers.has(key) || this.#pending.has(key)) return

    const timer = setTimeout(() => {
      this.#refreshTimers.delete(key)
      void this.#refresh(key, request).catch(() => undefined)
    }, delayMs)

    this.#refreshTimers.set(key, timer)
  }

  #refresh(key: string, request: MetricsTimelineBundleRequest) {
    const existing = this.#pending.get(key)

    if (existing) return existing

    const dirtyVersion = this.#dirtyVersions.get(key) ?? 0
    this.#requests.set(key, request)
    const pending = this.#loader(request)
      .then((snapshot) => {
        this.#snapshots.set(key, snapshot)
        if ((this.#dirtyVersions.get(key) ?? 0) === dirtyVersion) this.#dirty.delete(key)
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

  #loadInWorker(databasePath: string, request: MetricsTimelineBundleRequest) {
    return new Promise<MetricsTimelineBundleSnapshot>((resolve, reject) => {
      const worker = new Worker(new URL('./metricsTimelineBundleWorker.js', import.meta.url), {
        workerData: { databasePath, ...request },
      })
      let settled = false

      this.#workers.add(worker)
      worker.once('message', (message: WorkerResponse) => {
        settled = true
        if (message.ok) resolve(message.snapshot)
        else reject(new Error(message.error))
      })
      worker.once('error', (error) => {
        settled = true
        reject(error)
      })
      worker.once('exit', (code) => {
        this.#workers.delete(worker)
        if (!settled && code !== 0) {
          reject(new Error(`metrics timeline bundle worker exited with code ${code}`))
        }
      })
    })
  }
}
