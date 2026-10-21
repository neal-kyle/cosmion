import type { CatalogModel } from './catalog.js'
import { toNano, toUsd } from './money.js'
import type { Endpoint, PricingLine } from './openrouter.js'
import type { Settings } from './options.js'

/** Strongest first. A combination of kinds takes the weakest. */
export const PRICE_KINDS = ['exact', 'at_most', 'estimate', 'unknown'] as const
export type PriceKind = (typeof PRICE_KINDS)[number]

export interface PriceResult {
  kind: PriceKind
  /** `null` when unknown. */
  cost_usd: number | null
  /** What the price doesn't cover, or why it isn't exact. */
  notes: string[]
}

export interface PriceRequest {
  settings: Settings
  refCount: number
}

/** The newest ledger entry with the same model and settings, as far as pricing needs it. */
export interface LastMatch {
  usage: { prompt_tokens: number; completion_tokens: number } | null
  cost_usd: number | null
}

export function weakestKind(...kinds: PriceKind[]): PriceKind {
  const weakest = Math.max(0, ...kinds.map((kind) => PRICE_KINDS.indexOf(kind)))
  return PRICE_KINDS[weakest] ?? 'unknown'
}

/** The Images API's resolutions, lowest first, for `high_resolution` (FR-032). */
const RESOLUTIONS = ['512', '768', '1K', '2K', '4K']

/** Above this, a per-image price is corrected by what was actually charged (FR-034). */
const TOLERANCE_NANO = toNano(0.001)

const AFTER_FIRST = 'the price is shown after the first image with these settings.'

/** One endpoint's price; `nano` is null when unknown. */
interface Part {
  kind: PriceKind
  nano: number | null
  notes: string[]
  /** Priced from per-image catalog lines, which the last actual cost can correct. */
  perImage: boolean
}

/**
 * What a request will cost, from each pricing line's `unit` and `billable`, never the
 * model's name (FR-031–FR-036). Every endpoint is priced; the most expensive is shown.
 */
export function price(
  model: CatalogModel,
  request: PriceRequest,
  lastMatch: LastMatch | null,
): PriceResult {
  if (model.endpoints.length === 0) {
    return { kind: 'unknown', cost_usd: null, notes: ['No provider serves this model.'] }
  }
  const parts = model.endpoints.map((endpoint) =>
    priceEndpoint(model, endpoint, request, lastMatch),
  )
  const notes = [...new Set(parts.flatMap((part) => part.notes))]

  const costs = parts.map((part) => part.nano)
  if (costs.some((cost) => cost === null)) return { kind: 'unknown', cost_usd: null, notes }
  const highest = Math.max(...(costs as number[]))
  let kind = weakestKind(...parts.map((part) => part.kind))
  if (costs.some((cost) => cost !== highest)) {
    kind = weakestKind(kind, 'at_most')
    notes.push('Providers charge different prices; this is the highest.')
  }

  // The catalog can list less than is charged (Riverflow); the ledger knows better.
  const actual = lastMatch?.cost_usd ?? null
  if (
    actual !== null &&
    parts.every((part) => part.perImage) &&
    Math.abs(toNano(actual) - highest) > TOLERANCE_NANO
  ) {
    notes.push(
      `Listed at $${toUsd(highest)}, but the last generation with these settings was charged $${actual}.`,
    )
    return { kind: 'estimate', cost_usd: actual, notes }
  }
  return { kind, cost_usd: toUsd(highest), notes }
}

