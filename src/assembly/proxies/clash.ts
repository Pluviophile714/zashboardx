// Clash REST/WS 后端的代理「组装逻辑」:从 /proxies、/providers/proxies 拉取并
// 组装视图状态,以及选择/测速等动作。写入门面 index.ts 的共享状态。
import {
  deleteFixedProxyAPI,
  fetchProxiesAPI,
  fetchProxyGroupLatencyAPI,
  fetchProxyLatencyAPI,
  fetchProxyProviderAPI,
  fetchProxyProviderLatencyAPI,
  selectProxyAPI,
} from '@/api/clash'
import { postProxyMetricsSamplesAPI } from '@/api/metricsHelper'
import { disconnectByIdAPI } from '@/assembly/connections'
import { GLOBAL, IPV6_TEST_URL, NOT_CONNECTED, PROXY_TYPE, SPEEDTEST_MODE } from '@/constant'
import { getConnectionChains, isProxyGroup } from '@/helper'
import { showNotification } from '@/helper/notification'
import { activeConnections } from '@/store/connections'
import {
  automaticDisconnection,
  iconReflectList,
  independentLatencyTest,
  IPv6test,
  speedtestMode,
  speedtestTimeout,
} from '@/store/settings'
import { initSmartWeights } from '@/store/smart'
import type { Proxy } from '@/types'
import { last } from 'lodash'
import pLimit from 'p-limit'
import {
  getHistoryByName,
  getLatencyByName,
  getNowProxyNodeName,
  getTestUrl,
  IPv6Map,
  proxyGroupList,
  proxyMap,
  proxyProviederList,
  speedtestUrlWithDefault,
} from './index'

let fetchTime = 0

export const fetchProxies = async () => {
  const nowTime = Date.now()

  fetchTime = nowTime

  const [proxyRes, providerRes] = await Promise.all([fetchProxiesAPI(), fetchProxyProviderAPI()])
  const proxyData = proxyRes.data
  const providerData = providerRes.data

  if (fetchTime !== nowTime) {
    return
  }

  const sortIndex = proxyData.proxies[GLOBAL]?.all ?? []
  const allProviderProxies: Record<string, Proxy> = {}
  const providers = Object.values(providerData.providers).filter(
    (provider) => provider.name !== 'default' && provider.vehicleType !== 'Compatible',
  )

  for (const provider of providers) {
    for (const proxy of provider.proxies) {
      proxy['provider-name'] ||= provider.name
      allProviderProxies[proxy.name] = proxy
    }
  }

  proxyMap.value = {
    ...allProviderProxies,
    ...proxyData.proxies,
  }
  proxyGroupList.value = Object.values(proxyData.proxies)
    .filter((proxy) => proxy.all?.length && proxy.name !== GLOBAL)
    .sort((prev, next) => {
      const prevIndex = sortIndex.indexOf(prev.name)
      const nextIndex = sortIndex.indexOf(next.name)

      if (prevIndex === -1 && nextIndex === -1) {
        return 0
      }
      if (prevIndex === -1) {
        return 1
      }
      if (nextIndex === -1) {
        return -1
      }
      // 都在 sortIndex 中，按索引排序
      return prevIndex - nextIndex
    })
    .map((proxy) => proxy.name)

  proxyProviederList.value = providers

  const smartGroups: string[] = []

  Object.entries(proxyMap.value).forEach(([name, proxy]) => {
    const iconReflect = iconReflectList.value.find((icon) => icon.name === name)

    if (iconReflect) {
      proxyMap.value[name].icon = iconReflect.icon
    }
    if (IPv6test.value && getIPv6FromExtra(proxy)) {
      IPv6Map.value[name] = true
    }

    if (proxy.type.toLowerCase() === PROXY_TYPE.Smart) {
      smartGroups.push(name)
    }
  })

  if (smartGroups.length > 0) {
    void initSmartWeights(smartGroups)
  }
}

