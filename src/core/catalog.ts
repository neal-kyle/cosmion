import { z } from 'zod'
import { endpointSchema, type ImageModel, imageModelSchema, type OpenRouter } from './openrouter.js'

/** How many endpoint requests run at once during a refresh. */
const CONCURRENCY = 8

const catalogModelSchema = imageModelSchema.extend({ endpoints: z.array(endpointSchema) })
export type CatalogModel = z.infer<typeof catalogModelSchema>

/** The models plus their endpoint records, as cached. */
export const catalogSchema = z.object({
  fetched_at: z.string(),
  models: z.array(catalogModelSchema),
})
export type Catalog = z.infer<typeof catalogSchema>

/**
 * Fetches the model list and every model's endpoints. Any failing request fails the whole
 * refresh, so a catalog is never half old and half new.
 */
export async function fetchCatalog(client: OpenRouter): Promise<Catalog> {
  const list = await client.listImageModels()
  const models = await inBatches(list, CONCURRENCY, async (model: ImageModel) => ({
    ...model,
    endpoints: await client.getEndpoints(model.id),
  }))
  return { fetched_at: new Date().toISOString(), models }
}

export function findModel(catalog: Catalog, id: string): CatalogModel | undefined {
  return catalog.models.find((model) => model.id === id)
}

/** How many reference images a model takes. No `input_references` option means none. */
export function referenceSupport(model: ImageModel): { accepted: boolean; max: number } {
  const option = model.supported_parameters.input_references
  const max = option?.type === 'range' ? option.max : 0
  return { accepted: max > 0, max }
}

/** `map`, with at most `limit` calls running at once and no new ones after a failure. */
async function inBatches<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let failed = false
  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++
      try {
        results[index] = await fn(items[index] as T)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
