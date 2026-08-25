import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const freshnessKeys = [
  'metricsLive',
  'metricsPolling',
  'metricsStale',
  'metricsWaiting',
  'metricsNoSample',
  'metricsJustNow',
  'metricsLastProbe',
  'metricsSeconds',
  'metricsMinutes',
  'metricsHours',
] as const

test('keeps metrics freshness labels translated in every locale', () => {
  for (const localeFile of ['en.ts', 'zh.ts', 'zh-tw.ts', 'ru.ts']) {
    const source = readFileSync(new URL(`../../i18n/${localeFile}`, import.meta.url), 'utf8')

    for (const key of freshnessKeys) {
      assert.match(
        source,
        new RegExp(`\\b${key}:\\s*'(?!${key}')([^']+)'`),
        `${localeFile} is missing a translation for ${key}`,
      )
    }
  }
})