export const handlerProxySelect = async (proxyGroupName: string, proxyName: string) => {
  const proxyGroup = proxyMap.value[proxyGroupName]

  if (proxyGroup.type.toLowerCase() === PROXY_TYPE.LoadBalance) return
  if (proxyGroup.now === proxyName) {
    await fetchProxies()
    if (proxyGroup.now === proxyName) return
  }

  await selectProxyAPI(proxyGroupName, proxyName)
  proxyMap.value[proxyGroupName].now = proxyName

  if (automaticDisconnection.value) {
    activeConnections.value
      .filter((c) => getConnectionChains(c).includes(proxyGroupName))
      .forEach((c) => disconnectByIdAPI(c.id))
  }
  fetchProxies()
}

const getProviderNameByProxy = (proxyName: string) => {
  const hinted = proxyMap.value[proxyName]?.['provider-name']

  if (hinted) {
    return proxyProviederList.value.some((provider) => provider.name === hinted) ? hinted : ''
  }

  return (
    proxyProviederList.value.find((provider) =>
      provider.proxies.some((proxy) => proxy.name === proxyName),
    )?.name ?? ''
  )
}

// provider 节点走 provider 作用域的 healthcheck 端点,避免节点不在
// 全局 /proxies 映射(或同名冲突)导致测速失败
const fetchNodeLatency = (proxyName: string, url: string, timeout: number) => {
  const providerName = getProviderNameByProxy(proxyName)

  if (providerName) {
    return fetchProxyProviderLatencyAPI(providerName, proxyName, url, timeout)
  }

  return fetchProxyLatencyAPI(proxyName, url, timeout)
}

const latencyTestForSingle = async (proxyName: string, url: string, timeout: number) => {
  const now = getNowProxyNodeName(proxyName)

  if (IPv6test.value) {
    try {
      const { data: ipv6LatencyResult } = await fetchNodeLatency(now, IPV6_TEST_URL, 2000)

      IPv6Map.value[now] = ipv6LatencyResult.delay > NOT_CONNECTED
    } catch {
      IPv6Map.value[now] = false
    }
  }

  return await fetchNodeLatency(independentLatencyTest.value ? proxyName : now, url, timeout)
}

const getLatencyTestTargetName = (proxyName: string) =>
  independentLatencyTest.value ? proxyName : getNowProxyNodeName(proxyName)

const postFrontendLatencySamples = (
  latencyResults: Record<string, number>,
  url: string,
  timestamp = new Date().toISOString(),
) => {
  const samples = Object.entries(latencyResults).map(([proxyName, delay]) => {
    const success = delay > NOT_CONNECTED

    return {
      delay: success ? delay : null,
      errorType: success ? undefined : 'frontend_failed',
      nodeName: getLatencyTestTargetName(proxyName),
      success,
      testUrl: url,
      timestamp,
    }
  })

  if (samples.length > 0) {
    void postProxyMetricsSamplesAPI(samples)
  }
}

const postFrontendLatencySample = (
  proxyName: string,
  url: string,
  delay: number,
  timestamp = new Date().toISOString(),
) => postFrontendLatencySamples({ [proxyName]: delay }, url, timestamp)

const getNameForNotification = (name: string, url: string) => {
  if (independentLatencyTest.value) {
    return `${name}\n@${url}`
  }

  return name
}

export const proxyLatencyTest = async (
  proxyName: string,
  url = speedtestUrlWithDefault.value,
  timeout = speedtestTimeout.value,
) => {
  const res = await latencyTestForSingle(proxyName, url, timeout)
  postFrontendLatencySample(proxyName, url, res.status === 200 ? res.data.delay : NOT_CONNECTED)
  await fetchProxies()

  if (res.status !== 200) {
    showNotification({
      content: 'testFailedTip',
      params: {
        name: getNameForNotification(proxyName, url),
      },
      type: 'alert-error',
    })
  }
}

const setHistory = (proxyName: string, delay: number, url = speedtestUrlWithDefault.value) => {
  const history = getHistoryByName(proxyName)
  const now = new Date()
  const timestamp = now.toISOString()

  history.push({
    time: timestamp,
    delay,
  })
  postFrontendLatencySample(proxyName, url, delay, timestamp)
}

