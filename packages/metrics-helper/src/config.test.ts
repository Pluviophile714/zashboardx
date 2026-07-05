import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from './config.js'

test('defaults to a short observer collection interval', () => {
  const config = loadConfig({} as NodeJS.ProcessEnv)

  assert.equal(config.probeIntervalSeconds, 30)
})

test('uses scrape interval as the preferred observer collection interval', () => {
  const config = loadConfig({
    SCRAPE_INTERVAL_SECONDS: '60',
    PROBE_INTERVAL_SECONDS: '300',
  } as NodeJS.ProcessEnv)

  assert.equal(config.probeIntervalSeconds, 60)
})

test('keeps probe interval as a backward-compatible collection interval fallback', () => {
  const config = loadConfig({
    PROBE_INTERVAL_SECONDS: '120',
  } as NodeJS.ProcessEnv)

  assert.equal(config.probeIntervalSeconds, 120)
})
