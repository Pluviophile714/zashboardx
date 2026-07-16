import type { DiscoveredProxyNode, ProbeSample } from './types.js'

type MihomoClientOptions = {
  baseUrl: string
  secret: string
  fetchImpl?: typeof fetch
}

type MihomoProxy = {
  name?: string
  type?: string
  all?: string[]
  now?: string
  history?: {
    time?: string
    delay?: number | string
  }[]
}

type ProxiesResponse = {
  proxies?: Record<string, MihomoProxy>
}

type ProxyProvider = {
  name?: string
  vehicleType?: string
  proxies?: MihomoProxy[]
}

type ProxyProvidersResponse = {
  providers?: Record<string, ProxyProvider>
}

const builtinNames = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'GLOBAL', 'COMPATIBLE'])
const builtinTypes = new Set(['direct', 'reject', 'rejectdrop', 'compatible'])

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '')

const isGroupProxy = (proxy: MihomoProxy | undefined) => Array.isArray(proxy?.all)

const isBuiltinProxy = (name: string, proxy: MihomoProxy | undefined) => {
  const type = proxy?.type?.replace(/[\s-]/g, '').toLowerCase()

  return builtinNames.has(name) || (type ? builtinTypes.has(type) : false)
}

const toHistorySamples = (
  nodeName: string,
  proxy: MihomoProxy | undefined,
  testUrl: string | undefined,
): ProbeSample[] | undefined => {
  if (!testUrl || !Array.isArray(proxy?.history)) {
    return undefined
  }

  const samples: ProbeSample[] = []

  for (const item of proxy.history) {
    const timestampMs = item.time ? Date.parse(item.time) : Number.NaN
    const delay = typeof item.delay === 'number' ? item.delay : Number(item.delay)

    if (!Number.isFinite(timestampMs) || !Number.isFinite(delay)) {
      continue
    }

    if (delay > 0) {
      samples.push({
        nodeName,
        testUrl,
        timestamp: new Date(timestampMs).toISOString(),
        delay,
        success: true,
      })
      continue
    }

    samples.push({
      nodeName,
      testUrl,
      timestamp: new Date(timestampMs).toISOString(),
      delay: null,
      success: false,
      errorType: 'history_failed',
    })
  }

  if (proxy.type?.replace(/[\s-]/g, '').toLowerCase() === 'smart') {
    const rounds = new Map<string, ProbeSample>()

    for (const sample of samples) {
      rounds.set(sample.timestamp.slice(0, 19), sample)
    }

    return rounds.size ? [...rounds.values()] : undefined
  }

  return samples.length ? samples : undefined
}

export class MihomoClient {
  readonly #baseUrl: string
  readonly #secret: string
  readonly #fetch: typeof fetch

