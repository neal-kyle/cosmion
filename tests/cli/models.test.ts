import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createFakeOpenRouter, type FakeConfig } from '../helpers/fake-openrouter.js'
import { ledgerEntry, writeLedger } from '../helpers/ledger.js'
import { runCli } from '../helpers/run-cli.js'

const HOUR = 60 * 60 * 1000

interface ListedModel {
  id: string
  name: string
  accepts_references: boolean
  max_references: number
  parameters: string[]
  price: { kind: string; cost_usd: number | null; notes: string[] }
}
interface Listing {
  models: ListedModel[]
  fetched_at: string
}
interface Detail {
  id: string
  name: string
  description: string
  parameters: Record<string, unknown>
  endpoints: {
    provider_name: string
    provider_tag: string | null
    supported_parameters: Record<string, unknown>
    pricing: Record<string, unknown>[]
  }[]
  fetched_at: string
}

function setup(overrides: Partial<FakeConfig> = {}) {
  const fake = createFakeOpenRouter(overrides)
  const models = (args: string[] = [], options: { home?: string } = {}) =>
    runCli(['models', ...args], { fetch: fake.fetch, ...options })
  return { fake, models }
}

/** Number of requests a full refresh makes: the list, then one per model. */
const refreshSize = (fake: { config: FakeConfig }) => 1 + fake.config.models.length

function cacheFile(home: string): string {
  return join(home, 'cache', 'catalog.json')
}

/** Makes the cache look `hours` old, without knowing anything else about its format. */
function ageCache(home: string, hours: number): string {
  const cache = JSON.parse(readFileSync(cacheFile(home), 'utf8'))
  cache.fetched_at = new Date(Date.now() - hours * HOUR).toISOString()
  writeFileSync(cacheFile(home), JSON.stringify(cache))
  return cache.fetched_at
}

describe('models', () => {
  test('lists every image model with its reference support and options (FR-020)', async () => {
    const { fake, models } = setup()
    const result = await models(['--json'])
    expect(result.exitCode).toBe(0)
    const listing = result.json as Listing
    expect(listing.models.map((m) => m.id)).toEqual(fake.config.models.map((m) => m.id))
    for (const model of listing.models) {
      expect(model.name).toEqual(expect.any(String))
      expect(model.parameters).toEqual(expect.any(Array))
    }
  })

  test('accepts_references and max_references come from the input_references range', async () => {
    const { models } = setup()
    const { models: listed } = (await models(['--json'])).json as Listing
    const byId = (id: string) => listed.find((m) => m.id === id)
    expect(byId('bytedance-seed/seedream-4.5')).toMatchObject({
      accepts_references: true,
      max_references: 14,
    })
    expect(byId('google/gemini-2.5-flash-image')).toMatchObject({
      accepts_references: true,
      max_references: 3,
    })
    // No input_references key means unsupported, whatever the input modalities say.
    expect(byId('cosmion-test/no-references')).toMatchObject({
      accepts_references: false,
      max_references: 0,
    })
  })

  test('parameters are the names of the options the model supports', async () => {
    const { models } = setup()
    const { models: listed } = (await models(['--json'])).json as Listing
    expect(listed.find((m) => m.id === 'bytedance-seed/seedream-4.5')?.parameters).toEqual([
      'resolution',
      'aspect_ratio',
      'n',
      'input_references',
      'seed',
    ])
    expect(listed.find((m) => m.id === 'cosmion-test/no-references')?.parameters).toEqual([
      'aspect_ratio',
      'n',
    ])
  })

  test('fetched_at says when the catalog was fetched', async () => {
    const { models } = setup()
    const before = Date.now()
    const { fetched_at } = (await models(['--json'])).json as Listing
    expect(Date.parse(fetched_at)).toBeGreaterThanOrEqual(before - 1000)
    expect(Date.parse(fetched_at)).toBeLessThanOrEqual(Date.now())
  })

  test('text output lists each model on stdout and leaves stderr empty', async () => {
    const { fake, models } = setup()
    const result = await models()
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    for (const model of fake.config.models) {
      expect(result.stdout).toContain(model.id)
      expect(result.stdout).toContain(model.name as string)
    }
  })

  test('every request carries the Cosmion title and no key', async () => {
    const { fake, models } = setup()
    await models(['--json'])
    expect(fake.requests.length).toBeGreaterThan(0)
    for (const request of fake.requests) {
      expect(request.headers['x-openrouter-title']).toBe('Cosmion')
      expect(request.headers).not.toHaveProperty('authorization')
    }
  })
})

