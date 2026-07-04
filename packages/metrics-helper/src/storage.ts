import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { aggregateNodeMetrics } from './aggregate.js'
import type { NodeMetrics, ProbeSample } from './types.js'

type ProbeSampleRow = {
  node_name: string
  test_url: string
  timestamp: string
  delay: number | null
  success: number
  error_type: string | null
}

const toSample = (row: ProbeSampleRow): ProbeSample => ({
  nodeName: row.node_name,
  testUrl: row.test_url,
  timestamp: row.timestamp,
  delay: row.delay,
  success: row.success === 1,
  errorType: row.error_type ?? undefined,
})

export class MetricsStorage {
  readonly #databasePath: string
  #database?: DatabaseSync

  constructor(databasePath: string) {
    this.#databasePath = databasePath
  }

  init() {
    if (this.#databasePath !== ':memory:') {
      mkdirSync(dirname(this.#databasePath), { recursive: true })
    }

    this.#database = new DatabaseSync(this.#databasePath)
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS nodes (
        node_name TEXT PRIMARY KEY,
        type TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS probe_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        node_name TEXT NOT NULL,
        test_url TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        delay INTEGER,
        success INTEGER NOT NULL,
        error_type TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_probe_samples_node_time
        ON probe_samples (node_name, timestamp);
      CREATE INDEX IF NOT EXISTS idx_probe_samples_time
        ON probe_samples (timestamp);
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    this.#database
      .prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
      .run('schema_version', '1')
  }

  recordNode(nodeName: string, type: string | null) {
    const now = new Date().toISOString()

    this.#db
      .prepare(
        `
        INSERT INTO nodes (node_name, type, first_seen, last_seen)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(node_name) DO UPDATE SET
          type = COALESCE(excluded.type, nodes.type),
          last_seen = excluded.last_seen
      `,
      )
      .run(nodeName, type, now, now)
  }

  insertProbeSample(sample: ProbeSample) {
    this.recordNode(sample.nodeName, null)
    this.#db
      .prepare(
        `
        INSERT INTO probe_samples (
          node_name,
          test_url,
          timestamp,
          delay,
          success,
          error_type
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        sample.nodeName,
        sample.testUrl,
        sample.timestamp,
        sample.delay,
        sample.success ? 1 : 0,
        sample.errorType ?? null,
      )
  }

  getNodeMetrics(windowSeconds: number, nowMs = Date.now()) {
    const samplesByNode = new Map<string, ProbeSample[]>()
    const rows = this.#sampleRows(windowSeconds, nowMs)

    for (const row of rows) {
      const sample = toSample(row)
      const samples = samplesByNode.get(sample.nodeName) ?? []

      samples.push(sample)
      samplesByNode.set(sample.nodeName, samples)
    }

    const metrics: Record<string, NodeMetrics> = {}

    for (const [nodeName, samples] of samplesByNode) {
      metrics[nodeName] = aggregateNodeMetrics(samples, nowMs, windowSeconds)
    }

    return metrics
  }

  getSingleNodeMetrics(nodeName: string, windowSeconds: number, nowMs = Date.now()) {
    const rows = this.#sampleRows(windowSeconds, nowMs, nodeName)
    const metrics = aggregateNodeMetrics(rows.map(toSample), nowMs, windowSeconds)

    return metrics.sampleCount ? metrics : null
  }

  prune(retentionDays: number, nowMs = Date.now()) {
    const cutoff = new Date(nowMs - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const result = this.#db.prepare('DELETE FROM probe_samples WHERE timestamp < ?').run(cutoff)

    return Number(result.changes ?? 0)
  }

  close() {
    this.#database?.close()
    this.#database = undefined
  }

  get #db() {
    if (!this.#database) {
      throw new Error('MetricsStorage has not been initialized')
    }

    return this.#database
  }

  #sampleRows(windowSeconds: number, nowMs: number, nodeName?: string) {
    const windowStart = new Date(nowMs - windowSeconds * 1000).toISOString()
    const now = new Date(nowMs).toISOString()

    if (nodeName) {
      return this.#db
        .prepare(
          `
          SELECT node_name, test_url, timestamp, delay, success, error_type
          FROM probe_samples
          WHERE node_name = ? AND timestamp >= ? AND timestamp <= ?
          ORDER BY timestamp ASC
        `,
        )
        .all(nodeName, windowStart, now) as ProbeSampleRow[]
    }

    return this.#db
      .prepare(
        `
        SELECT node_name, test_url, timestamp, delay, success, error_type
        FROM probe_samples
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY node_name ASC, timestamp ASC
      `,
      )
      .all(windowStart, now) as ProbeSampleRow[]
  }
}