  constructor(options: MihomoClientOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl)
    this.#secret = options.secret
    this.#fetch = options.fetchImpl ?? fetch
  }

  async discoverProxyNodes(testUrl?: string): Promise<DiscoveredProxyNode[]> {
    const data = await this.#requestJson<ProxiesResponse>('/proxies')
    const providerData =
      (await this.#requestOptionalJson<ProxyProvidersResponse>('/providers/proxies')) ?? {}
    const proxies = data.proxies ?? {}
    const providerProxies = new Map<string, MihomoProxy>()
    const groupNames = new Set<string>()
    const candidateNames = new Set<string>()

    for (const provider of Object.values(providerData.providers ?? {})) {
      if (provider.name === 'default' || provider.vehicleType === 'Compatible') {
        continue
      }

      for (const proxy of provider.proxies ?? []) {
        if (proxy.name && !isBuiltinProxy(proxy.name, proxy)) {
          providerProxies.set(proxy.name, proxy)
          candidateNames.add(proxy.name)
        }
      }
    }

    for (const [name, proxy] of Object.entries(proxies)) {
      if (isGroupProxy(proxy)) {
        groupNames.add(name)
        proxy.all?.forEach((candidate) => candidateNames.add(candidate))
      } else {
        candidateNames.add(name)
      }
    }

    const discovered = new Map<string, DiscoveredProxyNode>()

    for (const name of candidateNames) {
      const topLevelProxy = proxies[name]
      const providerProxy = providerProxies.get(name)
      const proxy = topLevelProxy ?? providerProxy

      if (
        Boolean(proxy) &&
        !groupNames.has(name) &&
        !isGroupProxy(proxy) &&
        !isBuiltinProxy(name, proxy)
      ) {
        const historySamples = toHistorySamples(name, proxy, testUrl)

        discovered.set(name, {
          name,
          type: proxy?.type ?? null,
          ...(topLevelProxy ? {} : { probeable: false }),
          ...(historySamples ? { historySamples } : {}),
        })
      }
    }

    for (const [name, proxy] of Object.entries(proxies)) {
      if (!isGroupProxy(proxy) || isBuiltinProxy(name, proxy)) {
        continue
      }

      const historySamples = toHistorySamples(name, proxy, testUrl)

      if (!historySamples?.length) {
        continue
      }

      discovered.set(name, {
        name,
        type: proxy.type ?? null,
        probeable: false,
        historySamples,
      })
    }

    for (const proxy of Object.values(proxies)) {
      if (!isGroupProxy(proxy) || !proxy.now || !proxy.all?.includes(proxy.now)) {
        continue
      }

      const name = proxy.now

      if (discovered.has(name) || groupNames.has(name) || isBuiltinProxy(name, proxies[name])) {
        continue
      }

      const historySamples = toHistorySamples(name, proxy, testUrl)

      if (!historySamples?.length) {
        continue
      }

      const node = discovered.get(name) ?? {
        name,
        type: proxies[name]?.type ?? providerProxies.get(name)?.type ?? null,
        ...(proxies[name] ? {} : { probeable: false }),
      }

      discovered.set(name, {
        ...node,
        historySamples: [...(node.historySamples ?? []), ...historySamples],
      })
    }

    return [...discovered.values()]
      .filter((node) => {
        const proxy = proxies[node.name] ?? providerProxies.get(node.name)

        if (proxy) {
          return true
        }

        return Boolean(node.historySamples?.length)
      })
      .map((node) => {
        const proxy = proxies[node.name] ?? providerProxies.get(node.name)

        return {
          ...node,
          type: proxy?.type ?? node.type,
        }
      })
      .filter((node) => {
        const proxy = proxies[node.name] ?? providerProxies.get(node.name)

        return (
          !isBuiltinProxy(node.name, proxy) &&
          (!groupNames.has(node.name) || Boolean(node.historySamples?.length)) &&
          (!isGroupProxy(proxy) || Boolean(node.historySamples?.length))
        )
      })
      .sort((prev, next) => prev.name.localeCompare(next.name, 'zh-Hans-CN'))
  }

  async probeNode(
    nodeName: string,
    testUrl: string,
    timeoutMs: number,
    timestamp = new Date().toISOString(),
  ): Promise<ProbeSample> {
    const url = new URL(`${this.#baseUrl}/proxies/${encodeURIComponent(nodeName)}/delay`)

    url.searchParams.set('url', testUrl)
    url.searchParams.set('timeout', String(timeoutMs))

    try {
      const response = await this.#fetch(url.toString(), {
        headers: this.#headers(),
        signal: AbortSignal.timeout(timeoutMs + 1000),
      })

      if (!response.ok) {
        return this.#failedSample(nodeName, testUrl, timestamp, `http_${response.status}`)
      }

      const data = (await response.json()) as { delay?: unknown }
      const delay = typeof data.delay === 'number' ? data.delay : Number(data.delay)

      if (!Number.isFinite(delay) || delay < 0) {
        return this.#failedSample(nodeName, testUrl, timestamp, 'invalid_response')
      }

      return {
        nodeName,
        testUrl,
        timestamp,
        delay,
        success: true,
      }
    } catch {
      return this.#failedSample(nodeName, testUrl, timestamp, 'request_failed')
    }
  }

  async #requestJson<T>(path: string): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      headers: this.#headers(),
    })

    if (!response.ok) {
      throw new Error(`mihomo request failed: ${response.status}`)
    }

    return (await response.json()) as T
  }

  async #requestOptionalJson<T>(path: string): Promise<T | null> {
    try {
      return await this.#requestJson<T>(path)
    } catch {
      return null
    }
  }

  #headers() {
    return this.#secret
      ? {
          Authorization: `Bearer ${this.#secret}`,
        }
      : undefined
  }

  #failedSample(
    nodeName: string,
    testUrl: string,
    timestamp: string,
    errorType: string,
  ): ProbeSample {
    return {
      nodeName,
      testUrl,
      timestamp,
      delay: null,
      success: false,
      errorType,
    }
  }
}
