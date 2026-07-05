export type MetricsHelperConfig = {
  mihomoBaseUrl: string
  mihomoSecret: string
  bindHost: string
  port: number
  probeIntervalSeconds: number
  probeConcurrency: number
  probeTimeoutMs: number
  probeTestUrl: string
  probeWindowHours: number
  retentionDays: number
  databasePath: string
}

const parseInteger = (value: string | undefined, fallback: number, min: number) => {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback
  }

  return parsed
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): MetricsHelperConfig => ({
  mihomoBaseUrl: env.MIHOMO_BASE_URL || 'http://127.0.0.1:9090',
  mihomoSecret: env.MIHOMO_SECRET || '',
  bindHost: env.METRICS_BIND_HOST || '0.0.0.0',
  port: parseInteger(env.METRICS_PORT, 8787, 1),
  probeIntervalSeconds: parseInteger(
    env.SCRAPE_INTERVAL_SECONDS ?? env.PROBE_INTERVAL_SECONDS,
    30,
    30,
  ),
  probeConcurrency: parseInteger(env.PROBE_CONCURRENCY, 8, 1),
  probeTimeoutMs: parseInteger(env.PROBE_TIMEOUT_MS, 5000, 500),
  probeTestUrl: env.PROBE_TEST_URL || 'https://www.gstatic.com/generate_204',
  probeWindowHours: parseInteger(env.PROBE_WINDOW_HOURS, 24, 1),
  retentionDays: parseInteger(env.METRICS_RETENTION_DAYS, 7, 1),
  databasePath: env.METRICS_DATABASE_PATH || '/data/metrics.sqlite',
})
