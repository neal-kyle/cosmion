import { z } from 'zod'
import { CosmionError } from './errors.js'

const CREDITS_URL = 'https://openrouter.ai/settings/credits'

/** How long a generation may run before Cosmion gives up on it (FR-017). */
export const GENERATION_TIMEOUT_MS = 5 * 60 * 1000

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

/** What a generation sends besides the model and prompt: API field → value (FR-003). */
export interface ImageRequest {
  model: string
  prompt: string
  settings: Record<string, string | number>
  /** Data URLs or https:// URLs. */
  references: string[]
}

const imagesResponseSchema = z.object({
  // Possibly empty: a request can be charged and return nothing, and that cost is recorded.
  data: z.array(
    z.object({
      b64_json: z.string(),
      media_type: z.string().regex(/^image\/[a-z0-9+-]+$/i),
    }),
  ),
  // Read leniently below: a paid image must not be lost to an odd usage object.
  usage: z.unknown().optional(),
})

const tokensSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
})
export type Tokens = z.infer<typeof tokensSchema>

export interface GeneratedImages {
  images: { bytes: Buffer; mediaType: string }[]
  /** `usage.cost`, the actual charge in USD; null when the response leaves it out. */
  costUsd: number | null
  usage: Tokens | null
  /** From the `x-provider-name` and `x-generation-id` headers. */
  provider: string | null
  generationId: string | null
}

export interface OpenRouter {
  listImageModels(): Promise<ImageModel[]>
  getEndpoints(modelId: string): Promise<Endpoint[]>
  /** The key's label, limit and usage; a rejected key is an `auth` error. */
  getKey(key: string): Promise<KeyInfo>
  /** The account's credits, or null when OpenRouter refuses them to this key (403). */
  getCredits(key: string): Promise<Credits | null>
  /**
   * `POST /images`, never retried. Gives up after 5 minutes with a non-retryable
   * `upstream` error, since the provider may already have charged (FR-017). If `signal`
   * aborts (Ctrl-C), its abort error is thrown as it is.
   */
  generateImages(key: string, request: ImageRequest): Promise<GeneratedImages>
}

/** The OpenRouter calls Cosmion makes. The catalog calls need no key (FR-022). */
export function createOpenRouterClient(options: OpenRouterOptions): OpenRouter {
  async function send(
    path: string,
    request: { key?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<{ status: number; body: unknown; headers: Headers }> {
    const headers: Record<string, string> = { 'X-OpenRouter-Title': options.title }
    if (request.key !== undefined) headers.Authorization = `Bearer ${request.key}`
    if (request.body !== undefined) headers['Content-Type'] = 'application/json'
    const signal = request.signal ?? options.signal
    try {
      const response = await options.fetch(`${options.baseUrl}${path}`, {
        method: request.body === undefined ? 'GET' : 'POST',
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal,
      })
      const body = parseJson(await response.text())
      return { status: response.status, body, headers: response.headers }
    } catch (error) {
      // An abort is the caller's to explain (Ctrl-C or the generation timeout).
      if (signal?.aborted) throw error
      const reason = error instanceof Error ? error.message : String(error)
      throw new CosmionError('upstream', `Couldn't reach OpenRouter (${reason}).`)
    }
  }

  function check<T>(
    route: string,
    { status, body, headers }: { status: number; body: unknown; headers: Headers },
    schema: z.ZodType<T, unknown>,
  ): T {
    if (status < 200 || status >= 300) throw statusError(status, body, headers)
    const result = schema.safeParse(body)
    if (!result.success) {
      throw new CosmionError(
        'upstream',
        `OpenRouter sent an unexpected response for ${route}: ${z.prettifyError(result.error)}`,
      )
    }
    return result.data
  }

  async function get<T>(path: string, schema: z.ZodType<T>, key?: string): Promise<T> {
    return check(`GET ${path}`, await send(path, { key }), schema)
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
      const response = await send('/credits', { key })
      // The docs list 403 for keys that aren't management keys; live, ordinary keys get 200.
      if (response.status === 403) return null
      return check('GET /credits', response, creditsSchema).data
    },
    async generateImages(key, request) {
      // A plain setTimeout rather than AbortSignal.timeout(), which fake timers can't drive.
      const timeout = new Error('timeout')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(timeout), GENERATION_TIMEOUT_MS)
      const onAbort = () => controller.abort(options.signal?.reason)
      if (options.signal?.aborted) onAbort()
      options.signal?.addEventListener('abort', onAbort)

      const body: Record<string, unknown> = {
        model: request.model,
        prompt: request.prompt,
        ...request.settings,
      }
      if (request.references.length > 0) {
        body.input_references = request.references.map((url) => ({
          type: 'image_url',
          image_url: { url },
        }))
      }

      let response: Awaited<ReturnType<typeof send>>
      try {
        response = await send('/images', { key, body, signal: controller.signal })
      } catch (error) {
        if (controller.signal.reason !== timeout) throw error
        throw new CosmionError(
          'upstream',
          'The generation took more than 5 minutes, so Cosmion stopped waiting. The provider ' +
            'may still have been charged: check your activity on openrouter.ai before trying again.',
          { retryable: false },
        )
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }

      const { data, usage } = check('POST /images', response, imagesResponseSchema)
      const cost = z.object({ cost: z.number() }).safeParse(usage)
      const tokens = tokensSchema.safeParse(usage)
      return {
        images: data.map((item) => ({
          bytes: Buffer.from(item.b64_json, 'base64'),
          mediaType: item.media_type.toLowerCase(),
        })),
        costUsd: cost.success ? cost.data.cost : null,
        usage: tokens.success ? tokens.data : null,
        provider: response.headers.get('x-provider-name'),
        generationId: response.headers.get('x-generation-id'),
      }
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
    metadata: z
      .object({ limit_source: z.string().optional(), resets_at: z.unknown().optional() })
      .optional(),
  }),
})

