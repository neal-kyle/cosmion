import { describe, expect, test } from 'vitest'
import type { CatalogModel } from '../../src/core/catalog.js'
import type { Settings } from '../../src/core/options.js'
import { type LastMatch, type PriceKind, price, weakestKind } from '../../src/core/pricing.js'
import { loadCatalogFixtures } from '../helpers/fake-openrouter.js'

/** A fixture model with its endpoints, as the catalog holds it. */
function fixture(id: string): CatalogModel {
  const { models, endpoints } = loadCatalogFixtures()
  const found = models.find((model) => model.id === id)
  if (!found) throw new Error(`No fixture model ${id}`)
  return { ...found, endpoints: endpoints[id]?.endpoints ?? [] } as unknown as CatalogModel
}

/** A per-image model with these pricing lines, one endpoint per list. */
function custom(...endpoints: CatalogModel['endpoints'][number]['pricing'][]): CatalogModel {
  const base = fixture('cosmion-test/tiered')
  const template = base.endpoints[0]
  if (!template) throw new Error('the tiered fixture has no endpoint')
  return {
    ...base,
    endpoints: endpoints.map((pricing, i) => ({
      ...template,
      provider_name: `Provider ${i}`,
      pricing,
    })),
  }
}

const out = (cost_usd: number, variant?: string) => ({
  billable: 'output_image',
  unit: 'image',
  cost_usd,
  ...(variant ? { variant } : {}),
})

function priceOf(
  id: string | CatalogModel,
  settings: Settings = {},
  options: { refCount?: number; lastMatch?: LastMatch | null } = {},
) {
  const model = typeof id === 'string' ? fixture(id) : id
  return price(model, { settings, refCount: options.refCount ?? 0 }, options.lastMatch ?? null)
}

const tokens = (prompt_tokens: number, completion_tokens: number, cost_usd: number | null) => ({
  usage: { prompt_tokens, completion_tokens },
  cost_usd,
})

