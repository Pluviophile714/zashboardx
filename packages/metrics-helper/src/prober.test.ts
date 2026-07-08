import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import type { MetricsHelperConfig } from './config.js'
import { MihomoClient } from './mihomoClient.js'
import { ProbeRunner } from './prober.js'
import { MetricsStorage } from './storage.js'
import type { HelperHealth } from './types.js'

const tempDirs: string[] = []

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })

const createStorage = () => {
  const dir = mkdtempSync(join(tmpdir(), 'zashboardx-metrics-prober-'))

  tempDirs.push(dir)

  const storage = new MetricsStorage(join(dir, 'metrics.sqlite'))

  storage.init()

  return storage
}

const config: MetricsHelperConfig = {
  mihomoBaseUrl: 'http://mihomo.example:9090',
  mihomoSecret: '',
  bindHost: '127.0.0.1',
  port: 8787,
  probeIntervalSeconds: 60,
  probeConcurrency: 2,
  probeTimeoutMs: 5000,
  probeTestUrl: 'https://www.gstatic.com/generate_204',
  fallbackProbeStaleSeconds: 120,
  probeWindowHours: 24,
  retentionDays: 7,
  databasePath: ':memory:',
}

const createHealth = (): HelperHealth => ({
  ok: false,
  mihomoReachable: false,
  running: false,
  lastProbeAt: null,
  lastProbeError: null,
  lastProbeNodeCount: 0,
  version: 'test',
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('records mihomo history first and actively probes only nodes without history', async () => {
  const nowMs = Date.now()
  const historyTime = new Date(nowMs - 60_000).toISOString()
  const requestedDelayNodes: string[] = []
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input))

    if (url.pathname === '/proxies') {
      return jsonResponse({
        proxies: {
          Auto: {
            name: 'Auto',
            type: 'URLTest',
            all: ['HK-01', 'JP-01'],
          },
          'HK-01': {
            name: 'HK-01',
            type: 'Shadowsocks',
            history: [{ time: historyTime, delay: 88 }],
          },
          'JP-01': {
            name: 'JP-01',
            type: 'Vmess',
            history: [],
          },
        },
      })
    }

    requestedDelayNodes.push(decodeURIComponent(url.pathname.split('/').at(-2) ?? ''))
    return jsonResponse({ delay: 120 })
  }
  const storage = createStorage()
  const health = createHealth()
  const runner = new ProbeRunner({
    client: new MihomoClient({
      baseUrl: config.mihomoBaseUrl,
      secret: '',
      fetchImpl: fetchMock,
    }),
    storage,
    config,
    health,
  })

  await runner.runOnce()

  const metrics = storage.getNodeMetrics(24 * 60 * 60, nowMs + 1000)

  assert.deepEqual(requestedDelayNodes, ['JP-01'])
  assert.equal(metrics['HK-01'].lastDelay, 88)
  assert.equal(metrics['JP-01'].lastDelay, 120)
  assert.equal(health.ok, true)
  assert.equal(health.lastProbeNodeCount, 2)

  storage.close()
})

test('actively probes nodes whose mihomo history is stale', async () => {
  const nowMs = Date.now()
  const staleHistoryTime = new Date(nowMs - 10 * 60_000).toISOString()
  const requestedDelayNodes: string[] = []
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input))

    if (url.pathname === '/proxies') {
      return jsonResponse({
        proxies: {
          'HK-01': {
            name: 'HK-01',
            type: 'Shadowsocks',
            history: [{ time: staleHistoryTime, delay: 88 }],
          },
        },
      })
    }

    requestedDelayNodes.push(decodeURIComponent(url.pathname.split('/').at(-2) ?? ''))
    return jsonResponse({ delay: 118 })
  }
  const storage = createStorage()
  const health = createHealth()
  const runner = new ProbeRunner({
    client: new MihomoClient({
      baseUrl: config.mihomoBaseUrl,
      secret: '',
      fetchImpl: fetchMock,
    }),
    storage,
    config,
    health,
  })

  await runner.runOnce()

  const metrics = storage.getNodeMetrics(24 * 60 * 60, nowMs + 1000)

  assert.deepEqual(requestedDelayNodes, ['HK-01'])
  assert.equal(metrics['HK-01'].sampleCount, 2)
  assert.equal(metrics['HK-01'].lastDelay, 118)

  storage.close()
})
