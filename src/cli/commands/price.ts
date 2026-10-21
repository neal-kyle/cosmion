import { z } from 'zod'
import { toSettings } from '../../core/options.js'
import { PRICE_KINDS, type PriceResult, price as priceOf } from '../../core/pricing.js'
import { loadModel } from '../catalog-cache.js'
import { defineCommand } from '../define.js'
import { genOptions, modelOption, resolveModelId } from '../gen-options.js'
import { findNewestMatch, readLedger, settingsSchema } from '../ledger.js'
import { formatUsd } from '../output.js'
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
  text: (data) => [priceText(data), ...data.notes.map((note) => `  ${note}`)].join('\n'),
})

/** `$0.04`, `≤$0.09`, `~$0.0387` or `Unknown`. */
export function priceText(result: PriceResult): string {
  return result.cost_usd === null ? 'Unknown' : formatUsd(result.cost_usd, result.kind)
}
