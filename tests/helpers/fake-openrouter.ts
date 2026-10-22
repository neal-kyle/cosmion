import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixtures = join(import.meta.dirname, 'fixtures', 'catalog')

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
}

export interface FakeOpenRouter {
  fetch: typeof fetch
  config: FakeConfig
  requests: RecordedRequest[]
  /** Requests for the model list and the endpoint records. */
  catalogRequests(): RecordedRequest[]
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
    const answer = route(config, request, path)
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
    maxInFlight: () => maxInFlight,
  }
}

function route(config: FakeConfig, request: Request, path: string): Response {
  const method = request.method
  if (method === 'GET' && (path === '/key' || path === '/credits')) {
    const key = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
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
