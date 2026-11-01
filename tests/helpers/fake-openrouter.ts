import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

const fixtures = join(import.meta.dirname, 'fixtures', 'catalog')

/** The tiny 2×2 JPEG POST /images returns by default, base64. */
export const TINY_JPEG = readFileSync(
  join(import.meta.dirname, 'fixtures', 'images', 'tiny.jpg'),
).toString('base64')

export interface CatalogModel {
  id: string
  [key: string]: unknown
}
export interface CatalogEndpoints {
  id: string
  endpoints: Record<string, unknown>[]
}

/** The shipped fixtures, copied so a test can change its own without touching the next. */
export function loadCatalogFixtures(): {
  models: CatalogModel[]
  endpoints: Record<string, CatalogEndpoints>
} {
  const models = JSON.parse(readFileSync(join(fixtures, 'models.json'), 'utf8')).data
  const endpoints = JSON.parse(readFileSync(join(fixtures, 'endpoints.json'), 'utf8'))
  return { models, endpoints }
}

/** What GET /key answers for one key: the fields Cosmion reads, plus a few it ignores. */
export interface KeyRecord {
  label: string
  limit: number | null
  limit_remaining: number | null
  usage: number
  [key: string]: unknown
}

/** A key the fake accepts by default. */
export const VALID_KEY = 'sk-or-v1-fake0valid0key0000000000000000000000000000000000000000000000'

export interface RecordedRequest {
  method: string
  /** Without the `/api/v1` prefix, e.g. `/images/models`. */
  path: string
  /** Header names in lower case. */
  headers: Record<string, string>
  body: string | null
}

/** What a test can change at any time. */
export interface FakeConfig {
  models: CatalogModel[]
  endpoints: Record<string, CatalogEndpoints>
  /** The keys GET /key and GET /credits accept; any other gets a 401. */
  keys: Record<string, KeyRecord>
  /** What GET /credits answers for an accepted key. */
  credits: { total_credits: number; total_usage: number }
  /** GET /credits answers 403, as the docs say it does for keys that aren't management keys. */
  creditsRefused: boolean
  /** Every request gets this error status instead of its normal answer. */
  status?: number
  /** The `error.metadata` of that error, e.g. `{ limit_source: 'openrouter_credits' }`. */
  errorMetadata?: Record<string, unknown>
  /** Requests whose path contains one of these get a 500. */
  failPaths: string[]
  /** Every request waits this long (milliseconds) before it is answered. */
  delayMs: number
  /** `fetch` rejects, as when offline. */
  offline: boolean
  /** Replaces the body of a successful answer, whatever it was (a malformed response). */
  rawBody?: string
  /** How POST /images answers. */
  images: ImagesConfig
}

/** How POST /images answers; the catalog and key calls are unaffected. */
export interface ImagesConfig {
  /** The `data` items. Default: one tiny JPEG per image asked for (`n`, or 1). */
  data?: Record<string, unknown>[]
  /** The `usage` object, or null to leave it out. */
  usage: Record<string, unknown> | null
  /** Response headers, e.g. `x-provider-name`. */
  headers: Record<string, string>
  /** Answer with this error status instead. */
  status?: number
  /** The `error.metadata` of that error. */
  errorMetadata?: Record<string, unknown>
  /** Wait this long (milliseconds) before answering. */
  delayMs: number
  /** Replaces the whole successful body (a malformed response). */
  rawBody?: string
  /** Different answers for requests with these prompts, e.g. one batch row failing. */
  byPrompt?: Record<string, Partial<Omit<ImagesConfig, 'byPrompt'>>>
}

export interface FakeOpenRouter {
  fetch: typeof fetch
  config: FakeConfig
  requests: RecordedRequest[]
  /** Requests for the model list and the endpoint records. */
  catalogRequests(): RecordedRequest[]
  /** The POST /images requests, their bodies parsed. */
  imageRequests(): (RecordedRequest & { json: Record<string, unknown> })[]
  /** The most requests that were waiting for an answer at the same time. */
  maxInFlight(): number
}