const TIP_KEY = 'testLatencyOneByOneWithTip'
const limiter = pLimit(5)
const testLatencyOneByOneWithTip = async (
  proxyGroupName: string,
  nodes: string[],
  url = speedtestUrlWithDefault.value,
) => {
  const total = nodes.length
  let testDone = 0
  let testFailed = 0

  await Promise.allSettled(
    nodes.map((name) =>
      limiter(async () => {
        const res = await latencyTestForSingle(name, url, Math.min(2000, speedtestTimeout.value))

        if (res.status !== 200) {
          testFailed++
          setHistory(name, NOT_CONNECTED, url)
        } else {
          setHistory(name, res.data.delay, url)
        }
        testDone++
        showNotification({
          content: 'testFinishedTip',
          key: TIP_KEY + proxyGroupName,
          params: {
            name: getNameForNotification(proxyGroupName, url),
            total: total.toString(),
            number: testDone.toString(),
          },
          type: 'alert-info',
          timeout: 0,
        })
      }),
    ),
  )
  showNotification({
    content: 'testFinishedResultTip',
    key: TIP_KEY + proxyGroupName,
    params: {
      name: getNameForNotification(proxyGroupName, url),
      total: total.toString(),
      success: `${total - testFailed}`,
      failed: `${testFailed}`,
    },
    type: testFailed ? 'alert-warning' : 'alert-success',
    timeout: 3000,
  })
}

export const proxyGroupLatencyTest = async (proxyGroupName: string) => {
  const proxyNode = proxyMap.value[proxyGroupName]
  const all = proxyNode.all ?? []
  const url = getTestUrl(proxyGroupName)

  if (
    speedtestMode.value === SPEEDTEST_MODE.DASHBOARD &&
    [PROXY_TYPE.Selector, PROXY_TYPE.LoadBalance, PROXY_TYPE.Smart].includes(
      proxyNode.type.toLowerCase() as PROXY_TYPE,
    )
  ) {
    if (proxyNode.fixed) {
      deleteFixedProxyAPI(proxyGroupName)
    }
    return testLatencyOneByOneWithTip(proxyGroupName, all, url)
  }

  const timeout = Math.max(5000, speedtestTimeout.value)

  if (IPv6test.value) {
    try {
      const { data: ipv6LatencyResult } = await fetchProxyGroupLatencyAPI(
        proxyGroupName,
        IPV6_TEST_URL,
        timeout,
      )

      all?.forEach((name) => {
        IPv6Map.value[getNowProxyNodeName(name)] = ipv6LatencyResult[name] > NOT_CONNECTED
      })
    } catch {
      all?.forEach((name) => {
        IPv6Map.value[getNowProxyNodeName(name)] = false
      })
    }
  }
  const { data: latencyResult } = await fetchProxyGroupLatencyAPI(proxyGroupName, url, timeout)
  postFrontendLatencySamples(latencyResult, url)
  await fetchProxies()

  const total = all.length
  const testFailed = all.filter(
    (name) => getLatencyByName(name, proxyGroupName) === NOT_CONNECTED,
  ).length

  showNotification({
    content: 'testFinishedResultTip',
    key: TIP_KEY + proxyGroupName,
    params: {
      name: getNameForNotification(proxyGroupName, url),
      total: total.toString(),
      success: `${total - testFailed}`,
      failed: `${testFailed}`,
    },
    type: testFailed ? 'alert-warning' : 'alert-success',
    timeout: 3000,
  })
}

export const allProxiesLatencyTest = async () => {
  if (independentLatencyTest.value) {
    const limit = pLimit(3)

    return await Promise.all(
      proxyGroupList.value.map((proxyGroupName) =>
        limit(async () => {
          await proxyGroupLatencyTest(proxyGroupName)
        }),
      ),
    )
  }

  const proxyNode = Object.keys(proxyMap.value).filter((proxy) => !isProxyGroup(proxy))

  return testLatencyOneByOneWithTip('all', proxyNode)
}

const getIPv6FromExtra = (proxy: Proxy) => {
  const ipv6History = proxy.extra?.[IPV6_TEST_URL]?.history

  return (last(ipv6History)?.delay ?? NOT_CONNECTED) > NOT_CONNECTED
}
