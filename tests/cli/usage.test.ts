import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ledgerEntry, writeLedger } from '../helpers/ledger.js'
import { createTestContext, runCli } from '../helpers/run-cli.js'

interface Group {
  key: string
  total_usd: number
  generations: number
  images: number
  unknown_cost_count: number
}
interface Usage extends Omit<Group, 'key'> {
  since: string
  until: string
  by: string
  groups: Group[]
}

const originalTz = process.env.TZ

/** Runs `usage` with the ledger holding these entries, `now` fixed. */
async function usage(entries: Record<string, unknown>[], args: string[] = []) {
  const { home } = createTestContext()
  writeLedger(home, entries)
  return runCli(['usage', ...args], { home })
}

/** An entry at a local time in the current TZ: [year, month (1-12), day, hour]. */
function at(time: [number, number, number, number], overrides: Record<string, unknown> = {}) {
  const [year, month, day, hour] = time
  return ledgerEntry({
    id: Math.random().toString(36).slice(2, 10).padEnd(8, '0'),
    created_at: new Date(year, month - 1, day, hour).toISOString(),
    ...overrides,
  })
}

const twoImages = [
  { path: '/a-1.jpg', width: 1, height: 1, format: 'jpeg' },
  { path: '/a-2.jpg', width: 1, height: 1, format: 'jpeg' },
]

for (const tz of ['UTC', 'America/Los_Angeles']) {
  describe(`usage in ${tz} (Story 8, FR-080–FR-082)`, () => {
    beforeEach(() => {
      process.env.TZ = tz
      // Noon on 2026-10-28, local time.
      vi.useFakeTimers({ now: new Date(2026, 9, 28, 12), toFake: ['Date'] })
    })
    afterEach(() => {
      vi.useRealTimers()
      process.env.TZ = originalTz
    })

    test('by default, the last 30 days grouped by model (Story 8.1)', async () => {
      const result = await usage(
        [
          at([2026, 9, 1, 10], { model: 'a/one', cost_usd: 9 }), // too old
          at([2026, 10, 1, 10], { model: 'a/one', cost_usd: 0.04 }),
          at([2026, 10, 20, 10], { model: 'a/one', cost_usd: 0.06, images: twoImages }),
          at([2026, 10, 27, 10], { model: 'b/two', cost_usd: 0.5 }),
        ],
        ['--json'],
      )
      expect(result.exitCode).toBe(0)
      const data = result.json as Usage
      expect(data.by).toBe('model')
      expect(data.total_usd).toBeCloseTo(0.6, 9)
      expect(data.generations).toBe(3)
      expect(data.images).toBe(4)
      expect(data.unknown_cost_count).toBe(0)
      expect(data.groups.map((group) => group.key).sort()).toEqual(['a/one', 'b/two'])
      const one = data.groups.find((group) => group.key === 'a/one')
      expect(one).toMatchObject({ generations: 2, images: 3 })
      expect(one?.total_usd).toBeCloseTo(0.1, 9)
      expect(new Date(data.until).getTime()).toBe(new Date(2026, 9, 28, 12).getTime())
      expect(new Date(data.since).getTime()).toBe(new Date(2026, 8, 28, 12).getTime())
    })

    test('--since <date> --by day lists every day from that date, empty days too (Story 8.2)', async () => {
      const result = await usage(
        [
          at([2026, 10, 25, 0], { cost_usd: 0.04 }),
          at([2026, 10, 25, 23], { cost_usd: 0.02 }),
          at([2026, 10, 27, 9], { cost_usd: 0.01 }),
          at([2026, 10, 24, 23], { cost_usd: 1 }), // the day before
        ],
        ['--since', '2026-10-25', '--by', 'day', '--json'],
      )
      const data = result.json as Usage
      expect(data.groups.map((group) => group.key)).toEqual([
        '2026-10-25',
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
      ])
      expect(data.groups.map((group) => group.generations)).toEqual([2, 0, 1, 0])
      expect(data.groups[0]?.total_usd).toBeCloseTo(0.06, 9)
      expect(data.groups[1]?.total_usd).toBe(0)
      expect(new Date(data.since).getTime()).toBe(new Date(2026, 9, 25).getTime())
    })

    test('--until includes that whole day', async () => {
      const result = await usage(
        [at([2026, 10, 10, 23], { cost_usd: 0.04 }), at([2026, 10, 11, 0], { cost_usd: 1 })],
        ['--since', '2026-10-10', '--until', '2026-10-10', '--json'],
      )
      const data = result.json as Usage
      expect(data.generations).toBe(1)
      expect(data.total_usd).toBeCloseTo(0.04, 9)
      expect(new Date(data.until).getTime()).toBe(new Date(2026, 9, 11).getTime())
    })

    test('7d and 30d count back from now', async () => {
      const entries = [
        at([2026, 10, 22, 13], { cost_usd: 0.01 }),
        at([2026, 10, 21, 11], { cost_usd: 0.1 }),
      ]
      const week = (await usage(entries, ['--since', '7d', '--json'])).json as Usage
      expect(week.generations).toBe(1)
      const month = (await usage(entries, ['--since', '30d', '--json'])).json as Usage
      expect(month.generations).toBe(2)
    })

    test('unknown costs are counted apart, not as $0 (Story 8.3, FR-081)', async () => {
      const result = await usage(
        [
          at([2026, 10, 27, 10], { model: 'a/one', cost_usd: 0.04 }),
          at([2026, 10, 27, 11], { model: 'a/one', cost_usd: null }),
        ],
        ['--json'],
      )
      const data = result.json as Usage
      expect(data.total_usd).toBeCloseTo(0.04, 9)
      expect(data.generations).toBe(2)
      expect(data.unknown_cost_count).toBe(1)
      expect(data.groups[0]?.unknown_cost_count).toBe(1)
    })

    test('text mode shows each group and the total, and says some costs are unknown', async () => {
      const result = await usage([
        at([2026, 10, 27, 10], { model: 'a/one', cost_usd: 0.04 }),
        at([2026, 10, 27, 11], { model: 'b/two', cost_usd: null }),
      ])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('a/one')
      expect(result.stdout).toContain('b/two')
      expect(result.stdout).toContain('$0.04')
      expect(result.stdout).toMatch(/1 .*unknown/i)
    })
  })
}

describe('usage input', () => {
  for (const args of [
    ['--since', '2026-13-01'],
    ['--since', '2026-02-30'],
    ['--since', 'yesterday'],
    ['--until', '10x'],
    ['--by', 'week'],
  ]) {
    test(`${args.join(' ')} exits 2`, async () => {
      const result = await runCli(['usage', ...args, '--json'])
      expect(result.exitCode).toBe(2)
    })
  }

  test('--since after --until exits 2', async () => {
    const result = await runCli([
      'usage',
      '--since',
      '2026-10-10',
      '--until',
      '2026-10-01',
      '--json',
    ])
    expect(result.exitCode).toBe(2)
  })

  test('an empty ledger is all zeros', async () => {
    const result = await runCli(['usage', '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toMatchObject({ total_usd: 0, generations: 0, images: 0, groups: [] })
  })
})
