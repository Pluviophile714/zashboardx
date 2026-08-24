import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const localeFiles = ['en.ts', 'zh.ts', 'zh-tw.ts', 'ru.ts']
const localeKeys = [
  'strategyPenetration',
  'collapsePenetration',
  'stepwisePenetration',
  'fullExpansion',
]

test('defines translated labels for proxy penetration controls', () => {
  for (const localeFile of localeFiles) {
    const source = readFileSync(new URL(`../../i18n/${localeFile}`, import.meta.url), 'utf8')

    for (const key of localeKeys) {
      assert.match(
        source,
        new RegExp(`\\b${key}:\\s*'(?!${key}')([^']+)'`),
        `${localeFile} is missing a translation for ${key}`,
      )
    }
  }
})
