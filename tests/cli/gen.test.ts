import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createFakeOpenRouter,
  type FakeOpenRouter,
  TINY_JPEG,
  VALID_KEY,
} from '../helpers/fake-openrouter.js'
import { type RunCliOptions, type RunCliResult, runCli } from '../helpers/run-cli.js'

const SEEDREAM = 'bytedance-seed/seedream-4.5'
const images = join(import.meta.dirname, '..', 'helpers', 'fixtures', 'images')
const base64Of = (name: string) => readFileSync(join(images, name)).toString('base64')

interface Entry {
  id: string
  model: string
  prompt: string
  settings: Record<string, unknown>
  references: string[]
  images: { path: string; width: number | null; height: number | null; format: string }[]
  cost_usd: number | null
  usage: Record<string, number> | null
  provider: string | null
  generation_id: string | null
  [key: string]: unknown
}

function setup() {
  const fake = createFakeOpenRouter()
  const gen = (args: string[], options: RunCliOptions = {}) =>
    runCli(['gen', ...args], {
      fetch: fake.fetch,
      ...options,
      env: { OPENROUTER_API_KEY: VALID_KEY, ...options.env },
    })
  return { fake, gen }
}

const newFolder = (prefix: string) => mkdtempSync(join(tmpdir(), prefix))

