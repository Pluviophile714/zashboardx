import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const tokensSource = readFileSync(
  new URL('../../assets/styles/theme/tokens.css', import.meta.url),
  'utf8',
)

test('keeps the historical low-latency green across built-in themes', () => {
  assert.match(tokensSource, /--color-low-latency:\s*oklch\(0\.648 0\.15 160\)/)
  assert.doesNotMatch(tokensSource, /\[data-theme='light-neutral'\],[\s\S]*?--color-low-latency/)
})
