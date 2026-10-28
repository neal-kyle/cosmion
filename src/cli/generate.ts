import { mkdir, writeFile } from 'node:fs/promises'
import { imageSize } from 'image-size'
import type { CatalogModel } from '../core/catalog.js'
import { CosmionError, type ErrorCode } from '../core/errors.js'
import { newId } from '../core/ids.js'
import { createOpenRouterClient, type GeneratedImages } from '../core/openrouter.js'
import {
  type GenOptions,
  randomSeed,
  type Settings,
  toOptions,
  toSettings,
} from '../core/options.js'
import { loadModel } from './catalog-cache.js'
import type { Context } from './context.js'
import { resolveModelId } from './gen-options.js'
import { InterruptedError } from './hidden-input.js'
import { findKey, KEY_ENV } from './key.js'
import { appendEntry, type LedgerEntry, ledgerFile, readLedger } from './ledger.js'
import { TITLE } from './name.js'
import { extensionOf, formatOfPath, type OutPaths, planOutPaths } from './out-paths.js'
import { formatUsd, spinner, warn } from './output.js'
import { type Ref, readRefs } from './refs.js'

/** A generation as asked for: gen's arguments and options. */
export interface GenerationRequest {
  prompt: string
  /** --model; COSMION_MODEL when undefined. */
  model: string | undefined
  options: GenOptions
  refs: readonly string[]
  out: string | undefined
  force: boolean
  /**
   * regen: send exactly these settings (FR-085), still checked against the model, with
   * no random seed and no format implied by `out`. `options` is then ignored.
   */
  settings?: Settings
}

/** A request that passed every check (FR-012), ready to send. */
export interface PreparedGeneration {
  id: string
  key: string
  model: CatalogModel
  prompt: string
  /** Exactly what is sent, including a random seed and an implied output_format. */
  settings: Settings
  refs: Ref[]
  paths: OutPaths
  force: boolean
  /** Set for a batch row: recorded in the ledger entry (FR-074). */
  batch?: { id: string; row: number }
  /** Set by regen: the entry this one repeats. */
  regenOf?: string
}

/** A failure after OpenRouter answered: the money is spent and `entry` is in the ledger. */
export class ChargedError extends CosmionError {
  readonly entry: LedgerEntry

  constructor(
    code: ErrorCode,
    message: string,
    entry: LedgerEntry,
    options: { retryable?: boolean } = {},
  ) {
    super(code, message, options)
    this.name = 'ChargedError'
    this.entry = entry
  }
}

const MAY_BE_CHARGED =
  'The provider may still have been charged: check your activity on openrouter.ai before trying again.'

/**
 * Checks everything that can be checked before spending (FR-012): the prompt, a key, the
 * model, its options, the refs and the output paths. Sends nothing and writes nothing
 * (a catalog refresh aside). `takenIds` saves reading the ledger for every batch row;
 * the new id is added to it.
 */
export async function prepare(
  ctx: Context,
  request: GenerationRequest,
  takenIds?: Set<string>,
): Promise<PreparedGeneration> {
  const prompt = request.prompt.trim()
  if (prompt === '') throw new CosmionError('usage', 'The prompt is empty.')
  const modelId = resolveModelId(request.model, ctx.env)
  const found = await findKey(ctx)
  if (found.source === 'none') {
    throw new CosmionError(
      'auth',
      `No OpenRouter key. Run \`cosmion auth\` to save one, or set ${KEY_ENV}.`,
    )
  }

  const { model } = await loadModel(ctx, modelId)
  const exact = request.settings !== undefined
  const settings = toSettings(model, exact ? toOptions(request.settings ?? {}) : request.options)
  // FR-004: a seed for every model that takes one, so regen can repeat the generation.
  if (!exact && settings.seed === undefined) {
    const seed = randomSeed(model)
    if (seed !== undefined) settings.seed = seed
  }
  const refs = await readRefs(ctx, model, request.refs)

  const taken = takenIds ?? new Set((await readLedger(ctx)).map((entry) => entry.id))
  const id = newId((candidate) => taken.has(candidate))
  taken.add(id)
  const count = typeof settings.n === 'number' ? settings.n : 1
  const paths = await planOutPaths(ctx, { id, out: request.out, count, force: request.force })

  // FR-009: `--out hero.png` asks for PNG when the model offers it and --format wasn't given.
  const implied = paths.exact === null ? undefined : formatOfPath(paths.exact)
  const formats = model.supported_parameters.output_format
  if (
    !exact &&
    implied &&
    settings.output_format === undefined &&
    formats?.type === 'enum' &&
    formats.values.includes(implied)
  ) {
    settings.output_format = implied
  }

  return { id, key: found.key, model, prompt, settings, refs, paths, force: request.force }
}

