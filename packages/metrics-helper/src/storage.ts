import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { NodeMetrics, ProbeSample } from './types.js'

type NodeMetricsRow = {
  node_name: string
  first_timestamp: string
  last_timestamp: string
  sample_count: number
  success_count: number
  failure_count: number
  avg_delay: number | null
  min_delay: number | null
  max_delay: number | null
  last_delay: number | null
  last_success_at: string | null
  last_failure_at: string | null
}

type MetricsStorageInitOptions = {
  readonly?: boolean
}

export class MetricsStorage {
  readonly #databasePath: string
  #database?: DatabaseSync

  constructor(databasePath: string) {
    this.#databasePath = databasePath
  }

  init(options: MetricsStorageInitOptions = {}) {
    if (this.#databasePath !== ':memory:') {
      mkdirSync(dirname(this.#databasePath), { recursive: true })
    }

    this.#database = new DatabaseSync(this.#databasePath)

    if (options.readonly) {
      this.#database.exec('PRAGMA query_only = ON;')
      return
    }

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

    const node = this.#db
      .prepare('SELECT type FROM nodes WHERE node_name = ?')
      .get(sample.nodeName) as { type: string | null }
    const isSmart = node.type?.replace(/[\s-]/g, '').toLowerCase() === 'smart'

    if (isSmart) {
      const timestampSecond = sample.timestamp.slice(0, 19)
      const existingRound = this.#db
        .prepare(
          `
          SELECT id, timestamp
          FROM probe_samples
          WHERE node_name = ?
            AND test_url = ?
            AND substr(timestamp, 1, 19) = ?
          ORDER BY timestamp DESC, id DESC
          LIMIT 1
        `,
        )
        .get(sample.nodeName, sample.testUrl, timestampSecond) as
        | { id: number; timestamp: string }
        | undefined

      if (existingRound) {
        if (sample.timestamp <= existingRound.timestamp) {
          return false
        }

        this.#db
          .prepare(
            `
            UPDATE probe_samples
            SET timestamp = ?, delay = ?, success = ?, error_type = ?
            WHERE id = ?
          `,
          )
          .run(
            sample.timestamp,
            sample.delay,
            sample.success ? 1 : 0,
            sample.errorType ?? null,
            existingRound.id,
          )

        return true
      }
    }

    const existing = this.#db
      .prepare(
        `
        SELECT 1
        FROM probe_samples
        WHERE node_name = ? AND test_url = ? AND timestamp = ?
        LIMIT 1
      `,
      )
      .get(sample.nodeName, sample.testUrl, sample.timestamp)

    if (existing) {
      return false
    }

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

    return true
  }

  getNodeMetrics(windowSeconds: number, nowMs = Date.now()) {
    const metrics: Record<string, NodeMetrics> = {}

    for (const row of this.#metricRows(windowSeconds, nowMs)) {
      metrics[row.node_name] = this.#nodeMetricsFromRow(row)
    }

    return metrics
  }

  getSingleNodeMetrics(nodeName: string, windowSeconds: number, nowMs = Date.now()) {
    const row = this.#metricRows(windowSeconds, nowMs, nodeName)[0]

    return row ? this.#nodeMetricsFromRow(row) : null
  }

  getLatestSampleTimestamp(nodeName: string, testUrl?: string) {
    const whereTestUrl = testUrl ? 'AND test_url = ?' : ''
    const parameters = testUrl ? [nodeName, testUrl] : [nodeName]
    const row = this.#db
      .prepare(
        `
        SELECT MAX(timestamp) AS timestamp
        FROM probe_samples
        WHERE node_name = ? ${whereTestUrl}
      `,
      )
      .get(...parameters) as { timestamp: string | null } | undefined

    if (!row?.timestamp) {
      return null
    }

    const timestamp = Date.parse(row.timestamp)

    return Number.isFinite(timestamp) ? timestamp : null
  }

  getRecentProbeSamples(nodeName: string, windowSeconds: number, limit = 30, nowMs = Date.now()) {
    const windowStart = new Date(nowMs - windowSeconds * 1000).toISOString()
    const now = new Date(nowMs).toISOString()
    const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)))
    const rows = this.#db
      .prepare(
        `
        SELECT node_name, test_url, timestamp, delay, success, error_type
        FROM probe_samples
        WHERE node_name = ?
          AND timestamp >= ?
          AND timestamp <= ?
        ORDER BY timestamp DESC
        LIMIT ?
      `,
      )
      .all(nodeName, windowStart, now, boundedLimit) as {
      delay: number | null
      error_type: string | null
      node_name: string
      success: number
      test_url: string
      timestamp: string
    }[]