/** A `fetch` that answers like OpenRouter, from the fixtures, and records what it was asked. */
export function createFakeOpenRouter(overrides: Partial<FakeConfig> = {}): FakeOpenRouter {
  const config: FakeConfig = {
    ...loadCatalogFixtures(),
    keys: {
      [VALID_KEY]: {
        label: 'sk-or-v1-fak...000',
        limit: 100,
        limit_remaining: 74.5,
        limit_reset: 'monthly',
        usage: 25.5,
        usage_daily: 0.5,
        is_free_tier: false,
      },
    },
    credits: { total_credits: 100.5, total_usage: 25.75 },
    creditsRefused: false,
    failPaths: [],
    delayMs: 0,
    offline: false,
    images: {
      usage: { prompt_tokens: 17, completion_tokens: 16384, total_tokens: 16401, cost: 0.04 },
      headers: { 'x-provider-name': 'Seed', 'x-generation-id': 'gen-img-fake-0001' },
      delayMs: 0,
    },
    ...overrides,
  }
  const requests: RecordedRequest[] = []
  let inFlight = 0
  let maxInFlight = 0

  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '')
    requests.push({
      method: request.method,
      path,
      headers: Object.fromEntries(request.headers),
      body: init?.body === undefined || init.body === null ? null : String(init.body),
    })
    if (config.offline) throw new TypeError('fetch failed')
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    try {
      if (config.delayMs > 0) await sleep(config.delayMs, init?.signal ?? undefined)
    } finally {
      inFlight--
    }

    if (config.status !== undefined) return errorResponse(config.status, config.errorMetadata)
    if (config.failPaths.some((part) => path.includes(part))) return errorResponse(500)
    const answer = await route(config, request, path, init?.signal ?? undefined)
    if (config.rawBody !== undefined && answer.status === 200) {
      return new Response(config.rawBody, { status: 200 })
    }
    return answer
  }

  return {
    fetch: fakeFetch,
    config,
    requests,
    catalogRequests: () => requests.filter((r) => r.path.startsWith('/images/models')),
    imageRequests: () =>
      requests
        .filter((r) => r.method === 'POST' && r.path === '/images')
        .map((r) => ({ ...r, json: JSON.parse(r.body ?? '{}') })),
    maxInFlight: () => maxInFlight,
  }
}

/**
 * Serves the fake over HTTP on a random local port, for tests that run the real CLI in
 * other processes (COSMION_TEST_OPENROUTER_URL). `url` is the API base, ending in `/api/v1`.
 */
export async function serveFakeOpenRouter(
  fake: FakeOpenRouter,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(name, value)
    }
    const answer = await fake.fetch(`http://127.0.0.1${request.url}`, {
      method: request.method,
      headers,
      body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : undefined,
    })
    response.writeHead(answer.status, Object.fromEntries(answer.headers))
    response.end(await answer.text())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/api/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

async function route(
  config: FakeConfig,
  request: Request,
  path: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const method = request.method
  const key = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (method === 'POST' && path === '/images') {
    if (!config.keys[key]) return errorResponse(401, undefined, 'User not found.')
    return images(config.images, JSON.parse(await request.text()), signal)
  }
  if (method === 'GET' && (path === '/key' || path === '/credits')) {
    const record = config.keys[key]
    if (!record) return errorResponse(401, undefined, 'User not found.')
    if (path === '/key') return json({ data: record })
    if (config.creditsRefused) {
      return errorResponse(403, undefined, 'Only management keys can perform this operation')
    }
    return json({ data: config.credits })
  }
  if (method === 'GET' && path === '/images/models') return json({ data: config.models })
  const endpoints = /^\/images\/models\/(.+\/[^/]+)\/endpoints$/.exec(path)
  if (method === 'GET' && endpoints) {
    const record = config.endpoints[endpoints[1] as string]
    if (record) return json(record)
    return errorResponse(404, undefined, `No image model found for "${endpoints[1]}"`)
  }
  return errorResponse(404, undefined, `The fake has no route for ${method} ${path}`)
}

async function images(
  base: ImagesConfig,
  body: { n?: number; prompt?: string },
  signal: AbortSignal | undefined,
): Promise<Response> {
  const config = { ...base, ...base.byPrompt?.[body.prompt ?? ''] }
  if (config.delayMs > 0) await sleep(config.delayMs, signal)
  if (config.status !== undefined) return errorResponse(config.status, config.errorMetadata)
  if (config.rawBody !== undefined) return new Response(config.rawBody, { status: 200 })
  const data =
    config.data ??
    Array.from({ length: body.n ?? 1 }, () => ({ b64_json: TINY_JPEG, media_type: 'image/jpeg' }))
  return new Response(
    JSON.stringify({ created: 0, data, ...(config.usage ? { usage: config.usage } : {}) }),
    { status: 200, headers: { 'content-type': 'application/json', ...config.headers } },
  )
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(
  status: number,
  metadata?: Record<string, unknown>,
  message = `fake error ${status}`,
): Response {
  const error = { code: status, message, ...(metadata ? { metadata } : {}) }
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })
}
