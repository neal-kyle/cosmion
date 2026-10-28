import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ledgerEntry, writeLedger } from '../helpers/ledger.js'
import { createTestContext, runCli } from '../helpers/run-cli.js'

describe('show (Story 5.2, 5.3, FR-054)', () => {
  test('prints the full entry, marking each image as at its saved path or not', async () => {
    const first = createTestContext()
    const kept = join(first.cwd, 'kept.jpg')
    const moved = join(first.cwd, 'moved.jpg')
    writeFileSync(kept, 'image bytes')
    const entry = ledgerEntry({
      id: 'abcd1234',
      images: [
        { path: kept, width: 1024, height: 1024, format: 'jpeg' },
        { path: moved, width: 1024, height: 1024, format: 'jpeg' },
      ],
    })
    writeLedger(first.home, [ledgerEntry({ id: 'other000' }), entry])

    const result = await runCli(['show', 'abcd1234', '--json'], { home: first.home })
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({
      ...entry,
      images: [
        { path: kept, width: 1024, height: 1024, format: 'jpeg', exists: true },
        { path: moved, width: 1024, height: 1024, format: 'jpeg', exists: false },
      ],
    })
  })

  test('text mode shows the entry and says which image is no longer at its path', async () => {
    const first = createTestContext()
    const kept = join(first.cwd, 'kept.jpg')
    writeFileSync(kept, 'image bytes')
    writeLedger(first.home, [
      ledgerEntry({
        id: 'abcd1234',
        prompt: 'a lighthouse at dusk, with a long prompt that is shown in full here',
        images: [
          { path: kept, width: 2560, height: 1440, format: 'jpeg' },
          { path: '/nowhere/moved.jpg', width: 2560, height: 1440, format: 'jpeg' },
        ],
      }),
    ])
    const result = await runCli(['show', 'abcd1234'], { home: first.home })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('abcd1234')
    expect(result.stdout).toContain(
      'a lighthouse at dusk, with a long prompt that is shown in full here',
    )
    expect(result.stdout).toContain('$0.04')
    const keptLine = result.stdout.split('\n').find((line) => line.includes(kept))
    const movedLine = result.stdout.split('\n').find((line) => line.includes('/nowhere/moved.jpg'))
    expect(keptLine).not.toMatch(/missing/i)
    expect(movedLine).toMatch(/missing/i)
  })

  test('an unknown id exits 5', async () => {
    const first = createTestContext()
    writeLedger(first.home, [ledgerEntry({ id: 'abcd1234' })])
    const result = await runCli(['show', 'zzzz9999', '--json'], { home: first.home })
    expect(result.exitCode).toBe(5)
    expect(result.json).toMatchObject({ error: { code: 'not_found' } })
  })

  test('with no ledger at all, any id exits 5', async () => {
    const result = await runCli(['show', 'abcd1234', '--json'])
    expect(result.exitCode).toBe(5)
  })
})
