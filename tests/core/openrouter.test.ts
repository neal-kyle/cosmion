import { describe, expect, test } from 'vitest'
import { CosmionError, type ErrorCode } from '../../src/core/errors.js'
import { createOpenRouterClient } from '../../src/core/openrouter.js'
import { createFakeOpenRouter, type FakeConfig } from '../helpers/fake-openrouter.js'

function clientFor(overrides: Partial<FakeConfig> = {}) {
  const fake = createFakeOpenRouter(overrides)
  const client = createOpenRouterClient({
    baseUrl: 'https://openrouter.test/api/v1',
    fetch: fake.fetch,
    title: 'Cosmion',
  })
  return { fake, client }
}

async function failureOf(promise: Promise<unknown>): Promise<CosmionError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(CosmionError)
  return error as CosmionError
}

describe('the catalog calls', () => {
  test('listImageModels returns the models', async () => {
    const { client, fake } = clientFor()
    const models = await client.listImageModels()
    expect(models.map((m) => m.id)).toEqual(fake.config.models.map((m) => m.id))
    expect(models[0]).toMatchObject({ id: 'bytedance-seed/seedream-4.5', name: expect.any(String) })
  })

  test('getEndpoints returns one record per provider endpoint, with its pricing', async () => {
    const { client } = clientFor()
    const endpoints = await client.getEndpoints('google/gemini-3-pro-image-preview')
    expect(endpoints.map((e) => e.provider_tag)).toEqual([
      'google-ai-studio/global/flex',
      'google-ai-studio/global',
    ])
    expect(endpoints[0]?.pricing).toContainEqual({
      billable: 'output_image',
      unit: 'token',
      cost_usd: 0.00006,
    })
  })

  test('pricing lines with a unit or billable Cosmion has never seen still load', async () => {
    const { client } = clientFor()
    const [unit] = await client.getEndpoints('cosmion-test/unknown-unit')
    expect(unit?.pricing[0]?.unit).toBe('second')
    const [billable] = await client.getEndpoints('cosmion-test/unknown-billable')
    expect(billable?.pricing.map((p) => p.billable)).toContain('input_audio')
  })

  test('a model with no pricing lines loads with an empty list', async () => {
    const { client } = clientFor()
    const [endpoint] = await client.getEndpoints('krea/krea-2-medium')
    expect(endpoint?.pricing).toEqual([])
  })
})

describe('HTTP status → CosmionError (docs/openrouter-api.md, Errors)', () => {
  const cases: [number, ErrorCode, boolean][] = [
    [400, 'usage', false],
    [401, 'auth', false],
    [402, 'credits', false],
    [404, 'not_found', false],
    [429, 'rate_limited', true],
    [500, 'upstream', true],
    [502, 'upstream', true],
    [529, 'upstream', true],
    [524, 'upstream', true],
  ]

  test.each(cases)('%i is %s (retryable: %s)', async (status, code, retryable) => {
    const { client } = clientFor({ status })
    const error = await failureOf(client.listImageModels())
    expect(error.code).toBe(code)
    expect(error.retryable).toBe(retryable)
  })

  test("the message carries OpenRouter's own explanation", async () => {
    const { client } = clientFor({ status: 400 })
    expect((await failureOf(client.listImageModels())).message).toContain('fake error 400')
  })

  test('a failing endpoint request fails getEndpoints the same way', async () => {
    const { client } = clientFor({ failPaths: ['/endpoints'] })
    const error = await failureOf(client.getEndpoints('bytedance-seed/seedream-4.5'))
    expect(error).toMatchObject({ code: 'upstream', retryable: true })
  })

  test('an unknown model is not_found', async () => {
    const { client } = clientFor()
    const error = await failureOf(client.getEndpoints('nobody/nothing'))
    expect(error).toMatchObject({ code: 'not_found', retryable: false })
    expect(error.message).toContain('nobody/nothing')
  })

  test('a fetch that throws (offline) is upstream and retryable', async () => {
    const { client } = clientFor({ offline: true })
    const error = await failureOf(client.listImageModels())
    expect(error).toMatchObject({ code: 'upstream', retryable: true })
    expect(error.message).toContain('OpenRouter')
  })
})

describe('402 explains itself (FR-040a)', () => {
  test('out of credits: names the limit, links the credits page, explains the low-balance refusal', async () => {
    const { client } = clientFor({
      status: 402,
      errorMetadata: { limit_source: 'openrouter_credits' },
    })
    const { message } = await failureOf(client.listImageModels())
    expect(message).toContain('openrouter_credits')
    expect(message).toContain('https://openrouter.ai/settings/credits')
    expect(message).toMatch(/balance is low/i)
  })

  test("the key's own limit is named as such", async () => {
    const { client } = clientFor({ status: 402, errorMetadata: { limit_source: 'key_limit' } })
    const { message } = await failureOf(client.listImageModels())
    expect(message).toContain('key_limit')
    expect(message).toMatch(/key/i)
  })

  test('still a clear message when OpenRouter gives no limit_source', async () => {
    const { client } = clientFor({ status: 402 })
    const { message } = await failureOf(client.listImageModels())
    expect(message).toContain('https://openrouter.ai/settings/credits')
  })
})

describe('unexpected responses (FR-056)', () => {
  test.each([
    ['not JSON at all', '<html>Bad gateway</html>'],
    ['JSON of the wrong shape', '{"models": []}'],
    ['a model without an id', '{"data": [{"name": "No id"}]}'],
    ['an empty body', ''],
  ])('%s is upstream with a message, not a crash', async (_name, rawBody) => {
    const { client } = clientFor({ rawBody })
    const error = await failureOf(client.listImageModels())
    expect(error).toMatchObject({ code: 'upstream', retryable: true })
    expect(error.message).toContain('unexpected')
  })

  test('an endpoint record of the wrong shape is upstream too', async () => {
    const { client } = clientFor({ rawBody: '{"id": "x", "endpoints": "none"}' })
    const error = await failureOf(client.getEndpoints('bytedance-seed/seedream-4.5'))
    expect(error).toMatchObject({ code: 'upstream' })
  })
})

describe('what is sent', () => {
  test('every request carries X-OpenRouter-Title (FR-055)', async () => {
    const { client, fake } = clientFor()
    await client.listImageModels()
    await client.getEndpoints('bytedance-seed/seedream-4.5')
    expect(fake.requests).toHaveLength(2)
    for (const request of fake.requests) {
      expect(request.headers['x-openrouter-title']).toBe('Cosmion')
    }
  })

  test('catalog requests send no Authorization (FR-022)', async () => {
    const { client, fake } = clientFor()
    await client.listImageModels()
    await client.getEndpoints('bytedance-seed/seedream-4.5')
    for (const request of fake.requests) {
      expect(request.headers).not.toHaveProperty('authorization')
    }
  })

  test('the paths and method are the documented ones', async () => {
    const { client, fake } = clientFor()
    await client.listImageModels()
    await client.getEndpoints('bytedance-seed/seedream-4.5')
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /images/models',
      'GET /images/models/bytedance-seed/seedream-4.5/endpoints',
    ])
  })
})
