import { randomInt } from 'node:crypto'
import { CosmionError } from './errors.js'
import type { ImageModel, Parameter } from './openrouter.js'

/** Each gen option and the Images API field it sets (FR-003). References are sent apart. */
export const SETTING_FIELDS = {
  aspect: 'aspect_ratio',
  resolution: 'resolution',
  quality: 'quality',
  background: 'background',
  count: 'n',
  seed: 'seed',
  format: 'output_format',
  compression: 'output_compression',
} as const

export type OptionName = keyof typeof SETTING_FIELDS

/** The gen options as given; the flag of each is `--<name>`. */
export type GenOptions = { [K in OptionName]?: string | number | undefined }

/** Options as sent to the Images API and stored in the ledger: API field → value. */
export type Settings = Record<string, string | number>

/** When the model's seed option has no range (FR-004). */
const MAX_SEED = 2_147_483_647

/**
 * The settings to send: each passed option under its API field, checked against what the
 * model supports (FR-005). An option the model doesn't list, or a value it doesn't
 * allow, is a usage error naming the flag, the model and what is allowed.
 */
export function toSettings(model: ImageModel, options: GenOptions): Settings {
  const settings: Settings = {}
  for (const [name, field] of Object.entries(SETTING_FIELDS)) {
    const value = options[name as OptionName]
    if (value === undefined) continue
    const parameter = model.supported_parameters[field]
    if (!parameter) {
      throw new CosmionError(
        'usage',
        `${model.id} doesn't support --${name}. It takes: ${supportedFlags(model)}.`,
      )
    }
    if (!allows(parameter, value)) {
      throw new CosmionError(
        'usage',
        `--${name} ${value} isn't allowed for ${model.id}. Allowed: ${describe(parameter)}.`,
      )
    }
    settings[field] = value
  }
  return settings
}

/** The flag that sets an Images API field, for showing next to the field's name. */
export function flagOf(field: string): string | undefined {
  if (field === 'input_references') return '--ref'
  const name = Object.entries(SETTING_FIELDS).find(([, sent]) => sent === field)?.[0]
  return name && `--${name}`
}

function allows(parameter: Parameter, value: string | number): boolean {
  if (parameter.type === 'enum') return parameter.values.includes(String(value))
  if (parameter.type === 'range') {
    return (
      Number.isInteger(value) && Number(value) >= parameter.min && Number(value) <= parameter.max
    )
  }
  return true
}

function describe(parameter: Parameter): string {
  if (parameter.type === 'enum') return parameter.values.join(', ')
  if (parameter.type === 'range') return `whole numbers ${parameter.min} to ${parameter.max}`
  return 'any value'
}

function supportedFlags(model: ImageModel): string {
  const flags = [...Object.values(SETTING_FIELDS), 'input_references']
    .filter((field) => model.supported_parameters[field])
    .map((field) => flagOf(field) as string)
  return flags.length ? flags.join(', ') : 'no options'
}

/**
 * The gen options that give these settings: the reverse of toSettings, for re-sending a
 * past request (FR-085). A field that is no gen option is a usage error.
 */
export function toOptions(settings: Settings): GenOptions {
  const options: GenOptions = {}
  const names = Object.entries(SETTING_FIELDS)
  for (const [field, value] of Object.entries(settings)) {
    const name = names.find(([, sent]) => sent === field)?.[0] as OptionName | undefined
    if (!name) throw new CosmionError('usage', `The setting "${field}" isn't one Cosmion can send.`)
    options[name] = value
  }
  return options
}

/**
 * A seed for a model that takes one, so `regen` can repeat the generation (FR-004):
 * within the model's range, or 0–2,147,483,647. Undefined for a model without a seed.
 */
export function randomSeed(model: ImageModel): number | undefined {
  const parameter = model.supported_parameters.seed
  if (!parameter) return undefined
  if (parameter.type === 'range') return randomInt(parameter.min, parameter.max + 1)
  return randomInt(0, MAX_SEED + 1)
}

/**
 * Two requests have the same settings when everything sent but the prompt and seed is
 * equal, including the number of references (FR-034). Used for estimates and batch groups.
 */
export function sameSettingsKey(settings: Settings, refCount: number): string {
  const kept = Object.entries(settings)
    .filter(([field]) => field !== 'seed')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify([kept, refCount])
}
