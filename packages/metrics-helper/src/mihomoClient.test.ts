import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MihomoClient } from './mihomoClient.js'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })

test('discovers leaf proxy nodes from mihomo proxy groups', async () => {
  const requested: { url: string; authorization: string | null }[] = []
  const fetchMock: typeof fetch = async (input, init) => {
    requested.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization'),
    })

    return jsonResponse({
      proxies: {
        GLOBAL: {
          name: 'GLOBAL',
          type: 'Selector',
          all: ['Auto', 'HK-01', 'DIRECT', 'REJECT', 'STALE-01'],
        },
        Auto: {
          name: 'Auto',
          type: 'URLTest',
          all: ['HK-01', 'JP-01'],
        },
        'HK-01': {
          name: 'HK-01',
          type: 'Shadowsocks',
        },
        'JP-01': {
          name: 'JP-01',
          type: 'Vmess',
        },
        DIRECT: {
          name: 'DIRECT',
          type: 'Direct',
        },
      },
    })
  }

  const client = new MihomoClient({
    baseUrl: 'http://mihomo.example:9090',
    secret: 'secret',
    fetchImpl: fetchMock,
  })

  const nodes = await client.discoverProxyNodes()

  assert.deepEqual(nodes, [
    { name: 'HK-01', type: 'Shadowsocks' },
    { name: 'JP-01', type: 'Vmess' },
  ])
  assert.equal(requested[0].url, 'http://mihomo.example:9090/proxies')
  assert.equal(requested[0].authorization, 'Bearer secret')
})

test('maps mihomo proxy history to observed probe samples', async () => {
  const fetchMock: typeof fetch = async () =>
    jsonResponse({
      proxies: {
        Auto: {
          name: 'Auto',
          type: 'URLTest',
          all: ['HK-01'],
        },
        'HK-01': {
          name: 'HK-01',
          type: 'Shadowsocks',
          history: [
            { time: '2026-07-05T03:00:00.000Z', delay: 88 },
            { time: '2026-07-05T03:05:00.000Z', delay: 0 },
            { time: 'bad-date', delay: 120 },
          ],
        },
      },
    })
  const client = new MihomoClient({
    baseUrl: 'http://mihomo.example:9090',
    secret: '',
    fetchImpl: fetchMock,
  })

  const nodes = await client.discoverProxyNodes('https://www.gstatic.com/generate_204')

  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].name, 'HK-01')
  assert.deepEqual(nodes[0].historySamples, [
    {
      nodeName: 'HK-01',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-05T03:00:00.000Z',
      delay: 88,
      success: true,
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-05T03:05:00.000Z',
      delay: null,
      success: false,
      errorType: 'history_failed',
    },
  ])
})

test('maps selected group history to leaf nodes missing from top-level proxies', async () => {
  const fetchMock: typeof fetch = async () =>
    jsonResponse({
      proxies: {
        Manual: {
          name: 'Manual',
          type: 'Selector',
          all: ['HK-01', 'STALE-01'],
          now: 'HK-01',
          history: [
            { time: '2026-07-06T03:00:00.000Z', delay: 58 },
            { time: '2026-07-06T03:05:00.000Z', delay: 0 },
          ],
        },
      },
    })
  const client = new MihomoClient({
    baseUrl: 'http://mihomo.example:9090',
    secret: '',
    fetchImpl: fetchMock,
  })

  const nodes = await client.discoverProxyNodes('https://www.gstatic.com/generate_204')
  const leaf = nodes.find((node) => node.name === 'HK-01')

  assert.equal(leaf?.type, null)
  assert.deepEqual(leaf?.historySamples, [
    {
      nodeName: 'HK-01',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-06T03:00:00.000Z',
      delay: 58,
      success: true,
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-06T03:05:00.000Z',
      delay: null,
      success: false,
      errorType: 'history_failed',
    },
  ])
})

test('maps provider proxy history to nodes missing from top-level proxies', async () => {
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input))

    if (url.pathname === '/providers/proxies') {
      return jsonResponse({
        providers: {
          main: {
            name: 'main',
            vehicleType: 'HTTP',
            proxies: [
              {
                name: 'HK-07',
                type: 'Trojan',
                history: [
                  { time: '2026-07-07T02:00:00.000Z', delay: 63 },
                  { time: '2026-07-07T02:05:00.000Z', delay: 0 },
                ],
              },
            ],
          },
        },
      })
    }

    return jsonResponse({
      proxies: {
        Manual: {
          name: 'Manual',
          type: 'Selector',
          all: ['HK-07'],
        },
      },
    })
  }
  const client = new MihomoClient({
    baseUrl: 'http://mihomo.example:9090',
    secret: '',
    fetchImpl: fetchMock,
  })

  const nodes = await client.discoverProxyNodes('https://www.gstatic.com/generate_204')
  const providerNode = nodes.find((node) => node.name === 'HK-07')

  assert.equal(providerNode?.type, 'Trojan')
  assert.equal(providerNode?.probeable, false)
  assert.deepEqual(providerNode?.historySamples, [
    {
      nodeName: 'HK-07',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-07T02:00:00.000Z',
      delay: 63,
      success: true,
    },
    {
      nodeName: 'HK-07',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-07T02:05:00.000Z',
      delay: null,
      success: false,
      errorType: 'history_failed',
    },
  ])
})

