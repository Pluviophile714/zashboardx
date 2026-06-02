import { isSingBox } from '@/api'
import { GLOBAL, PROXY_TAB_TYPE } from '@/constant'
import { isHiddenGroup } from '@/helper'
import { configs } from '@/store/config'
import {
  getProxyGroupChains,
  proxiesTabShow,
  proxyGroupList,
  proxyMap,
  proxyProviederList,
} from '@/store/proxies'
import { groupsInActiveFolder, isProxyFolderModeActive } from '@/store/proxyFolders'
import { rules } from '@/store/rules'
import { customGlobalNode, displayGlobalByMode, manageHiddenGroup } from '@/store/settings'
import { isEmpty } from 'lodash'
import { computed, ref } from 'vue'
import {
  isProxyNodeSearchMode,
  matchProxySearchKeyword,
  proxyGroupContainsMatchingNode,
  proxyProviderContainsMatchingNode,
  proxySearchKeyword,
} from './proxySearch'

const filterProxyGroups = (groups: string[], respectHiddenGroups = true) => {
  if (!proxySearchKeyword.value) {
    if (!respectHiddenGroups || manageHiddenGroup.value) {
      return groups
    }

    return groups.filter((name) => !isHiddenGroup(name))
  }

  const matchesGroup = isProxyNodeSearchMode.value
    ? proxyGroupContainsMatchingNode
    : (name: string) => matchProxySearchKeyword(name)

  return groups.filter(matchesGroup)
}

const getCurrentProxyGroups = () => {
  if (displayGlobalByMode.value) {
    if (configs.value?.mode.toUpperCase() === GLOBAL) {
      const globalName =
        isSingBox.value && proxyMap.value[customGlobalNode.value] ? customGlobalNode.value : GLOBAL

      return filterProxyGroups(getProxyGroupChains(globalName), false)
    }

    return filterProxyGroups(proxyGroupList.value)
  }

  return filterProxyGroups([...proxyGroupList.value, GLOBAL])
}

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
  rootName: string,
  targetName: string,
  groupSet: Set<string>,
  visited = new Set<string>(),
): boolean => {
  if (rootName === targetName || visited.has(rootName)) return false
  visited.add(rootName)
  for (const member of getChildGroupNames(rootName, groupSet)) {
    if (member === targetName || hasDescendantGroup(member, targetName, groupSet, visited)) {
      return true
    }
  }
  return false
}

const referencedCurrentGroupNames = computed(() => {
  const referenced = new Set<string>()
  currentGroupSet.value.forEach((name) => {
    if (name === GLOBAL) return
    getChildGroupNames(name, currentGroupSet.value).forEach((member) => referenced.add(member))
  })
  return referenced
})

const fallbackPolicyGroupNames = computed(() => {
  return new Set(
    getCurrentProxyGroups().filter((name) => !referencedCurrentGroupNames.value.has(name)),
  )
})

const resolvedPolicyGroupNames = computed(() => {
  const direct = [...ruleProxyNames.value].filter((name) => currentGroupSet.value.has(name))
  if (direct.length > 0) {
    const topLevel = direct.filter(
      (name) =>
        !direct.some(
          (candidate) =>
            candidate !== name && hasDescendantGroup(candidate, name, currentGroupSet.value),
        ),
    )
    if (topLevel.length > 0) return new Set(topLevel)
  }
  return fallbackPolicyGroupNames.value
})

const isPolicyGroup = (name: string) => resolvedPolicyGroupNames.value.has(name)

const getRenderProxyGroups = () => {
  if (isEmpty(proxyMap.value)) return []

  const current = getCurrentProxyGroups()

  if (proxiesTabShow.value === PROXY_TAB_TYPE.POLICY) return current.filter(isPolicyGroup)
  if (proxiesTabShow.value === PROXY_TAB_TYPE.NODE) {
    return current.filter((name) => !isPolicyGroup(name))
  }

  return current
}

const getRenderProxyProviders = () => {
  const names = proxyProviederList.value.map((provider) => provider.name)

  if (!proxySearchKeyword.value) {
    return names
  }

  const matches = isProxyNodeSearchMode.value
    ? proxyProviderContainsMatchingNode
    : (name: string) => matchProxySearchKeyword(name)

  return names.filter(matches)
}

const limitInitialRender = (names: string[]) =>
  isProxiesPageMounted.value ? names : names.slice(0, 16)

export const disableProxiesPageScroll = ref(false)
export const isProxiesPageMounted = ref(false)
export const policyGroups = computed(() => getCurrentProxyGroups().filter(isPolicyGroup))
export const nodeGroups = computed(() =>
  getCurrentProxyGroups().filter((name) => !isPolicyGroup(name)),
)
export const renderProxyGroups = computed(() => limitInitialRender(getRenderProxyGroups()))
export const renderProxyProviders = computed(() => limitInitialRender(getRenderProxyProviders()))
export const renderGroups = computed(() => {
  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) {
    return renderProxyProviders.value
  }

  return renderProxyGroups.value
})
export const renderProxiesPageItems = computed(() => {
  if (proxiesTabShow.value === PROXY_TAB_TYPE.PROVIDER) {
    return renderProxyProviders.value
  }

  const groups = renderProxyGroups.value
  if (!isProxyFolderModeActive.value) return groups
  const filter = groupsInActiveFolder.value
  if (!filter) return groups
  return groups.filter((name) => filter.has(name))
})
