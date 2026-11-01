import { describe, expect, test } from 'vitest'
import {
  type RowResult,
  type ScheduledRow,
  type ScheduleInput,
  schedule,
} from '../../src/core/batch.js'
import { CosmionError } from '../../src/core/errors.js'
import { toNano } from '../../src/core/money.js'

interface FakeRow {
  /** What OpenRouter charged; null when it didn't say. Default: the row's price. */
  cost?: number | null
  /** Fails with this error code. */
  error?: 'upstream' | 'rate_limited' | 'usage' | 'credits' | 'auth'
  /** Failed before anything was charged (default for an error). */
  charged?: boolean
  /** How many event-loop turns the row takes. Default 1. */
  ticks?: number
}

/**
 * Runs the scheduler with rows that finish after a number of microtask turns, recording
 * the order rows start in and how many ran at once.
 */
async function runFake(
  rows: (ScheduledRow & FakeRow)[],
  options: Partial<Omit<ScheduleInput, 'rows' | 'runRow'>> = {},
) {
  const started: number[] = []
  let running = 0
  let maxRunning = 0
  /** Rows running when each row started. */
  const runningAtStart = new Map<number, number[]>()
  const live = new Set<number>()
  const byRow = new Map(rows.map((row) => [row.row, row]))

  const result = await schedule({
    rows: rows.map(({ row, group, price }) => ({ row, group, price })),
    budget: 1,
    spent: 0,
    concurrency: 2,
    unknownCostMessage: 'unknown cost: continue with --no-budget',
    ...options,
    async runRow(row): Promise<RowResult> {
      const fake = byRow.get(row) as ScheduledRow & FakeRow
      started.push(row)
      runningAtStart.set(row, [...live])
      live.add(row)
      running++
      maxRunning = Math.max(maxRunning, running)
      for (let i = 0; i < (fake.ticks ?? 1); i++) await Promise.resolve()
      running--
      live.delete(row)
      if (fake.error) {
        return {
          charged: fake.charged ?? false,
          costUsd: fake.charged ? (fake.cost ?? null) : null,
          error: { code: fake.error, message: `${fake.error} on row ${row}` },
        }
      }
      return {
        charged: true,
        costUsd: fake.cost === undefined ? fake.price : fake.cost,
        error: null,
      }
    },
  })
  const statuses = Object.fromEntries(result.rows.map((row) => [row.row, row.status]))
  return { result, started, maxRunning, runningAtStart, statuses }
}

const known = (row: number, price: number, extra: FakeRow = {}) => ({
  row,
  group: 'a',
  price,
  ...extra,
})

