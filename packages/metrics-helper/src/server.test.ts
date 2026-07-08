import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { createMetricsServer } from './server.js'
import { MetricsStorage } from './storage.js'
import type { HelperHealth } from './types.js'

const tempDirs: string[] = []
const at = (minute: number) => new Date(Date.UTC(2026, 6, 4, 0, minute, 0)).toISOString()

const createStorage = () => {
  const dir = mkdtempSync(join(tmpdir(), 'zashboardx-metrics-server-'))

  tempDirs.push(dir)

  const storage = new MetricsStorage(join(dir, 'metrics.sqlite'))

  storage.init()
  storage.insertProbeSample({
    nodeName: 'HK-01',
    testUrl: 'https://example.com',
    timestamp: at(0),
    delay: 80,
    success: true,
  })

  return storage
}

const listen = async (server: ReturnType<typeof createMetricsServer>) =>
  new Promise<string>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (address && typeof address === 'object') {
        resolve(`http://127.0.0.1:${address.port}`)
      }
    })
  })

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('serves health and node metrics as JSON', async () => {
  const storage = createStorage()
  const health: HelperHealth = {
    ok: true,
    mihomoReachable: true,
    running: false,
    lastProbeAt: at(1),
    lastProbeError: null,
    lastProbeNodeCount: 1,
    version: '0.1.0',
  }
  const server = createMetricsServer({
    storage,
    health,
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const healthResponse = await fetch(`${baseUrl}/api/metrics/health`)
    const healthBody = (await healthResponse.json()) as HelperHealth

    assert.equal(healthResponse.status, 200)
    assert.equal(healthResponse.headers.get('cache-control'), 'no-store')
    assert.equal(healthBody.ok, true)
    assert.equal(healthBody.version, '0.1.0')

    const nodesResponse = await fetch(`${baseUrl}/api/metrics/nodes?window=24h`)
    const nodesBody = (await nodesResponse.json()) as {
      windowSeconds: number
      nodes: Record<
        string,
        {
          availability: number | null
          firstSampleAt: string | null
          lastSampleAt: string | null
          sampleCount: number
        }
      >
    }

    assert.equal(nodesResponse.status, 200)
    assert.equal(nodesBody.windowSeconds, 24 * 60 * 60)
    assert.equal(nodesBody.nodes['HK-01'].availability, 1)
    assert.equal(nodesBody.nodes['HK-01'].firstSampleAt, at(0))
    assert.equal(nodesBody.nodes['HK-01'].lastSampleAt, at(0))
    assert.equal(nodesBody.nodes['HK-01'].sampleCount, 1)

    const nodeResponse = await fetch(`${baseUrl}/api/metrics/nodes/HK-01?window=24h`)
    const nodeBody = (await nodeResponse.json()) as {
      name: string
      metrics: {
        availability: number | null
        firstSampleAt: string | null
        lastSampleAt: string | null
        sampleCount: number
      } | null
    }

    assert.equal(nodeResponse.status, 200)
    assert.equal(nodeBody.name, 'HK-01')
    assert.equal(nodeBody.metrics?.availability, 1)
    assert.equal(nodeBody.metrics?.firstSampleAt, at(0))
    assert.equal(nodeBody.metrics?.lastSampleAt, at(0))
  } finally {
    server.close()
    storage.close()
  }
})

test('accepts frontend latency samples and deduplicates repeated posts', async () => {
  const storage = createStorage()
  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)
  const sample = {
    nodeName: 'JP-01',
    testUrl: 'https://www.gstatic.com/generate_204',
    timestamp: at(5),
    delay: 121,
    success: true,
  }

  try {
    const firstPost = await fetch(`${baseUrl}/api/metrics/samples`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ samples: [sample] }),
    })
    const firstBody = (await firstPost.json()) as { accepted: number; received: number }

    assert.equal(firstPost.status, 200)
    assert.equal(firstBody.received, 1)
    assert.equal(firstBody.accepted, 1)

    const duplicatePost = await fetch(`${baseUrl}/api/metrics/samples`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ samples: [sample] }),
    })
    const duplicateBody = (await duplicatePost.json()) as { accepted: number; received: number }

    assert.equal(duplicatePost.status, 200)
    assert.equal(duplicateBody.received, 1)
    assert.equal(duplicateBody.accepted, 0)

    const nodeResponse = await fetch(`${baseUrl}/api/metrics/nodes/JP-01?window=24h`)
    const nodeBody = (await nodeResponse.json()) as {
      metrics: {
        availability: number | null
        lastDelay: number | null
        sampleCount: number
      } | null
    }

    assert.equal(nodeBody.metrics?.availability, 1)
    assert.equal(nodeBody.metrics?.lastDelay, 121)
    assert.equal(nodeBody.metrics?.sampleCount, 1)
  } finally {
    server.close()
    storage.close()
  }
})

test('returns 404 for unknown metric routes', async () => {
  const storage = createStorage()
  const server = createMetricsServer({
    storage,
    health: {
      ok: true,
      mihomoReachable: true,
      running: false,
      lastProbeAt: null,
      lastProbeError: null,
      lastProbeNodeCount: 0,
      version: '0.1.0',
    },
    defaultWindowSeconds: 24 * 60 * 60,
    now: () => Date.parse(at(30)),
  })
  const baseUrl = await listen(server)

  try {
    const response = await fetch(`${baseUrl}/api/metrics/unknown`)

    assert.equal(response.status, 404)
  } finally {
    server.close()
    storage.close()
  }
})
