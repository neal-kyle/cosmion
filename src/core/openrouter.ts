import { z } from 'zod'
import { CosmionError } from './errors.js'

const CREDITS_URL = 'https://openrouter.ai/settings/credits'

/** What an option accepts. An absent key means the model doesn't support the option. */
export const parameterSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enum'), values: z.array(z.string()) }),
  z.object({ type: z.literal('range'), min: z.number(), max: z.number() }),
  z.object({ type: z.literal('boolean') }),
])
export type Parameter = z.infer<typeof parameterSchema>

export const supportedParametersSchema = z.record(z.string(), parameterSchema)

/** `billable` and `unit` are plain strings: a value Cosmion has never seen must still load. */
export const pricingLineSchema = z.object({
  billable: z.string(),
  unit: z.string(),
  cost_usd: z.number(),
  variant: z.string().optional(),
})
export type PricingLine = z.infer<typeof pricingLineSchema>

export const endpointSchema = z.object({
  provider_name: z.string(),
  provider_tag: z.string().nullable(),
  supported_parameters: supportedParametersSchema,
  pricing: z.array(pricingLineSchema),
})
export type Endpoint = z.infer<typeof endpointSchema>

export const imageModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  supported_parameters: supportedParametersSchema,
})
export type ImageModel = z.infer<typeof imageModelSchema>

const modelListSchema = z.object({ data: z.array(imageModelSchema) })
const endpointListSchema = z.object({ endpoints: z.array(endpointSchema) })

export interface OpenRouterOptions {
  /** `https://openrouter.ai/api/v1`, or a fake's address. */
  baseUrl: string
  fetch: typeof fetch
  /** Sent as `X-OpenRouter-Title` (FR-055). */
  title: string
  signal?: AbortSignal
}

export interface OpenRouter {
  listImageModels(): Promise<ImageModel[]>
  getEndpoints(modelId: string): Promise<Endpoint[]>
}

/** The OpenRouter calls Cosmion makes. The catalog calls need no key (FR-022). */
export function createOpenRouterClient(options: OpenRouterOptions): OpenRouter {
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const where = `GET ${path}`
    let status: number
    let text: string
    try {
      const response = await options.fetch(`${options.baseUrl}${path}`, {
        headers: { 'X-OpenRouter-Title': options.title },
        signal: options.signal,
      })
      status = response.status
      text = await response.text()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new CosmionError('upstream', `Couldn't reach OpenRouter (${reason}).`)
    }

    const body = parseJson(text)
    if (status < 200 || status >= 300) throw statusError(status, body)

    const result = schema.safeParse(body)
    if (!result.success) {
      throw new CosmionError(
        'upstream',
        `OpenRouter sent an unexpected response for ${where}: ${z.prettifyError(result.error)}`,
      )
    }
    return result.data
  }

  return {
    async listImageModels() {
      return (await get('/images/models', modelListSchema)).data
    },
    async getEndpoints(modelId) {
      // The id is `author/slug`; the slash stays a slash.
      const id = modelId.split('/').map(encodeURIComponent).join('/')
      return (await get(`/images/models/${id}/endpoints`, endpointListSchema)).endpoints
    },
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const errorBodySchema = z.object({
  error: z.object({
    message: z.string().optional(),
    metadata: z.object({ limit_source: z.string().optional() }).optional(),
  }),
})

/** The HTTP status table of docs/openrouter-api.md → Errors. */
function statusError(status: number, body: unknown): CosmionError {
  const parsed = errorBodySchema.safeParse(body)
  const detail = parsed.success ? parsed.data.error.message : undefined
  const because = detail ? `: ${detail}` : ''

  switch (status) {
    case 400:
      return new CosmionError('usage', `OpenRouter rejected the request${because}`)
    case 401:
      return new CosmionError('auth', `OpenRouter rejected the API key${because}`)
    case 402:
      return new CosmionError(
        'credits',
        outOfCreditsMessage(parsed.success ? parsed.data.error.metadata?.limit_source : undefined),
      )
    case 404:
      return new CosmionError('not_found', `OpenRouter has no such model or resource${because}`)
    case 429:
      return new CosmionError('rate_limited', `OpenRouter is rate limiting requests${because}`)
    default:
      return new CosmionError('upstream', `OpenRouter failed with status ${status}${because}`)
  }
}

/** FR-040a: says which limit ran out, and what to do about it. */
function outOfCreditsMessage(limitSource: string | undefined): string {
  if (limitSource === undefined || limitSource === 'openrouter_credits') {
    const source = limitSource ? ` (${limitSource})` : ''
    return (
      `OpenRouter says you are out of credits${source}. Add credits at ${CREDITS_URL}. ` +
      "OpenRouter also refuses generations when the balance is low, even if it covers the image's price."
    )
  }
  return `The key's own spending limit has been reached (${limitSource}). Raise the key's limit on OpenRouter, or use another key.`
}