/** The HTTP status table of docs/openrouter-api.md → Errors. */
function statusError(status: number, body: unknown, headers: Headers): CosmionError {
  const parsed = errorBodySchema.safeParse(body)
  const detail = parsed.success ? parsed.data.error.message : undefined
  const because = detail ? `: ${detail}` : ''
  const metadata = parsed.success ? parsed.data.error.metadata : undefined
  const limitSource = metadata?.limit_source
  const resetsAt = metadata?.resets_at
  const retryAfter = headers.get('retry-after')
  const wait = retryAfter === null ? '' : ` Try again ${waitText(retryAfter)}.`

  switch (status) {
    case 400:
      return new CosmionError('usage', `OpenRouter rejected the request${because}`)
    case 401:
      return new CosmionError('auth', `OpenRouter rejected the API key${because}`)
    case 402:
      if (limitSource === 'openrouter_in_flight_budget') {
        // OpenRouter's docs: "A 402 without the header is not a wait-and-retry case."
        if (retryAfter !== null) {
          return new CosmionError('rate_limited', inFlightMessage(retryAfter))
        }
        return new CosmionError(
          'credits',
          'OpenRouter refused this to cover money held for requests still running ' +
            "(openrouter_in_flight_budget), and didn't say when to try again. Add credits at " +
            `${CREDITS_URL}, which raises how much can be held, or run fewer generations at once.`,
        )
      }
      if (limitSource === undefined || limitSource === 'openrouter_credits') {
        return new CosmionError('credits', outOfCreditsMessage(limitSource))
      }
      return new CosmionError('credits', spentLimitMessage(limitSource, because, resetsAt))
    case 403:
      // 403 also means a moderation, guardrail or permission refusal: retrying won't change it.
      if (limitSource === undefined && !/key limit/i.test(detail ?? '')) {
        return new CosmionError('usage', `OpenRouter refused the request${because}`)
      }
      return new CosmionError('credits', spentLimitMessage(limitSource, because, resetsAt))
    case 404:
      return new CosmionError('not_found', `OpenRouter has no such model or resource${because}`)
    case 413:
      return new CosmionError(
        'usage',
        `${sentence(`OpenRouter says the request is too large${because}`)} ` +
          'Use fewer or smaller reference images (--ref).',
      )
    case 429:
      return new CosmionError(
        'rate_limited',
        `${sentence(`OpenRouter is rate limiting requests${because}`)}${wait}`,
      )
    default:
      return new CosmionError(
        'upstream',
        `${sentence(`OpenRouter failed with status ${status}${because}`)}${wait}`,
      )
  }
}

/** `Retry-After` is a number of seconds; anything else is shown as "shortly". */
function waitText(retryAfter: string): string {
  if (!/^\d+$/.test(retryAfter)) return 'shortly'
  return `in ${retryAfter} ${retryAfter === '1' ? 'second' : 'seconds'}`
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

/** Not a spent limit: OpenRouter is holding money for requests still running, and says when to retry. */
function inFlightMessage(retryAfter: string): string {
  return (
    'OpenRouter is holding money for requests still running, so it refused this one ' +
    `(openrouter_in_flight_budget). Try again ${waitText(retryAfter)}, or run fewer at once.`
  )
}

/** FR-040a: the account's balance ran out. */
function outOfCreditsMessage(limitSource: string | undefined): string {
  const source = limitSource ? ` (${limitSource})` : ''
  return (
    `OpenRouter says you are out of credits${source}. Add credits at ${CREDITS_URL}. ` +
    "OpenRouter also refuses generations when the balance is low, even if it covers the image's price."
  )
}

/**
 * FR-040a: a spending limit ran out: the key's own, an org (guardrail) budget or a workspace
 * budget. OpenRouter's message, kept in `because`, gives the figures and the reset time;
 * `resets_at` is null for a limit that never resets.
 */
function spentLimitMessage(
  limitSource: string | undefined,
  because: string,
  resetsAt: unknown,
): string {
  const [what, ...remedies] =
    limitSource === 'openrouter_guardrail_budget'
      ? ['An organization budget that covers this key', 'ask your org admin to raise it']
      : limitSource === 'openrouter_workspace_budget'
        ? ["The workspace's budget", 'raise it on OpenRouter (or ask its admin)', 'use another key']
        : limitSource === undefined || limitSource === 'openrouter_key_limit'
          ? ["This key's spending limit", "raise the key's limit on OpenRouter", 'use another key']
          : ['A spending limit on OpenRouter', 'raise it on OpenRouter', 'use another key']
  // A string is when it resets; null means it never does; absent means OpenRouter didn't say.
  if (typeof resetsAt === 'string') remedies.unshift(`wait until ${resetsAt}`)
  else if (resetsAt === undefined) remedies.unshift('wait for it to reset if it does')
  const last = remedies.pop()
  const next = remedies.length > 0 ? `${remedies.join(', ')}, or ${last}` : `${last}`
  const source = limitSource ? ` (${limitSource})` : ''
  return `${sentence(`${what} has been reached${source}${because}`)} ${next[0]?.toUpperCase()}${next.slice(1)}.`
}
