import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createFakeOpenRouter } from '../helpers/fake-openrouter.js'
import { ledgerEntry, writeLedger } from '../helpers/ledger.js'
import { type RunCliOptions, runCli } from '../helpers/run-cli.js'

interface PriceOutput {
  model: string
  settings: Record<string, unknown>
  kind: string
  cost_usd: number | null
  notes: string[]
}

function setup() {
  const fake = createFakeOpenRouter()
  const price = (args: string[], options: RunCliOptions = {}) =>
    runCli(['price', ...args], { fetch: fake.fetch, ...options })
  return { fake, price }
}

const newHome = () => mkdtempSync(join(tmpdir(), 'cosmion-home-'))

describe('the model (FR-002)', () => {
  test.each([['--model'], ['-m']])('comes from %s', async (flag) => {
    const { price } = setup()
    const result = await price([flag, 'bytedance-seed/seedream-4.5', '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({
      model: 'bytedance-seed/seedream-4.5',
      settings: {},
      kind: 'exact',
      cost_usd: 0.04,
      notes: [],
    })
  })

  test('otherwise from COSMION_MODEL', async () => {
    const { price } = setup()
    const result = await price(['--json'], {
      env: { COSMION_MODEL: 'bytedance-seed/seedream-4.5' },
    })
    expect(result.exitCode).toBe(0)
    expect((result.json as PriceOutput).model).toBe('bytedance-seed/seedream-4.5')
  })

  test('--model wins over COSMION_MODEL', async () => {
    const { price } = setup()
    const result = await price(['-m', 'sourceful/riverflow-v2.5-fast', '--json'], {
      env: { COSMION_MODEL: 'bytedance-seed/seedream-4.5' },
    })
    expect((result.json as PriceOutput).model).toBe('sourceful/riverflow-v2.5-fast')
  })

  test('neither: exit 2, suggesting cosmion models, and nothing fetched', async () => {
    const { fake, price } = setup()
    const result = await price(['--json'])
    expect(result.exitCode).toBe(2)
    const { message } = (result.json as { error: { message: string } }).error
    expect(message).toContain('--model')
    expect(message).toContain('COSMION_MODEL')
    expect(message).toContain('cosmion models')
    expect(fake.requests).toEqual([])
  })

  test('an unknown model exits 5', async () => {
    const { price } = setup()
    const result = await price(['-m', 'nobody/nothing', '--json'])
    expect(result.exitCode).toBe(5)
  })
})

describe('options (FR-030)', () => {
  test('the settings are the API fields that would be sent', async () => {
    const { price } = setup()
    const result = await price([
      '-m',
      'bytedance-seed/seedream-4.5',
      '--resolution',
      '2K',
      '--aspect',
      '16:9',
      '-n',
      '2',
      '--seed',
      '5',
      '--json',
    ])
    expect(result.json).toMatchObject({
      settings: { resolution: '2K', aspect_ratio: '16:9', n: 2, seed: 5 },
      kind: 'exact',
      cost_usd: 0.08,
    })
  })

  test.each([
    ['an option the model lacks', ['--quality', 'high'], '--quality'],
    ['a value outside its enum', ['--resolution', '8K'], '--resolution'],
    ['a count outside its range', ['--count', '11'], '--count'],
  ])('%s exits 2 naming the flag and the model', async (_what, args, flag) => {
    const { price } = setup()
    const result = await price(['-m', 'bytedance-seed/seedream-4.5', ...args, '--json'])
    expect(result.exitCode).toBe(2)
    const { message } = (result.json as { error: { message: string } }).error
    expect(message).toContain(flag)
    expect(message).toContain('bytedance-seed/seedream-4.5')
  })

  test('refs are checked like gen, and priced (FR-033)', async () => {
    const { price } = setup()
    const cwd = mkdtempSync(join(tmpdir(), 'cosmion-cwd-'))
    copyFileSync(
      join(import.meta.dirname, '..', 'helpers', 'fixtures', 'images', 'tiny.png'),
      join(cwd, 'a.png'),
    )
    const model = ['-m', 'bytedance-seed/seedream-5-0-pro', '--resolution', '1K']
    const ok = await price([...model, '--ref', 'a.png', '--ref', 'a.png', '--json'], { cwd })
    expect(ok.json).toMatchObject({ kind: 'exact', cost_usd: 0.051 })

    const missing = await price([...model, '--ref', 'missing.png', '--json'], { cwd })
    expect(missing.exitCode).toBe(2)
    const refused = await price(['-m', 'cosmion-test/no-references', '--ref', 'a.png', '--json'], {
      cwd,
    })
    expect(refused.exitCode).toBe(2)
  })

  test('nothing is sent to POST /images', async () => {
    const { fake, price } = setup()
    await price(['-m', 'bytedance-seed/seedream-4.5', '--json'])
    expect(fake.requests.length).toBeGreaterThan(0)
    for (const request of fake.requests) {
      expect(request.method).toBe('GET')
      expect(request.path).toMatch(/^\/images\/models/)
    }
  })
})