function priceEndpoint(
  model: CatalogModel,
  endpoint: Endpoint,
  { settings, refCount }: PriceRequest,
  lastMatch: LastMatch | null,
): Part {
  const unknown = (note: string): Part => ({
    kind: 'unknown',
    nano: null,
    notes: [note],
    perImage: false,
  })

  const outputs = endpoint.pricing.filter((line) => line.billable === 'output_image')
  const selected = selectOutputLine(model, outputs, settings)
  if (!selected) return unknown('No price is listed; the actual cost is recorded after generating.')
  const { line, ceiling } = selected

  let kind: PriceKind = ceiling ? 'at_most' : 'exact'
  const notes: string[] = []
  if (ceiling) {
    notes.push("The pricing tiers don't match these settings exactly; this is the highest.")
  }

  let nano: number
  if (line.unit === 'image') {
    nano = toNano(line.cost_usd) * Number(settings.n ?? 1)
  } else if (line.unit === 'token') {
    // Tokens per image are near-fixed for the same settings, so the last count × today's
    // price. The estimate covers the whole request, like that entry (count included).
    if (!lastMatch?.usage) return unknown(`Priced per token; ${AFTER_FIRST}`)
    const inputPrices = endpoint.pricing
      .filter((other) => other.billable !== 'output_image' && other.unit === 'token')
      .map((other) => toNano(other.cost_usd))
    nano =
      lastMatch.usage.prompt_tokens * Math.max(0, ...inputPrices) +
      lastMatch.usage.completion_tokens * toNano(line.cost_usd)
    kind = weakestKind(kind, 'estimate')
  } else if (line.unit === 'megapixel') {
    // Not linear in megapixels, so the last actual cost, which covers everything.
    if (lastMatch?.cost_usd == null) return unknown(`Priced per megapixel; ${AFTER_FIRST}`)
    return { kind: 'estimate', nano: toNano(lastMatch.cost_usd), notes, perImage: false }
  } else {
    return unknown(`Priced per "${line.unit}", which Cosmion doesn't know; it's never guessed.`)
  }

  for (const other of endpoint.pricing) {
    if (other.billable === 'output_image' || other.cost_usd === 0) continue
    const extra = otherLineCost(other, line.unit, refCount)
    if (extra === null) {
      notes.push(
        `Not included: ${other.billable} at $${other.cost_usd} per ${other.unit}, which can't be counted ahead.`,
      )
      kind = weakestKind(kind, 'estimate')
    } else {
      nano += extra
    }
  }
  return { kind, nano, notes, perImage: line.unit === 'image' }
}

/** What a line other than the output adds, or null if Cosmion can't count it (FR-033, FR-036). */
function otherLineCost(line: PricingLine, outputUnit: string, refCount: number): number | null {
  // Input tokens are already in a per-token estimate, through the prompt's tokens.
  if (line.unit === 'token' && outputUnit === 'token' && line.billable.startsWith('input_')) {
    return 0
  }
  switch (line.billable) {
    case 'input_image':
    case 'input_reference':
      if (refCount === 0) return 0
      if (line.unit === 'image') return toNano(line.cost_usd) * refCount
      if (line.unit === 'request') return toNano(line.cost_usd)
      return null
    case 'input_font':
      // Cosmion never sends fonts.
      return 0
    default:
      return null
  }
}

/**
 * The output line for these settings (FR-032), and whether it's only a ceiling because
 * the candidates differ in price. Undefined when there is no output line.
 */
function selectOutputLine(
  model: CatalogModel,
  outputs: PricingLine[],
  settings: Settings,
): { line: PricingLine; ceiling: boolean } | undefined {
  if (outputs.length <= 1) return outputs[0] && { line: outputs[0], ceiling: false }

  const resolution = settings.resolution === undefined ? undefined : String(settings.resolution)
  if (resolution !== undefined) {
    const names = [resolution]
    if (settings.quality !== undefined) names.push(`${settings.quality}_${resolution}`)
    const wanted = names.map((name) => name.toLowerCase())
    const matches = outputs.filter(
      ({ variant }) =>
        variant !== undefined &&
        (wanted.includes(variant.toLowerCase()) ||
          (variant === 'high_resolution' && aboveLowest(model, resolution))),
    )
    if (matches.length === 1 && matches[0]) return { line: matches[0], ceiling: false }
    // The line without a variant is the base tier.
    const base = outputs.filter(({ variant }) => variant === undefined)
    if (matches.length === 0 && base.length > 0) return highestOf(base)
  }
  return highestOf(outputs)
}

function aboveLowest(model: CatalogModel, resolution: string): boolean {
  const offered = model.supported_parameters.resolution
  if (offered?.type !== 'enum') return false
  const ranks = offered.values
    .map((value) => RESOLUTIONS.indexOf(value))
    .filter((rank) => rank >= 0)
  return ranks.length > 0 && RESOLUTIONS.indexOf(resolution) > Math.min(...ranks)
}

function highestOf(lines: PricingLine[]): { line: PricingLine; ceiling: boolean } | undefined {
  const sorted = [...lines].sort((a, b) => b.cost_usd - a.cost_usd)
  const line = sorted[0]
  if (!line) return undefined
  return { line, ceiling: sorted.some((other) => other.cost_usd !== line.cost_usd) }
}
