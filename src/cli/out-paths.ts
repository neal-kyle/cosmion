import { constants } from 'node:fs'
import { access, lstat, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { CosmionError } from '../core/errors.js'
import type { Context } from './context.js'
import { FILE_PREFIX } from './name.js'

/** Where a request's images go (FR-007, FR-008). */
export interface OutPaths {
  /** The folder the images go in. It may not exist yet: it is created just before writing. */
  folder: string
  /** The file `--out` named, written exactly whatever the format; null for default names. */
  exact: string | null
  /** Where image `k` (from 1) goes. `extension` (e.g. `.jpg`) is used only by default names. */
  pathFor(k: number, extension: string): string
}

/** The extensions a default name can get, known only once the image is back (FR-010). */
const DEFAULT_EXTENSIONS = ['.png', '.jpg', '.webp', '.svg', '.gif']

/** Formats as the Images API names them, by file extension (FR-009). */
const EXTENSION_FORMATS: Record<string, string> = {
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.webp': 'webp',
  '.svg': 'svg',
  '.gif': 'gif',
}

/** The format a path's extension names, e.g. `jpeg` for `hero.JPG`. */
export function formatOfPath(path: string): string | undefined {
  return EXTENSION_FORMATS[extname(path).toLowerCase()]
}

/** The extension a default name gets for a format: `.jpg` for jpeg, otherwise `.<format>`. */
export function extensionOf(format: string): string {
  return format === 'jpeg' ? '.jpg' : `.${format}`
}

/**
 * Works out where `count` images go and checks it before anything is sent (FR-012): no
 * path is taken (unless `force`) and the folder can be written, or for a folder that
 * doesn't exist yet, the nearest existing one above it. Creates nothing.
 */
export async function planOutPaths(
  ctx: Context,
  request: { id: string; out: string | undefined; count: number; force: boolean },
): Promise<OutPaths> {
  const { id, out, count, force } = request
  const ks = Array.from({ length: count }, (_, i) => i + 1)
  let paths: OutPaths
  let candidates: string[]

  if (out === undefined || /[\\/]$/.test(out) || (await isFolder(resolve(ctx.cwd, out)))) {
    // A trailing `\` marks a folder on every platform, so it is dropped before resolving.
    const folder = out === undefined ? ctx.cwd : resolve(ctx.cwd, out.replace(/\\+$/, '') || out)
    const name = (k: number) => (count > 1 ? `${FILE_PREFIX}-${id}-${k}` : `${FILE_PREFIX}-${id}`)
    paths = { folder, exact: null, pathFor: (k, extension) => join(folder, name(k) + extension) }
    candidates = ks.flatMap((k) =>
      DEFAULT_EXTENSIONS.map((extension) => paths.pathFor(k, extension)),
    )
  } else {
    const exact = resolve(ctx.cwd, out)
    const extension = extname(exact)
    const stem = exact.slice(0, exact.length - extension.length)
    paths = {
      folder: dirname(exact),
      exact,
      pathFor: (k) => (count > 1 ? `${stem}-${k}${extension}` : exact),
    }
    candidates = ks.map((k) => paths.pathFor(k, ''))
  }

  if (!force) {
    for (const path of candidates) {
      if (await exists(path)) {
        throw new CosmionError(
          'usage',
          `${path} already exists. Choose another --out, or pass --force to replace it.`,
        )
      }
    }
  }
  await checkWritable(paths.folder)
  return paths
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    // lstat: a broken symlink is still in the way of an exclusive write.
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/** The folder, or the nearest existing folder above it, must be writable. */
async function checkWritable(folder: string): Promise<void> {
  let existing = folder
  for (;;) {
    try {
      if (!(await stat(existing)).isDirectory()) {
        throw new CosmionError('usage', `Can't save into ${folder}: ${existing} is a file.`)
      }
      break
    } catch (error) {
      if (error instanceof CosmionError) throw error
      const parent = dirname(existing)
      if (parent === existing) throw error
      existing = parent
    }
  }
  try {
    await access(existing, constants.W_OK)
  } catch {
    throw new CosmionError('usage', `Can't save into ${folder}: ${existing} isn't writable.`)
  }
}
