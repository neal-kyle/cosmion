import { z } from 'zod'
import { toSettings } from '../../core/options.js'
import {
  AFTER_FIRST_IMAGE,
  PRICE_KINDS,
  type PriceResult,
  price as priceOf,
} from '../../core/pricing.js'
import { loadModel } from '../catalog-cache.js'
import { defineCommand } from '../define.js'
import { genOptions, modelOption, resolveModelId } from '../gen-options.js'
import { findNewestMatch, readLedger, settingsSchema } from '../ledger.js'
import { formatUsd } from '../output.js'
import { type Column, style } from '../pretty.js'
import { readRefs } from '../refs.js'

/** A price as every command shows it (FR-034). */
export const priceSchema = z.strictObject({
  kind: z.enum(PRICE_KINDS),
  cost_usd: z.number().nullable(),
  notes: z.array(z.string()),
})

const outputSchema = z.strictObject({
  model: z.string(),
  settings: settingsSchema,
  ...priceSchema.shape,
})

export const price = defineCommand({
  name: 'price',
  summary: 'Show what a generation will cost, without spending anything',
  options: [modelOption, ...genOptions],
  output: outputSchema,
  async run(input, ctx) {
    const { model } = await loadModel(ctx, resolveModelId(input.model, ctx.env))
    const settings = toSettings(model, input)
    const refCount = (await readRefs(ctx, model, input.ref)).length
    const lastMatch = findNewestMatch(await readLedger(ctx), model.id, settings, refCount)
    const result = priceOf(model, { settings, refCount }, lastMatch ?? null)
    return { data: { model: model.id, settings, ...result } }
  },
  text: (data) => {
    const headline = data.notes.includes(AFTER_FIRST_IMAGE)
      ? 'Unknown until the first image with these settings'
      : priceText(data)
    const notes = data.notes.filter((note) => note !== AFTER_FIRST_IMAGE)
    return [headline, ...notes.map((note) => `  ${note}`)].join('\n')
  },
  pretty: (data) => {
    const headline = data.notes.includes(AFTER_FIRST_IMAGE)
      ? 'Unknown until the first image with these settings'
      : priceText(data)
    const notes = data.notes.filter((note) => note !== AFTER_FIRST_IMAGE)
    return [style('bold', headline), ...notes.map((note) => style('dim', note))].join('\n')
  },
})

/** `$0.04`, `≤$0.09`, `~$0.0387` or `Unknown`. */
export function priceText(result: PriceResult): string {
  return result.cost_usd === null ? 'Unknown' : formatUsd(result.cost_usd, result.kind)
}

export const PRICE_LEGEND = '≤ at most · ~ estimate'

/** The price column of the model tables on a terminal. */
export const priceColumn: Column<{ price: PriceResult }> = {
  header: 'price',
  value: ({ price }) => (price.cost_usd === null ? 'unknown' : priceText(price)),
  role: ({ price }) => (price.cost_usd === null ? 'dim' : undefined),
  right: true,
}
