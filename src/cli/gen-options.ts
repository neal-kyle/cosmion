import { CosmionError } from '../core/errors.js'
import type { Context } from './context.js'
import type { OptionDefinition } from './define.js'
import { ENV_PREFIX } from './name.js'

const MODEL_ENV = `${ENV_PREFIX}MODEL`

export const modelOption = {
  name: 'model',
  flag: '--model <id>',
  alias: '-m',
  type: 'string',
  description: `The model id, e.g. bytedance-seed/seedream-4.5 (default: ${MODEL_ENV})`,
} as const satisfies OptionDefinition

/**
 * The nine gen options (FR-003), shared by gen, price, models rank and batch columns.
 * Their names are core's option names; the values each model allows come from the
 * catalog, so they aren't listed here.
 */
export const genOptions = [
  {
    name: 'aspect',
    flag: '--aspect <ratio>',
    type: 'string',
    description: 'Aspect ratio, e.g. 16:9',
  },
  {
    name: 'resolution',
    flag: '--resolution <r>',
    type: 'string',
    description: 'Resolution, e.g. 1K, 2K or 4K',
  },
  {
    name: 'quality',
    flag: '--quality <q>',
    type: 'string',
    description: 'Quality, e.g. low, medium or high',
  },
  {
    name: 'background',
    flag: '--background <b>',
    type: 'string',
    description: 'Background: auto, transparent or opaque',
  },
  {
    name: 'count',
    flag: '--count <n>',
    alias: '-n',
    type: 'integer',
    description: 'How many images to ask for (an upper bound)',
  },
  {
    name: 'seed',
    flag: '--seed <int>',
    type: 'integer',
    description: 'Seed for repeatable results',
  },
  {
    name: 'format',
    flag: '--format <f>',
    type: 'string',
    description: 'Output format: png, jpeg, webp or svg',
  },
  {
    name: 'compression',
    flag: '--compression <0-100>',
    type: 'integer',
    description: 'Compression for jpeg and webp',
  },
  {
    name: 'ref',
    flag: '--ref <path-or-url>',
    type: 'string',
    repeatable: true,
    description: 'A reference image: a PNG, JPEG or WebP file, or an https:// URL (repeatable)',
  },
] as const satisfies readonly OptionDefinition[]

/** The model from --model, otherwise COSMION_MODEL (FR-002). */
export function resolveModelId(model: string | undefined, env: Context['env']): string {
  const id = model || env[MODEL_ENV]
  if (!id) {
    throw new CosmionError(
      'usage',
      `No model given. Pass --model <id> or set ${MODEL_ENV}; \`cosmion models\` lists the ids.`,
    )
  }
  return id
}
