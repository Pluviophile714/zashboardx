export type SmartLossMetric = {
  current?: number
  cumulative?: number
}

export type SmartLossMetricMap = Record<string, Record<string, SmartLossMetric>>
export type SmartLossMetricByNameMap = Record<string, SmartLossMetric>

type SmartLossMetricSource = Record<string, unknown>

const currentLossKeys = ['LossRate', 'lossRate', 'loss_rate']
const cumulativeLossKeys = ['CumulLossRate', 'cumulLossRate', 'cumul_loss_rate']
const cumulativeSentKeys = ['CumulSent', 'cumulSent', 'cumul_sent']
const cumulativeRetransKeys = ['CumulRetrans', 'cumulRetrans', 'cumul_retrans']

const getFiniteNumber = (source: SmartLossMetricSource, keys: string[]) => {
  for (const key of keys) {
    const value = source[key]
    const numberValue = typeof value === 'number' ? value : Number(value)

    if (Number.isFinite(numberValue) && numberValue >= 0) {
      return numberValue
    }
  }
}

export const extractSmartLossMetric = (
  source: SmartLossMetricSource,
): SmartLossMetric | undefined => {
  const current = getFiniteNumber(source, currentLossKeys)
  let cumulative = getFiniteNumber(source, cumulativeLossKeys)

  if (cumulative === undefined) {
    const sent = getFiniteNumber(source, cumulativeSentKeys)
    const retrans = getFiniteNumber(source, cumulativeRetransKeys)

    if (sent && retrans !== undefined) {
      cumulative = retrans / sent
    }
  }

  const result: SmartLossMetric = {}

  if (current !== undefined) {
    result.current = current
  }
  if (cumulative !== undefined) {
    result.cumulative = cumulative
  }

  return result.current === undefined && result.cumulative === undefined ? undefined : result
}

export const getPrimarySmartLossRate = (metric?: SmartLossMetric) => {
  return metric?.cumulative ?? metric?.current
}

export const resolveSmartLossMetric = (
  metricsByGroup: SmartLossMetricMap,
  metricsByName: SmartLossMetricByNameMap,
  groupName: string | undefined,
  nodeName: string,
) => {
  return (groupName ? metricsByGroup[groupName]?.[nodeName] : undefined) ?? metricsByName[nodeName]
}

export const formatSmartLossRate = (rate?: number) => {
  if (rate === undefined || !Number.isFinite(rate)) {
    return '--'
  }

  return `${(rate * 100).toFixed(2)}%`
}

export const getSmartLossRateClass = (metric?: SmartLossMetric) => {
  const rate = getPrimarySmartLossRate(metric)

  if (rate === undefined) {
    return 'text-base-content/50'
  }
  if (rate < 0.01) {
    return 'text-low-latency'
  }
  if (rate < 0.03) {
    return 'text-medium-latency'
  }

  return 'text-high-latency'
}
