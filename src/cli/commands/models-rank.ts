import { z } from 'zod'
import { referenceSupport } from '../../core/catalog.js'
import { CosmionError } from '../../core/errors.js'
import { SETTING_FIELDS, type Settings, toSettings } from '../../core/options.js'
import { price as priceOf } from '../../core/pricing.js'
import { loadCatalog } from '../catalog-cache.js'
import { defineCommand } from '../define.js'
import { genOptions } from '../gen-options.js'
import { findNewestMatch, readLedger, settingsSchema } from '../ledger.js'
import { table } from '../output.js'
import { priceSchema, priceText } from './price.js'

const outputSchema = z.strictObject({
  settings: settingsSchema,
  models: z.array(z.strictObject({ id: z.string(), name: z.string(), price: priceSchema })),
})

// Every gen option but --ref: ranking needs how many references, not the files.
const [aspect, resolution, quality, background, count, seed, format, compression] = genOptions

export const modelsRank = defineCommand({
  name: 'rank',
  summary: 'List the models that support these options, cheapest first',
  options: [
    aspect,
    resolution,
    quality,
    background,
    count,
    seed,
    format,
    compression,
    {
      name: 'refs',
      flag: '--refs <n>',
      type: 'integer',
      description: 'How many reference images the model must accept (default: 0)',
    },
  ],
  output: outputSchema,
  async run(input, ctx) {
    const refCount = input.refs ?? 0
    if (refCount < 0) throw new CosmionError('usage', '--refs must be 0 or more.')
    const { catalog } = await loadCatalog(ctx)
    const ledger = await readLedger(ctx)

    const models = catalog.models.flatMap((model) => {
      let settings: Settings
      try {
        settings = toSettings(model, input)
      } catch (error) {
        // The model doesn't support one of the options or values: not a candidate.
        if (error instanceof CosmionError && error.code === 'usage') return []
        throw error
      }
      const references = referenceSupport(model)
      if (refCount > 0 && (!references.accepted || references.max < refCount)) return []
      const lastMatch = findNewestMatch(ledger, model.id, settings, refCount)
      const price = priceOf(model, { settings, refCount }, lastMatch ?? null)
      return [{ id: model.id, name: model.name, price }]
    })
    // FR-090: cheapest first by the number, whatever its kind; unknown last.
    models.sort((a, b) => {
      const [x, y] = [a.price.cost_usd, b.price.cost_usd]
      if (x !== y) {
        if (x === null) return 1
        if (y === null) return -1
        return x - y
      }
      return a.id < b.id ? -1 : 1
    })

    const settings: Settings = {}
    for (const [name, field] of Object.entries(SETTING_FIELDS)) {
      const value = input[name as keyof typeof SETTING_FIELDS]
      if (value !== undefined) settings[field] = value
    }
    return { data: { settings, models } }
  },
  text: (data) =>
    data.models.length === 0
      ? 'No model supports all of these options.'
      : table([
          ['ID', 'NAME', 'PRICE'],
          ...data.models.map((m) => [m.id, m.name, priceText(m.price)]),
        ]),
})
