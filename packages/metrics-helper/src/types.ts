export type LossSource = 'official' | 'probe' | 'log-inferred'

export type ProbeSample = {
  nodeName: string
  testUrl: string
  timestamp: string
  delay: number | null
  success: boolean
  errorType?: string
}

export type ProbeSampleRange = {
  samples: ProbeSample[]
  truncated: boolean
}

export type ProbeTimelineBucket = {
  start: string
  end: string
  sampleCount: number
  successCount: number
  failureCount: number
  avgDelay: number | null
  minDelay: number | null
  maxDelay: number | null
  jitter: number | null
}

export type DiscoveredProxyNode = {
  name: string
  type: string | null
  historySamples?: ProbeSample[]
  probeable?: boolean
}

export type NodeMetrics = {
  availability: number | null
  coverageSeconds: number
  firstSampleAt: string | null
  lastSampleAt: string | null
  sampleCount: number
  successCount: number
  failureCount: number
  avgDelay: number | null
  minDelay: number | null
  maxDelay: number | null
  lastDelay: number | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lossRate: number | null
  lossSource: LossSource | null
  recentSamples?: ProbeSample[]
}

export type HelperHealth = {
  ok: boolean
  mihomoReachable: boolean
  running: boolean
  lastProbeAt: string | null
  lastProbeError: string | null
  lastProbeNodeCount: number
  version: string
}
