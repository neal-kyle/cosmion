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
    const answer = route(config, request.method, path)
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

function route(config: FakeConfig, method: string, path: string): Response {
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
