import { activeConnections } from '@/assembly/connections'
import { proxyMap } from '@/assembly/proxies'
import { smartOrderMap, smartWeightsMap } from '@/assembly/proxies/smart'
import { PROXY_TYPE } from '@/constant'
import { getConnectionChains, getConnectionStart } from '@/helper'

export const getTopSmartNode = (groupName: string) => {
  const group = proxyMap.value[groupName]

  if (group?.type.toLowerCase() !== PROXY_TYPE.Smart) return ''

  const order = smartOrderMap.value[groupName]

  if (order) {
    const entries = Object.entries(order)

    if (entries.length) {
      entries.sort((a, b) => a[1] - b[1])
      return entries[0][0]
    }
  }

  const weights = smartWeightsMap.value[groupName]

  if (!weights) return ''

  const entries = Object.entries(weights)

  if (!entries.length) return ''

  entries.sort((a, b) => Number(b[1]) - Number(a[1]))
  return entries[0][0]
}

export const getActiveConnectionOutbound = (groupName: string) => {
  const connections = activeConnections.value
    .filter((connection) => {
      const chains = getConnectionChains(connection)

      return chains.includes(groupName) && chains[0]
    })
    .sort((a, b) => {
      const speedDiff = b.downloadSpeed + b.uploadSpeed - (a.downloadSpeed + a.uploadSpeed)

      if (speedDiff) return speedDiff

      return Number(getConnectionStart(b)) - Number(getConnectionStart(a))
    })

  const chains = connections[0] ? getConnectionChains(connections[0]) : []

  return chains[0] ?? ''
}

export const getSmartOutbound = (groupName: string) => {
  const group = proxyMap.value[groupName]

  if (group?.type.toLowerCase() !== PROXY_TYPE.Smart) return ''

  return getActiveConnectionOutbound(groupName) || getTopSmartNode(groupName)
}