describe('the price summary (FR-020)', () => {
  test("each model's price is what `price -m <id>` gives with no options", async () => {
    const { fake, models } = setup()
    const home = mkdtempSync(join(tmpdir(), 'cosmion-home-'))
    // One estimate among them, so the ledger is read too.
    writeLedger(home, [
      ledgerEntry({
        model: 'google/gemini-2.5-flash-image',
        settings: { seed: 3 },
        usage: { prompt_tokens: 17, completion_tokens: 1290, total_tokens: 1307 },
      }),
    ])
    const listing = (await models(['--json'], { home })).json as Listing
    for (const model of listing.models) {
      const priced = await runCli(['price', '-m', model.id, '--json'], { fetch: fake.fetch, home })
      const { kind, cost_usd, notes } = priced.json as Listing['models'][number]['price']
      expect(model.price, model.id).toEqual({ kind, cost_usd, notes })
    }
    const byId = (id: string) => listing.models.find((m) => m.id === id)?.price
    expect(byId('bytedance-seed/seedream-4.5')).toEqual({
      kind: 'exact',
      cost_usd: 0.04,
      notes: [],
    })
    expect(byId('bytedance-seed/seedream-5-0-pro')).toMatchObject({
      kind: 'at_most',
      cost_usd: 0.09,
    })
    expect(byId('google/gemini-2.5-flash-image')).toMatchObject({ kind: 'estimate' })
    expect(byId('krea/krea-2-medium')).toMatchObject({ kind: 'unknown', cost_usd: null })
  })

  test('text output shows each price on its model line', async () => {
    const { models } = setup()
    const result = await models()
    const line = (id: string) => result.stdout.split('\n').find((l) => l.startsWith(`${id} `))
    expect(line('bytedance-seed/seedream-4.5')).toContain('$0.04')
    expect(line('bytedance-seed/seedream-5-0-pro')).toContain('≤$0.09')
    expect(line('krea/krea-2-medium')).toMatch(/unknown/i)
  })
})

