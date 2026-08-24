// 组装层 · proxies 门面。
// 持有代理的「视图状态」与纯读取 helper,拉取与动作转交 clash 组装实现。
import { can } from '@/assembly/backend'
import { NOT_CONNECTED, PROXY_TAB_TYPE, PROXY_TYPE, TEST_URL } from '@/constant'
import { notifyRequestError } from '@/helper/requestError'
import { useStorage } from '@/helper/storage'
import { groupTestUrls, independentLatencyTest, speedtestUrl } from '@/store/settings'
import type { Proxy, ProxyProvider } from '@/types'
import { last } from 'lodash'
import { computed, ref } from 'vue'
import * as clash from './clash'

export const proxiesFilter = ref('')
export const proxiesTabShow = ref(PROXY_TAB_TYPE.PROXIES)

export const proxyGroupList = ref<string[]>([])
export const proxyMap = ref<Record<string, Proxy>>({})
export const IPv6Map = useStorage<Record<string, boolean>>('cache/ipv6-map', {})
export const hiddenGroupMap = useStorage<Record<string, boolean>>('config/hidden-group-map', {})
export const proxyProviederList = ref<ProxyProvider[]>([])
const latencyHistoryCache = useStorage<Record<string, Proxy['history']>>(
  'cache/proxy-latency-history',
  {},
)

export const speedtestUrlWithDefault = computed(() => {
  return speedtestUrl.value || TEST_URL
})

export const getTestUrl = (groupName?: string) => {
  if (!groupName || !independentLatencyTest.value) {
    return speedtestUrlWithDefault.value
  }

  const groupTestUrl = groupTestUrls.value.find((item) => item.name === groupName)

  if (groupTestUrl) {
    return groupTestUrl.url
  }

  const proxyNode =
    proxyMap.value[groupName] || proxyProviederList.value.find((p) => p.name === groupName)

  return proxyNode?.testUrl || speedtestUrlWithDefault.value
}

export const getLatencyFromHistory = (history: Proxy['history']) => {
  return last(history)?.delay ?? NOT_CONNECTED
}

export const getLatencyByName = (proxyName: string, groupName?: string) => {
  const history = getHistoryByName(proxyName, groupName)

  return getLatencyFromHistory(history)
}

export const getHistoryByName = (proxyName: string, groupName?: string) => {
  if (groupName && independentLatencyTest.value && can('independentLatency')) {
    const proxyNode = proxyMap.value[proxyName]
    const url = getTestUrl(groupName)

    if (!proxyNode) {
      return []
    }

    if (!proxyNode?.extra) {
      const nowNode = proxyMap.value[getNowProxyNodeName(proxyName)]

      return nowNode?.history
    }

    if (!proxyNode.extra?.[url]) {
      proxyNode.extra[url] = {
        history: [],
        alive: true,
      }
    }

    return proxyNode?.extra?.[url]?.history
  }

  const nowNode = proxyMap.value[getNowProxyNodeName(proxyName)]

  return nowNode?.history
}

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

export const getIPv6ByName = (proxyName: string) => {
  return IPv6Map.value[getNowProxyNodeName(proxyName)]
}

export const getNowProxyNodeName = (name: string) => {
  let node = proxyMap.value[name]

  if (!name || !node) {
    return name
  }

  while (node.now && node.now !== node.name) {
    const nextNode = proxyMap.value[node.now]

    if (!nextNode) {
      return node.name
    }

    node = nextNode
  }

  return node.name
}

export const getProxyGroupChains = (name: string) => {
  let proxyNode = proxyMap.value[name]

  if (!proxyNode) {
    return []
  }

  const result = [name]

  while (
    proxyNode.now &&
    proxyNode.now !== proxyNode.name &&
    proxyGroupList.value.includes(proxyNode.now)
  ) {
    result.push(proxyNode.now)
    proxyNode = proxyMap.value[proxyNode.now]
  }
  return result
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

export const hasSmartGroup = computed(() => {
  return Object.values(proxyMap.value).some(
    (proxy) => proxy.type.toLowerCase() === PROXY_TYPE.Smart,
  )
})

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
