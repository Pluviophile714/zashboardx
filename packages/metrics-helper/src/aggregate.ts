import type { NodeMetrics, ProbeSample } from './types.js'

const emptyMetrics = (): NodeMetrics => ({
  availability: null,
  coverageSeconds: 0,
  sampleCount: 0,
  successCount: 0,
  failureCount: 0,
  avgDelay: null,
  minDelay: null,
  maxDelay: null,
  lastDelay: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lossRate: null,
  lossSource: null,
})

export const aggregateNodeMetrics = (
  samples: ProbeSample[],
  nowMs = Date.now(),
  windowSeconds = 24 * 60 * 60,
): NodeMetrics => {
  const windowStart = nowMs - windowSeconds * 1000
  const windowSamples = samples
    .filter((sample) => {
      const timestamp = Date.parse(sample.timestamp)

      return Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= nowMs
    })
    .sort((prev, next) => Date.parse(prev.timestamp) - Date.parse(next.timestamp))

  if (!windowSamples.length) {
    return emptyMetrics()
  }

  const successSamples = windowSamples.filter((sample) => sample.success)
  const successDelaySamples = successSamples.filter(
    (sample): sample is ProbeSample & { delay: number } =>
      typeof sample.delay === 'number' && Number.isFinite(sample.delay),
  )
  const firstTimestamp = Date.parse(windowSamples[0].timestamp)
  const lastTimestamp = Date.parse(windowSamples[windowSamples.length - 1].timestamp)
  const successCount = successSamples.length
  const failureCount = windowSamples.length - successCount
  const delaySum = successDelaySamples.reduce((sum, sample) => sum + sample.delay, 0)
  const lastSuccess = [...successSamples].reverse()[0]
  const lastFailure = [...windowSamples].reverse().find((sample) => !sample.success)

  return {
    availability: successCount / windowSamples.length,
    coverageSeconds: Math.max(0, Math.round((lastTimestamp - firstTimestamp) / 1000)),
    sampleCount: windowSamples.length,
    successCount,
    failureCount,
    avgDelay: successDelaySamples.length ? Math.round(delaySum / successDelaySamples.length) : null,
    minDelay: successDelaySamples.length
      ? Math.min(...successDelaySamples.map((sample) => sample.delay))
      : null,
    maxDelay: successDelaySamples.length
      ? Math.max(...successDelaySamples.map((sample) => sample.delay))
      : null,
    lastDelay:
      lastSuccess && typeof lastSuccess.delay === 'number' && Number.isFinite(lastSuccess.delay)
        ? lastSuccess.delay
        : null,
    lastSuccessAt: lastSuccess?.timestamp ?? null,
    lastFailureAt: lastFailure?.timestamp ?? null,
    lossRate: null,
    lossSource: null,
  }
}
