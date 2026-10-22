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

const keyInfoSchema = z.object({
  data: z.object({
    label: z.string().nullable(),
    /** `null` when the key has no spending limit. */
    limit: z.number().nullable(),
    limit_remaining: z.number().nullable(),
    usage: z.number(),
  }),
})
export type KeyInfo = z.infer<typeof keyInfoSchema>['data']

const creditsSchema = z.object({
  data: z.object({ total_credits: z.number(), total_usage: z.number() }),
})
export type Credits = z.infer<typeof creditsSchema>['data']

export interface OpenRouter {
  listImageModels(): Promise<ImageModel[]>
  getEndpoints(modelId: string): Promise<Endpoint[]>
  /** The key's label, limit and usage; a rejected key is an `auth` error. */
  getKey(key: string): Promise<KeyInfo>
  /** The account's credits, or null when OpenRouter refuses them to this key (403). */
  getCredits(key: string): Promise<Credits | null>
}

/** The OpenRouter calls Cosmion makes. The catalog calls need no key (FR-022). */
export function createOpenRouterClient(options: OpenRouterOptions): OpenRouter {
  async function send(path: string, key?: string): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { 'X-OpenRouter-Title': options.title }
    if (key !== undefined) headers.Authorization = `Bearer ${key}`
    try {
      const response = await options.fetch(`${options.baseUrl}${path}`, {
        headers,
        signal: options.signal,
      })
      return { status: response.status, body: parseJson(await response.text()) }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new CosmionError('upstream', `Couldn't reach OpenRouter (${reason}).`)
    }
  }

  function check<T>(path: string, status: number, body: unknown, schema: z.ZodType<T>): T {
    if (status < 200 || status >= 300) throw statusError(status, body)
    const result = schema.safeParse(body)
    if (!result.success) {
      throw new CosmionError(
        'upstream',
        `OpenRouter sent an unexpected response for GET ${path}: ${z.prettifyError(result.error)}`,
      )
    }
    return result.data
  }

  async function get<T>(path: string, schema: z.ZodType<T>, key?: string): Promise<T> {
    const { status, body } = await send(path, key)
    return check(path, status, body, schema)
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
    async getKey(key) {
      return (await get('/key', keyInfoSchema, key)).data
    },
    async getCredits(key) {
      const { status, body } = await send('/credits', key)
      // The docs list 403 for keys that aren't management keys; live, ordinary keys get 200.
      if (status === 403) return null
      return check('/credits', status, body, creditsSchema).data
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
