import { describe, expect, test } from 'vitest'
import { ledgerEntry, writeLedger } from '../helpers/ledger.js'
import { createTestContext, runCli } from '../helpers/run-cli.js'

/** `count` entries a minute apart, oldest first, ids `e0000000`, `e0000001`, … */
function entries(
  count: number,
  overrides: (index: number) => Record<string, unknown> = () => ({}),
) {
  return Array.from({ length: count }, (_, index) =>
    ledgerEntry({
      id: `e${String(index).padStart(7, '0')}`,
      created_at: new Date(Date.UTC(2026, 9, 1) + index * 60_000).toISOString(),
      prompt: `prompt number ${index}`,
      images: [{ path: `/pics/cosmion-${index}.jpg`, width: 1024, height: 1024, format: 'jpeg' }],
      ...overrides(index),
    }),
  )
}

async function historyIn(home: string, args: string[] = []) {
  return runCli(['history', ...args], { home })
}

function idsOf(json: unknown): string[] {
  return (json as { entries: { id: string }[] }).entries.map((entry) => entry.id)
}

describe('history (Story 5.1, FR-053)', () => {
  test('lists the 20 newest of 50 entries, newest first', async () => {
    const home = createTestContext().home
    writeLedger(home, entries(50))
    const result = await historyIn(home, ['--json'])
    expect(result.exitCode).toBe(0)
    const ids = idsOf(result.json)
    expect(ids).toHaveLength(20)
    expect(ids[0]).toBe('e0000049')
    expect(ids[19]).toBe('e0000030')
  })

  test('newest first goes by created_at, not by the order lines were written', async () => {
    const home = createTestContext().home
    const [a, b, c] = entries(3)
    writeLedger(home, [a, c, b] as Record<string, unknown>[])
    expect(idsOf((await historyIn(home, ['--json'])).json)).toEqual([
      'e0000002',
      'e0000001',
      'e0000000',
    ])
  })

  test('JSON entries are the full ledger entries', async () => {
    const home = createTestContext().home
    const [entry] = entries(1)
    writeLedger(home, [entry as Record<string, unknown>])
    expect((await historyIn(home, ['--json'])).json).toEqual({ entries: [entry] })
  })

  test('text mode shows id, time, model, cost, shortened prompt and path', async () => {
    const home = createTestContext().home
    const longPrompt = `a lighthouse at dusk ${'with waves '.repeat(20)}`
    writeLedger(home, [
      ledgerEntry({
        id: 'abcd1234',
        prompt: longPrompt,
        cost_usd: 0.04,
        images: [{ path: '/pics/lighthouse.jpg', width: 1, height: 1, format: 'jpeg' }],
      }),
    ])
    const result = await historyIn(home)
    expect(result.exitCode).toBe(0)
    const line = result.stdout.split('\n').find((text) => text.startsWith('abcd1234'))
    expect(line).toBeDefined()
    expect(line).toContain('bytedance-seed/seedream-4.5')
    expect(line).toContain('$0.04')
    expect(line).toContain('/pics/lighthouse.jpg')
    expect(line).toMatch(/2026-10-1[78]/)
    expect(line).toContain('a lighthouse at dusk')
    expect(line).toContain('…')
    expect(line).not.toContain(longPrompt.trim())
  })

  test('text mode shows an unknown cost as unknown, and a prompt on one line', async () => {
    const home = createTestContext().home
    writeLedger(home, [ledgerEntry({ cost_usd: null, prompt: 'two\nlines' })])
    const result = await historyIn(home)
    expect(result.stdout).toMatch(/unknown/i)
    expect(result.stdout).toContain('two lines')
  })

  test('an empty ledger lists nothing', async () => {
    const result = await runCli(['history', '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({ entries: [] })
  })

  test('--limit sets how many', async () => {
    const home = createTestContext().home
    writeLedger(home, entries(50))
    const ids = idsOf((await historyIn(home, ['--limit', '5', '--json'])).json)
    expect(ids).toEqual(['e0000049', 'e0000048', 'e0000047', 'e0000046', 'e0000045'])
  })

  test('--limit below 1 exits 2', async () => {
    const result = await runCli(['history', '--limit', '0', '--json'])
    expect(result.exitCode).toBe(2)
  })

  test('--model keeps only that model', async () => {
    const home = createTestContext().home
    writeLedger(
      home,
      entries(10, (index) => ({ model: index % 2 === 0 ? 'a/even' : 'b/odd' })),
    )
    const result = await historyIn(home, ['--model', 'b/odd', '--json'])
    const listed = (result.json as { entries: { model: string }[] }).entries
    expect(listed).toHaveLength(5)
    expect(listed.every((entry) => entry.model === 'b/odd')).toBe(true)
  })

  test('a cut-off last line is skipped with a warning (FR-052)', async () => {
    const home = createTestContext().home
    const whole = JSON.stringify(ledgerEntry({ id: 'cutoff00' }))
    writeLedger(home, [...entries(2), whole.slice(0, 50)])
    const result = await historyIn(home, ['--json'])
    expect(result.exitCode).toBe(0)
    expect(idsOf(result.json)).toEqual(['e0000001', 'e0000000'])
    expect(result.stderr).toMatch(/warning:.*line 3/)
  })

  test('responds in under 1 second with 10,000 entries (SC-005)', async () => {
    const home = createTestContext().home
    writeLedger(home, entries(10_000))
    const start = performance.now()
    const result = await historyIn(home, ['--json'])
    const elapsed = performance.now() - start
    expect(result.exitCode).toBe(0)
    expect(idsOf(result.json)[0]).toBe('e0009999')
    expect(elapsed).toBeLessThan(1000)
  })
})