/**
 * Sends the request, saves the images and appends one ledger entry (FR-013, FR-014).
 * Once OpenRouter has answered the entry is always written, even if an image can't be
 * saved: the money is spent either way.
 */
export async function execute(ctx: Context, prepared: PreparedGeneration): Promise<LedgerEntry> {
  const { id, model, settings, paths } = prepared
  try {
    await mkdir(paths.folder, { recursive: true })
  } catch (error) {
    throw new CosmionError('internal', `Couldn't create ${paths.folder} (${reason(error)}).`)
  }

  const client = createOpenRouterClient({
    baseUrl: ctx.baseUrl,
    fetch: ctx.fetch,
    title: TITLE,
    signal: ctx.signal,
  })
  const progress = spinner(ctx, `Generating with ${model.id}`)
  let result: GeneratedImages
  try {
    result = await client.generateImages(prepared.key, {
      model: model.id,
      prompt: prepared.prompt,
      settings,
      references: prepared.refs.map((ref) => ref.url),
    })
  } catch (error) {
    if (ctx.signal.aborted) throw new InterruptedError(`Interrupted. ${MAY_BE_CHARGED}`)
    throw error
  } finally {
    progress.stop()
  }

  const asked = typeof settings.n === 'number' ? settings.n : 1
  if (result.images.length > 0 && result.images.length < asked) {
    warn(ctx, `OpenRouter returned ${result.images.length} of ${asked} images.`)
  }
  if (result.costUsd === null) {
    warn(ctx, "OpenRouter didn't say what this generation cost; it is recorded as unknown.")
  }

  const images: LedgerEntry['images'] = []
  const failures: string[] = []
  const wanted = paths.exact === null ? undefined : formatOfPath(paths.exact)
  for (const [index, image] of result.images.entries()) {
    const format = formatOf(image.mediaType)
    const path = paths.pathFor(index + 1, extensionOf(format))
    try {
      // `wx`: a file that appeared since the check is still never overwritten (FR-011).
      await writeFile(path, image.bytes, { flag: prepared.force ? 'w' : 'wx' })
    } catch (error) {
      failures.push(`${path} (${reason(error)})`)
      continue
    }
    if (wanted && wanted !== format) {
      warn(ctx, `${path} holds a ${format} image: the model returned ${format}, not ${wanted}.`)
    }
    images.push({ path, ...dimensions(ctx, image.bytes, format, path), format })
  }

  const entry: LedgerEntry = {
    v: 1,
    id,
    created_at: new Date().toISOString(),
    model: model.id,
    prompt: prepared.prompt,
    settings,
    references: prepared.refs.map((ref) => ref.source),
    images,
    cost_usd: result.costUsd,
    usage: result.usage,
    provider: result.provider,
    generation_id: result.generationId,
    batch_id: prepared.batch?.id ?? null,
    row: prepared.batch?.row ?? null,
    regen_of: prepared.regenOf ?? null,
  }
  let recorded = true
  try {
    await appendEntry(ctx, entry)
  } catch (error) {
    recorded = false
    // The images are the main result; a missing record isn't worth failing for.
    warn(ctx, `Couldn't add ${id} to the ledger at ${ledgerFile(ctx.env)} (${reason(error)}).`)
  }

  const cost = result.costUsd === null ? 'an unknown amount' : formatUsd(result.costUsd)
  if (result.images.length === 0) {
    // Not retryable: trying again could be charged again.
    throw new ChargedError(
      'upstream',
      `OpenRouter charged ${cost} for generation ${id} but returned no images.${recorded ? ' It is recorded in the ledger.' : ''}`,
      entry,
      { retryable: false },
    )
  }
  if (failures.length > 0) {
    throw new ChargedError(
      'internal',
      `OpenRouter charged ${cost} for generation ${id}, but Cosmion couldn't save ${failures.join(', ')}.`,
      entry,
    )
  }
  return entry
}

/** `image/svg+xml` → `svg`, `image/jpeg` → `jpeg`: the format as the Images API names it. */
function formatOf(mediaType: string): string {
  const subtype = mediaType.slice(mediaType.indexOf('/') + 1).replace(/\+xml$/, '')
  return subtype === 'jpg' ? 'jpeg' : subtype
}

/** SVG has no fixed size; other images unreadable here are kept with a warning. */
function dimensions(
  ctx: Context,
  bytes: Uint8Array,
  format: string,
  path: string,
): { width: number | null; height: number | null } {
  if (format === 'svg') return { width: null, height: null }
  try {
    const { width, height } = imageSize(bytes)
    return { width, height }
  } catch {
    warn(ctx, `Couldn't read the dimensions of ${path}; they are recorded as unknown.`)
    return { width: null, height: null }
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
