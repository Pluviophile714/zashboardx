import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  NodeMetrics,
  ProbeSample,
  ProbeSampleRange,
  ProbeTimeline,
  ProbeTimelineBucket,
  ProbeTimelineBundle,
} from './types.js'

const FALLBACK_ROUND_WINDOW_MS = 2_000
const ROLLUP_BUCKET_SECONDS = [60, 300, 900] as const
const ROLLUP_READY_METADATA_KEY = 'metrics_rollup_ready'

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

type ProbeTimelineRow = {
  bucket_index: number
  sample_count: number
  success_count: number
  failure_count: number
  avg_delay: number | null
  min_delay: number | null
  max_delay: number | null
  jitter: number | null
}

type ProbeTimelineBundleRow = {
  delay: number | null
  id: number
  success: number
  timestamp: string
}

type TimelineAccumulator = {
  delaySum: number
  failureCount: number
  jitterCount: number
  jitterSum: number
  maxDelay: number | null
  minDelay: number | null
  previousDelay: number | null
  sampleCount: number
  successCount: number
}

const TIMELINE_BUNDLE_PROFILES = {
  '6h': { bucketCount: 72, windowSeconds: 21_600 },
  '24h': { bucketCount: 96, windowSeconds: 86_400 },
} as const

const buildTimelineFromRows = (
  rows: ProbeTimelineBundleRow[],
  windowSeconds: number,
  bucketCount: number,
  nowMs: number,
): ProbeTimeline => {
  const normalizedNowMs = Math.floor(nowMs / 1000) * 1000
  const windowStartMs = normalizedNowMs - windowSeconds * 1000
  const jitterWindowStartMs = nowMs - windowSeconds * 1000
  const bucketSeconds = windowSeconds / bucketCount
  const bucketMs = bucketSeconds * 1000
  const accumulators: TimelineAccumulator[] = Array.from({ length: bucketCount }, () => ({
    delaySum: 0,
    failureCount: 0,
    jitterCount: 0,
    jitterSum: 0,
    maxDelay: null,
    minDelay: null,
    previousDelay: null,
    sampleCount: 0,
    successCount: 0,
  }))
  let previousWindowDelay: number | null = null
  let windowJitterCount = 0
  let windowJitterSum = 0

  for (const row of rows) {
    const timestampMs = Date.parse(row.timestamp)

    if (!Number.isFinite(timestampMs)) continue

    if (
      timestampMs >= jitterWindowStartMs &&
      timestampMs <= nowMs &&
      row.success === 1 &&
      row.delay !== null
    ) {
      if (previousWindowDelay !== null) {
        windowJitterSum += Math.abs(row.delay - previousWindowDelay)
        windowJitterCount += 1
      }
      previousWindowDelay = row.delay
    }

    if (timestampMs < windowStartMs || timestampMs > normalizedNowMs) continue

    const timestampSeconds = Math.floor(timestampMs / 1000)
    const windowStartSeconds = Math.floor(windowStartMs / 1000)
    const bucketIndex = Math.min(
      bucketCount - 1,
      Math.floor((timestampSeconds - windowStartSeconds) / bucketSeconds),
    )
    const accumulator = accumulators[bucketIndex]

    if (!accumulator) continue

    accumulator.sampleCount += 1
    if (row.success !== 1 || row.delay === null) {
      accumulator.failureCount += 1
      continue
    }

    accumulator.successCount += 1
    accumulator.delaySum += row.delay
    accumulator.minDelay =
      accumulator.minDelay === null ? row.delay : Math.min(accumulator.minDelay, row.delay)
    accumulator.maxDelay =
      accumulator.maxDelay === null ? row.delay : Math.max(accumulator.maxDelay, row.delay)

    if (accumulator.previousDelay !== null) {
      accumulator.jitterSum += Math.abs(row.delay - accumulator.previousDelay)
      accumulator.jitterCount += 1
    }
    accumulator.previousDelay = row.delay
  }

  return {
    bucketSeconds,
    buckets: accumulators.map((accumulator, bucketIndex) => ({
      start: new Date(windowStartMs + bucketIndex * bucketMs).toISOString(),
      end: new Date(windowStartMs + (bucketIndex + 1) * bucketMs).toISOString(),
      sampleCount: accumulator.sampleCount,
      successCount: accumulator.successCount,
      failureCount: accumulator.failureCount,
      avgDelay:
        accumulator.successCount > 0 ? accumulator.delaySum / accumulator.successCount : null,
      minDelay: accumulator.minDelay,
      maxDelay: accumulator.maxDelay,
      jitter: accumulator.jitterCount > 0 ? accumulator.jitterSum / accumulator.jitterCount : null,
    })),
    jitter: windowJitterCount > 0 ? windowJitterSum / windowJitterCount : null,
    windowSeconds,
  }
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
      CREATE TABLE IF NOT EXISTS metrics_rollup_buckets (
        node_name TEXT NOT NULL,
        bucket_seconds INTEGER NOT NULL,
        bucket_start INTEGER NOT NULL,
        sample_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL,
        failure_count INTEGER NOT NULL,
        delay_sum REAL NOT NULL,
        min_delay REAL,
        max_delay REAL,
        jitter_sum REAL NOT NULL,
        jitter_count INTEGER NOT NULL,
        first_timestamp TEXT NOT NULL,
        last_timestamp TEXT NOT NULL,
        last_success_at TEXT,
        last_success_delay REAL,
        last_failure_at TEXT,
        PRIMARY KEY (node_name, bucket_seconds, bucket_start)
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_rollup_window
        ON metrics_rollup_buckets (bucket_seconds, bucket_start, node_name);
    `)

    const rollupColumns = new Set(
      (
        this.#db.prepare('PRAGMA table_info(metrics_rollup_buckets)').all() as { name: string }[]
      ).map((column) => column.name),
    )
    const rollupColumnMigrations = [
      ['last_success_at', 'TEXT'],
      ['last_success_delay', 'REAL'],
      ['last_failure_at', 'TEXT'],
    ] as const
    let rollupSchemaChanged = false

    for (const [column, type] of rollupColumnMigrations) {
      if (!rollupColumns.has(column)) {
        this.#db.exec(`ALTER TABLE metrics_rollup_buckets ADD COLUMN ${column} ${type}`)
        rollupSchemaChanged = true
      }
    }

    if (rollupSchemaChanged) {
      this.#db
        .prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
        .run(ROLLUP_READY_METADATA_KEY, '0')
    }

    const schemaVersionRow = this.#database
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get('schema_version') as { value: string } | undefined
    const schemaVersion = Number(schemaVersionRow?.value ?? 0)

    if (!Number.isFinite(schemaVersion) || schemaVersion < 2) {
      this.#removeLegacyFallbackRoundDuplicates()
    }

    this.#database
      .prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
      .run('schema_version', '2')
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

  insertProbeSample(sample: ProbeSample, options: { collapseFallbackRound?: boolean } = {}) {
    this.recordNode(sample.nodeName, null)

    const node = this.#db
      .prepare('SELECT type FROM nodes WHERE node_name = ?')
      .get(sample.nodeName) as { type: string | null }
    const normalizedType = node.type?.replace(/[\s-]/g, '').toLowerCase()
    const isSmart = normalizedType === 'smart'
    const isFallback = normalizedType === 'fallback'

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
        { id: number; timestamp: string } | undefined

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

    if (isFallback && options.collapseFallbackRound) {
      const timestampMs = Date.parse(sample.timestamp)
      const existingRound = this.#db
        .prepare(
          `
          SELECT id, timestamp
          FROM probe_samples
          WHERE node_name = ?
            AND test_url = ?
            AND timestamp >= ?
            AND timestamp <= ?
          ORDER BY timestamp DESC, id DESC
          LIMIT 1
        `,
        )
        .get(
          sample.nodeName,
          sample.testUrl,
          new Date(timestampMs - FALLBACK_ROUND_WINDOW_MS).toISOString(),
          new Date(timestampMs + FALLBACK_ROUND_WINDOW_MS).toISOString(),
        ) as { id: number; timestamp: string } | undefined

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
    const rows = this.#canUseMetricsRollups(windowSeconds)
      ? this.#rollupMetricRows(windowSeconds, nowMs)
      : this.#metricRows(windowSeconds, nowMs)

    for (const row of rows) {
      metrics[row.node_name] = {
        ...this.#nodeMetricsFromRow(row),
        recentSamples: this.getRecentProbeSamples(row.node_name, windowSeconds, 30, nowMs),
      }
    }

    return metrics
  }

  getSingleNodeMetrics(nodeName: string, windowSeconds: number, nowMs = Date.now()) {
    const row = this.#canUseMetricsRollups(windowSeconds)
      ? this.#rollupMetricRows(windowSeconds, nowMs, nodeName)[0]
      : this.#metricRows(windowSeconds, nowMs, nodeName)[0]

    return row
      ? {
          ...this.#nodeMetricsFromRow(row),
          recentSamples: this.getRecentProbeSamples(nodeName, windowSeconds, 30, nowMs),
        }
      : null
  }

  getNodeDetails(
    nodeName: string,
    windowSeconds: number,
    bucketCount: number,
    limit = 30,
    nowMs = Date.now(),
  ) {
    this.#db.exec('BEGIN')

    try {
      const details = {
        samples: this.getRecentProbeSamples(nodeName, windowSeconds, limit, nowMs),
        jitter: this.getNodeJitter(nodeName, windowSeconds, nowMs),
        buckets: this.getNodeTimeline(nodeName, windowSeconds, bucketCount, nowMs),
      }

      this.#db.exec('COMMIT')

      return details
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }

  getNodeTimeline(
    nodeName: string,
    windowSeconds: number,
    bucketCount = 96,
    nowMs = Date.now(),
  ): ProbeTimelineBucket[] {
    const bucketSeconds = windowSeconds / bucketCount

    if (
      this.getMetricsRollupState().ready &&
      ROLLUP_BUCKET_SECONDS.includes(bucketSeconds as 60 | 300 | 900)
    ) {
      return this.#getNodeRollupTimeline(nodeName, windowSeconds, bucketCount, nowMs)
    }

    const normalizedNowMs = Math.floor(nowMs / 1000) * 1000
    const windowStartMs = normalizedNowMs - windowSeconds * 1000
    const windowStart = new Date(windowStartMs).toISOString()
    const now = new Date(normalizedNowMs).toISOString()
    const rows = this.#db
      .prepare(
        `
        WITH bucketed AS (
          SELECT
            MIN(
              ?,
              CAST((unixepoch(timestamp) - ?) / ? AS INTEGER)
            ) AS bucket_index,
            id,
            timestamp,
            success,
            delay
          FROM probe_samples
          WHERE node_name = ?
            AND timestamp >= ?
            AND timestamp <= ?
        ),
        aggregated AS (
          SELECT
            bucket_index,
            COUNT(*) AS sample_count,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failure_count,
            AVG(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END) AS avg_delay,
            MIN(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END) AS min_delay,
            MAX(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END) AS max_delay
          FROM bucketed
          GROUP BY bucket_index
        ),
        successful_samples AS (
          SELECT
            bucket_index,
            delay,
            LAG(delay) OVER (
              PARTITION BY bucket_index
              ORDER BY timestamp ASC, id ASC
            ) AS previous_delay
          FROM bucketed
          WHERE success = 1 AND delay IS NOT NULL
        ),
        jitter_by_bucket AS (
          SELECT
            bucket_index,
            AVG(ABS(delay - previous_delay)) AS jitter
          FROM successful_samples
          WHERE previous_delay IS NOT NULL
          GROUP BY bucket_index
        )
        SELECT
          aggregated.bucket_index,
          aggregated.sample_count,
          aggregated.success_count,
          aggregated.failure_count,
          aggregated.avg_delay,
          aggregated.min_delay,
          aggregated.max_delay,
          jitter_by_bucket.jitter
        FROM aggregated
        LEFT JOIN jitter_by_bucket USING (bucket_index)
        ORDER BY aggregated.bucket_index ASC
      `,
      )
      .all(
        bucketCount - 1,
        Math.floor(windowStartMs / 1000),
        bucketSeconds,
        nodeName,
        windowStart,
        now,
      ) as ProbeTimelineRow[]
    const rowsByBucket = new Map(rows.map((row) => [Number(row.bucket_index), row]))

    return Array.from({ length: bucketCount }, (_, bucketIndex) => {
      const row = rowsByBucket.get(bucketIndex)

      return {
        start: new Date(windowStartMs + bucketIndex * bucketSeconds * 1000).toISOString(),
        end: new Date(windowStartMs + (bucketIndex + 1) * bucketSeconds * 1000).toISOString(),
        sampleCount: row ? Number(row.sample_count) : 0,
        successCount: row ? Number(row.success_count) : 0,
        failureCount: row ? Number(row.failure_count) : 0,
        avgDelay: row?.avg_delay === null || row === undefined ? null : Number(row.avg_delay),
        minDelay: row?.min_delay === null || row === undefined ? null : Number(row.min_delay),
        maxDelay: row?.max_delay === null || row === undefined ? null : Number(row.max_delay),
        jitter: row?.jitter === null || row === undefined ? null : Number(row.jitter),
      }
    })
  }

  getMetricsRollupState() {
    const row = this.#db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get(ROLLUP_READY_METADATA_KEY) as { value: string } | undefined

    return { ready: row?.value === '1' }
  }

  getMetricsRollupBucketCount(nodeName: string, bucketSeconds: number) {
    const row = this.#db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM metrics_rollup_buckets
        WHERE node_name = ? AND bucket_seconds = ?
      `,
      )
      .get(nodeName, bucketSeconds) as { count: number }

    return Number(row.count)
  }

  rebuildMetricsRollups(retentionDays: number, nowMs = Date.now()) {
    const cutoff = new Date(nowMs - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const now = new Date(nowMs).toISOString()

    this.transaction(() => {
      this.#db.exec('DELETE FROM metrics_rollup_buckets')
      this.#database
        ?.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
        .run(ROLLUP_READY_METADATA_KEY, '0')

      for (const bucketSeconds of ROLLUP_BUCKET_SECONDS) {
        this.#db
          .prepare(
            `
            WITH bucketed AS (
              SELECT
                node_name,
                timestamp,
                id,
                success,
                delay,
                CAST(unixepoch(timestamp) / ? AS INTEGER) * ? AS bucket_start
              FROM probe_samples
              WHERE timestamp >= ? AND timestamp <= ?
            ),
            aggregated AS (
              SELECT
                node_name,
                bucket_start,
                COUNT(*) AS sample_count,
                SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
                SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failure_count,
                COALESCE(
                  SUM(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay ELSE 0 END),
                  0
                ) AS delay_sum,
                MIN(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END) AS min_delay,
                MAX(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END) AS max_delay,
                0 AS jitter_sum,
                0 AS jitter_count,
                MIN(timestamp) AS first_timestamp,
                MAX(timestamp) AS last_timestamp,
                MAX(CASE WHEN success = 1 THEN timestamp END) AS last_success_at,
                MAX(CASE WHEN success = 0 THEN timestamp END) AS last_failure_at
              FROM bucketed
              GROUP BY node_name, bucket_start
            ),
            latest_success AS (
              SELECT node_name, bucket_start, delay AS last_success_delay
              FROM (
                SELECT
                  node_name,
                  bucket_start,
                  delay,
                  ROW_NUMBER() OVER (
                    PARTITION BY node_name, bucket_start
                    ORDER BY timestamp DESC, id DESC
                  ) AS row_number
                FROM bucketed
                WHERE success = 1
              )
              WHERE row_number = 1
            )
            INSERT INTO metrics_rollup_buckets (
              node_name,
              bucket_seconds,
              bucket_start,
              sample_count,
              success_count,
              failure_count,
              delay_sum,
              min_delay,
              max_delay,
              jitter_sum,
              jitter_count,
              first_timestamp,
              last_timestamp,
              last_success_at,
              last_success_delay,
              last_failure_at
            )
            SELECT
              aggregated.node_name,
              ?,
              aggregated.bucket_start,
              aggregated.sample_count,
              aggregated.success_count,
              aggregated.failure_count,
              aggregated.delay_sum,
              aggregated.min_delay,
              aggregated.max_delay,
              aggregated.jitter_sum,
              aggregated.jitter_count,
              aggregated.first_timestamp,
              aggregated.last_timestamp,
              aggregated.last_success_at,
              latest_success.last_success_delay,
              aggregated.last_failure_at
            FROM aggregated
            LEFT JOIN latest_success USING (node_name, bucket_start)
          `,
          )
          .run(bucketSeconds, bucketSeconds, cutoff, now, bucketSeconds)

        this.#db
          .prepare(
            `
            WITH bucketed AS (
              SELECT
                node_name,
                timestamp,
                id,
                delay,
                CAST(unixepoch(timestamp) / ? AS INTEGER) * ? AS bucket_start
              FROM probe_samples
              WHERE timestamp >= ?
                AND timestamp <= ?
                AND success = 1
                AND delay IS NOT NULL
            ),
            ordered AS (
              SELECT
                node_name,
                bucket_start,
                delay,
                LAG(delay) OVER (
                  PARTITION BY node_name, bucket_start
                  ORDER BY timestamp ASC, id ASC
                ) AS previous_delay
              FROM bucketed
            ),
            jitter AS (
              SELECT
                node_name,
                bucket_start,
                SUM(ABS(delay - previous_delay)) AS jitter_sum,
                COUNT(*) AS jitter_count
              FROM ordered
              WHERE previous_delay IS NOT NULL
              GROUP BY node_name, bucket_start
            )
            UPDATE metrics_rollup_buckets
            SET jitter_sum = COALESCE(
                  (
                    SELECT jitter.jitter_sum
                    FROM jitter
                    WHERE jitter.node_name = metrics_rollup_buckets.node_name
                      AND jitter.bucket_start = metrics_rollup_buckets.bucket_start
                  ),
                  0
                ),
                jitter_count = COALESCE(
                  (
                    SELECT jitter.jitter_count
                    FROM jitter
                    WHERE jitter.node_name = metrics_rollup_buckets.node_name
                      AND jitter.bucket_start = metrics_rollup_buckets.bucket_start
                  ),
                  0
                )
            WHERE bucket_seconds = ?
          `,
          )
          .run(bucketSeconds, bucketSeconds, cutoff, now, bucketSeconds)
      }

      this.#database
        ?.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
        .run(ROLLUP_READY_METADATA_KEY, '1')
    })
  }

  refreshMetricsRollupBuckets(nodeName: string, timestamps: string[]) {
    if (!this.getMetricsRollupState().ready || !nodeName || !timestamps.length) {
      return
    }

    const affectedBuckets = new Map<number, Set<number>>()

    for (const bucketSeconds of ROLLUP_BUCKET_SECONDS) {
      const bucketStarts = new Set<number>()

      for (const timestamp of timestamps) {
        const timestampMs = Date.parse(timestamp)

        if (!Number.isFinite(timestampMs)) continue

        bucketStarts.add(Math.floor(timestampMs / (bucketSeconds * 1000)) * bucketSeconds)
      }

      if (bucketStarts.size) affectedBuckets.set(bucketSeconds, bucketStarts)
    }

    this.transaction(() => {
      for (const [bucketSeconds, bucketStarts] of affectedBuckets) {
        for (const bucketStart of bucketStarts) {
          this.#refreshMetricsRollupBucket(nodeName, bucketSeconds, bucketStart)
        }
      }
    })
  }

  #getNodeRollupTimeline(
    nodeName: string,
    windowSeconds: number,
    bucketCount: number,
    nowMs: number,
  ): ProbeTimelineBucket[] {
    const bucketSeconds = windowSeconds / bucketCount
    const bucketMs = bucketSeconds * 1000
    const currentBucketStartMs = Math.floor(nowMs / bucketMs) * bucketMs
    const windowEndMs = currentBucketStartMs + bucketMs
    const windowStartMs = windowEndMs - windowSeconds * 1000
    const rows = this.#db
      .prepare(
        `
        SELECT
          bucket_start,
          sample_count,
          success_count,
          failure_count,
          delay_sum,
          min_delay,
          max_delay,
          jitter_sum,
          jitter_count
        FROM metrics_rollup_buckets
        WHERE node_name = ?
          AND bucket_seconds = ?
          AND bucket_start >= ?
          AND bucket_start < ?
        ORDER BY bucket_start ASC
      `,
      )
      .all(
        nodeName,
        bucketSeconds,
        Math.floor(windowStartMs / 1000),
        Math.floor(windowEndMs / 1000),
      ) as {
      bucket_start: number
      delay_sum: number
      failure_count: number
      jitter_count: number
      jitter_sum: number
      max_delay: number | null
      min_delay: number | null
      sample_count: number
      success_count: number
    }[]
    const rowsByBucket = new Map(rows.map((row) => [Number(row.bucket_start), row]))

    return Array.from({ length: bucketCount }, (_, bucketIndex) => {
      const bucketStartMs = windowStartMs + bucketIndex * bucketMs
      const row = rowsByBucket.get(Math.floor(bucketStartMs / 1000))
      const successCount = row ? Number(row.success_count) : 0

      return {
        start: new Date(bucketStartMs).toISOString(),
        end: new Date(bucketStartMs + bucketMs).toISOString(),
        sampleCount: row ? Number(row.sample_count) : 0,
        successCount,
        failureCount: row ? Number(row.failure_count) : 0,
        avgDelay: row && successCount > 0 ? Number(row.delay_sum) / successCount : null,
        minDelay: row?.min_delay === null || row === undefined ? null : Number(row.min_delay),
        maxDelay: row?.max_delay === null || row === undefined ? null : Number(row.max_delay),
        jitter:
          row && Number(row.jitter_count) > 0
            ? Number(row.jitter_sum) / Number(row.jitter_count)
            : null,
      }
    })
  }

  #getNodeRollupJitter(nodeName: string, windowSeconds: number, nowMs: number) {
    const bucketSeconds = windowSeconds === 3_600 ? 60 : windowSeconds === 21_600 ? 300 : 900
    const bucketMs = bucketSeconds * 1000
    const currentBucketStartMs = Math.floor(nowMs / bucketMs) * bucketMs
    const windowEndMs = currentBucketStartMs + bucketMs
    const windowStartMs = windowEndMs - windowSeconds * 1000
    const row = this.#db
      .prepare(
        `
        SELECT
          COALESCE(SUM(jitter_sum), 0) AS jitter_sum,
          COALESCE(SUM(jitter_count), 0) AS jitter_count
        FROM metrics_rollup_buckets
        WHERE node_name = ?
          AND bucket_seconds = ?
          AND bucket_start >= ?
          AND bucket_start < ?
      `,
      )
      .get(
        nodeName,
        bucketSeconds,
        Math.floor(windowStartMs / 1000),
        Math.floor(windowEndMs / 1000),
      ) as { jitter_count: number; jitter_sum: number }

    return Number(row.jitter_count) > 0 ? Number(row.jitter_sum) / Number(row.jitter_count) : null
  }

  getNodeTimelineBundle(nodeName: string, nowMs = Date.now()): ProbeTimelineBundle {
    if (this.getMetricsRollupState().ready) {
      const buildRollupTimeline = (windowSeconds: number, bucketCount: number): ProbeTimeline => ({
        bucketSeconds: windowSeconds / bucketCount,
        buckets: this.#getNodeRollupTimeline(nodeName, windowSeconds, bucketCount, nowMs),
        jitter: this.#getNodeRollupJitter(nodeName, windowSeconds, nowMs),
        windowSeconds,
      })

      return {
        '6h': buildRollupTimeline(
          TIMELINE_BUNDLE_PROFILES['6h'].windowSeconds,
          TIMELINE_BUNDLE_PROFILES['6h'].bucketCount,
        ),
        '24h': buildRollupTimeline(
          TIMELINE_BUNDLE_PROFILES['24h'].windowSeconds,
          TIMELINE_BUNDLE_PROFILES['24h'].bucketCount,
        ),
      }
    }

    const normalizedNowMs = Math.floor(nowMs / 1000) * 1000
    const earliestWindowStart = new Date(
      normalizedNowMs - TIMELINE_BUNDLE_PROFILES['24h'].windowSeconds * 1000,
    ).toISOString()
    const now = new Date(nowMs).toISOString()
    const rows = this.#db
      .prepare(
        `
        SELECT id, timestamp, success, delay
        FROM probe_samples
        WHERE node_name = ?
          AND timestamp >= ?
          AND timestamp <= ?
        ORDER BY timestamp ASC, id ASC
      `,
      )
      .all(nodeName, earliestWindowStart, now) as ProbeTimelineBundleRow[]

    return {
      '6h': buildTimelineFromRows(
        rows,
        TIMELINE_BUNDLE_PROFILES['6h'].windowSeconds,
        TIMELINE_BUNDLE_PROFILES['6h'].bucketCount,
        nowMs,
      ),
      '24h': buildTimelineFromRows(
        rows,
        TIMELINE_BUNDLE_PROFILES['24h'].windowSeconds,
        TIMELINE_BUNDLE_PROFILES['24h'].bucketCount,
        nowMs,
      ),
    }
  }

  getNodeJitter(nodeName: string, windowSeconds: number, nowMs = Date.now()) {
    if (this.#canUseMetricsRollups(windowSeconds)) {
      return this.#getNodeRollupJitter(nodeName, windowSeconds, nowMs)
    }

    const windowStart = new Date(nowMs - windowSeconds * 1000).toISOString()
    const now = new Date(nowMs).toISOString()
    const row = this.#db
      .prepare(
        `
        WITH successful_samples AS (
          SELECT
            delay,
            LAG(delay) OVER (ORDER BY timestamp ASC, id ASC) AS previous_delay
          FROM probe_samples
          WHERE node_name = ?
            AND timestamp >= ?
            AND timestamp <= ?
            AND success = 1
            AND delay IS NOT NULL
        )
        SELECT AVG(ABS(delay - previous_delay)) AS jitter
        FROM successful_samples
        WHERE previous_delay IS NOT NULL
      `,
      )
      .get(nodeName, windowStart, now) as { jitter: number | null }

    return row.jitter === null ? null : Number(row.jitter)
  }

  getProbeSamplesBetween(
    nodeName: string,
    startMs: number,
    endMs: number,
    limit: number,
  ): ProbeSampleRange {
    const rows = this.#db
      .prepare(
        `
        SELECT node_name, test_url, timestamp, delay, success, error_type
        FROM probe_samples
        WHERE node_name = ?
          AND timestamp >= ?
          AND timestamp < ?
        ORDER BY timestamp ASC, id ASC
        LIMIT ?
      `,
      )
      .all(nodeName, new Date(startMs).toISOString(), new Date(endMs).toISOString(), limit + 1) as {
      delay: number | null
      error_type: string | null
      node_name: string
      success: number
      test_url: string
      timestamp: string
    }[]
    const truncated = rows.length > limit

    return {
      samples: rows.slice(0, limit).map((row): ProbeSample => {
        const success = row.success === 1

        return {
          nodeName: row.node_name,
          testUrl: row.test_url,
          timestamp: row.timestamp,
          delay: row.delay === null ? null : Number(row.delay),
          success,
          ...(success || !row.error_type ? {} : { errorType: row.error_type }),
        }
      }),
      truncated,
    }
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
    const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000
    const cutoff = new Date(cutoffMs).toISOString()
    const cutoffBucketStart = Math.floor(cutoffMs / 1000)
    const result = this.#db.prepare('DELETE FROM probe_samples WHERE timestamp < ?').run(cutoff)

    this.#db
      .prepare('DELETE FROM metrics_rollup_buckets WHERE bucket_start < ?')
      .run(cutoffBucketStart)

    return Number(result.changes ?? 0)
  }

  transaction<T>(work: () => T) {
    this.#db.exec('BEGIN IMMEDIATE')

    try {
      const result = work()

      this.#db.exec('COMMIT')
      return result
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
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

  #removeLegacyFallbackRoundDuplicates() {
    const fallbackNodes = this.#db
      .prepare(
        `
        SELECT node_name
        FROM nodes
        WHERE lower(replace(replace(COALESCE(type, ''), ' ', ''), '-', '')) = 'fallback'
      `,
      )
      .all() as { node_name: string }[]
    const removeDuplicates = this.#db.prepare(
      `
        WITH ordered AS (
          SELECT
            sample.id,
            sample.timestamp,
            LEAD(sample.timestamp) OVER (
              PARTITION BY sample.test_url
              ORDER BY sample.timestamp, sample.id
            ) AS next_timestamp
          FROM probe_samples AS sample
          WHERE sample.node_name = ?
        )
        DELETE FROM probe_samples
        WHERE id IN (
          SELECT id
          FROM ordered
          WHERE next_timestamp IS NOT NULL
            AND (julianday(next_timestamp) - julianday(timestamp)) * 86400000 <= ?
        )
      `,
    )

    for (const node of fallbackNodes) {
      removeDuplicates.run(node.node_name, FALLBACK_ROUND_WINDOW_MS)
    }
  }

  #refreshMetricsRollupBucket(nodeName: string, bucketSeconds: number, bucketStart: number) {
    const bucketStartMs = bucketStart * 1000
    const bucketEndMs = bucketStartMs + bucketSeconds * 1000
    const bucketStartIso = new Date(bucketStartMs).toISOString()
    const bucketEndIso = new Date(bucketEndMs).toISOString()

    this.#db
      .prepare(
        `
        DELETE FROM metrics_rollup_buckets
        WHERE node_name = ? AND bucket_seconds = ? AND bucket_start = ?
      `,
      )
      .run(nodeName, bucketSeconds, bucketStart)
    this.#db
      .prepare(
        `
        INSERT INTO metrics_rollup_buckets (
          node_name,
          bucket_seconds,
          bucket_start,
          sample_count,
          success_count,
          failure_count,
          delay_sum,
          min_delay,
          max_delay,
          last_success_at,
          last_success_delay,
          last_failure_at,
          jitter_sum,
          jitter_count,
          first_timestamp,
          last_timestamp
        )
        SELECT
          node_name,
          ?,
          ?,
          COUNT(*),
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END),
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END),
          COALESCE(SUM(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay ELSE 0 END), 0),
          MIN(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END),
          MAX(CASE WHEN success = 1 AND delay IS NOT NULL THEN delay END),
          MAX(CASE WHEN success = 1 THEN timestamp END),
          (
            SELECT delay
            FROM probe_samples
            WHERE node_name = ?
              AND timestamp >= ?
              AND timestamp < ?
              AND success = 1
            ORDER BY timestamp DESC, id DESC
            LIMIT 1
          ),
          MAX(CASE WHEN success = 0 THEN timestamp END),
          COALESCE(
            (
              SELECT SUM(ABS(delay - previous_delay))
              FROM (
                SELECT
                  delay,
                  LAG(delay) OVER (ORDER BY timestamp ASC, id ASC) AS previous_delay
                FROM probe_samples
                WHERE node_name = ?
                  AND timestamp >= ?
                  AND timestamp < ?
                  AND success = 1
                  AND delay IS NOT NULL
              )
              WHERE previous_delay IS NOT NULL
            ),
            0
          ),
          COALESCE(
            (
              SELECT COUNT(*)
              FROM (
                SELECT
                  LAG(delay) OVER (ORDER BY timestamp ASC, id ASC) AS previous_delay
                FROM probe_samples
                WHERE node_name = ?
                  AND timestamp >= ?
                  AND timestamp < ?
                  AND success = 1
                  AND delay IS NOT NULL
              )
              WHERE previous_delay IS NOT NULL
            ),
            0
          ),
          MIN(timestamp),
          MAX(timestamp)
        FROM probe_samples
        WHERE node_name = ? AND timestamp >= ? AND timestamp < ?
        GROUP BY node_name
      `,
      )
      .run(
        bucketSeconds,
        bucketStart,
        nodeName,
        bucketStartIso,
        bucketEndIso,
        nodeName,
        bucketStartIso,
        bucketEndIso,
        nodeName,
        bucketStartIso,
        bucketEndIso,
        nodeName,
        bucketStartIso,
        bucketEndIso,
      )
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

  #canUseMetricsRollups(windowSeconds: number) {
    return (
      this.getMetricsRollupState().ready && [3_600, 21_600, 86_400, 604_800].includes(windowSeconds)
    )
  }

  #rollupMetricRows(windowSeconds: number, nowMs: number, nodeName?: string) {
    const bucketSeconds = windowSeconds === 3_600 ? 60 : windowSeconds === 21_600 ? 300 : 900
    const bucketMs = bucketSeconds * 1000
    const currentBucketStartMs = Math.floor(nowMs / bucketMs) * bucketMs
    const windowEndMs = currentBucketStartMs + bucketMs
    const windowStartMs = windowEndMs - windowSeconds * 1000
    const nodeClause = nodeName ? 'AND node_name = ?' : ''
    const parameters: (number | string)[] = [
      bucketSeconds,
      Math.floor(windowStartMs / 1000),
      Math.floor(windowEndMs / 1000),
    ]

    if (nodeName) parameters.push(nodeName)
    parameters.push(bucketSeconds, Math.floor(windowStartMs / 1000), Math.floor(windowEndMs / 1000))

    return this.#db
      .prepare(
        `
        WITH aggregated AS (
          SELECT
            node_name,
            MIN(first_timestamp) AS first_timestamp,
            MAX(last_timestamp) AS last_timestamp,
            SUM(sample_count) AS sample_count,
            SUM(success_count) AS success_count,
            SUM(failure_count) AS failure_count,
            CASE
              WHEN SUM(success_count) > 0 THEN SUM(delay_sum) / SUM(success_count)
              ELSE NULL
            END AS avg_delay,
            MIN(min_delay) AS min_delay,
            MAX(max_delay) AS max_delay,
            MAX(last_success_at) AS last_success_at,
            MAX(last_failure_at) AS last_failure_at
          FROM metrics_rollup_buckets
          WHERE bucket_seconds = ?
            AND bucket_start >= ?
            AND bucket_start < ?
            ${nodeClause}
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
            SELECT latest.last_success_delay
            FROM metrics_rollup_buckets AS latest
            WHERE latest.node_name = aggregated.node_name
              AND latest.bucket_seconds = ?
              AND latest.bucket_start >= ?
              AND latest.bucket_start < ?
              AND latest.last_success_at IS NOT NULL
            ORDER BY latest.last_success_at DESC, latest.bucket_start DESC
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