describe('models <id>', () => {
  test('shows one model in full (FR-021)', async () => {
    const { fake, models } = setup()
    const result = await models(['bytedance-seed/seedream-4.5', '--json'])
    expect(result.exitCode).toBe(0)
    const detail = result.json as Detail
    expect(detail).toMatchObject({
      id: 'bytedance-seed/seedream-4.5',
      name: fake.config.models[0]?.name,
      description: fake.config.models[0]?.description,
    })
    expect(detail.parameters).toMatchObject({
      resolution: { type: 'enum', values: ['1K', '2K', '4K'] },
      n: { type: 'range', min: 1, max: 10 },
      seed: { type: 'boolean' },
    })
    expect(detail.endpoints).toEqual([
      {
        provider_name: 'Seed',
        provider_tag: 'seed',
        supported_parameters: expect.objectContaining({ resolution: expect.anything() }),
        pricing: [
          { billable: 'output_image', unit: 'image', cost_usd: 0.04 },
          { billable: 'input_image', unit: 'image', cost_usd: 0 },
        ],
      },
    ])
    expect(detail.fetched_at).toEqual(expect.any(String))
  })

  test('lists every endpoint, including two at different prices from one provider', async () => {
    const { models } = setup()
    const detail = (await models(['google/gemini-3-pro-image-preview', '--json'])).json as Detail
    expect(detail.endpoints.map((e) => e.provider_tag)).toEqual([
      'google-ai-studio/global/flex',
      'google-ai-studio/global',
    ])
    expect(detail.endpoints.map((e) => e.provider_name)).toEqual([
      'Google AI Studio',
      'Google AI Studio',
    ])
  })

  test('a model with no pricing still shows, with empty pricing', async () => {
    const { models } = setup()
    const detail = (await models(['krea/krea-2-medium', '--json'])).json as Detail
    expect(detail.endpoints[0]?.pricing).toEqual([])
  })

  test('text output shows the description, options with their values and the providers', async () => {
    const { fake, models } = setup()
    const result = await models(['bytedance-seed/seedream-4.5'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('bytedance-seed/seedream-4.5')
    expect(result.stdout).toContain(fake.config.models[0]?.description as string)
    expect(result.stdout).toContain('resolution')
    expect(result.stdout).toContain('1K, 2K, 4K')
    expect(result.stdout).toContain('Seed')
    expect(result.stdout).toContain('seed')
    expect(result.stdout).toContain('output_image')
    expect(result.stdout).toContain('0.04')
  })

  test('text output names each option by its flag, with the field it sends when that differs', async () => {
    const { models } = setup()
    const result = await models(['bytedance-seed/seedream-4.5'])
    expect(result.stdout).toMatch(/^\s*--resolution\s+1K, 2K, 4K/m)
    expect(result.stdout).toMatch(/^\s*--seed\s+yes/m)
    expect(result.stdout).toMatch(/^\s*--aspect \(sends aspect_ratio\)\s+/m)
    expect(result.stdout).toMatch(/^\s*--count \(sends n\)\s+1 to 10/m)
    expect(result.stdout).toMatch(/^\s*--ref \(sends input_references\)\s+/m)
  })

  test('the list names options by their flags too', async () => {
    const { models } = setup()
    const result = await models([])
    const row = result.stdout
      .split('\n')
      .find((line) => line.startsWith('bytedance-seed/seedream-4.5'))
    expect(row).toContain('--resolution, --aspect, --count, --ref, --seed')
  })
})

describe('the catalog cache (FR-022)', () => {
  test('the first run fetches the list and every model, at most 8 at a time', async () => {
    const { fake, models } = setup({ delayMs: 5 })
    await models(['--json'])
    expect(fake.catalogRequests()).toHaveLength(refreshSize(fake))
    expect(fake.maxInFlight()).toBeGreaterThan(1)
    expect(fake.maxInFlight()).toBeLessThanOrEqual(8)
  })

  test('a second run makes no catalog requests', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    const made = fake.catalogRequests().length
    const second = await models(['--json'], { home: first.home })
    expect(second.exitCode).toBe(0)
    expect(fake.catalogRequests()).toHaveLength(made)
    expect((second.json as Listing).fetched_at).toBe((first.json as Listing).fetched_at)
  })

  test('models <id> uses the same cache', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    const made = fake.requests.length
    const second = await models(['google/gemini-2.5-flash-image', '--json'], { home: first.home })
    expect(second.exitCode).toBe(0)
    expect(fake.requests).toHaveLength(made)
  })

  test('the cache is a catalog.json in the cache folder, with nothing left beside it', async () => {
    const { models } = setup()
    const { home } = await models(['--json'])
    expect(existsSync(cacheFile(home))).toBe(true)
    expect(readdirSync(join(home, 'cache'))).toEqual(['catalog.json'])
  })

  // On Windows a rename can fail while another process has the file open.
  test('a cache that cannot be saved is a warning, not a failure', async () => {
    const { fake, models } = setup()
    const home = mkdtempSync(join(tmpdir(), 'cosmion-test-'))
    mkdirSync(join(cacheFile(home), 'in-the-way'), { recursive: true })
    const result = await models(['--json'], { home })
    expect(result.exitCode).toBe(0)
    expect((result.json as Listing).models).toHaveLength(fake.config.models.length)
    expect(result.stderr).toContain("Couldn't save the model catalog")
    expect(readdirSync(join(home, 'cache'))).toEqual(['catalog.json'])
  })

  test('a cache older than 24 hours is refreshed first (Story 4.9)', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    ageCache(first.home, 25)
    const before = fake.catalogRequests().length
    const second = await models(['--json'], { home: first.home })
    expect(second.exitCode).toBe(0)
    expect(fake.catalogRequests()).toHaveLength(before + refreshSize(fake))
    expect(Date.now() - Date.parse((second.json as Listing).fetched_at)).toBeLessThan(HOUR)
  })

  test('a cache under 24 hours old is used as it is', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    ageCache(first.home, 23)
    const before = fake.catalogRequests().length
    await models(['--json'], { home: first.home })
    expect(fake.catalogRequests()).toHaveLength(before)
  })

  test('--refresh always refreshes', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    const before = fake.catalogRequests().length
    const second = await models(['--refresh', '--json'], { home: first.home })
    expect(second.exitCode).toBe(0)
    expect(fake.catalogRequests()).toHaveLength(before + refreshSize(fake))
  })

  test('--refresh picks up a changed catalog', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    fake.config.models = fake.config.models.slice(0, 3)
    const second = await models(['--refresh', '--json'], { home: first.home })
    expect((second.json as Listing).models).toHaveLength(3)
  })

  test('a cache that cannot be read counts as missing', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    writeFileSync(cacheFile(first.home), '{"models": [')
    const second = await models(['--json'], { home: first.home })
    expect(second.exitCode).toBe(0)
    expect(fake.catalogRequests()).toHaveLength(2 * refreshSize(fake))
  })
})

