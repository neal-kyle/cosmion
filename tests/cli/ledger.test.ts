import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  appendEntry,
  findNewestMatch,
  type LedgerEntry,
  ledgerFile,
  readLedger,
} from '../../src/cli/ledger.js'
import { ledgerEntry, writeLedger } from '../helpers/ledger.js'
import { createTestContext } from '../helpers/run-cli.js'

describe('reading the ledger', () => {
  test('no ledger file is an empty ledger', async () => {
    const t = createTestContext()
    expect(await readLedger(t.ctx)).toEqual([])
    expect(t.stderr()).toBe('')
  })

  test('entries are parsed in file order (FR-050)', async () => {
    const t = createTestContext()
    const first = ledgerEntry({ id: 'aaaaaaa1' })
    const second = ledgerEntry({ id: 'aaaaaaa2', cost_usd: null, usage: null, provider: null })
    writeLedger(t.home, [first, second])
    expect(await readLedger(t.ctx)).toEqual([first, second])
    expect(t.stderr()).toBe('')
  })

  test('a cut-off line is skipped with a warning; the other entries are unaffected', async () => {
    const t = createTestContext()
    const whole = JSON.stringify(ledgerEntry({ id: 'aaaaaaa2' }))
    writeLedger(t.home, [ledgerEntry({ id: 'aaaaaaa1' }), whole.slice(0, 40)])
    const entries = await readLedger(t.ctx)
    expect(entries.map((entry) => entry.id)).toEqual(['aaaaaaa1'])
    expect(t.stderr()).toMatch(/warning:.*line 2/)
  })

  test('a line that parses but is not an entry is skipped with a warning', async () => {
    const t = createTestContext()
    const { id: _, ...noId } = ledgerEntry()
    writeLedger(t.home, [noId, ledgerEntry({ id: 'aaaaaaa2' })])
    const entries = await readLedger(t.ctx)
    expect(entries.map((entry) => entry.id)).toEqual(['aaaaaaa2'])
    expect(t.stderr()).toMatch(/warning:.*line 1/)
  })

  test('an entry with an unknown v is skipped with a warning (FR-052)', async () => {
    const t = createTestContext()
    writeLedger(t.home, [ledgerEntry({ v: 2, id: 'aaaaaaa1' }), ledgerEntry({ id: 'aaaaaaa2' })])
    const entries = await readLedger(t.ctx)
    expect(entries.map((entry) => entry.id)).toEqual(['aaaaaaa2'])
    expect(t.stderr()).toMatch(/warning:.*line 1.*newer/i)
  })

  test('unknown fields pass through (FR-052)', async () => {
    const t = createTestContext()
    writeLedger(t.home, [ledgerEntry({ added_later: { x: 1 } })])
    const [entry] = await readLedger(t.ctx)
    expect(entry).toMatchObject({ added_later: { x: 1 } })
  })

  test('blank lines are not warned about', async () => {
    const t = createTestContext()
    writeLedger(t.home, [ledgerEntry(), '', '  '])
    expect(await readLedger(t.ctx)).toHaveLength(1)
    expect(t.stderr()).toBe('')
  })
})

describe('finding the newest entry with the same model and settings', () => {
  const model = 'google/gemini-2.5-flash-image'
  const entries = [
    ledgerEntry({ id: 'aaaaaaa1', model, settings: { aspect_ratio: '1:1', seed: 1 } }),
    ledgerEntry({ id: 'aaaaaaa2', model, settings: { aspect_ratio: '1:1', seed: 2 } }),
    ledgerEntry({ id: 'aaaaaaa3', model, settings: { aspect_ratio: '16:9' } }),
    ledgerEntry({ id: 'aaaaaaa4', model: 'other/model', settings: { aspect_ratio: '1:1' } }),
    ledgerEntry({
      id: 'aaaaaaa5',
      model,
      settings: { aspect_ratio: '1:1' },
      references: ['/a.png'],
    }),
  ]

  async function parsed() {
    const t = createTestContext()
    writeLedger(t.home, entries)
    return readLedger(t.ctx)
  }

  test('the newest one wins, whatever its seed', async () => {
    const found = findNewestMatch(await parsed(), model, { aspect_ratio: '1:1' }, 0)
    expect(found?.id).toBe('aaaaaaa2')
  })

  test('the number of references must match', async () => {
    const found = findNewestMatch(await parsed(), model, { aspect_ratio: '1:1' }, 1)
    expect(found?.id).toBe('aaaaaaa5')
  })

  test('other settings or another model: no match', async () => {
    const all = await parsed()
    expect(findNewestMatch(all, model, { aspect_ratio: '4:3' }, 0)).toBeUndefined()
    expect(findNewestMatch(all, model, {}, 0)).toBeUndefined()
    expect(findNewestMatch(all, 'nobody/nothing', { aspect_ratio: '1:1' }, 0)).toBeUndefined()
  })
})

describe('appending (FR-051)', () => {
  const entry = (id: string) => ledgerEntry({ id }) as LedgerEntry

  test('creates the data folder and the file, one line per entry', async () => {
    const t = createTestContext()
    await appendEntry(t.ctx, entry('aaaaaaa1'))
    await appendEntry(t.ctx, entry('aaaaaaa2'))
    const text = readFileSync(ledgerFile(t.ctx.env), 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(
      text
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line).id),
    ).toEqual(['aaaaaaa1', 'aaaaaaa2'])
  })

  test('adds to the end of an existing ledger, leaving its lines as they were', async () => {
    const t = createTestContext()
    const file = writeLedger(t.home, [entry('aaaaaaa1'), 'a cut-off line'])
    const before = readFileSync(file, 'utf8')
    await appendEntry(t.ctx, entry('aaaaaaa2'))
    const after = readFileSync(file, 'utf8')
    expect(after.startsWith(before)).toBe(true)
    expect(JSON.parse(after.slice(before.length))).toEqual(entry('aaaaaaa2'))
  })

  test('many appends at once each land as one complete line', async () => {
    const t = createTestContext()
    const ids = Array.from({ length: 50 }, (_, i) => `aaaa${String(i).padStart(4, '0')}`)
    await Promise.all(ids.map((id) => appendEntry(t.ctx, entry(id))))
    const entries = await readLedger(t.ctx)
    expect(entries.map((e) => e.id).sort()).toEqual(ids)
    expect(t.stderr()).toBe('')
  })
})