/** The ledger's lines, parsed; none when there is no ledger. */
function ledgerOf(home: string): Entry[] {
  const file = join(home, 'data', 'ledger.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))
}

/**
 * Runs `start` with the fake holding POST /images open for a moment, does `action` while
 * the request is running, then waits for the result.
 */
async function whileGenerating(
  fake: FakeOpenRouter,
  start: () => Promise<RunCliResult>,
  action: () => void,
): Promise<RunCliResult> {
  fake.config.images.delayMs = 300
  const running = start()
  for (let i = 0; i < 2000 && fake.imageRequests().length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  action()
  return running
}

describe('Story 1: generate an image into my project', () => {
  test('1. saved as ./cosmion-<id>.jpg, its entry printed with the actual cost', async () => {
    const { gen } = setup()
    const result = await gen(['a lighthouse at dusk', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(0)
    const entry = result.json as Entry
    expect(entry).toEqual({
      v: 1,
      id: expect.stringMatching(/^[a-z0-9]{8}$/),
      created_at: expect.any(String),
      model: SEEDREAM,
      prompt: 'a lighthouse at dusk',
      settings: { seed: expect.any(Number) },
      references: [],
      images: [
        { path: join(result.cwd, `cosmion-${entry.id}.jpg`), width: 2, height: 2, format: 'jpeg' },
      ],
      cost_usd: 0.04,
      usage: { prompt_tokens: 17, completion_tokens: 16384, total_tokens: 16401 },
      provider: 'Seed',
      generation_id: 'gen-img-fake-0001',
      batch_id: null,
      row: null,
      regen_of: null,
    })
    expect(new Date(entry.created_at as string).toISOString()).toBe(entry.created_at)
    expect(readFileSync(join(result.cwd, `cosmion-${entry.id}.jpg`)).toString('base64')).toBe(
      TINY_JPEG,
    )
  })

  test('1. one ledger entry, the same as the output (FR-014, FR-050)', async () => {
    const { gen } = setup()
    const result = await gen(['a lighthouse', '-m', SEEDREAM, '--json'])
    expect(ledgerOf(result.home)).toEqual([result.json])
  })

  test('1. text mode: the path on stdout, one summary line on stderr (FR-015)', async () => {
    const { gen } = setup()
    const result = await gen(['a lighthouse', '-m', SEEDREAM])
    expect(result.exitCode).toBe(0)
    const [entry] = ledgerOf(result.home)
    expect(result.stdout).toBe(`${entry?.images[0]?.path}\n`)
    const lines = result.stderr.trimEnd().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(entry?.id)
    expect(lines[0]).toContain(SEEDREAM)
    expect(lines[0]).toContain('$0.04')
  })

  test('2. --out assets/hero.png is written exactly there, creating assets/', async () => {
    const { gen } = setup()
    const result = await gen(['hero', '-m', SEEDREAM, '--out', 'assets/hero.png', '--json'])
    expect(result.exitCode).toBe(0)
    const path = join(result.cwd, 'assets', 'hero.png')
    expect(existsSync(path)).toBe(true)
    expect((result.json as Entry).images.map((image) => image.path)).toEqual([path])
  })

  test('3. --count 3 --out shots/ saves three numbered images in one entry', async () => {
    const { fake, gen } = setup()
    const result = await gen(['shots', '-m', SEEDREAM, '--count', '3', '--out', 'shots/', '--json'])
    expect(result.exitCode).toBe(0)
    const entry = result.json as Entry
    expect(fake.imageRequests()[0]?.json.n).toBe(3)
    expect(entry.images.map((image) => image.path)).toEqual(
      [1, 2, 3].map((k) => join(result.cwd, 'shots', `cosmion-${entry.id}-${k}.jpg`)),
    )
    for (const image of entry.images) expect(existsSync(image.path)).toBe(true)
    expect(ledgerOf(result.home)).toHaveLength(1)
  })

  test('3. text mode prints each path on its own line', async () => {
    const { gen } = setup()
    const result = await gen(['shots', '-m', SEEDREAM, '-n', '2'])
    const [entry] = ledgerOf(result.home)
    expect(result.stdout).toBe(`${entry?.images.map((image) => image.path).join('\n')}\n`)
  })

  test('4. --ref sends the image and the ledger records its path', async () => {
    const { fake, gen } = setup()
    const cwd = newFolder('cosmion-cwd-')
    copyFileSync(join(images, 'tiny.png'), join(cwd, 'sketch.png'))
    const url = 'https://example.com/b.png'
    const result = await gen(
      ['from a sketch', '-m', SEEDREAM, '--ref', 'sketch.png', '--ref', url, '--json'],
      {
        cwd,
      },
    )
    expect(result.exitCode).toBe(0)
    expect(fake.imageRequests()[0]?.json.input_references).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Of('tiny.png')}` } },
      { type: 'image_url', image_url: { url } },
    ])
    expect((result.json as Entry).references).toEqual([join(cwd, 'sketch.png'), url])
  })
})

describe('the model and the prompt', () => {
  test('the model comes from COSMION_MODEL when --model is not given (FR-002)', async () => {
    const { fake, gen } = setup()
    const result = await gen(['a lighthouse', '--json'], { env: { COSMION_MODEL: SEEDREAM } })
    expect(result.exitCode).toBe(0)
    expect(fake.imageRequests()[0]?.json.model).toBe(SEEDREAM)
  })

  test('with no model at all: exit 2', async () => {
    const { fake, gen } = setup()
    const result = await gen(['a lighthouse', '--json'])
    expect(result.exitCode).toBe(2)
    expect(fake.requests).toEqual([])
  })

  test('- reads the prompt from stdin (FR-001)', async () => {
    const { fake, gen } = setup()
    const result = await gen(['-', '-m', SEEDREAM, '--json'], { stdin: 'a lighthouse\nat dusk\n' })
    expect(result.exitCode).toBe(0)
    expect(fake.imageRequests()[0]?.json.prompt).toBe('a lighthouse\nat dusk')
    expect((result.json as Entry).prompt).toBe('a lighthouse\nat dusk')
  })

  test('spaces and line breaks around an argument are removed too (FR-001)', async () => {
    const { fake, gen } = setup()
    const result = await gen(['  a lighthouse \n', '-m', SEEDREAM, '--json'])
    expect(fake.imageRequests()[0]?.json.prompt).toBe('a lighthouse')
    expect((result.json as Entry).prompt).toBe('a lighthouse')
  })

  test.each([
    ['an empty argument', [''], undefined],
    ['blank stdin', ['-'], '  \n'],
  ])('%s exits 2 and sends nothing', async (_what, prompt, stdin) => {
    const { fake, gen } = setup()
    const result = await gen([...prompt, '-m', SEEDREAM, '--json'], { stdin })
    expect(result.exitCode).toBe(2)
    expect((result.json as { error: { message: string } }).error.message).toMatch(/prompt/i)
    expect(fake.requests).toEqual([])
  })
})

describe('what is sent (FR-003, FR-004)', () => {
  test('each option under its API field', async () => {
    const { fake, gen } = setup()
    const model = fake.config.models.find((m) => m.id === 'cosmion-test/tiered')
    if (!model) throw new Error('fixture missing')
    model.supported_parameters = {
      aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] },
      resolution: { type: 'enum', values: ['1K', '2K'] },
      quality: { type: 'enum', values: ['low', 'high'] },
      background: { type: 'enum', values: ['auto', 'opaque'] },
      n: { type: 'range', min: 1, max: 4 },
      seed: { type: 'boolean' },
      output_format: { type: 'enum', values: ['png', 'webp'] },
      output_compression: { type: 'range', min: 0, max: 100 },
    }
    const result = await gen([
      'all of it',
      '-m',
      'cosmion-test/tiered',
      '--aspect',
      '16:9',
      '--resolution',
      '2K',
      '--quality',
      'high',
      '--background',
      'opaque',
      '-n',
      '2',
      '--seed',
      '42',
      '--format',
      'webp',
      '--compression',
      '80',
      '--json',
    ])
    expect(result.exitCode).toBe(0)
    const settings = {
      aspect_ratio: '16:9',
      resolution: '2K',
      quality: 'high',
      background: 'opaque',
      n: 2,
      seed: 42,
      output_format: 'webp',
      output_compression: 80,
    }
    expect(fake.imageRequests()[0]?.json).toEqual({
      model: 'cosmion-test/tiered',
      prompt: 'all of it',
      ...settings,
    })
    expect((result.json as Entry).settings).toEqual(settings)
  })

  test('only the options passed (a model without a seed gets nothing else)', async () => {
    const { fake, gen } = setup()
    const result = await gen([
      'p',
      '-m',
      'x-ai/grok-imagine-image-2.0',
      '--aspect',
      '16:9',
      '--json',
    ])
    expect(result.exitCode).toBe(0)
    expect(fake.imageRequests()[0]?.json).toEqual({
      model: 'x-ai/grok-imagine-image-2.0',
      prompt: 'p',
      aspect_ratio: '16:9',
    })
    expect((result.json as Entry).settings).toEqual({ aspect_ratio: '16:9' })
  })

  test('a model that takes a seed gets a random one, sent and recorded', async () => {
    const { fake, gen } = setup()
    const first = await gen(['p', '-m', SEEDREAM, '--json'])
    const second = await gen(['p', '-m', SEEDREAM, '--json'])
    const seeds = fake.imageRequests().map((request) => request.json.seed)
    expect(seeds[0]).toEqual(expect.any(Number))
    expect(Number.isInteger(seeds[0])).toBe(true)
    expect((first.json as Entry).settings.seed).toBe(seeds[0])
    expect((second.json as Entry).settings.seed).toBe(seeds[1])
    expect(seeds[0]).not.toBe(seeds[1])
  })

  test("the random seed stays within the model's seed range", async () => {
    const { fake, gen } = setup()
    const model = fake.config.models.find((m) => m.id === SEEDREAM)
    if (!model) throw new Error('fixture missing')
    model.supported_parameters = {
      ...(model.supported_parameters as object),
      seed: { type: 'range', min: 5, max: 6 },
    }
    await gen(['p', '-m', SEEDREAM, '--json'])
    expect([5, 6]).toContain(fake.imageRequests()[0]?.json.seed)
  })

  test('--seed is sent as given', async () => {
    const { fake, gen } = setup()
    await gen(['p', '-m', SEEDREAM, '--seed', '7', '--json'])
    expect(fake.imageRequests()[0]?.json.seed).toBe(7)
  })
})

describe('the format (FR-009, FR-010)', () => {
  const FLUX = 'black-forest-labs/flux.2-klein-4b' // output_format: png, jpeg

  test.each([
    ['x.png', 'png'],
    ['x.jpg', 'jpeg'],
    ['x.JPEG', 'jpeg'],
  ])('--out %s asks for %s when the model offers it', async (out, format) => {
    const { fake, gen } = setup()
    const result = await gen(['p', '-m', FLUX, '--out', out, '--json'])
    expect(result.exitCode).toBe(0)
    expect(fake.imageRequests()[0]?.json.output_format).toBe(format)
    expect((result.json as Entry).settings.output_format).toBe(format)
  })

  test.each([
    ['a format the model does not offer', FLUX, ['--out', 'x.webp']],
    ['a model without output_format', SEEDREAM, ['--out', 'x.png']],
    ['an extension that is no format', FLUX, ['--out', 'x.txt']],
    ['a folder', FLUX, ['--out', 'shots/']],
  ])('nothing implied for %s', async (_what, model, args) => {
    const { fake, gen } = setup()
    await gen(['p', '-m', model, ...args, '--json'])
    expect(fake.imageRequests()[0]?.json).not.toHaveProperty('output_format')
  })

  test('--format wins over the extension', async () => {
    const { fake, gen } = setup()
    await gen(['p', '-m', FLUX, '--format', 'jpeg', '--out', 'x.png', '--json'])
    expect(fake.imageRequests()[0]?.json.output_format).toBe('jpeg')
  })

  test.each([
    ['image/png', 'tiny.png', '.png', 'png'],
    ['image/jpeg', 'tiny.jpg', '.jpg', 'jpeg'],
    ['image/webp', 'tiny.webp', '.webp', 'webp'],
  ])('a default name takes its extension from media_type %s', async (type, file, ext, format) => {
    const { fake, gen } = setup()
    fake.config.images.data = [{ b64_json: base64Of(file), media_type: type }]
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    const entry = result.json as Entry
    expect(entry.images).toEqual([
      { path: join(result.cwd, `cosmion-${entry.id}${ext}`), width: 2, height: 2, format },
    ])
  })
})

describe('progress (FR-015, FR-042)', () => {
  test('shown on stderr when it is a terminal', async () => {
    const { gen } = setup()
    const result = await gen(['p', '-m', SEEDREAM], { stderrIsTTY: true })
    expect(result.stderr).toContain('Generating')
  })

  test('not shown otherwise', async () => {
    const { gen } = setup()
    const result = await gen(['p', '-m', SEEDREAM])
    expect(result.stderr).not.toContain('Generating')
  })
})

describe('nothing is sent when a pre-check fails (FR-012)', () => {
  async function refused(args: string[], options: RunCliOptions = {}) {
    const { fake, gen } = setup()
    const result = await gen(['p', ...args, '--json'], options)
    expect(fake.imageRequests()).toEqual([])
    return result
  }

  test('no key: exit 3', async () => {
    const result = await refused(['-m', SEEDREAM], { env: { OPENROUTER_API_KEY: undefined } })
    expect(result.exitCode).toBe(3)
    expect((result.json as { error: { message: string } }).error.message).toContain('cosmion auth')
  })

  test('an unknown model: exit 5', async () => {
    const result = await refused(['-m', 'nobody/nothing'])
    expect(result.exitCode).toBe(5)
  })

  test('Story 1.5: an option the model does not take: exit 2, naming the flag and model', async () => {
    const result = await refused(['-m', SEEDREAM, '--quality', 'high'])
    expect(result.exitCode).toBe(2)
    const { message } = (result.json as { error: { message: string } }).error
    expect(message).toContain('--quality')
    expect(message).toContain(SEEDREAM)
  })

  test('a reference that cannot be read: exit 2', async () => {
    const result = await refused(['-m', SEEDREAM, '--ref', 'missing.png'])
    expect(result.exitCode).toBe(2)
  })

  test('Story 1.6: the output path is taken: exit 2, the file untouched', async () => {
    const cwd = newFolder('cosmion-cwd-')
    writeFileSync(join(cwd, 'logo.png'), 'old')
    const result = await refused(['-m', SEEDREAM, '--out', 'logo.png'], { cwd })
    expect(result.exitCode).toBe(2)
    expect(readFileSync(join(cwd, 'logo.png'), 'utf8')).toBe('old')
  })

  test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'the output folder is not writable (the nearest existing one, for a new folder): exit 2',
    async () => {
      const cwd = newFolder('cosmion-cwd-')
      mkdirSync(join(cwd, 'locked'))
      chmodSync(join(cwd, 'locked'), 0o500)
      try {
        const result = await refused(['-m', SEEDREAM, '--out', 'locked/new/a.png'], { cwd })
        expect(result.exitCode).toBe(2)
        expect(existsSync(join(cwd, 'locked', 'new'))).toBe(false)
      } finally {
        chmodSync(join(cwd, 'locked'), 0o700)
      }
    },
  )

  test('a missing output folder is not created when nothing is sent', async () => {
    const cwd = newFolder('cosmion-cwd-')
    const result = await refused(['-m', SEEDREAM, '--quality', 'high', '--out', 'new/deeper/'], {
      cwd,
    })
    expect(result.exitCode).toBe(2)
    expect(readdirSync(cwd)).toEqual([])
  })

  test('with --force an existing file is replaced', async () => {
    const { gen } = setup()
    const cwd = newFolder('cosmion-cwd-')
    writeFileSync(join(cwd, 'logo.png'), 'old')
    const result = await gen(['p', '-m', SEEDREAM, '--out', 'logo.png', '--force', '--json'], {
      cwd,
    })
    expect(result.exitCode).toBe(0)
    expect(readFileSync(join(cwd, 'logo.png')).toString('base64')).toBe(TINY_JPEG)
  })
})

const KEY_LIMIT_MESSAGE =
  'Key limit exceeded (daily limit). Manage it using https://openrouter.ai/settings/keys ' +
  '$2.52 of $2.00 used; resets 2026-11-02T00:00:00.000Z.'

describe('failures from OpenRouter (FR-016, FR-040)', () => {
  test.each([
    [400, 2, 'usage', false],
    [401, 3, 'auth', false],
    [402, 4, 'credits', false],
    [404, 5, 'not_found', false],
    [429, 6, 'rate_limited', true],
    [500, 7, 'upstream', true],
    [502, 7, 'upstream', true],
    [524, 7, 'upstream', true],
  ])(
    '%i exits %i (%s, retryable: %s), sent once, nothing recorded',
    async (status, exit, code, retryable) => {
      const { fake, gen } = setup()
      fake.config.images.status = status
      const result = await gen(['p', '-m', SEEDREAM, '--json'])
      expect(result.exitCode).toBe(exit)
      expect(result.json).toEqual({ error: { code, message: expect.any(String), retryable } })
      expect(fake.imageRequests()).toHaveLength(1)
      expect(ledgerOf(result.home)).toEqual([])
    },
  )

  test('Story 1.7: 402 says the credits ran out and links to the credits page (FR-040a)', async () => {
    const { fake, gen } = setup()
    fake.config.images.status = 402
    fake.config.images.errorMetadata = { limit_source: 'openrouter_credits' }
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(4)
    const { message } = (result.json as { error: { message: string } }).error
    expect(message).toContain('https://openrouter.ai/settings/credits')
    expect(message).toMatch(/credits/)
  })

  test("403 for the key's daily limit exits 4 and isn't retryable, keeping the reset time", async () => {
    const { fake, gen } = setup()
    fake.config.images.status = 403
    fake.config.images.errorMessage = KEY_LIMIT_MESSAGE
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(4)
    expect(result.json).toEqual({
      error: { code: 'credits', message: expect.any(String), retryable: false },
    })
    const { message } = (result.json as { error: { message: string } }).error
    expect(message).toContain('$2.52 of $2.00 used; resets 2026-11-02T00:00:00.000Z')
    expect(fake.imageRequests()).toHaveLength(1)
    expect(ledgerOf(result.home)).toEqual([])
  })

  test('a 403 that names a spending limit only in its metadata exits 4', async () => {
    const { fake, gen } = setup()
    fake.config.images.status = 403
    fake.config.images.errorMetadata = { limit_source: 'openrouter_key_limit' }
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(4)
    expect((result.json as { error: { message: string } }).error.message).toContain(
      'openrouter_key_limit',
    )
  })

  test('any other 403 stays upstream', async () => {
    const { fake, gen } = setup()
    fake.config.images.status = 403
    fake.config.images.errorMessage = 'Your input was flagged'
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(7)
    expect((result.json as { error: { code: string } }).error.code).toBe('upstream')
  })

  test('Story 2.4: a server error is retryable', async () => {
    const { fake, gen } = setup()
    fake.config.images.status = 503
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(7)
    expect((result.json as { error: { retryable: boolean } }).error.retryable).toBe(true)
  })

  test.each([
    ['an image without b64_json', { data: [{ media_type: 'image/png' }] }],
    ['an image without media_type', { data: [{ b64_json: TINY_JPEG }] }],
    ['data that is not a list', { data: 'images' }],
  ])('%s exits 7 with a message (FR-056)', async (_what, body) => {
    const { fake, gen } = setup()
    fake.config.images.rawBody = JSON.stringify(body)
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(7)
    expect((result.json as { error: { message: string } }).error.message).toMatch(/unexpected/i)
  })

  test('a body that is not JSON exits 7', async () => {
    const { fake, gen } = setup()
    fake.config.images.rawBody = '<html>Bad gateway</html>'
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(7)
  })

  test('the network failing exits 7, retryable', async () => {
    const { fake, gen } = setup()
    const home = newFolder('cosmion-home-')
    await runCli(['models', '--json'], { fetch: fake.fetch, home })
    fake.config.offline = true
    const result = await gen(['p', '-m', SEEDREAM, '--json'], { home })
    expect(result.exitCode).toBe(7)
    expect((result.json as { error: { retryable: boolean } }).error.retryable).toBe(true)
  })

  describe('the 5-minute timeout (FR-017)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    test('exit 7, not retryable, saying it may still have been charged', async () => {
      const { fake, gen } = setup()
      const home = newFolder('cosmion-home-')
      // The catalog is fetched first, with real timers.
      await runCli(['models', '--json'], { fetch: fake.fetch, home })
      fake.config.images.delayMs = 10 * 60_000
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      let finished = false
      const running = gen(['p', '-m', SEEDREAM, '--json'], { home }).finally(() => {
        finished = true
      })
      while (fake.imageRequests().length === 0) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      await vi.advanceTimersByTimeAsync(5 * 60_000 - 1)
      expect(finished).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      const result = await running

      expect(result.exitCode).toBe(7)
      const { error } = result.json as {
        error: { code: string; message: string; retryable: boolean }
      }
      expect(error.code).toBe('upstream')
      expect(error.retryable).toBe(false)
      expect(error.message).toMatch(/may still have been charged/)
      expect(error.message).toContain('openrouter.ai')
      expect(ledgerOf(home)).toEqual([])
    })
  })
})

describe('edge cases', () => {
  test('fewer images than asked for: those that came back are saved and reported', async () => {
    const { fake, gen } = setup()
    fake.config.images.data = [{ b64_json: TINY_JPEG, media_type: 'image/jpeg' }]
    const result = await gen(['p', '-m', SEEDREAM, '-n', '3', '--json'])
    expect(result.exitCode).toBe(0)
    const entry = result.json as Entry
    expect(entry.images.map((image) => image.path)).toEqual([
      join(result.cwd, `cosmion-${entry.id}-1.jpg`),
    ])
    expect(result.stderr).toMatch(/warning:.*1 of 3/)
  })

  test('fewer images than asked for with --out: still numbered <stem>-<k><ext>', async () => {
    const { fake, gen } = setup()
    fake.config.images.data = [{ b64_json: TINY_JPEG, media_type: 'image/jpeg' }]
    const result = await gen(['p', '-m', SEEDREAM, '-n', '3', '--out', 'hero.jpg', '--json'])
    expect(result.exitCode).toBe(0)
    expect((result.json as Entry).images.map((image) => image.path)).toEqual([
      join(result.cwd, 'hero-1.jpg'),
    ])
  })

  test('no images at all: an entry with the cost and no images, exit 7, not retryable', async () => {
    const { fake, gen } = setup()
    fake.config.images.data = []
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(7)
    const { error } = result.json as {
      error: { code: string; message: string; retryable: boolean }
    }
    expect(error.code).toBe('upstream')
    expect(error.retryable).toBe(false)
    expect(error.message).toMatch(/no images/)
    expect(error.message).toContain('$0.04')
    expect(readdirSync(result.cwd)).toEqual([])
    const [entry, ...rest] = ledgerOf(result.home)
    expect(rest).toEqual([])
    expect(entry).toMatchObject({ images: [], cost_usd: 0.04, provider: 'Seed' })
    expect(error.message).toContain(entry?.id)
  })

  test('paid but not saved: an entry with the cost and no images, exit 1', async () => {
    const { fake, gen } = setup()
    const cwd = newFolder('cosmion-cwd-')
    // The file appears after the check and before the write; it is still not overwritten.
    const result = await whileGenerating(
      fake,
      () => gen(['p', '-m', SEEDREAM, '--out', 'logo.png', '--json'], { cwd }),
      () => writeFileSync(join(cwd, 'logo.png'), 'old'),
    )
    expect(result.exitCode).toBe(1)
    const { error } = result.json as { error: { code: string; message: string } }
    expect(error.code).toBe('internal')
    expect(error.message).toContain(join(cwd, 'logo.png'))
    expect(error.message).toContain('$0.04')
    expect(readFileSync(join(cwd, 'logo.png'), 'utf8')).toBe('old')
    const [entry, ...rest] = ledgerOf(result.home)
    expect(rest).toEqual([])
    expect(entry).toMatchObject({ images: [], cost_usd: 0.04, provider: 'Seed' })
  })

  test('dimensions that cannot be read: the image is kept with null dimensions and a warning', async () => {
    const { fake, gen } = setup()
    const garbage = Buffer.from('not really an image').toString('base64')
    fake.config.images.data = [{ b64_json: garbage, media_type: 'image/png' }]
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(0)
    const [image] = (result.json as Entry).images
    expect(image).toMatchObject({ width: null, height: null, format: 'png' })
    expect(readFileSync(image?.path as string).toString('base64')).toBe(garbage)
    expect(result.stderr).toMatch(/warning:.*dimensions/)
  })

  test('a format other than the --out extension: written there anyway, with a warning', async () => {
    // Riverflow lists only jpeg and returns WebP.
    const { fake, gen } = setup()
    fake.config.images.data = [{ b64_json: base64Of('tiny.webp'), media_type: 'image/webp' }]
    const result = await gen([
      'p',
      '-m',
      'sourceful/riverflow-v2.5-fast',
      '--out',
      'x.jpg',
      '--json',
    ])
    expect(result.exitCode).toBe(0)
    expect(fake.imageRequests()[0]?.json.output_format).toBe('jpeg')
    expect((result.json as Entry).images).toEqual([
      { path: join(result.cwd, 'x.jpg'), width: 2, height: 2, format: 'webp' },
    ])
    expect(result.stderr).toMatch(/warning:.*webp/i)
  })

  test('SVG is saved as .svg with null width and height, without a warning', async () => {
    const { fake, gen } = setup()
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
    fake.config.images.data = [
      { b64_json: Buffer.from(svg).toString('base64'), media_type: 'image/svg+xml' },
    ]
    const result = await gen(['p', '-m', 'recraft/recraft-v4.1-vector', '--json'])
    expect(result.exitCode).toBe(0)
    const entry = result.json as Entry
    expect(entry.images).toEqual([
      {
        path: join(result.cwd, `cosmion-${entry.id}.svg`),
        width: null,
        height: null,
        format: 'svg',
      },
    ])
    expect(readFileSync(entry.images[0]?.path as string, 'utf8')).toBe(svg)
    expect(result.stderr).not.toContain('warning')
  })

  test('no usage.cost: cost recorded as null, with a warning', async () => {
    const { fake, gen } = setup()
    fake.config.images.usage = { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toMatchObject({
      cost_usd: null,
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    })
    expect(result.stderr).toMatch(/warning:.*cost/)
  })

  test('no usage at all: usage and cost null', async () => {
    const { fake, gen } = setup()
    fake.config.images.usage = null
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toMatchObject({ cost_usd: null, usage: null })
  })

  test('no provider or generation id headers: null', async () => {
    const { fake, gen } = setup()
    fake.config.images.headers = {}
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    expect(result.json).toMatchObject({ provider: null, generation_id: null })
  })

  test('a ledger that cannot be written after saving: a warning, exit 0', async () => {
    const { fake, gen } = setup()
    const home = newFolder('cosmion-home-')
    const result = await whileGenerating(
      fake,
      () => gen(['p', '-m', SEEDREAM, '--json'], { home }),
      // A folder where the ledger file should be.
      () => mkdirSync(join(home, 'data', 'ledger.jsonl'), { recursive: true }),
    )
    expect(result.exitCode).toBe(0)
    expect(existsSync((result.json as Entry).images[0]?.path as string)).toBe(true)
    expect(result.stderr).toMatch(/warning:.*ledger/)
  })

  test('the key appears nowhere in the ledger or the output (FR-049)', async () => {
    const { gen } = setup()
    const result = await gen(['p', '-m', SEEDREAM, '--json'])
    const ledger = readFileSync(join(result.home, 'data', 'ledger.jsonl'), 'utf8')
    for (const text of [ledger, result.stdout, result.stderr]) {
      expect(text).not.toContain(VALID_KEY)
    }
  })

  test('Ctrl-C: no entry, the "may still have been charged" message, exit 130 (FR-040)', async () => {
    const { fake, gen } = setup()
    const interrupt = new AbortController()
    const result = await whileGenerating(
      fake,
      () => gen(['p', '-m', SEEDREAM, '--json'], { signal: interrupt.signal }),
      () => interrupt.abort(),
    )
    expect(result.exitCode).toBe(130)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/may still have been charged/)
    expect(ledgerOf(result.home)).toEqual([])
    expect(readdirSync(result.cwd)).toEqual([])
  })
})