describe('the batch scheduler (FR-073, FR-075)', () => {
  test('rows start in file order', async () => {
    const rows = [1, 2, 3, 4, 5].map((row) => known(row, 0.01, { ticks: 6 - row }))
    const { started } = await runFake(rows, { concurrency: 3 })
    expect(started).toEqual([1, 2, 3, 4, 5])
  })

  test('5 rows at $0.04 with a $0.20 budget all run and spend $0.20 (Story 7.1)', async () => {
    const rows = [1, 2, 3, 4, 5].map((row) => known(row, 0.04))
    const { result, statuses } = await runFake(rows, { budget: 0.2 })
    expect(Object.values(statuses)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(toNano(result.spent)).toBe(toNano(0.2))
    expect(result.stopped).toBeNull()
  })

  test('with a $0.10 budget, 2 run and 3 are skipped_budget (Story 7.2)', async () => {
    const rows = [1, 2, 3, 4, 5].map((row) => known(row, 0.04))
    const { result, statuses } = await runFake(rows, { budget: 0.1 })
    expect(statuses).toEqual({
      1: 'ok',
      2: 'ok',
      3: 'skipped_budget',
      4: 'skipped_budget',
      5: 'skipped_budget',
    })
    expect(toNano(result.spent)).toBe(toNano(0.08))
  })

  test('a row that does not fit waits for a running row, then is checked again', async () => {
    // Row 1 costs less than listed, which frees room for row 2.
    const rows = [known(1, 0.06, { cost: 0.03, ticks: 3 }), known(2, 0.06)]
    const { statuses, runningAtStart } = await runFake(rows, { budget: 0.1 })
    expect(statuses).toEqual({ 1: 'ok', 2: 'ok' })
    expect(runningAtStart.get(2)).toEqual([])
  })

  test('the prices of running rows count against the budget', async () => {
    const rows = [known(1, 0.04, { ticks: 5 }), known(2, 0.04), known(3, 0.04)]
    const { runningAtStart, statuses } = await runFake(rows, { budget: 0.1, concurrency: 3 })
    expect(runningAtStart.get(2)).toEqual([1])
    // 0.04 spent or running twice leaves 0.02: row 3 can never fit.
    expect(statuses[3]).toBe('skipped_budget')
  })

  test('a skipped row does not stop later, cheaper rows', async () => {
    const rows = [
      known(1, 0.08),
      { row: 2, group: 'b', price: 0.05 },
      { row: 3, group: 'c', price: 0.01 },
    ]
    const { statuses } = await runFake(rows, { budget: 0.1, concurrency: 1 })
    expect(statuses).toEqual({ 1: 'ok', 2: 'skipped_budget', 3: 'ok' })
  })

  test('concurrency is never exceeded', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => known(i + 1, 0.01, { ticks: (i % 4) + 1 }))
    for (const concurrency of [1, 2, 3, 8]) {
      const { maxRunning } = await runFake(rows, { budget: null, concurrency })
      expect(maxRunning).toBe(Math.min(concurrency, rows.length))
    }
  })

  test('already-spent money (resume) counts', async () => {
    const rows = [1, 2, 3].map((row) => known(row, 0.04))
    const { statuses, result } = await runFake(rows, { budget: 0.2, spent: 0.12 })
    expect(statuses).toEqual({ 1: 'ok', 2: 'ok', 3: 'skipped_budget' })
    expect(toNano(result.spent)).toBe(toNano(0.2))
  })

  test('spending is the sum of actual costs, not prices', async () => {
    const rows = [known(1, 0.04, { cost: 0.03 }), known(2, 0.04, { cost: 0.035 })]
    const { result } = await runFake(rows)
    expect(toNano(result.spent)).toBe(toNano(0.065))
  })

  describe('unknown prices', () => {
    const unknown = (row: number, extra: FakeRow = {}) => ({
      row,
      group: 'u',
      price: null,
      ...extra,
    })

    test('an unknown-price row waits until nothing runs, then runs alone', async () => {
      const rows = [known(1, 0.01, { ticks: 4 }), unknown(2, { cost: 0.01 }), known(3, 0.01)]
      const { runningAtStart, statuses } = await runFake(rows, { concurrency: 3 })
      expect(runningAtStart.get(2)).toEqual([])
      expect(runningAtStart.get(3)).toEqual([])
      expect(statuses).toEqual({ 1: 'ok', 2: 'ok', 3: 'ok' })
    })

    test('its actual cost prices the rest of its group (Story 7.6)', async () => {
      const rows = [1, 2, 3, 4].map((row) => unknown(row, { cost: 0.03 }))
      const { result, statuses, runningAtStart } = await runFake(rows, { budget: 0.1 })
      // Row 1 alone ($0.03), then 0.03 per row: rows 2 and 3 fit in $0.10, row 4 doesn't.
      expect(statuses).toEqual({ 1: 'ok', 2: 'ok', 3: 'ok', 4: 'skipped_budget' })
      expect(runningAtStart.get(3)).toEqual([2])
      expect(result.rows.find((row) => row.row === 2)?.price).toBe(0.03)
      expect(toNano(result.spent)).toBe(toNano(0.09))
    })

    test('it starts only while spent < budget, otherwise it is skipped_budget', async () => {
      const rows = [known(1, 0.1), unknown(2)]
      const { statuses } = await runFake(rows, { budget: 0.1 })
      expect(statuses).toEqual({ 1: 'ok', 2: 'skipped_budget' })
    })

    test('a group still unknown after a failed row keeps running its rows alone', async () => {
      const rows = [unknown(1, { error: 'upstream' }), unknown(2, { cost: 0.02 }), unknown(3)]
      const { statuses, runningAtStart } = await runFake(rows, { concurrency: 3 })
      expect(statuses).toEqual({ 1: 'failed', 2: 'ok', 3: 'ok' })
      expect(runningAtStart.get(2)).toEqual([])
    })
  })

  describe('a finished row dearer than its price (FR-073)', () => {
    test('raises its group price for rows not yet started', async () => {
      const rows = [1, 2, 3, 4].map((row) => known(row, 0.02, { cost: 0.04 }))
      const { statuses, result } = await runFake(rows, { budget: 0.1, concurrency: 1 })
      // 0.04 + 0.04 spent; row 3 is now priced 0.04 and doesn't fit in the 0.02 left.
      expect(statuses).toEqual({ 1: 'ok', 2: 'ok', 3: 'skipped_budget', 4: 'skipped_budget' })
      expect(result.rows.find((row) => row.row === 2)?.price).toBe(0.04)
    })

    test('only its own group', async () => {
      const rows = [
        known(1, 0.02, { cost: 0.04 }),
        { row: 2, group: 'b', price: 0.02 },
        { row: 3, group: 'b', price: 0.02 },
      ]
      const { result } = await runFake(rows, { concurrency: 1 })
      expect(result.rows.map((row) => row.price)).toEqual([0.02, 0.02, 0.02])
    })

    test('prices are never lowered', async () => {
      const rows = [known(1, 0.04, { cost: 0.01 }), known(2, 0.04)]
      const { result } = await runFake(rows, { concurrency: 1 })
      expect(result.rows.find((row) => row.row === 2)?.price).toBe(0.04)
    })
  })

  describe('failures and stops', () => {
    test('a retryable or usage failure marks the row failed and the batch goes on', async () => {
      const rows = [
        known(1, 0.01, { error: 'upstream' }),
        known(2, 0.01, { error: 'usage' }),
        known(3, 0.01),
      ]
      const { statuses, result } = await runFake(rows, { concurrency: 1 })
      expect(statuses).toEqual({ 1: 'failed', 2: 'failed', 3: 'ok' })
      expect(result.stopped).toBeNull()
      expect(toNano(result.spent)).toBe(toNano(0.01))
    })

    for (const code of ['credits', 'auth'] as const) {
      test(`a ${code} error stops new rows; running rows finish; the rest are not_run`, async () => {
        const rows = [
          known(1, 0.01, { ticks: 5 }),
          known(2, 0.01, { error: code, ticks: 1 }),
          known(3, 0.01),
          known(4, 0.01),
        ]
        const { statuses, result, started } = await runFake(rows, { budget: null })
        expect(statuses).toEqual({ 1: 'ok', 2: 'failed', 3: 'not_run', 4: 'not_run' })
        expect(started).toEqual([1, 2])
        expect(result.stopped).toEqual({ code, message: `${code} on row 2` })
      })
    }

    test('a charged failure counts its cost', async () => {
      const rows = [known(1, 0.04, { error: 'upstream', charged: true, cost: 0.04 })]
      const { result, statuses } = await runFake(rows)
      expect(statuses[1]).toBe('failed')
      expect(toNano(result.spent)).toBe(toNano(0.04))
    })

    test('a runRow that throws stops new rows, lets running ones finish, and rethrows', async () => {
      const finished: number[] = []
      const run = schedule({
        rows: [1, 2, 3].map((row) => ({ row, group: 'a', price: 0.01 })),
        budget: null,
        spent: 0,
        concurrency: 2,
        unknownCostMessage: '',
        async runRow(row) {
          await Promise.resolve()
          if (row === 1) throw new CosmionError('internal', 'interrupted')
          await Promise.resolve()
          finished.push(row)
          return { charged: true, costUsd: 0.01, error: null }
        },
      })
      await expect(run).rejects.toThrow('interrupted')
      expect(finished).toEqual([2])
    })
  })

  describe('no usage.cost (FR-073a)', () => {
    test('a known price counts as spent', async () => {
      const rows = [known(1, 0.04, { cost: null }), known(2, 0.04)]
      const { result, statuses } = await runFake(rows)
      expect(statuses).toEqual({ 1: 'ok', 2: 'ok' })
      expect(toNano(result.spent)).toBe(toNano(0.08))
    })

    test('an unknown price stops the batch: no new rows, the rest not_run', async () => {
      const rows = [{ row: 1, group: 'u', price: null, cost: null }, known(2, 0.01), known(3, 0.01)]
      const { result, statuses } = await runFake(rows)
      expect(statuses).toEqual({ 1: 'ok', 2: 'not_run', 3: 'not_run' })
      expect(result.stopped).toEqual({
        code: 'unknown_cost',
        message: 'unknown cost: continue with --no-budget',
      })
    })

    test('without a budget, it does not stop anything', async () => {
      const rows = [{ row: 1, group: 'u', price: null, cost: null }, known(2, 0.01)]
      const { result, statuses } = await runFake(rows, { budget: null })
      expect(statuses).toEqual({ 1: 'ok', 2: 'ok' })
      expect(result.stopped).toBeNull()
    })
  })

  test('with no budget, a row starts whenever a slot is free, whatever its price', async () => {
    const rows = [
      { row: 1, group: 'u', price: null, ticks: 3 },
      known(2, 1000, { ticks: 3 }),
      { row: 3, group: 'u', price: null },
    ]
    const { statuses, runningAtStart } = await runFake(rows, { budget: null, concurrency: 3 })
    expect(statuses).toEqual({ 1: 'ok', 2: 'ok', 3: 'ok' })
    expect(runningAtStart.get(3)).toEqual([1, 2])
  })
})

