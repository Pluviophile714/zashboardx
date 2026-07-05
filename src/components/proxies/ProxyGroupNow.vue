<template>
  <div class="flex flex-1 items-center gap-1 truncate">
    <template v-if="shouldShowNow">
      <Component
        class="text-base-content/40 h-3.5 w-3.5 shrink-0 outline-none"
        :is="isFixed ? LockClosedIcon : ArrowRightCircleIcon"
        @mouseenter="tipForFixed"
      />
      <ProxyName
        :name="proxyGroup.now"
        :class="
          isNowAGroup && 'hover:bg-base-300 hover:-mx-1 hover:rounded-lg hover:px-1 hover:shadow'
        "
        class="text-base-content text-xs font-medium md:text-sm"
        @click="handlerClickNow"
      />
      <template v-if="finalOutbound && displayFinalOutbound">
        <ArrowRightCircleIcon class="text-base-content/40 h-3.5 w-3.5 shrink-0" />
        <ProxyName
          :name="finalOutbound"
          class="text-base-content text-xs font-medium md:text-sm"
        />
      </template>
    </template>
    <template v-else-if="proxyGroup.type.toLowerCase() === PROXY_TYPE.Smart && topSmartNode">
      <ArrowRightCircleIcon class="text-info/70 h-4 w-4 shrink-0" />
      <ProxyName
        :name="topSmartNode"
        class="text-base-content/70 text-xs md:text-sm"
      />
      <span class="text-base-content/40 text-[10px] md:text-xs">Smart</span>
    </template>
    <template v-else-if="proxyGroup.type.toLowerCase() === PROXY_TYPE.LoadBalance">
      <CheckCircleIcon class="text-base-content/40 h-3.5 w-3.5 shrink-0" />
      <span class="text-base-content text-xs font-medium md:text-sm">
        {{ $t('loadBalance') }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { PROXY_TYPE } from '@/constant'
import { useTooltip } from '@/helper/tooltip'
import { scrollToGroup } from '@/helper/utils'
import { getNowProxyNodeName, proxyGroupList, proxyMap } from '@/assembly/proxies'
import { displayFinalOutbound } from '@/store/settings'
import { ArrowRightCircleIcon, CheckCircleIcon, LockClosedIcon } from '@heroicons/vue/24/outline'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ProxyName from './ProxyName.vue'
import { getActiveConnectionOutbound, getSmartOutbound, getTopSmartNode } from './smartOutbound'

const props = defineProps<{
  name: string
  mobile?: boolean
}>()
const proxyGroup = computed(() => proxyMap.value[props.name])
const { showTip } = useTooltip()
const { t } = useI18n()

const isFixed = computed(() => {
  return proxyGroup.value.fixed === proxyGroup.value.now
})

const tipForFixed = (e: Event) => {
  if (!isFixed.value) {
    return
  }

  showTip(e, t('tipForFixed', { type: proxyGroup.value.type }), {
    delay: [500, 0],
  })
}

const isNowAGroup = computed(() => {
  return proxyGroupList.value.includes(proxyGroup.value.now)
})

const resolvedNow = computed(() => getNowProxyNodeName(proxyGroup.value.now))

const isSmartGroup = computed(() => {
  return proxyGroup.value.type.toLowerCase() === PROXY_TYPE.Smart
})

const shouldShowNow = computed(() => {
  if (!proxyGroup.value.now) return false

  return !(isSmartGroup.value && resolvedNow.value === proxyGroup.value.name)
})

const finalOutbound = computed(() => {
  const activeOutbound = getActiveConnectionOutbound(props.name)

  if (activeOutbound) {
    return activeOutbound
  }

  if (resolvedNow.value !== proxyGroup.value.now) {
    return getSmartOutbound(resolvedNow.value) || resolvedNow.value
  }

  return getSmartOutbound(proxyGroup.value.now)
})

const topSmartNode = computed(() => {
  if (!isSmartGroup.value) return ''

  const activeOutbound = getActiveConnectionOutbound(props.name)

  if (activeOutbound) {
    return activeOutbound
  }

  return getTopSmartNode(props.name)
})

const handlerClickNow = (e: Event) => {
  if (isNowAGroup.value) {
    e.stopPropagation()
    scrollToGroup(proxyGroup.value.now)
  }
}
</script>
