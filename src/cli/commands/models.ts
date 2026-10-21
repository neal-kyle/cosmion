import { z } from 'zod'
import { referenceSupport } from '../../core/catalog.js'
import { endpointSchema, type Parameter, supportedParametersSchema } from '../../core/openrouter.js'
import { loadCatalog, loadModel } from '../catalog-cache.js'
import { defineCommand } from '../define.js'

const listedModelSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  accepts_references: z.boolean(),
  max_references: z.number().int(),
  /** The names of the options the model supports; `models <id>` gives their values. */
  parameters: z.array(z.string()),
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
  output: z.union([listSchema, detailSchema]),
  async run(input, ctx) {
    if (input.id === undefined) {
      const { catalog } = await loadCatalog(ctx, { refresh: input.refresh })
      const data: List = {
        models: catalog.models.map((model) => {
          const references = referenceSupport(model)
          return {
            id: model.id,
            name: model.name,
            accepts_references: references.accepted,
            max_references: references.max,
            parameters: Object.keys(model.supported_parameters),
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
})

function listText(list: List): string {
  const rows = list.models.map((model) => [
    model.id,
    model.name,
    model.accepts_references ? String(model.max_references) : '-',
    model.parameters.join(', '),
  ])
  return table([['ID', 'NAME', 'REFS', 'OPTIONS'], ...rows])
}

function detailText(detail: Detail): string {
  const options = Object.entries(detail.parameters).map(([name, option]) => [
    `  ${name}`,
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

function describeOption(option: Parameter): string {
  if (option.type === 'enum') return option.values.join(', ')
  if (option.type === 'range') return `${option.min} to ${option.max}`
  return 'yes'
}

/** A price without the exponent JavaScript uses for small numbers (3e-7 → 0.0000003). */
function plainNumber(value: number): string {
  return value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}

/** Left-aligned columns, two spaces apart. */
function table(rows: string[][]): string {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, column) => {
      widths[column] = Math.max(widths[column] ?? 0, cell.length)
    })
  }
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
        )
        .join('  '),
    )
    .join('\n')
}