/** A small seeded random generator, so a failing case can be reproduced. */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

describe('SC-008: never over budget', () => {
  const PRICES = [0.003, 0.01, 0.02, 0.04, 0.05, 0.12]

  function randomRows(next: () => number, withUnknown: boolean) {
    const groups = Array.from({ length: 4 }, (_, i) => ({
      group: `g${i}`,
      price: (PRICES[Math.floor(next() * PRICES.length)] ?? 0.01) * (1 + Math.floor(next() * 3)),
      unknown: withUnknown && next() < 0.5,
    }))
    const count = 1 + Math.floor(next() * 15)
    return Array.from({ length: count }, (_, i) => {
      const group = groups[Math.floor(next() * groups.length)] ?? (groups[0] as (typeof groups)[0])
      return {
        row: i + 1,
        group: group.group,
        price: group.unknown ? null : group.price,
        // Charged as listed; an unknown group is charged its hidden price (count included).
        cost: group.price,
        ticks: 1 + Math.floor(next() * 4),
        error: next() < 0.1 ? ('upstream' as const) : undefined,
      }
    })
  }

  test('every price known and charged as listed: never more than the budget', async () => {
    const next = random(1)
    for (let i = 0; i < 300; i++) {
      const rows = randomRows(next, false)
      const budget = Math.round(next() * 40) / 100 + 0.01
      const spent = next() < 0.2 ? Math.round(next() * budget * 100) / 100 : 0
      const concurrency = 1 + Math.floor(next() * 8)
      const { result } = await runFake(rows, { budget, spent, concurrency })
      expect(toNano(result.spent), `case ${i}`).toBeLessThanOrEqual(toNano(Math.max(budget, spent)))
    }
  })

  test('some unknown: never more than the budget plus one row', async () => {
    const next = random(2)
    for (let i = 0; i < 300; i++) {
      const rows = randomRows(next, true)
      const budget = Math.round(next() * 40) / 100 + 0.01
      const concurrency = 1 + Math.floor(next() * 8)
      const { result } = await runFake(rows, { budget, concurrency })
      const dearest = Math.max(...rows.map((row) => row.cost))
      expect(toNano(result.spent), `case ${i}`).toBeLessThanOrEqual(toNano(budget + dearest))
    }
  })

  test('charged more than listed: rows started after the first dearer row finishes use the actual cost', async () => {
    const next = random(3)
    for (let i = 0; i < 200; i++) {
      const listed = 0.02
      const actual = 0.02 * (2 + Math.floor(next() * 3))
      const count = 2 + Math.floor(next() * 10)
      const rows = Array.from({ length: count }, (_, k) =>
        known(k + 1, listed, { cost: actual, ticks: 1 + Math.floor(next() * 3) }),
      )
      const budget = 0.05 + Math.round(next() * 30) / 100
      const concurrency = 1 + Math.floor(next() * 4)
      const { result, started } = await runFake(rows, { budget, concurrency })

      // Overspend is bounded by the rows already running when the first dearer one finished.
      const overspend = (actual - listed) * concurrency
      expect(toNano(result.spent), `case ${i}`).toBeLessThanOrEqual(toNano(budget + overspend))
      // Once a row is priced at the actual cost, every row started after it is too, and
      // with one slot, every row after the first.
      const prices = started.map((row) => result.rows.find((r) => r.row === row)?.price)
      const firstRaised = prices.indexOf(actual)
      if (firstRaised !== -1) {
        expect(
          prices.slice(firstRaised).every((price) => price === actual),
          `case ${i}`,
        ).toBe(true)
      }
      if (concurrency === 1) expect(prices.slice(1).every((price) => price === actual)).toBe(true)
    }
  })

  test('a finished row with no cost and no price starts no further rows', async () => {
    const next = random(4)
    for (let i = 0; i < 100; i++) {
      const rows = randomRows(next, true).map((row) =>
        row.price === null ? { ...row, cost: null, error: undefined } : row,
      )
      const { result } = await runFake(rows, {
        budget: 10,
        concurrency: 1 + Math.floor(next() * 4),
      })
      const firstUnknown = rows.find((row) => row.price === null)
      if (!firstUnknown) continue
      const outcome = result.rows.find((row) => row.row === firstUnknown.row)
      if (outcome?.status !== 'ok') continue
      expect(result.stopped?.code).toBe('unknown_cost')
      for (const row of result.rows.filter((r) => r.row > firstUnknown.row)) {
        expect(row.status).toBe('not_run')
      }
    }
  })
})
