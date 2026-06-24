import { fetchSmartGroupWeightsAPI, fetchSmartWeightsAPI } from '@/assembly/proxies'
import {
  extractSmartLossMetric,
  type SmartLossMetric,
  type SmartLossMetricByNameMap,
} from '@/helper/smartLossMetrics'
import type { NodeRank } from '@/types'
import { shallowRef } from 'vue'

type SmartWeightsMap = Record<string, Record<string, string>>
type SmartOrderMap = Record<string, Record<string, number>>
type SmartLossMetricsMap = Record<string, Record<string, SmartLossMetric>>

export const smartWeightsMap = shallowRef<SmartWeightsMap>({})
export const smartOrderMap = shallowRef<SmartOrderMap>({})
export const smartLossMetricsMap = shallowRef<SmartLossMetricsMap>({})
export const smartLossMetricsByNameMap = shallowRef<SmartLossMetricByNameMap>({})

const buildSmartGroupMaps = (weights: NodeRank[]) => {
  const smartWeights: Record<string, string> = {}
  const smartOrder: Record<string, number> = {}
  const smartLossMetrics: Record<string, SmartLossMetric> = {}
  const smartLossMetricsByName: SmartLossMetricByNameMap = {}

  weights.forEach((weight, index) => {
    smartWeights[weight.Name] = weight.Rank
    smartOrder[weight.Name] = index

    const lossMetric = extractSmartLossMetric(weight as unknown as Record<string, unknown>)

    if (lossMetric) {
      smartLossMetrics[weight.Name] = lossMetric
      smartLossMetricsByName[weight.Name] = lossMetric
    }
  })

  return {
    smartLossMetrics,
    smartLossMetricsByName,
    smartOrder,
    smartWeights,
  }
}

// deprecated
const fetchSmartGroupWeights = async (proxyName: string) => {
  const { data } = await fetchSmartGroupWeightsAPI(proxyName)

  if (!data.weights?.length) return null

  const maps = buildSmartGroupMaps(data.weights)

  return { proxyName, ...maps }
}

export const initSmartWeights = async (smartGroups: string[]) => {
  const { status, data: smartWeights } = await fetchSmartWeightsAPI()

  const nextSmartWeightsMap: SmartWeightsMap = {}
  const nextSmartOrderMap: SmartOrderMap = {}
  const nextSmartLossMetricsMap: SmartLossMetricsMap = {}
  const nextSmartLossMetricsByNameMap: SmartLossMetricByNameMap = {}

  if (status !== 200) {
    // deprecated fallback
    const groupMaps = await Promise.all(smartGroups.map((name) => fetchSmartGroupWeights(name)))

    groupMaps.forEach((maps) => {
      if (!maps) return

      nextSmartWeightsMap[maps.proxyName] = maps.smartWeights
      nextSmartOrderMap[maps.proxyName] = maps.smartOrder
      nextSmartLossMetricsMap[maps.proxyName] = maps.smartLossMetrics
      Object.assign(nextSmartLossMetricsByNameMap, maps.smartLossMetricsByName)
    })

    smartWeightsMap.value = nextSmartWeightsMap
    smartOrderMap.value = nextSmartOrderMap
    smartLossMetricsMap.value = nextSmartLossMetricsMap
    smartLossMetricsByNameMap.value = nextSmartLossMetricsByNameMap
    return
  }

  for (const [group, weights] of Object.entries(smartWeights.weights)) {
    if (!weights?.length) continue

    const maps = buildSmartGroupMaps(weights)

    nextSmartWeightsMap[group] = maps.smartWeights
    nextSmartOrderMap[group] = maps.smartOrder
    nextSmartLossMetricsMap[group] = maps.smartLossMetrics
    Object.assign(nextSmartLossMetricsByNameMap, maps.smartLossMetricsByName)
  }

  smartWeightsMap.value = nextSmartWeightsMap
  smartOrderMap.value = nextSmartOrderMap
  smartLossMetricsMap.value = nextSmartLossMetricsMap
  smartLossMetricsByNameMap.value = nextSmartLossMetricsByNameMap
}
