import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createFakeOpenRouter, VALID_KEY } from '../helpers/fake-openrouter.js'
import { ledgerEntry, writeLedger } from '../helpers/ledger.js'
import { createTestContext, type RunCliOptions, runCli } from '../helpers/run-cli.js'

const SEEDREAM = 'bytedance-seed/seedream-4.5'
/** Has no seed option. */
const GEMINI = 'google/gemini-3.1-flash-image'
const images = join(import.meta.dirname, '..', 'helpers', 'fixtures', 'images')
const URL_REF = 'https://example.test/style.png'

function setup(entry: Record<string, unknown>) {
  const fake = createFakeOpenRouter()
  const { home, cwd } = createTestContext()
  writeLedger(home, [ledgerEntry({ id: 'other000' }), entry])
  const regen = (args: string[], options: RunCliOptions = {}) =>
    runCli(['regen', ...args], {
      fetch: fake.fetch,
      home,
      cwd,
      ...options,
      env: { OPENROUTER_API_KEY: VALID_KEY, ...options.env },
    })
  const ledger = () =>
    readFileSync(join(home, 'data', 'ledger.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  return { fake, home, cwd, regen, ledger }
}

/** An entry with a local reference file (copied into `folder`) and a URL reference. */
function original(folder: string, overrides: Record<string, unknown> = {}) {
  const ref = join(folder, 'sketch.png')
  copyFileSync(join(images, 'tiny.png'), ref)
  return {
    entry: ledgerEntry({
      id: 'orig0001',
      model: SEEDREAM,
      prompt: 'a lighthouse at dusk',
      settings: { aspect_ratio: '16:9', resolution: '2K', n: 1, seed: 1234 },
      references: [ref, URL_REF],
      ...overrides,
    }),
    ref,
  }
}

describe('regen (Story 9, FR-085, FR-086)', () => {
  test('sends the original model, prompt, settings with seed and references exactly (Story 9.1)', async () => {
    const { cwd } = createTestContext()
    const { entry, ref } = original(cwd)
    const t = setup(entry)
    const result = await t.regen(['orig0001', '--json'])
    expect(result.exitCode).toBe(0)

    const requests = t.fake.imageRequests()
    expect(requests).toHaveLength(1)
    const body = requests[0]?.json as Record<string, unknown>
    expect(body.model).toBe(SEEDREAM)
    expect(body.prompt).toBe('a lighthouse at dusk')
    expect(body).toMatchObject({ aspect_ratio: '16:9', resolution: '2K', n: 1, seed: 1234 })
    expect(body.output_format).toBeUndefined()
    const base64 = readFileSync(ref).toString('base64')
    expect(body.input_references).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
      { type: 'image_url', image_url: { url: URL_REF } },
    ])

    const made = result.json as Record<string, unknown>
    expect(made.regen_of).toBe('orig0001')
    expect(made.id).not.toBe('orig0001')
    expect(made.settings).toEqual({ aspect_ratio: '16:9', resolution: '2K', n: 1, seed: 1234 })
    expect(made.references).toEqual([ref, URL_REF])
    expect(t.ledger().at(-1)).toEqual(made)
  })

  test('saves in the current folder by default, under a new name', async () => {
    const { cwd } = createTestContext()
    const t = setup(original(cwd).entry)
    const result = await t.regen(['orig0001'])
    expect(result.exitCode).toBe(0)
    const path = result.stdout.trim()
    expect(path.startsWith(t.cwd)).toBe(true)
    expect(path).toMatch(/cosmion-[a-z0-9]{8}\.jpg$/)
    expect(existsSync(path)).toBe(true)
  })

  test('--out and --force follow gen (FR-008, FR-011)', async () => {
    const { cwd } = createTestContext()
    const t = setup(original(cwd).entry)
    writeFileSync(join(t.cwd, 'again.jpg'), 'old')
    expect((await t.regen(['orig0001', '--out', 'again.jpg', '--json'])).exitCode).toBe(2)
    expect(t.fake.imageRequests()).toHaveLength(0)
    const forced = await t.regen(['orig0001', '--out', 'again.jpg', '--force', '--json'])
    expect(forced.exitCode).toBe(0)
    expect(readFileSync(join(t.cwd, 'again.jpg'), 'utf8')).not.toBe('old')
  })

  test('--out with an extension does not add an output_format the original did not send', async () => {
    const { cwd } = createTestContext()
    const t = setup(
      original(cwd, { model: 'black-forest-labs/flux.2-klein-4b', settings: { seed: 5 } }).entry,
    )
    await t.regen(['orig0001', '--out', 'x.png', '--json'])
    expect(t.fake.imageRequests()[0]?.json.output_format).toBeUndefined()
  })

  test('a missing local reference exits 2 naming it, with nothing sent (Story 9.2)', async () => {
    const { cwd } = createTestContext()
    const t = setup(original(cwd, { references: [join(cwd, 'gone.png')] }).entry)
    const result = await t.regen(['orig0001', '--json'])
    expect(result.exitCode).toBe(2)
    expect((result.json as { error: { message: string } }).error.message).toContain('gone.png')
    expect(t.fake.imageRequests()).toHaveLength(0)
  })

  test('a model that was removed exits 5', async () => {
    const t = setup(ledgerEntry({ id: 'orig0001', model: 'gone/model', references: [] }))
    const result = await t.regen(['orig0001', '--json'])
    expect(result.exitCode).toBe(5)
    expect(t.fake.imageRequests()).toHaveLength(0)
  })

  test('settings the model no longer supports exit 2 (FR-086)', async () => {
    const t = setup(
      ledgerEntry({
        id: 'orig0001',
        model: SEEDREAM,
        settings: { resolution: '8K' },
        references: [],
      }),
    )
    const result = await t.regen(['orig0001', '--json'])
    expect(result.exitCode).toBe(2)
    expect((result.json as { error: { message: string } }).error.message).toMatch(/resolution/)
    expect(t.fake.imageRequests()).toHaveLength(0)
  })

  test('a setting that is no option at all exits 2', async () => {
    const t = setup(
      ledgerEntry({ id: 'orig0001', model: SEEDREAM, settings: { style: 'x' }, references: [] }),
    )
    const result = await t.regen(['orig0001', '--json'])
    expect(result.exitCode).toBe(2)
    expect((result.json as { error: { message: string } }).error.message).toMatch(/style/)
  })

  test('an entry without a seed re-runs with a warning that the result will differ', async () => {
    const t = setup(
      ledgerEntry({
        id: 'orig0001',
        model: GEMINI,
        settings: { resolution: '1K' },
        references: [],
      }),
    )
    const result = await t.regen(['orig0001', '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toMatch(/warning:.*seed.*identical/i)
    expect(t.fake.imageRequests()[0]?.json.seed).toBeUndefined()
  })

  test('an entry with a seed gives no such warning', async () => {
    const { cwd } = createTestContext()
    const t = setup(original(cwd).entry)
    const result = await t.regen(['orig0001', '--json'])
    expect(result.stderr).not.toMatch(/identical/i)
  })

  test('an unknown id exits 5', async () => {
    const t = setup(ledgerEntry({ id: 'orig0001' }))
    const result = await t.regen(['zzzz9999', '--json'])
    expect(result.exitCode).toBe(5)
    expect(t.fake.imageRequests()).toHaveLength(0)
  })
})
