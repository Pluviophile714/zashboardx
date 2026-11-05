import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProbeStorageWorkerClient } from './probeStorageWorkerClient.js'
import { MetricsStorage } from './storage.js'
import type { DiscoveredProxyNode } from './types.js'

test('persists a large probe round without blocking the main event loop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zashboardx-probe-worker-'))
  const databasePath = join(dir, 'metrics.sqlite')
  const nowMs = Date.UTC(2026, 7, 11, 8, 0, 0)
  const historyAt = new Date(nowMs - 30_000).toISOString()
  const nodes: DiscoveredProxyNode[] = Array.from({ length: 600 }, (_, index) => ({
    name: `node-${index}`,
    type: 'Shadowsocks',
    historySamples: [
      {
        nodeName: `node-${index}`,
        testUrl: 'https://example.com',
        timestamp: historyAt,
        delay: 60 + (index % 40),
        success: true,
      },
    ],
  }))

  nodes.push({ name: 'needs-fallback', type: 'Vmess' })

  const client = new ProbeStorageWorkerClient(databasePath)

  try {
    let timerFired = false
    const persisted = client.prepareRound(nodes, nowMs, 120_000)

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        timerFired = true
        resolve()
      }, 0)
    })

    assert.equal(timerFired, true)
    assert.deepEqual(await persisted, ['needs-fallback'])

    await client.finishRound(
      [
        {
          nodeName: 'needs-fallback',
          testUrl: 'https://example.com',
          timestamp: new Date(nowMs).toISOString(),
          delay: 120,
          success: true,
        },
      ],
      7,
      nowMs,
    )

    const storage = new MetricsStorage(databasePath)
    storage.init({ readonly: true })

    assert.equal(storage.getNodeMetrics(86_400, nowMs)['node-0'].lastDelay, 60)
    assert.equal(storage.getNodeMetrics(86_400, nowMs)['needs-fallback'].lastDelay, 120)
    storage.close()
  } finally {
    await client.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('rebuilds rollups before a later probe round and refreshes the active bucket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zashboardx-probe-rollup-worker-'))
  const databasePath = join(dir, 'metrics.sqlite')
  const nowMs = Date.UTC(2026, 6, 11, 8, 5, 0)
  const client = new ProbeStorageWorkerClient(databasePath)

  try {
    await client.prepareRound(
      [
        {
          name: 'HK-01',
          type: 'Shadowsocks',
          historySamples: [
            {
              nodeName: 'HK-01',
              testUrl: 'https://example.com',
              timestamp: new Date(nowMs - 30_000).toISOString(),
              delay: 80,
              success: true,
            },
          ],
        },
      ],
      nowMs,
      120_000,
    )
    const rollupClient = client as ProbeStorageWorkerClient & {
      rebuildMetricsRollups: (retentionDays: number, rebuildNowMs: number) => Promise<void>
    }

    await rollupClient.rebuildMetricsRollups(7, nowMs)
    await client.finishRound(
      [
        {
          nodeName: 'HK-01',
          testUrl: 'https://example.com',
          timestamp: new Date(nowMs).toISOString(),
          delay: 120,
          success: true,
        },
      ],
      7,
      nowMs,
    )

    const storage = new MetricsStorage(databasePath)
    storage.init({ readonly: true })
    const timeline = storage.getNodeTimeline('HK-01', 86_400, 96, nowMs)

    assert.equal(timeline.at(-1)?.sampleCount, 2)
    assert.equal(timeline.at(-1)?.avgDelay, 100)
    storage.close()
  } finally {
    await client.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
