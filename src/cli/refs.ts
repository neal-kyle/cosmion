import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { imageSize } from 'image-size'
import { referenceSupport } from '../core/catalog.js'
import { CosmionError } from '../core/errors.js'
import type { ImageModel } from '../core/openrouter.js'
import type { Context } from './context.js'

export interface Ref {
  /** What is sent: a base64 data URL, or the https:// URL as given. */
  url: string
  /** What the ledger records: the file's absolute path, or the URL. */
  source: string
}

/** The image types a local reference can be, by image-size's name for them. */
const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
}

/**
 * Reads and checks `--ref` values (FR-006): local PNG, JPEG or WebP files become data
 * URLs, `https://` URLs are sent as they are. Anything the model or the file system
 * won't allow is a usage error, before anything is sent.
 */
export async function readRefs(
  ctx: Context,
  model: ImageModel,
  refs: readonly string[],
): Promise<Ref[]> {
  if (refs.length === 0) return []
  const { accepted, max } = referenceSupport(model)
  if (!accepted) {
    throw new CosmionError('usage', `${model.id} doesn't accept reference images (--ref).`)
  }
  if (refs.length > max) {
    throw new CosmionError(
      'usage',
      `${model.id} takes at most ${max} reference images (--ref); ${refs.length} were given.`,
    )
  }
  return Promise.all(refs.map((ref) => readRef(ctx, ref)))
}

async function readRef(ctx: Context, ref: string): Promise<Ref> {
  if (ref.startsWith('https://')) return { url: ref, source: ref }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ref)) {
    throw new CosmionError('usage', `--ref ${ref}: only https:// URLs and local files work.`)
  }

  const path = resolve(ctx.cwd, ref)
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CosmionError('usage', `Couldn't read --ref ${ref} (${reason}).`)
  }
  // The type comes from the bytes: an extension can lie.
  const type = mediaType(bytes)
  if (!type) throw new CosmionError('usage', `--ref ${ref} isn't a PNG, JPEG or WebP image.`)
  return { url: `data:${type};base64,${bytes.toString('base64')}`, source: path }
}

function mediaType(bytes: Uint8Array): string | undefined {
  try {
    return MEDIA_TYPES[imageSize(bytes).type ?? '']
  } catch {
    // Not an image type image-size knows.
    return undefined
  }
}