test('keeps selected group history as group metrics as well as leaf metrics', async () => {
  const fetchMock: typeof fetch = async () =>
    jsonResponse({
      proxies: {
        Manual: {
          name: 'Manual',
          type: 'Selector',
          all: ['HK-01'],
          now: 'HK-01',
          history: [
            { time: '2026-07-06T03:00:00.000Z', delay: 58 },
            { time: '2026-07-06T03:05:00.000Z', delay: 0 },
          ],
        },
      },
    })
  const client = new MihomoClient({
    baseUrl: 'http://mihomo.example:9090',
    secret: '',
    fetchImpl: fetchMock,
  })

  const nodes = await client.discoverProxyNodes('https://www.gstatic.com/generate_204')
  const group = nodes.find((node) => node.name === 'Manual')
  const leaf = nodes.find((node) => node.name === 'HK-01')

  assert.equal(group?.type, 'Selector')
  assert.equal(leaf?.type, null)
  assert.deepEqual(group?.historySamples, [
    {
      nodeName: 'Manual',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-06T03:00:00.000Z',
      delay: 58,
      success: true,
    },
    {
      nodeName: 'Manual',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-06T03:05:00.000Z',
      delay: null,
      success: false,
      errorType: 'history_failed',
    },
  ])
  assert.deepEqual(leaf?.historySamples, [
    {
      nodeName: 'HK-01',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-06T03:00:00.000Z',
      delay: 58,
      success: true,
    },
    {
      nodeName: 'HK-01',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-06T03:05:00.000Z',
      delay: null,
      success: false,
      errorType: 'history_failed',
    },
  ])
})

test('does not copy selected group history into an already discovered leaf node', async () => {
  const fetchMock: typeof fetch = async () =>
    jsonResponse({
      proxies: {
        Manual: {
          name: 'Manual',
          type: 'Selector',
          all: ['HK-01'],
          now: 'HK-01',
          history: [
            { time: '2026-07-06T03:00:10.000Z', delay: 58 },
            { time: '2026-07-06T03:01:10.000Z', delay: 59 },
          ],
        },
        Fallback: {
          name: 'Fallback',
          type: 'Fallback',
          all: ['HK-01'],
          now: 'HK-01',
          history: [
            { time: '2026-07-06T03:00:20.000Z', delay: 60 },
            { time: '2026-07-06T03:01:20.000Z', delay: 61 },
          ],
        },
        'HK-01': {
          name: 'HK-01',
          type: 'Trojan',
          history: [{ time: '2026-07-06T03:00:00.000Z', delay: 55 }],
        },
      },
    })
  const client = new MihomoClient({
    baseUrl: 'http://mihomo.example:9090',
    secret: '',
    fetchImpl: fetchMock,
  })

  const nodes = await client.discoverProxyNodes('https://www.gstatic.com/generate_204')
  const leaf = nodes.find((node) => node.name === 'HK-01')

  assert.equal(leaf?.type, 'Trojan')
  assert.deepEqual(leaf?.historySamples, [
    {
      nodeName: 'HK-01',
      testUrl: 'https://www.gstatic.com/generate_204',
      timestamp: '2026-07-06T03:00:00.000Z',
      delay: 55,
      success: true,
    },
  ])
})

test('probes a proxy node through the delay endpoint', async () => {
  const requested: string[] = []
  const fetchMock: typeof fetch = async (input) => {
    requested.push(String(input))

    return jsonResponse({ delay: 88 })
  }
  const client = new MihomoClient({
    baseUrl: 'http://mihomo.example:9090/',
    secret: '',
    fetchImpl: fetchMock,
  })

  const sample = await client.probeNode(
    'HK 01',
    'https://www.gstatic.com/generate_204',
    5000,
    '2026-07-04T00:00:00.000Z',
  )

  assert.equal(sample.nodeName, 'HK 01')
  assert.equal(sample.delay, 88)
  assert.equal(sample.success, true)
  assert.equal(sample.errorType, undefined)
  assert.equal(
    requested[0],
    'http://mihomo.example:9090/proxies/HK%2001/delay?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=5000',
  )
})

test('records failed delay checks without throwing', async () => {
  const fetchMock: typeof fetch = async () => jsonResponse({ message: 'failed' }, 500)
  const client = new MihomoClient({
    baseUrl: 'http://mihomo.example:9090',
    secret: '',
    fetchImpl: fetchMock,
  })

  const sample = await client.probeNode(
    'HK-01',
    'https://www.gstatic.com/generate_204',
    5000,
    '2026-07-04T00:00:00.000Z',
  )

  assert.equal(sample.success, false)
  assert.equal(sample.delay, null)
  assert.equal(sample.errorType, 'http_500')
})