describe('Story 4 scenarios', () => {
  test('1: a per-image model with one line is exact', () => {
    expect(priceOf('bytedance-seed/seedream-4.5')).toEqual({
      kind: 'exact',
      cost_usd: 0.04,
      notes: [],
    })
  })

  test('2: tiered lines: --resolution 2K uses the 2k line exactly', () => {
    expect(priceOf('cosmion-test/tiered', { resolution: '2K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.06,
    })
    expect(priceOf('cosmion-test/tiered', { resolution: '1K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.03,
    })
  })

  test('3: two providers at different prices give the higher, at most', () => {
    const result = priceOf(custom([out(0.04)], [out(0.05)]))
    expect(result).toMatchObject({ kind: 'at_most', cost_usd: 0.05 })
    expect(result.notes.length).toBeGreaterThan(0)
  })

  test('3: two providers at the same price are exact', () => {
    expect(priceOf(custom([out(0.04)], [out(0.04)]))).toMatchObject({
      kind: 'exact',
      cost_usd: 0.04,
    })
  })

  test("4: per-token, used before: last generation's tokens × current per-token prices", () => {
    // Gemini 2.5 Flash Image: input $0.0000003, output $0.00003 per token.
    const result = priceOf(
      'google/gemini-2.5-flash-image',
      {},
      { lastMatch: tokens(17, 1290, 0.04) },
    )
    expect(result).toMatchObject({ kind: 'estimate', cost_usd: 0.0387051 })
  })

  test('5: per-token, never used with these settings: unknown, known after the first image', () => {
    const result = priceOf('google/gemini-2.5-flash-image')
    expect(result).toMatchObject({ kind: 'unknown', cost_usd: null })
    expect(result.notes.join(' ')).toMatch(/after the first image/i)
  })

  test('5: per-megapixel, never used with these settings: unknown', () => {
    const result = priceOf('black-forest-labs/flux.2-klein-4b', { aspect_ratio: '16:9' })
    expect(result).toMatchObject({ kind: 'unknown', cost_usd: null })
    expect(result.notes.join(' ')).toMatch(/after the first image/i)
  })

  test('6: a variant-less line is the base tier; high_resolution is above the lowest', () => {
    expect(priceOf('bytedance-seed/seedream-5-0-pro', { resolution: '1K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.045,
    })
    expect(priceOf('bytedance-seed/seedream-5-0-pro', { resolution: '2K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.09,
    })
  })

  test('7: a per-image model charged differently last time shows that cost, with both figures', () => {
    const result = priceOf(
      'sourceful/riverflow-v2.5-fast',
      { resolution: '1K' },
      { lastMatch: tokens(10, 4096, 0.031378) },
    )
    expect(result).toMatchObject({ kind: 'estimate', cost_usd: 0.031378 })
    expect(result.notes.join(' ')).toContain('0.019')
    expect(result.notes.join(' ')).toContain('0.031378')
  })

  test('8: per-megapixel, used before: the last actual cost', () => {
    const result = priceOf(
      'black-forest-labs/flux.2-klein-4b',
      { aspect_ratio: '16:9' },
      { lastMatch: tokens(0, 0, 0.015) },
    )
    expect(result).toMatchObject({ kind: 'estimate', cost_usd: 0.015 })
  })

  test('8: per-megapixel, used before but with no recorded cost: unknown', () => {
    const result = priceOf(
      'black-forest-labs/flux.2-klein-4b',
      {},
      { lastMatch: tokens(0, 0, null) },
    )
    expect(result).toMatchObject({ kind: 'unknown', cost_usd: null })
  })
})

describe('output line selection (FR-032)', () => {
  test('variant names match the resolution case-insensitively (2k ↔ 2K)', () => {
    expect(priceOf('sourceful/riverflow-v2.5-fast', { resolution: '2K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.021,
    })
    expect(priceOf(custom([out(0.03, '1K'), out(0.06, '2K')]), { resolution: '2K' })).toMatchObject(
      { kind: 'exact', cost_usd: 0.06 },
    )
  })

  test('<quality>_<resolution> variants', () => {
    const grok = 'x-ai/grok-imagine-image-2.0'
    expect(priceOf(grok, { quality: 'low', resolution: '1K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.04,
    })
    expect(priceOf(grok, { quality: 'low', resolution: '2K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.06,
    })
    expect(priceOf(grok, { quality: 'medium', resolution: '2K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.08,
    })
  })

  test('the variant-less line is the base tier when no variant matches', () => {
    expect(priceOf('sourceful/riverflow-v2.5-fast', { resolution: '1K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.019,
    })
  })

  test('high_resolution matches any resolution above the lowest the model offers', () => {
    const model = custom([out(0.045), out(0.09, 'high_resolution')])
    model.supported_parameters.resolution = { type: 'enum', values: ['1K', '2K', '4K'] }
    expect(priceOf(model, { resolution: '1K' })).toMatchObject({ cost_usd: 0.045 })
    expect(priceOf(model, { resolution: '2K' })).toMatchObject({ cost_usd: 0.09 })
    expect(priceOf(model, { resolution: '4K' })).toMatchObject({ kind: 'exact', cost_usd: 0.09 })
  })

  test('a resolution no variant matches, with no base line: the highest line, at most', () => {
    const result = priceOf('cosmion-test/tiered', { resolution: '4K' })
    expect(result).toMatchObject({ kind: 'at_most', cost_usd: 0.06 })
    expect(result.notes.length).toBeGreaterThan(0)
  })

  test('no resolution chosen: the highest line, at most', () => {
    expect(priceOf('cosmion-test/tiered')).toMatchObject({ kind: 'at_most', cost_usd: 0.06 })
    expect(priceOf('bytedance-seed/seedream-5-0-pro')).toMatchObject({
      kind: 'at_most',
      cost_usd: 0.09,
    })
  })

  test('<quality>_<resolution> variants with only a resolution: the highest line, at most', () => {
    expect(priceOf('x-ai/grok-imagine-image-2.0', { resolution: '1K' })).toMatchObject({
      kind: 'at_most',
      cost_usd: 0.08,
    })
  })

  test('candidates that all cost the same are exact', () => {
    expect(priceOf(custom([out(0.05, '1k'), out(0.05, '2k')]))).toEqual({
      kind: 'exact',
      cost_usd: 0.05,
      notes: [],
    })
  })

  test('a single output line is used whatever its variant', () => {
    expect(priceOf(custom([out(0.07, 'mystery')]), { resolution: '4K' })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.07,
    })
  })
})

describe('reference lines (FR-033)', () => {
  test('no refs, no reference lines', () => {
    expect(priceOf('bytedance-seed/seedream-5-0-pro', { resolution: '1K' })).toMatchObject({
      cost_usd: 0.045,
    })
  })

  test('unit image: per reference', () => {
    const settings = { resolution: '1K' }
    expect(priceOf('bytedance-seed/seedream-5-0-pro', settings, { refCount: 1 })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.048,
    })
    expect(priceOf('bytedance-seed/seedream-5-0-pro', settings, { refCount: 2 })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.051,
    })
  })

  test('unit request: once, however many references', () => {
    const styles = 'recraft/recraft-v4-styles'
    expect(priceOf(styles, {}, { refCount: 1 })).toMatchObject({ kind: 'exact', cost_usd: 0.04 })
    expect(priceOf(styles, {}, { refCount: 3 })).toMatchObject({ kind: 'exact', cost_usd: 0.04 })
  })

  test('a free reference line adds nothing', () => {
    expect(priceOf('bytedance-seed/seedream-4.5', {}, { refCount: 2 })).toEqual({
      kind: 'exact',
      cost_usd: 0.04,
      notes: [],
    })
  })
})

describe('count (FR-035)', () => {
  test('per-image prices are multiplied by n', () => {
    expect(priceOf('bytedance-seed/seedream-4.5', { n: 3 })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.12,
    })
  })

  test('only the output lines; a per-request reference is still charged once', () => {
    expect(priceOf('recraft/recraft-v4-styles', { n: 2 }, { refCount: 1 })).toMatchObject({
      kind: 'exact',
      cost_usd: 0.075,
    })
  })

  test("an estimate with n: 2 is the matching entry's figure, not doubled (FR-034)", () => {
    const perToken = priceOf(
      'google/gemini-2.5-flash-image',
      { n: 2 },
      { lastMatch: tokens(17, 2580, 0.08) },
    )
    expect(perToken).toMatchObject({ kind: 'estimate', cost_usd: 0.0774051 })

    const perMegapixel = priceOf(
      'black-forest-labs/flux.2-klein-4b',
      { n: 2 },
      { lastMatch: tokens(0, 0, 0.03) },
    )
    expect(perMegapixel).toMatchObject({ kind: 'estimate', cost_usd: 0.03 })

    const perImage = priceOf(
      'sourceful/riverflow-v2.5-fast',
      { n: 2 },
      {
        lastMatch: tokens(0, 0, 0.062),
      },
    )
    expect(perImage).toMatchObject({ kind: 'estimate', cost_usd: 0.062 })
  })
})

describe('the rate, when the price is unknown (FR-034a)', () => {
  const rate = (result: { notes: string[] }) =>
    result.notes.find((note) => note.startsWith('Rate')) ?? null
  const line = (billable: string, unit: string, cost_usd: number) => ({
    billable,
    unit,
    cost_usd,
  })

  test('per token: every charge per 1M tokens, the output first', () => {
    const model = custom([
      line('input_image', 'token', 0.000008),
      line('input_text', 'token', 0.000005),
      line('output_image', 'token', 0.00003),
    ])
    expect(rate(priceOf(model))).toBe('Rate per 1M tokens: $30 out, $8 image in, $5 text in')
  })

  test('the charges are in the same order whatever the catalog lists', () => {
    const model = custom([
      line('input_text', 'token', 0.000005),
      line('output_image', 'token', 0.00003),
      line('input_image', 'token', 0.000008),
    ])
    expect(rate(priceOf(model))).toBe('Rate per 1M tokens: $30 out, $8 image in, $5 text in')
  })

  test('per megapixel: spelled out', () => {
    const model = custom([line('output_image', 'megapixel', 0.014)])
    expect(rate(priceOf(model))).toBe('Rate: $0.014/megapixel out')
  })

  test('mixed units: each charge carries its own', () => {
    const model = custom([
      line('input_image', 'image', 0.02),
      line('output_image', 'token', 0.00003),
    ])
    expect(rate(priceOf(model))).toBe('Rate: $30/1M tokens out, $0.02/image in')
  })

  test('free lines are left out', () => {
    const model = custom([line('input_text', 'token', 0), line('output_image', 'megapixel', 0.014)])
    expect(rate(priceOf(model))).toBe('Rate: $0.014/megapixel out')
  })

  test('several providers: the highest of each charge', () => {
    const model = custom(
      [line('input_text', 'token', 0.000005), line('output_image', 'token', 0.00003)],
      [line('input_text', 'token', 0.000004), line('output_image', 'token', 0.000033)],
    )
    expect(rate(priceOf(model))).toBe('Rate per 1M tokens: $33 out, $5 text in')
  })

  test('an unknown unit is listed as it is', () => {
    const model = custom([line('output_image', 'second', 0.5)])
    expect(rate(priceOf(model))).toBe('Rate: $0.5/second out')
  })

  test('no output line, no rate', () => {
    const model = custom([line('input_text', 'token', 0.000005)])
    expect(priceOf(model).kind).toBe('unknown')
    expect(rate(priceOf(model))).toBeNull()
  })

  test('a known price has no rate', () => {
    expect(rate(priceOf('bytedance-seed/seedream-4.5'))).toBeNull()
    expect(
      rate(priceOf('google/gemini-2.5-flash-image', {}, { lastMatch: tokens(17, 1290, 0.03872) })),
    ).toBeNull()
  })
})

describe('what Cosmion cannot compute (FR-036, FR-034)', () => {
  test('an unknown billable is noted and makes the kind no better than estimate', () => {
    const result = priceOf('cosmion-test/unknown-billable')
    expect(result).toMatchObject({ kind: 'estimate', cost_usd: 0.02 })
    expect(result.notes.join(' ')).toContain('input_audio')
  })

  test('an unknown unit is unknown, cost null', () => {
    const result = priceOf('cosmion-test/unknown-unit')
    expect(result).toMatchObject({ kind: 'unknown', cost_usd: null })
    expect(result.notes.join(' ')).toContain('second')
  })

  test('an unknown unit stays unknown even with a matching generation', () => {
    expect(
      priceOf('cosmion-test/unknown-unit', {}, { lastMatch: tokens(0, 0, 0.01) }),
    ).toMatchObject({ kind: 'unknown', cost_usd: null })
  })

  test('no pricing listed is unknown, cost null', () => {
    const result = priceOf('krea/krea-2-medium')
    expect(result).toMatchObject({ kind: 'unknown', cost_usd: null })
    expect(result.notes.length).toBeGreaterThan(0)
  })

  test('a reference line in a unit that cannot be counted ahead is noted, kind estimate', () => {
    const model = custom([out(0.04), { billable: 'input_image', unit: 'token', cost_usd: 1e-6 }])
    const result = priceOf(model, {}, { refCount: 1 })
    expect(result).toMatchObject({ kind: 'estimate', cost_usd: 0.04 })
    expect(result.notes.length).toBeGreaterThan(0)
  })
})

describe('per-token estimates', () => {
  test('use the highest current input per-token price', () => {
    const model = custom([
      { billable: 'input_text', unit: 'token', cost_usd: 1e-6 },
      { billable: 'input_image', unit: 'token', cost_usd: 5e-6 },
      { billable: 'output_image', unit: 'token', cost_usd: 3e-5 },
    ])
    expect(priceOf(model, {}, { lastMatch: tokens(100, 1000, 0.5) })).toMatchObject({
      kind: 'estimate',
      cost_usd: 0.0305,
    })
  })

  test('several endpoints: the highest estimate', () => {
    // Gemini 3 Pro Image Preview: flex $0.000001 / $0.00006, global $0.000002 / $0.00012.
    const result = priceOf(
      'google/gemini-3-pro-image-preview',
      {},
      { lastMatch: tokens(100, 1000, 0.06) },
    )
    expect(result).toMatchObject({ kind: 'estimate', cost_usd: 0.1202 })
  })

  test('a matching generation without token counts is unknown', () => {
    const result = priceOf(
      'google/gemini-2.5-flash-image',
      {},
      {
        lastMatch: { usage: null, cost_usd: 0.04 },
      },
    )
    expect(result).toMatchObject({ kind: 'unknown', cost_usd: null })
  })
})

describe('per-image models and the last actual cost', () => {
  test('within $0.001 of the listed price: still exact', () => {
    expect(
      priceOf('bytedance-seed/seedream-4.5', {}, { lastMatch: tokens(17, 16384, 0.0405) }),
    ).toEqual({ kind: 'exact', cost_usd: 0.04, notes: [] })
  })

  test('more than $0.001 cheaper: the actual cost as an estimate too', () => {
    expect(
      priceOf('bytedance-seed/seedream-4.5', {}, { lastMatch: tokens(17, 16384, 0.035) }),
    ).toMatchObject({ kind: 'estimate', cost_usd: 0.035 })
  })

  test('a matching generation with no recorded cost changes nothing', () => {
    expect(
      priceOf('bytedance-seed/seedream-4.5', {}, { lastMatch: tokens(17, 16384, null) }),
    ).toEqual({ kind: 'exact', cost_usd: 0.04, notes: [] })
  })
})

describe('combining kinds', () => {
  test('takes the weakest: exact → at_most → estimate → unknown', () => {
    const order: PriceKind[] = ['exact', 'at_most', 'estimate', 'unknown']
    for (const [i, a] of order.entries()) {
      for (const [j, b] of order.entries()) {
        expect(weakestKind(a, b)).toBe(order[Math.max(i, j)])
      }
    }
    expect(weakestKind()).toBe('exact')
  })

  test('an endpoint with an unknown price makes the whole price unknown', () => {
    const result = priceOf(custom([out(0.04)], []))
    expect(result).toMatchObject({ kind: 'unknown', cost_usd: null })
  })

  test('a model no provider serves is unknown', () => {
    expect(priceOf(custom())).toMatchObject({ kind: 'unknown', cost_usd: null })
  })
})
