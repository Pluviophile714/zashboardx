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
          all: ['Auto', 'HK-01', 'DIRECT', 'REJECT'],
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