describe('when a refresh fails', () => {
  test('with a cache, the stale one is used and a warning goes to stderr', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    const staleAt = ageCache(first.home, 30)
    fake.config.status = 500
    const second = await models(['--json'], { home: first.home })
    expect(second.exitCode).toBe(0)
    expect((second.json as Listing).models).toHaveLength(fake.config.models.length)
    expect((second.json as Listing).fetched_at).toBe(staleAt)
    expect(second.stderr).toMatch(/warning:/)
    expect(second.stderr).toMatch(/couldn't refresh the model catalog/i)
    expect(second.stderr).toContain(staleAt)
  })

  test('--refresh that fails also falls back to the cache', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    fake.config.offline = true
    const second = await models(['--refresh', '--json'], { home: first.home })
    expect(second.exitCode).toBe(0)
    expect(second.stderr).toMatch(/couldn't refresh the model catalog/i)
  })

  test('with no cache it exits 7', async () => {
    const { fake, models } = setup({ status: 500 })
    const result = await models(['--json'])
    expect(result.exitCode).toBe(7)
    expect(result.json).toMatchObject({ error: { code: 'upstream', retryable: true } })
    expect(existsSync(cacheFile(result.home))).toBe(false)
    expect(fake.catalogRequests().length).toBeGreaterThan(0)
  })

  test('offline with no cache exits 7 too', async () => {
    const { models } = setup({ offline: true })
    const result = await models(['--json'])
    expect(result.exitCode).toBe(7)
  })

  test('one failing model request fails the whole refresh and writes nothing', async () => {
    const { models } = setup({ failPaths: ['/bytedance-seed/seedream-5-0-pro/endpoints'] })
    const result = await models(['--json'])
    expect(result.exitCode).toBe(7)
    expect(existsSync(cacheFile(result.home))).toBe(false)
  })

  test('one failing model request leaves the old cache as it was', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    const staleAt = ageCache(first.home, 30)
    const before = readFileSync(cacheFile(first.home), 'utf8')
    fake.config.failPaths = ['/google/gemini-2.5-flash-image/endpoints']
    const second = await models(['--json'], { home: first.home })
    expect(second.exitCode).toBe(0)
    expect((second.json as Listing).fetched_at).toBe(staleAt)
    expect(readFileSync(cacheFile(first.home), 'utf8')).toBe(before)
  })

  test('a response of the wrong shape counts as a failed refresh (FR-056)', async () => {
    const { models } = setup({ rawBody: '<html>nope</html>' })
    const result = await models(['--json'])
    expect(result.exitCode).toBe(7)
    expect((result.json as { error: { message: string } }).error.message).toContain('unexpected')
  })
})

describe('an unknown model id', () => {
  test('refreshes once, then exits 5', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    const before = fake.catalogRequests().length
    const result = await models(['nobody/nothing', '--json'], { home: first.home })
    expect(result.exitCode).toBe(5)
    expect(result.json).toMatchObject({ error: { code: 'not_found', retryable: false } })
    expect((result.json as { error: { message: string } }).error.message).toContain(
      'nobody/nothing',
    )
    expect(fake.catalogRequests()).toHaveLength(before + refreshSize(fake))
  })

  test('with no cache, fetches the catalog once, not twice', async () => {
    const { fake, models } = setup()
    const result = await models(['nobody/nothing', '--json'])
    expect(result.exitCode).toBe(5)
    expect(fake.catalogRequests()).toHaveLength(refreshSize(fake))
  })

  test('finds a model that appeared since the cache was made', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    const added = structuredClone(fake.config.models[0])
    if (!added) throw new Error('the fixtures have no models')
    added.id = 'cosmion-test/brand-new'
    fake.config.models.push(added)
    fake.config.endpoints['cosmion-test/brand-new'] = {
      id: 'cosmion-test/brand-new',
      endpoints: fake.config.endpoints['bytedance-seed/seedream-4.5']?.endpoints ?? [],
    }
    const result = await models(['cosmion-test/brand-new', '--json'], { home: first.home })
    expect(result.exitCode).toBe(0)
    expect((result.json as Detail).id).toBe('cosmion-test/brand-new')
  })

  test('if that refresh fails, warns and still exits 5 from the cache', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    fake.config.status = 500
    const result = await models(['nobody/nothing', '--json'], { home: first.home })
    expect(result.exitCode).toBe(5)
    expect(result.stderr).toMatch(/couldn't refresh the model catalog/i)
  })

  test('a known id never triggers a refresh', async () => {
    const { fake, models } = setup()
    const first = await models(['--json'])
    const before = fake.catalogRequests().length
    await models(['bytedance-seed/seedream-4.5', '--json'], { home: first.home })
    expect(fake.catalogRequests()).toHaveLength(before)
  })
})
