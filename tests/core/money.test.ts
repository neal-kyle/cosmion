import { expect, test } from 'vitest'
import { toNano, toUsd } from '../../src/core/money.js'

test('USD becomes whole nano-dollars and back', () => {
  expect(toNano(0.04)).toBe(40_000_000)
  expect(toNano(1)).toBe(1_000_000_000)
  expect(toNano(0)).toBe(0)
  expect(toUsd(40_000_000)).toBe(0.04)
})

test('0.2 − 4 × 0.04 leaves exactly 0.04, where floating point does not', () => {
  expect(0.2 - 0.04 - 0.04 - 0.04 - 0.04).not.toBe(0.04)
  const left = toNano(0.2) - 4 * toNano(0.04)
  expect(toUsd(left)).toBe(0.04)
  expect(left >= toNano(0.04)).toBe(true)
})

test('per-token prices below a millionth of a dollar survive the round trip', () => {
  for (const price of [3e-7, 1e-6, 2e-6, 3e-5, 6.6e-5, 0.00012]) {
    expect(Number.isInteger(toNano(price))).toBe(true)
    expect(toUsd(toNano(price))).toBe(price)
  }
  expect(toNano(3e-7)).toBe(300)
})

test('token counts × a per-token price sum exactly', () => {
  // Gemini 2.5 Flash Image, live 2026-10-17: 1290 image tokens at $0.00003.
  expect(toUsd(1290 * toNano(3e-5))).toBe(0.0387)
})
