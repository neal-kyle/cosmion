import { expect, test } from 'vitest'
import { formatUsd } from '../../src/cli/output.js'

test.each([
  [0.04, '$0.04'],
  [0.007, '$0.007'],
  [0.0387, '$0.0387'],
  [0.03872, '$0.0387'],
  [0.000123, '$0.000123'],
  [0.031378, '$0.0314'],
  [0.09, '$0.09'],
  [0.5, '$0.5'],
  [0, '$0'],
])('under a dollar, three significant figures without trailing zeros: %d → %s', (usd, text) => {
  expect(formatUsd(usd)).toBe(text)
})

test.each([
  [1.25, '$1.25'],
  [12.34, '$12.34'],
  [1, '$1.00'],
  [12.345678, '$12.35'],
  // Rounds up to a dollar, so it's shown like one.
  [0.99951, '$1.00'],
])('from a dollar, two decimals: %d → %s', (usd, text) => {
  expect(formatUsd(usd)).toBe(text)
})

test('at_most is prefixed ≤, estimate ~, exact nothing (FR-037)', () => {
  expect(formatUsd(0.09, 'at_most')).toBe('≤$0.09')
  expect(formatUsd(0.0387, 'estimate')).toBe('~$0.0387')
  expect(formatUsd(0.04, 'exact')).toBe('$0.04')
})
