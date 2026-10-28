import { describe, expect, test } from 'vitest'
import { createFakeOpenRouter } from '../helpers/fake-openrouter.js'
import { ledgerEntry, writeLedger } from '../helpers/ledger.js'
import { createTestContext, runCli } from '../helpers/run-cli.js'

interface Ranked {
  settings: Record<string, string | number>
  models: { id: string; name: string; price: { kind: string; cost_usd: number | null } }[]
}

function setup() {
  const fake = createFakeOpenRouter()
  const { home } = createTestContext()
  const run = (args: string[]) => runCli(args, { fetch: fake.fetch, home })
  return { fake, home, run }
}

/** What `models <id>` says the model supports. */
async function parametersOf(run: (args: string[]) => ReturnType<typeof runCli>, id: string) {
  const result = await run(['models', id, '--json'])
  return (
    result.json as { parameters: Record<string, { type: string; values?: string[]; max?: number }> }
  ).parameters
}

describe('models rank (Story 10, FR-090)', () => {
  test('--resolution 4K: only models that offer 4K, cheapest first, unknown last (Story 10.1)', async () => {
    const t = setup()
    const result = await t.run(['models', 'rank', '--resolution', '4K', '--json'])
    expect(result.exitCode).toBe(0)
    const ranked = result.json as Ranked
    expect(ranked.settings).toEqual({ resolution: '4K' })
    const ids = ranked.models.map((model) => model.id)
    expect(ids).toContain('bytedance-seed/seedream-4.5')
    expect(ids).toContain('google/gemini-3.1-flash-image')
    expect(ids).not.toContain('sourceful/riverflow-v2.5-fast')
    for (const id of ids) {
      expect((await parametersOf(t.run, id)).resolution?.values).toContain('4K')
    }

    const prices = ranked.models.map((model) => model.price.cost_usd)
    const known = prices.filter((price) => price !== null) as number[]
    expect(known).toEqual([...known].sort((a, b) => a - b))
    const firstUnknown = prices.indexOf(null)
    if (firstUnknown !== -1) expect(prices.slice(firstUnknown).every((p) => p === null)).toBe(true)
    expect(ranked.models.at(-1)?.price.kind).toBe('unknown')
  })

  test('each price is what `price` gives for those options', async () => {
    const t = setup()
    const ranked = (await t.run(['models', 'rank', '--resolution', '4K', '--json'])).json as Ranked
    for (const model of ranked.models.slice(0, 3)) {
      const price = await t.run(['price', '-m', model.id, '--resolution', '4K', '--json'])
      expect(price.json).toMatchObject(model.price)
    }
  })

  test('--refs 2 --background transparent (Story 10.2)', async () => {
    const t = setup()
    const ranked = (
      await t.run(['models', 'rank', '--refs', '2', '--background', 'transparent', '--json'])
    ).json as Ranked
    expect(ranked.models.map((model) => model.id)).toEqual(['sourceful/riverflow-v2.5-fast'])
  })

  test('--refs leaves out models that take fewer references, or none', async () => {
    const t = setup()
    const ranked = (await t.run(['models', 'rank', '--refs', '4', '--json'])).json as Ranked
    const ids = ranked.models.map((model) => model.id)
    expect(ids).toContain('black-forest-labs/flux.2-klein-4b')
    expect(ids).not.toContain('google/gemini-2.5-flash-image')
    expect(ids).not.toContain('cosmion-test/no-references')
    expect(ids).not.toContain('krea/krea-2-medium')
  })

  test('a value outside a range leaves the model out', async () => {
    const t = setup()
    const ranked = (await t.run(['models', 'rank', '--count', '6', '--json'])).json as Ranked
    for (const model of ranked.models) {
      expect((await parametersOf(t.run, model.id)).n?.max).toBeGreaterThanOrEqual(6)
    }
    expect(ranked.models.map((model) => model.id)).not.toContain('google/gemini-3.1-flash-image')
  })

  test('estimates from the ledger rank by their number', async () => {
    const t = setup()
    writeLedger(t.home, [
      ledgerEntry({
        model: 'google/gemini-3.1-flash-image',
        settings: { resolution: '4K' },
        references: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        cost_usd: 0.001,
      }),
    ])
    const ranked = (await t.run(['models', 'rank', '--resolution', '4K', '--json'])).json as Ranked
    const gemini = ranked.models.find((model) => model.id === 'google/gemini-3.1-flash-image')
    expect(gemini?.price.kind).toBe('estimate')
    const prices = ranked.models
      .map((model) => model.price.cost_usd)
      .filter((p) => p !== null) as number[]
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  test('with no options, every model is listed', async () => {
    const t = setup()
    const all = (await t.run(['models', '--json'])).json as { models: unknown[] }
    const ranked = (await t.run(['models', 'rank', '--json'])).json as Ranked
    expect(ranked.models).toHaveLength(all.models.length)
    expect(ranked.settings).toEqual({})
  })

  test('text mode shows id, name and price per line', async () => {
    const t = setup()
    const result = await t.run(['models', 'rank', '--resolution', '4K'])
    expect(result.stdout).toMatch(/bytedance-seed\/seedream-4\.5.*\$/)
    expect(result.stdout).toMatch(/Unknown/)
  })

  test('--refs below 0 exits 2', async () => {
    const t = setup()
    expect((await t.run(['models', 'rank', '--refs', '-1', '--json'])).exitCode).toBe(2)
  })
})