describe('estimates from the ledger (FR-034)', () => {
  const gemini = 'google/gemini-2.5-flash-image'

  function seeded(entries: Record<string, unknown>[]) {
    const home = newHome()
    writeLedger(home, entries)
    return home
  }

  const geminiEntry = (overrides: Record<string, unknown> = {}) =>
    ledgerEntry({
      model: gemini,
      settings: { aspect_ratio: '1:1', seed: 99 },
      usage: { prompt_tokens: 17, completion_tokens: 1290, total_tokens: 1307 },
      cost_usd: 0.03872,
      ...overrides,
    })

  test('a per-token model used with the same settings is estimated from its tokens', async () => {
    const { price } = setup()
    const home = seeded([geminiEntry()])
    const result = await price(['-m', gemini, '--aspect', '1:1', '--json'], { home })
    expect(result.json).toMatchObject({ kind: 'estimate', cost_usd: 0.0387051 })
  })

  test('the seed does not matter', async () => {
    const { price } = setup()
    const flux = 'black-forest-labs/flux.2-klein-4b'
    const home = seeded([ledgerEntry({ model: flux, settings: { seed: 99 }, cost_usd: 0.014 })])
    const result = await price(['-m', flux, '--seed', '1', '--json'], { home })
    expect(result.json).toMatchObject({ kind: 'estimate', cost_usd: 0.014 })
  })

  test('other settings do', async () => {
    const { price } = setup()
    const home = seeded([geminiEntry()])
    const result = await price(['-m', gemini, '--aspect', '16:9', '--json'], { home })
    expect(result.json).toMatchObject({ kind: 'unknown', cost_usd: null })
  })

  test('--format matches an entry whose output_format was implied by --out', async () => {
    const { price } = setup()
    const flux = 'black-forest-labs/flux.2-klein-4b'
    const home = seeded([
      ledgerEntry({ model: flux, settings: { output_format: 'png' }, cost_usd: 0.015 }),
    ])
    const matched = await price(['-m', flux, '--format', 'png', '--json'], { home })
    expect(matched.json).toMatchObject({ kind: 'estimate', cost_usd: 0.015 })
    const unmatched = await price(['-m', flux, '--json'], { home })
    expect(unmatched.json).toMatchObject({ kind: 'unknown' })
  })

  test('a bad ledger line is skipped with a warning, and the price still comes out', async () => {
    const { price } = setup()
    const home = newHome()
    writeLedger(home, [geminiEntry(), '{"v": 1, "id": "cut'])
    const result = await price(['-m', gemini, '--aspect', '1:1', '--json'], { home })
    expect(result.exitCode).toBe(0)
    expect(result.json).toMatchObject({ kind: 'estimate' })
    expect(result.stderr).toMatch(/warning:/)
  })
})

describe('text output (FR-037)', () => {
  test('exact: the price', async () => {
    const { price } = setup()
    const result = await price(['-m', 'bytedance-seed/seedream-4.5'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.split('\n')[0]).toBe('$0.04')
  })

  test('at_most: prefixed ≤, with the notes', async () => {
    const { price } = setup()
    const result = await price(['-m', 'bytedance-seed/seedream-5-0-pro'])
    expect(result.stdout.split('\n')[0]).toBe('≤$0.09')
    expect(result.stdout.split('\n').length).toBeGreaterThan(1)
  })

  test('estimate: prefixed ~', async () => {
    const { price } = setup()
    const home = newHome()
    writeLedger(home, [
      ledgerEntry({
        model: 'google/gemini-2.5-flash-image',
        settings: {},
        usage: { prompt_tokens: 17, completion_tokens: 1290, total_tokens: 1307 },
      }),
    ])
    const result = await price(['-m', 'google/gemini-2.5-flash-image'], { home })
    expect(result.stdout.split('\n')[0]).toBe('~$0.0387')
  })

  test('unknown until the first image: says so, with the rate (FR-034a)', async () => {
    const { price } = setup()
    const result = await price(['-m', 'google/gemini-2.5-flash-image'])
    const lines = result.stdout.trim().split('\n')
    expect(lines[0]).toBe('Unknown until the first image with these settings')
    expect(lines[1]).toMatch(/^ {2}Rate per 1M tokens: \$\d.* out/)
    expect(lines).toHaveLength(2)
  })

  test('per megapixel: the rate is spelled out (FR-034a)', async () => {
    const { price } = setup()
    const result = await price(['-m', 'black-forest-labs/flux.2-klein-4b'])
    expect(result.stdout).toMatch(/Rate: \$[\d.]+\/megapixel out/)
  })

  test('no pricing listed: unknown, with no rate', async () => {
    const { price } = setup()
    const result = await price(['-m', 'krea/krea-2-medium'])
    expect(result.stdout.split('\n')[0]).toBe('Unknown')
    expect(result.stdout).not.toContain('Rate')
  })

  test('--json has the rate in notes, and no new field (FR-034a)', async () => {
    const { price } = setup()
    const result = await price(['-m', 'google/gemini-2.5-flash-image', '--json'])
    const output = result.json as PriceOutput
    expect(Object.keys(output).sort()).toEqual(['cost_usd', 'kind', 'model', 'notes', 'settings'])
    expect(output).toMatchObject({ kind: 'unknown', cost_usd: null })
    expect(output.notes.some((note) => note.startsWith('Rate per 1M tokens: '))).toBe(true)
  })
})
