import { isSingBox } from '@/api'
import { GLOBAL, PROXY_TAB_TYPE } from '@/constant'
import { isHiddenGroup } from '@/helper'
import { configs } from '@/store/config'
import {
  getProxyGroupChains,
  proxiesFilter,
  proxiesTabShow,
  proxyGroupList,
  proxyMap,
  proxyProviederList,
} from '@/store/proxies'
import { rules } from '@/store/rules'
import { customGlobalNode, displayGlobalByMode, manageHiddenGroup } from '@/store/settings'
import { isEmpty } from 'lodash'
import { computed, ref } from 'vue'

const matchProxyGroupFilter = (name: string) => {
  const normalizedFilter = proxiesFilter.value.trim()
  if (!normalizedFilter) return true
  try { return new RegExp(normalizedFilter, 'i').test(name) } catch { return true }
}

const filterGroups = (all: string[]) => {
  if (proxiesFilter.value.trim().length) return all.filter(matchProxyGroupFilter)
  if (manageHiddenGroup.value) return all
  return all.filter((name) => !isHiddenGroup(name))
}

const getCurrentProxyGroups = () => {
  if (displayGlobalByMode.value) {
    if (configs.value?.mode.toUpperCase() === GLOBAL) {
      return [
        isSingBox.value && proxyMap.value[customGlobalNode.value] ? customGlobalNode.value : GLOBAL,
      ]
    }
    return filterGroups(proxyGroupList.value)
  }
  return filterGroups([...proxyGroupList.value, GLOBAL])
}

// ─── AnGe group classification ───

const currentGroupSet = computed(() => new Set(getCurrentProxyGroups()))

const ruleProxyNames = computed(() => {
  return new Set(rules.value.map((rule) => rule.proxy))
})

const getChildGroupNames = (name: string, groupSet: Set<string>) => {
  const proxyGroup = proxyMap.value[name]
  if (!proxyGroup?.all?.length) return []
  return proxyGroup.all.filter((member) => groupSet.has(member))
}

const hasDescendantGroup = (
  rootName: string, targetName: string, groupSet: Set<string>,
  visited = new Set<string>(),
): boolean => {
  if (rootName === targetName || visited.has(rootName)) return false
  visited.add(rootName)
  for (const member of getChildGroupNames(rootName, groupSet)) {
    if (member === targetName || hasDescendantGroup(member, targetName, groupSet, visited)) return true
  }
  return false
}

const referencedCurrentGroupNames = computed(() => {
  const referenced = new Set<string>()
  currentGroupSet.value.forEach((name) => {
    if (name === GLOBAL) return
    getChildGroupNames(name, currentGroupSet.value).forEach((m) => referenced.add(m))
  })
  return referenced
})

const fallbackPolicyGroupNames = computed(() => {
  return new Set(getCurrentProxyGroups().filter((n) => !referencedCurrentGroupNames.value.has(n)))
})

const resolvedPolicyGroupNames = computed(() => {
  const direct = [...ruleProxyNames.value].filter((n) => currentGroupSet.value.has(n))
  if (direct.length > 0) {
    const topLevel = direct.filter((name) =>
      !direct.some((c) => c !== name && hasDescendantGroup(c, name, currentGroupSet.value)))
    if (topLevel.length > 0) return new Set(topLevel)
  }
  return fallbackPolicyGroupNames.value
})

const isPolicyGroup = (name: string) => resolvedPolicyGroupNames.value.has(name)

const getRenderGroups = () => {
  if (isEmpty(proxyMap.value)) return []
  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER)
    return proxyProviederList.value.map((g) => g.name)
  const current = getCurrentProxyGroups()
  if (proxiesTabShow.value === PROXY_TAB_TYPE.POLICY) return current.filter(isPolicyGroup)
  if (proxiesTabShow.value === PROXY_TAB_TYPE.NODE) return current.filter((n) => !isPolicyGroup(n))
  return current
}

const limitInitialRender = (names: string[]) =>
  isProxiesPageMounted.value ? names : names.slice(0, 16)

export const disableProxiesPageScroll = ref(false)
export const isProxiesPageMounted = ref(false)
export const policyGroups = computed(() => getCurrentProxyGroups().filter(isPolicyGroup))
export const nodeGroups = computed(() => getCurrentProxyGroups().filter((n) => !isPolicyGroup(n)))
export const renderGroups = computed(() => limitInitialRender(getRenderGroups()))
export const renderProxyGroups = renderGroups
export const renderProxyProviders = computed(() => limitInitialRender(proxyProviederList.value.map((p) => p.name)))
export const renderProxiesPageItems = computed(() => {
  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) return renderProxyProviders.value
  return renderProxyGroups.value
})
