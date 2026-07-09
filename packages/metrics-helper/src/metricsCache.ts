import type { MetricsStorage } from './storage.js'
import type { NodeMetrics } from './types.js'

export type MetricsSnapshot = {
  windowSeconds: number
  generatedAt: string
  cacheGeneratedAt: string
  computeMs: number
  cached: true
  nodes: Record<string, NodeMetrics>
}

type MetricsAggregationCacheOptions = {
  storage: MetricsStorage
  defaultWindowSeconds: number
  ttlMs: number
  refreshDebounceMs: number
  now?: () => number
}

export class MetricsAggregationCache {
  readonly #storage: MetricsStorage
  readonly #defaultWindowSeconds: number
  readonly #ttlMs: number
  readonly #refreshDebounceMs: number
  readonly #now: () => number
  readonly #snapshots = new Map<number, MetricsSnapshot>()
  readonly #dirtyWindows = new Set<number>()
  readonly #refreshWindows = new Set<number>()
  #refreshTimer?: NodeJS.Timeout

  constructor(options: MetricsAggregationCacheOptions) {
    this.#storage = options.storage
    this.#defaultWindowSeconds = options.defaultWindowSeconds
    this.#ttlMs = options.ttlMs
    this.#refreshDebounceMs = options.refreshDebounceMs
    this.#now = options.now ?? Date.now
  }

  get(windowSeconds = this.#defaultWindowSeconds, nowMs = this.#now()) {
    const snapshot = this.#snapshots.get(windowSeconds)

    if (!snapshot) {
      return this.refresh(windowSeconds, nowMs)
    }

    if (this.#isStale(snapshot, nowMs) || this.#dirtyWindows.has(windowSeconds)) {
      this.scheduleRefresh(this.#refreshDebounceMs, windowSeconds)
    }

    return snapshot
  }

  getSingleNodeMetrics(nodeName: string, windowSeconds = this.#defaultWindowSeconds) {
    return this.get(windowSeconds).nodes[nodeName] ?? null
  }

  refresh(windowSeconds = this.#defaultWindowSeconds, nowMs = this.#now()) {
    const startedAt = performance.now()
    const nodes = this.#storage.getNodeMetrics(windowSeconds, nowMs)
    const generatedAt = new Date(nowMs).toISOString()
    const snapshot: MetricsSnapshot = {
      cached: true,
      cacheGeneratedAt: generatedAt,
      computeMs: Math.max(0, Math.round(performance.now() - startedAt)),
      generatedAt,
      nodes,
      windowSeconds,
    }

    this.#snapshots.set(windowSeconds, snapshot)
    this.#dirtyWindows.delete(windowSeconds)

    return snapshot
  }

  markDirty(windowSeconds = this.#defaultWindowSeconds) {
    this.#dirtyWindows.add(windowSeconds)
  }

  scheduleRefresh(delayMs = this.#refreshDebounceMs, windowSeconds = this.#defaultWindowSeconds) {
    this.#dirtyWindows.add(windowSeconds)
    this.#refreshWindows.add(windowSeconds)

    if (this.#refreshTimer) {
      return
    }

    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = undefined
      const windows = [...this.#refreshWindows]

      this.#refreshWindows.clear()

      for (const windowSeconds of windows) {
        this.refresh(windowSeconds)
      }
    }, delayMs)
  }

  stop() {
    if (this.#refreshTimer) {
      clearTimeout(this.#refreshTimer)
      this.#refreshTimer = undefined
    }
    this.#refreshWindows.clear()
  }

  #isStale(snapshot: MetricsSnapshot, nowMs: number) {
    return nowMs - Date.parse(snapshot.cacheGeneratedAt) > this.#ttlMs
  }
}