    return rows.reverse().map((row): ProbeSample => {
      const success = row.success === 1

      return {
        nodeName: row.node_name,
        testUrl: row.test_url,
        timestamp: row.timestamp,
        delay: row.delay === null ? null : Number(row.delay),
        success,
        ...(success || !row.error_type ? {} : { errorType: row.error_type }),
      }
    })
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

  #metricRows(windowSeconds: number, nowMs: number, nodeName?: string) {
    const windowStart = new Date(nowMs - windowSeconds * 1000).toISOString()
    const now = new Date(nowMs).toISOString()
    const whereClause = nodeName
      ? 'WHERE node_name = ? AND timestamp >= ? AND timestamp <= ?'
      : 'WHERE timestamp >= ? AND timestamp <= ?'
    const parameters = nodeName
      ? [nodeName, windowStart, now, windowStart, now]
      : [windowStart, now, windowStart, now]

    return this.#db
      .prepare(
        `
        WITH aggregated AS (
          SELECT
            node_name,
            MIN(timestamp) AS first_timestamp,
            MAX(timestamp) AS last_timestamp,
            COUNT(*) AS sample_count,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failure_count,
            AVG(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END) AS avg_delay,
            MIN(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END) AS min_delay,
            MAX(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END) AS max_delay,
            MAX(CASE WHEN success = 1 THEN timestamp END) AS last_success_at,
            MAX(CASE WHEN success = 0 THEN timestamp END) AS last_failure_at
          FROM probe_samples
          ${whereClause}
          GROUP BY node_name
        )
        SELECT
          aggregated.node_name,
          aggregated.first_timestamp,
          aggregated.last_timestamp,
          aggregated.sample_count,
          aggregated.success_count,
          aggregated.failure_count,
          aggregated.avg_delay,
          aggregated.min_delay,
          aggregated.max_delay,
          (
            SELECT probe_samples.delay
            FROM probe_samples
            WHERE probe_samples.node_name = aggregated.node_name
              AND probe_samples.timestamp >= ?
              AND probe_samples.timestamp <= ?
              AND probe_samples.success = 1
            ORDER BY probe_samples.timestamp DESC
            LIMIT 1
          ) AS last_delay,
          aggregated.last_success_at,
          aggregated.last_failure_at
        FROM aggregated
        ORDER BY aggregated.node_name ASC
      `,
      )
      .all(...parameters) as NodeMetricsRow[]
  }

  #nodeMetricsFromRow(row: NodeMetricsRow): NodeMetrics {
    const firstTimestamp = Date.parse(row.first_timestamp)
    const lastTimestamp = Date.parse(row.last_timestamp)
    const sampleCount = Number(row.sample_count) || 0
    const successCount = Number(row.success_count) || 0
    const failureCount = Number(row.failure_count) || 0

    return {
      availability: sampleCount ? successCount / sampleCount : null,
      coverageSeconds:
        Number.isFinite(firstTimestamp) && Number.isFinite(lastTimestamp)
          ? Math.max(0, Math.round((lastTimestamp - firstTimestamp) / 1000))
          : 0,
      firstSampleAt: row.first_timestamp,
      lastSampleAt: row.last_timestamp,
      sampleCount,
      successCount,
      failureCount,
      avgDelay: row.avg_delay === null ? null : Math.round(Number(row.avg_delay)),
      minDelay: row.min_delay === null ? null : Number(row.min_delay),
      maxDelay: row.max_delay === null ? null : Number(row.max_delay),
      lastDelay: row.last_delay === null ? null : Number(row.last_delay),
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      lossRate: null,
      lossSource: null,
    }
  }
}
