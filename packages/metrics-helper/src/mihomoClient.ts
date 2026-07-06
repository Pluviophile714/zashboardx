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
  history?: {
    time?: string
    delay?: number | string
  }[]
}

type ProxiesResponse = {
  proxies?: Record<string, MihomoProxy>
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
    const proxies = data.proxies ?? {}
    const groupNames = new Set<string>()
    const candidateNames = new Set<string>()

    for (const [name, proxy] of Object.entries(proxies)) {
      if (isGroupProxy(proxy)) {
        groupNames.add(name)
        proxy.all?.forEach((candidate) => candidateNames.add(candidate))
      } else {
        candidateNames.add(name)
      }
    }

    return [...candidateNames]
      .filter((name) => {
        const proxy = proxies[name]

        return (
          Boolean(proxy) &&
          !groupNames.has(name) &&
          !isGroupProxy(proxy) &&
          !isBuiltinProxy(name, proxy)
        )
      })
      .map((name) => {
        const historySamples = toHistorySamples(name, proxies[name], testUrl)

        return {
          name,
          type: proxies[name]?.type ?? null,
          ...(historySamples ? { historySamples } : {}),
        }
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
