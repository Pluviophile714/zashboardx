// 组装层 · proxies 门面。
// 持有两种后端(clash / sing-box native)共用的代理「视图状态」与纯读取 helper,
// 并按后端类型路由到 clash(拉取式)/ singbox(流驱动)的组装实现。
import { isSingboxBackend } from '@/assembly/backend'
import { isSingBoxCore } from '@/assembly/version'
import { NOT_CONNECTED, PROXY_TAB_TYPE, PROXY_TYPE, TEST_URL } from '@/constant'
import { groupTestUrls, independentLatencyTest, speedtestUrl } from '@/store/settings'
import type { Proxy, ProxyProvider } from '@/types'
import { useStorage } from '@vueuse/core'
import { last } from 'lodash'
import { computed, ref } from 'vue'

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
  if (independentLatencyTest.value && !isSingBoxCore.value) {
    const proxyNode = proxyMap.value[proxyName]
    const url = getTestUrl(groupName)

    if (!proxyNode) {
      return []
    }

    if (!proxyNode?.extra) {
      proxyNode.extra = {}
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

interface ProxiesBackend {
  fetchProxies: () => Promise<unknown>
  handlerProxySelect: (proxyGroupName: string, proxyName: string) => Promise<unknown>
  proxyLatencyTest: (
    proxyName: string,
    url?: string,
    timeout?: number,
    groupName?: string,
  ) => Promise<unknown>
  proxyGroupLatencyTest: (proxyGroupName: string) => Promise<unknown>
  allProxiesLatencyTest: () => Promise<unknown>
}

const load = (): Promise<ProxiesBackend> =>
  isSingboxBackend.value ? import('./singbox') : import('./clash')

export const fetchProxies = async () => (await load()).fetchProxies()

export const handlerProxySelect = async (proxyGroupName: string, proxyName: string) =>
  (await load()).handlerProxySelect(proxyGroupName, proxyName)

export const proxyLatencyTest = async (
  proxyName: string,
  url?: string,
  timeout?: number,
  groupName?: string,
) => (await load()).proxyLatencyTest(proxyName, url, timeout, groupName)

export const proxyGroupLatencyTest = async (proxyGroupName: string) =>
  (await load()).proxyGroupLatencyTest(proxyGroupName)

export const allProxiesLatencyTest = async () => (await load()).allProxiesLatencyTest()

// 后端切换 / 登出时丢弃 sing-box 订阅(clash 无需处理)。
export const resetProxies = async () => {
  const m = await import('./singbox')
  m.resetProxies()
}

// 代理集 / smart 权重动作(Clash 专属),经 proxies 域门面暴露给 view 与 store/smart。
export {
  fetchSmartGroupWeightsAPI,
  fetchSmartWeightsAPI,
  flushSmartGroupWeightsAPI,
  proxyProviderHealthCheckAPI,
  updateProxyProviderAPI,
} from '@/api/clash'
