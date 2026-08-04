import type { ProxyMetricsSample, ProxyMetricsTimelineBucket } from '../api/metricsHelper.ts'

export type LatencyStripHistoryItem = {
  delay: number
  time?: string
}

type ResolveLatencyStripHistoryOptions = {
  mode: 'recent' | 'bucket'
  recent: LatencyStripHistoryItem[]
  bucket: LatencyStripHistoryItem[]
}

const formatBucketTime = (timestamp: string) => {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${hours}:${minutes}`
}

export const mapLatencyBucketSamplesToHistory = (
  samples: ProxyMetricsSample[],
  notConnected = 0,
): LatencyStripHistoryItem[] =>
  samples.map((sample) => ({
    delay: sample.success && sample.delay !== null ? sample.delay : notConnected,
    time: sample.timestamp,
  }))

export const resolveLatencyStripHistory = ({
  mode,
  recent,
  bucket,
}: ResolveLatencyStripHistoryOptions) => (mode === 'bucket' ? bucket : recent)

export const formatLatencyBucketTitle = (
  bucket: Pick<ProxyMetricsTimelineBucket, 'start' | 'end'>,
  recordCount: number,
) =>
  `${formatBucketTime(bucket.start)} - ${formatBucketTime(bucket.end)} · ${recordCount} ${
    recordCount === 1 ? 'record' : 'records'
  }`
