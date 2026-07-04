export type LossSource = 'official' | 'probe' | 'log-inferred'

export type ProbeSample = {
  nodeName: string
  testUrl: string
  timestamp: string
  delay: number | null
  success: boolean
  errorType?: string
}

export type DiscoveredProxyNode = {
  name: string
  type: string | null
}

export type NodeMetrics = {
  availability: number | null
  coverageSeconds: number
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
