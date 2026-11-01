import { z } from 'zod'
import { referenceSupport } from '../../core/catalog.js'
import { endpointSchema, type Parameter, supportedParametersSchema } from '../../core/openrouter.js'
import { flagOf } from '../../core/options.js'
import { price as priceOf } from '../../core/pricing.js'
import { loadCatalog, loadModel } from '../catalog-cache.js'
import { defineCommand } from '../define.js'
import { findNewestMatch, readLedger } from '../ledger.js'
import { table } from '../output.js'
import { fields, fitTable, style, wrap } from '../pretty.js'
import { modelsRank } from './models-rank.js'
import { PRICE_LEGEND, priceColumn, priceSchema, priceText } from './price.js'

const listedModelSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  accepts_references: z.boolean(),
  max_references: z.number().int(),
  /** The names of the options the model supports; `models <id>` gives their values. */
  parameters: z.array(z.string()),
  /** What `price -m <id>` gives with no options (FR-020). */
  price: priceSchema,
})

const listSchema = z.strictObject({
  models: z.array(listedModelSchema),
  fetched_at: z.string(),
})

const detailSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  parameters: supportedParametersSchema,
  endpoints: z.array(z.strictObject(endpointSchema.shape)),
  fetched_at: z.string(),
})

type List = z.infer<typeof listSchema>
type Detail = z.infer<typeof detailSchema>

export const models = defineCommand({
  name: 'models',
  summary: 'List the image models, or show one in full',
  args: [
    {
      name: 'id',
      description:
        'A model id such as bytedance-seed/seedream-4.5; without one, every model is listed',
    },
  ],
  options: [
    {
      name: 'refresh',
      flag: '--refresh',
      type: 'boolean',
      description: 'Fetch the catalog again even if the saved copy is recent',
    },
  ],
  subcommands: [modelsRank],
  output: z.union([listSchema, detailSchema]),
  async run(input, ctx) {
    if (input.id === undefined) {
      const { catalog } = await loadCatalog(ctx, { refresh: input.refresh })
      const ledger = await readLedger(ctx)
      const data: List = {
        models: catalog.models.map((model) => {
          const references = referenceSupport(model)
          const lastMatch = findNewestMatch(ledger, model.id, {}, 0)
          return {
            id: model.id,
            name: model.name,
            accepts_references: references.accepted,
            max_references: references.max,
            parameters: Object.keys(model.supported_parameters),
            price: priceOf(model, { settings: {}, refCount: 0 }, lastMatch ?? null),
          }
        }),
        fetched_at: catalog.fetched_at,
      }
      return { data }
    }
    const { catalog, model } = await loadModel(ctx, input.id, { refresh: input.refresh })
    const data: Detail = {
      id: model.id,
      name: model.name,
      description: model.description,
      parameters: model.supported_parameters,
      endpoints: model.endpoints,
      fetched_at: catalog.fetched_at,
    }
    return { data }
  },
  text: (data) => ('models' in data ? listText(data) : detailText(data)),
  pretty: (data, columns) =>
    'models' in data ? listPretty(data, columns) : detailPretty(data, columns),
})

function listText(list: List): string {
  const rows = list.models.map((model) => [
    model.id,
    model.name,
    priceText(model.price),
    model.accepts_references ? String(model.max_references) : '-',
    model.parameters.map(optionLabel).join(', '),
  ])
  return table([['ID', 'NAME', 'PRICE', 'REFS', 'OPTIONS'], ...rows])
}

function detailText(detail: Detail): string {
  const options = Object.entries(detail.parameters).map(([name, option]) => [
    `  ${optionLabel(name)}`,
    describeOption(option),
  ])
  const providers = detail.endpoints.flatMap((endpoint) => {
    const tag = endpoint.provider_tag ? ` (${endpoint.provider_tag})` : ''
    const lines = endpoint.pricing.map((line) => [
      `    ${line.billable}`,
      `per ${line.unit}${line.variant ? `, ${line.variant}` : ''}`,
      `$${plainNumber(line.cost_usd)}`,
    ])
    return [
      `  ${endpoint.provider_name}${tag}`,
      table(lines.length ? lines : [['    no pricing listed']]),
    ]
  })
  return [
    `${detail.id}: ${detail.name}`,
    '',
    detail.description,
    '',
    'Options',
    table(options),
    '',
    'Providers',
    ...providers,
  ].join('\n')
}

function listPretty(list: List, columns: number): string {
  return [
    fitTable<List['models'][number]>(
      [
        { header: 'id', value: (model) => model.id, role: () => 'accent' },
        { header: 'name', value: (model) => model.name, drop: 2, min: 30 },
        priceColumn,
        {
          header: 'refs',
          value: (model) => (model.accepts_references ? String(model.max_references) : '-'),
          right: true,
        },
        {
          header: 'options',
          value: (model) => model.parameters.map(optionLabel).join(', '),
          role: () => 'dim',
          drop: 3,
        },
      ],
      list.models,
      columns,
    ),
    '',
    ...wrap(`${PRICE_LEGEND} · cosmion models <id> for options and providers`, columns).map(
      (line) => style('dim', line),
    ),
  ].join('\n')
}

function detailPretty(detail: Detail, columns: number): string {
  const options = Object.entries(detail.parameters).map(([name, option]): [string, string] => [
    optionLabel(name),
    describeOption(option),
  ])
  const providers = detail.endpoints.flatMap((endpoint) => {
    const tag = endpoint.provider_tag ? ` (${endpoint.provider_tag})` : ''
    const lines = endpoint.pricing.map((line): [string, string] => [
      line.billable,
      `$${plainNumber(line.cost_usd)} per ${line.unit}${line.variant ? `, ${line.variant}` : ''}`,
    ])
    return [
      `  ${endpoint.provider_name}${tag}`,
      ...(lines.length
        ? fields(lines, columns - 4).map((line) => `    ${line}`)
        : [style('dim', '    no pricing listed')]),
    ]
  })
  return [
    `${style('strong', detail.id)}  ${style('dim', detail.name)}`,
    '',
    ...wrap(detail.description, Math.min(columns, 90)),
    '',
    style('bold', 'Options'),
    ...fields(options, columns - 2).map((line) => `  ${line}`),
    '',
    style('bold', 'Providers'),
    ...providers,
  ].join('\n')
}

/** An option as the flag that sets it; a field no flag sets keeps its name. */
function optionLabel(field: string): string {
  return flagOf(field) ?? field
}

function describeOption(option: Parameter): string {
  if (option.type === 'enum') return option.values.join(', ')
  if (option.type === 'range') return `${option.min} to ${option.max}`
  return 'yes'
}

/** A price without the exponent JavaScript uses for small numbers (3e-7 → 0.0000003). */
function plainNumber(value: number): string {
  return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}
