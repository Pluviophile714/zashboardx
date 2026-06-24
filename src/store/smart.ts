import { fetchSmartGroupWeightsAPI, fetchSmartWeightsAPI } from '@/api'
import {
  extractSmartLossMetric,
  type SmartLossMetric,
  type SmartLossMetricByNameMap,
} from '@/helper/smartLossMetrics'
import type { NodeRank } from '@/types'
import { ref } from 'vue'

export const smartWeightsMap = ref<Record<string, Record<string, string>>>({})
export const smartOrderMap = ref<Record<string, Record<string, number>>>({})
export const smartLossMetricsMap = ref<Record<string, Record<string, SmartLossMetric>>>({})
export const smartLossMetricsByNameMap = ref<SmartLossMetricByNameMap>({})

const restructWeights = (proxyName: string, weights: NodeRank[]) => {
  const smartWeights: Record<string, string> = {}
  const smartOrder: Record<string, number> = {}
  const smartLossMetrics: Record<string, SmartLossMetric> = {}

  weights.forEach((weight, index) => {
    smartWeights[weight.Name] = weight.Rank
    smartOrder[weight.Name] = index

    const lossMetric = extractSmartLossMetric(weight as unknown as Record<string, unknown>)

    if (lossMetric) {
      smartLossMetrics[weight.Name] = lossMetric
      smartLossMetricsByNameMap.value[weight.Name] = lossMetric
    }
  })

  smartWeightsMap.value[proxyName] = smartWeights
  smartOrderMap.value[proxyName] = smartOrder
  smartLossMetricsMap.value[proxyName] = smartLossMetrics
}

// deprecated
const fetchSmartGroupWeights = async (proxyName: string) => {
  const { data } = await fetchSmartGroupWeightsAPI(proxyName)

  if (!data.weights?.length) return

  restructWeights(proxyName, data.weights)
}

export const initSmartWeights = async (smartGroups: string[]) => {
  const { status, data: smartWeights } = await fetchSmartWeightsAPI()

  smartWeightsMap.value = {}
  smartOrderMap.value = {}
  smartLossMetricsMap.value = {}
  smartLossMetricsByNameMap.value = {}

  if (status !== 200) {
    // deprecated fallback
    smartGroups.forEach((name) => {
      fetchSmartGroupWeights(name)
    })
    return
  }

  for (const [group, weights] of Object.entries(smartWeights.weights)) {
    if (!weights?.length) continue

    restructWeights(group, weights)
  }
}
