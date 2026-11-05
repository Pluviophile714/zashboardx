// 组装层 · proxies 门面。
// 持有代理的「视图状态」与纯读取 helper,拉取与动作转交 clash 组装实现。
import { useStorage } from '@/composables/use-storage'
import { NOT_CONNECTED } from '@/constant'
import { notifyRequestError } from '@/helper/request-error'
import type { Proxy } from '@/types'
import * as clash from './clash'
import { getHistoryByName, getTestUrl, proxyMap } from './state'
export { flushSmartGroupWeights, proxyProviderHealthCheck, updateProxyProvider } from './actions'
export {
  smartLossMetricsByNameMap,
  smartLossMetricsMap,
  smartOrderMap,
  smartWeightsMap,
} from './smart'
export type { LatencyMap } from './state'

export { hiddenGroupMap, proxiesFilter, proxiesTabShow } from '@/store/proxies'
export {
  getHistoryByName,
  getIPv6ByName,
  getLatencyByName,
  getLatencyFromHistory,
  getNowProxyNodeName,
  getProviderNameByProxy,
  getProxyGroupChains,
  getTestUrl,
  hasSmartGroup,
  isLatencyTestable,
  latencyMapOf,
  proxyGroupList,
  proxyMap,
  proxyProviederList,
  speedtestUrlWithDefault,
} from './state'

export { IPv6Map } from './state'
const latencyHistoryCache = useStorage<Record<string, Proxy['history']>>(
  'cache/proxy-latency-history',
  {},
)

const getLatencyHistoryCacheKey = (proxyName: string, groupName?: string) => {
  return `${proxyName}\n${getTestUrl(groupName)}`
}

export const hasDisplayHistoryByName = (proxyName: string, groupName?: string) => {
  const cachedHistory = latencyHistoryCache.value[getLatencyHistoryCacheKey(proxyName, groupName)]

  if (cachedHistory?.length) {
    return true
  }

  return !!getHistoryByName(proxyName, groupName)?.length
}

const coalesceLatencyHistory = (history: Proxy['history']) => {
  const byTime = new Map<string, Proxy['history'][number]>()

  for (const item of history) {
    if (!item?.time) continue

    const previous = byTime.get(item.time)

    if (!previous) {
      byTime.set(item.time, item)
      continue
    }

    if (previous.delay <= NOT_CONNECTED || item.delay <= NOT_CONNECTED) {
      byTime.set(item.time, {
        ...item,
        delay: NOT_CONNECTED,
      })
      continue
    }

    byTime.set(item.time, item.delay >= previous.delay ? item : previous)
  }

  return [...byTime.values()].sort((prev, next) => Date.parse(prev.time) - Date.parse(next.time))
}

export const getDisplayHistoryByName = (proxyName: string, groupName?: string, limit = 30) => {
  const key = getLatencyHistoryCacheKey(proxyName, groupName)
  const cachedHistory = latencyHistoryCache.value[key] ?? []
  const currentHistory = getHistoryByName(proxyName, groupName) ?? []

  if (!currentHistory.length) {
    return cachedHistory.slice(-limit)
  }

  const merged = coalesceLatencyHistory([...cachedHistory, ...currentHistory])
    .filter((item) => item?.time)
    .slice(-limit)

  latencyHistoryCache.value[key] = merged

  return merged
}

export const getDirectChildProxyGroups = (groupName: string) => {
  return (proxyMap.value[groupName]?.all ?? []).filter((name) => {
    return Boolean(proxyMap.value[name]?.all?.length)
  })
}

export const getDescendantProxyGroups = (groupName: string) => {
  const descendants: string[] = []
  const visited = new Set<string>([groupName])

  const walk = (name: string) => {
    getDirectChildProxyGroups(name).forEach((childGroupName) => {
      if (visited.has(childGroupName)) {
        return
      }

      visited.add(childGroupName)
      descendants.push(childGroupName)
      walk(childGroupName)
    })
  }

  walk(groupName)

  return descendants
}

// ---------- 按后端路由的组装动作 ----------

export const fetchProxies = () => clash.fetchProxies()

// 切换节点只会由用户点击触发,且调用点都是模板里的 @click(没有 catch 的落点),
// 所以在门面里兜住:失败弹提示,否则 UI 会停在旧选择上一声不吭。
export const handlerProxySelect = async (proxyGroupName: string, proxyName: string) => {
  try {
    return await clash.handlerProxySelect(proxyGroupName, proxyName)
  } catch (e) {
    notifyRequestError(e)
  }
}

export const proxyLatencyTest = (proxyName: string, url?: string, timeout?: number) =>
  clash.proxyLatencyTest(proxyName, url, timeout)

export const proxyGroupLatencyTest = (proxyGroupName: string) =>
  clash.proxyGroupLatencyTest(proxyGroupName)

export const allProxiesLatencyTest = () => clash.allProxiesLatencyTest()

// 代理集 / smart 权重动作(Clash 专属),经 proxies 域门面暴露给 view 与 store/smart。
export {
  fetchSmartGroupWeightsAPI,
  fetchSmartWeightsAPI,
  flushSmartGroupWeightsAPI,
  proxyProviderHealthCheckAPI,
  updateProxyProviderAPI,
} from '@/api/clash'
