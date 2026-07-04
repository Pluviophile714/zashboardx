import type { ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { MetricsStorage } from './storage.js'
import type { HelperHealth } from './types.js'

type MetricsServerOptions = {
  storage: MetricsStorage
  health: HelperHealth
  defaultWindowSeconds: number
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

export const createMetricsServer = (options: MetricsServerOptions) =>
  createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method !== 'GET') {
      sendStatus(response, 405, { error: 'method_not_allowed' })
      return
    }

    const url = new URL(request.url ?? '/', 'http://localhost')
    const windowSeconds = parseWindowSeconds(
      url.searchParams.get('window'),
      options.defaultWindowSeconds,
    )
    const nowMs = options.now?.() ?? Date.now()

    if (url.pathname === '/api/metrics/health') {
      sendJson(response, options.health)
      return
    }

    if (url.pathname === '/api/metrics/nodes') {
      sendJson(response, {
        windowSeconds,
        generatedAt: new Date(nowMs).toISOString(),
        nodes: options.storage.getNodeMetrics(windowSeconds, nowMs),
      })
      return
    }

    if (url.pathname.startsWith('/api/metrics/nodes/')) {
      const encodedName = url.pathname.slice('/api/metrics/nodes/'.length)
      const nodeName = decodeURIComponent(encodedName)

      sendJson(response, {
        windowSeconds,
        generatedAt: new Date(nowMs).toISOString(),
        name: nodeName,
        metrics: options.storage.getSingleNodeMetrics(nodeName, windowSeconds, nowMs),
      })
      return
    }

    sendStatus(response, 404, { error: 'not_found' })
  })
