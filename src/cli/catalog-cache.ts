import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  type Catalog,
  type CatalogModel,
  catalogSchema,
  fetchCatalog,
  findModel,
} from '../core/catalog.js'
import { CosmionError } from '../core/errors.js'
import { createOpenRouterClient } from '../core/openrouter.js'
import type { Context } from './context.js'
import { TITLE } from './name.js'
import { spinner, warn } from './output.js'
import { resolvePaths } from './paths.js'

const MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface LoadedCatalog {
  catalog: Catalog
  /** A refresh was attempted during this call, whether or not it worked. */
  refreshTried: boolean
  /** The refresh failed, so this is the older cached copy. */
  stale: boolean
}

/**
 * The catalog from the cache folder, fetched again when it is missing, older than 24 hours
 * or `refresh` is set (FR-022). If the fetch fails, a cached copy is used with a warning;
 * with none, the error is the result.
 */
export async function loadCatalog(
  ctx: Context,
  options: { refresh?: boolean } = {},
): Promise<LoadedCatalog> {
  const file = join(resolvePaths(ctx.env).cache, 'catalog.json')
  const cached = await readCache(file)
  if (cached && !options.refresh && isFresh(cached))
    return { catalog: cached, refreshTried: false, stale: false }

  let fresh: Catalog
  try {
    fresh = await refresh(ctx)
  } catch (error) {
    // Ctrl-C ends the command; it isn't a reason to fall back.
    if (!cached || !(error instanceof CosmionError) || ctx.signal.aborted) throw error
    warn(
      ctx,
      `Couldn't refresh the model catalog (${error.message}) Using the copy fetched at ${cached.fetched_at}.`,
    )
    return { catalog: cached, refreshTried: true, stale: true }
  }
  await writeCache(file, fresh)
  return { catalog: fresh, refreshTried: true, stale: false }
}

/**
 * One model of the catalog. A model that isn't in it triggers one refresh, in case it is
 * new; if it still isn't, it is unknown.
 */
export async function loadModel(
  ctx: Context,
  id: string,
  options: { refresh?: boolean } = {},
): Promise<{ catalog: Catalog; model: CatalogModel }> {
  let loaded = await loadCatalog(ctx, options)
  let model = findModel(loaded.catalog, id)
  if (!model && !loaded.refreshTried) {
    loaded = await loadCatalog(ctx, { refresh: true })
    model = findModel(loaded.catalog, id)
  }
  if (!model) {
    throw new CosmionError(
      'not_found',
      `No image model "${id}". Run \`cosmion models\` to see the available ids.`,
    )
  }
  return { catalog: loaded.catalog, model }
}

function isFresh(catalog: Catalog): boolean {
  // An unreadable date gives NaN, which is never fresh.
  return Date.now() - Date.parse(catalog.fetched_at) <= MAX_AGE_MS
}

async function refresh(ctx: Context): Promise<Catalog> {
  const client = createOpenRouterClient({
    baseUrl: ctx.baseUrl,
    fetch: ctx.fetch,
    title: TITLE,
    signal: ctx.signal,
  })
  const progress = spinner(ctx, 'Fetching the model catalog')
  try {
    return await fetchCatalog(client)
  } finally {
    progress.stop()
  }
}

/** A missing, unreadable or malformed cache is the same as no cache. */
async function readCache(file: string): Promise<Catalog | null> {
  try {
    return catalogSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return null
  }
}

/** Written to a temporary file and renamed, so a reader never sees half a file. */
async function writeCache(file: string, catalog: Catalog): Promise<void> {
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temporary, JSON.stringify(catalog))
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    const reason = error instanceof Error ? error.message : String(error)
    throw new CosmionError('internal', `Couldn't save the model catalog to ${file} (${reason}).`)
  }
}
