import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { MetricsAggregationCache } from './metricsCache.js'
import type { MetricsStorage } from './storage.js'
import type { HelperHealth, ProbeSample } from './types.js'

type MetricsServerOptions = {
  storage: MetricsStorage
  health: HelperHealth
  defaultWindowSeconds: number
  metricsCache?: MetricsAggregationCache
  now?: () => number
}

const parseWindowSeconds = (value: string | null, fallback: number) => {
  if (!value) {
    return fallback
  }

  const trimmed = value.trim().toLowerCase()
  const match = /^(\d+)([hdm]?)$/.exec(trimmed)

  if (!match) {
    return fallback
  }

  const amount = Number(match[1])

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return fallback
  }

  if (match[2] === 'd') {
    return amount * 24 * 60 * 60
  }
  if (match[2] === 'h') {
    return amount * 60 * 60
  }
  if (match[2] === 'm') {
    return amount * 60
  }

  return amount
}

const parseLimit = (value: string | null, fallback: number) => {
  if (!value) {
    return fallback
  }

  const amount = Number(value)

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return fallback
  }

  return Math.min(200, amount)
}

const sendJson = (response: ServerResponse, body: unknown) => {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

const sendStatus = (response: ServerResponse, statusCode: number, body: unknown) => {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

const readJsonBody = async (request: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    let body = ''

    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        reject(new Error('body_too_large'))
        request.destroy()
      }
    })
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('invalid_json'))
      }
    })
    request.on('error', reject)
  })

const normalizePostedSample = (input: unknown): ProbeSample | null => {
  if (!input || typeof input !== 'object') {
    return null
  }

  const sample = input as Record<string, unknown>
  const nodeName = typeof sample.nodeName === 'string' ? sample.nodeName.trim() : ''
  const testUrl = typeof sample.testUrl === 'string' ? sample.testUrl.trim() : ''
  const timestampValue = typeof sample.timestamp === 'string' ? sample.timestamp : ''
  const timestampMs = Date.parse(timestampValue)
  const delay =
    typeof sample.delay === 'number'
      ? sample.delay
      : typeof sample.delay === 'string'
        ? Number(sample.delay)
        : Number.NaN

  if (
    !nodeName ||
    nodeName.length > 512 ||
    !testUrl ||
    testUrl.length > 2048 ||
    !Number.isFinite(timestampMs)
  ) {
    return null
  }

  const success = sample.success === undefined ? delay > 0 : sample.success === true
  const normalizedDelay = success && Number.isFinite(delay) && delay > 0 ? Math.round(delay) : null
  const errorType =
    typeof sample.errorType === 'string' && sample.errorType.trim()
      ? sample.errorType.trim().slice(0, 128)
      : undefined

  return {
    nodeName,
    testUrl,
    timestamp: new Date(timestampMs).toISOString(),
    delay: normalizedDelay,
    success,
    ...(success ? {} : { errorType: errorType ?? 'frontend_failed' }),
  }
}

const extractPostedSamples = (body: unknown) => {
  if (!body || typeof body !== 'object') {
    return []
  }

  const rawSamples = (body as { samples?: unknown }).samples

  if (!Array.isArray(rawSamples)) {
    return []
  }

  return rawSamples
    .slice(0, 1000)
    .map(normalizePostedSample)
    .filter((sample): sample is ProbeSample => sample !== null)
}

export const createMetricsServer = (options: MetricsServerOptions) =>
  createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', 'http://localhost')

    if (request.method === 'POST' && url.pathname === '/api/metrics/samples') {
      try {
        const samples = extractPostedSamples(await readJsonBody(request))
        let accepted = 0

        for (const sample of samples) {
          if (options.storage.insertProbeSample(sample)) {
            accepted += 1
          }
        }

        if (accepted > 0) {
          options.metricsCache?.markDirty()
        }

        sendJson(response, {
          accepted,
          received: samples.length,
        })
      } catch (error) {
        sendStatus(response, 400, {
          error: error instanceof Error ? error.message : 'invalid_request',
        })
      }
      return
    }

    if (request.method !== 'GET') {
      sendStatus(response, 405, { error: 'method_not_allowed' })
      return
    }

    const windowSeconds = parseWindowSeconds(
      url.searchParams.get('window'),
      options.defaultWindowSeconds,
    )
    const nowMs = options.now?.() ?? Date.now()

    if (url.pathname === '/api/metrics/health') {
      sendJson(response, options.health)
      return
    }

    if (url.pathname === '/api/metrics/timeline') {
      const nodeName = url.searchParams.get('node')?.trim() ?? ''
      const requestedWindow = url.searchParams.get('window') ?? '24h'

      if (!nodeName || nodeName.length > 512) {
        sendStatus(response, 400, { error: 'invalid_node' })
        return
      }
      if (requestedWindow !== '24h') {
        sendStatus(response, 400, { error: 'unsupported_window' })
        return
      }

      sendJson(response, {
        windowSeconds: 86_400,
        generatedAt: new Date(nowMs).toISOString(),
        nodeName,
        bucketSeconds: 900,
        buckets: options.storage.getNodeTimeline(nodeName, 86_400, 96, nowMs),
      })
      return
    }

    if (url.pathname === '/api/metrics/samples') {
      const nodeName = url.searchParams.get('node')?.trim() ?? ''

      if (!nodeName || nodeName.length > 512) {
        sendStatus(response, 400, { error: 'invalid_node' })
        return
      }

      sendJson(response, {
        windowSeconds,
        generatedAt: new Date(nowMs).toISOString(),
        nodeName,
        samples: options.storage.getRecentProbeSamples(
          nodeName,
          windowSeconds,
          parseLimit(url.searchParams.get('limit'), 30),
          nowMs,
        ),
      })
      return
    }

    if (url.pathname === '/api/metrics/nodes') {
      sendJson(
        response,
        options.metricsCache?.get(windowSeconds, nowMs) ?? {
          windowSeconds,
          generatedAt: new Date(nowMs).toISOString(),
          nodes: options.storage.getNodeMetrics(windowSeconds, nowMs),
        },
      )
      return
    }

    if (url.pathname.startsWith('/api/metrics/nodes/')) {
      const encodedName = url.pathname.slice('/api/metrics/nodes/'.length)
      const nodeName = decodeURIComponent(encodedName)

      sendJson(response, {
        windowSeconds,
        generatedAt: new Date(nowMs).toISOString(),
        name: nodeName,
        metrics:
          options.metricsCache?.get(windowSeconds, nowMs).nodes[nodeName] ??
          options.storage.getSingleNodeMetrics(nodeName, windowSeconds, nowMs),
      })
      return
    }

    sendStatus(response, 404, { error: 'not_found' })
  })
