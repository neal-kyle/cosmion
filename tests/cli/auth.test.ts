import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createFakeOpenRouter, VALID_KEY } from '../helpers/fake-openrouter.js'
import { type RunCliOptions, runCli } from '../helpers/run-cli.js'

const isWindows = process.platform === 'win32'
const OTHER_KEY = 'sk-or-v1-fake0other0key0000000000000000000000000000000000000000000000'
const BAD_KEY = 'sk-or-v1-fake0rejected0key000000000000000000000000000000000000000000'

const newHome = () => mkdtempSync(join(tmpdir(), 'cosmion-home-'))
const settingsFile = (home: string) => join(home, 'config', 'settings.json')
const savedKey = (home: string) =>
  existsSync(settingsFile(home))
    ? JSON.parse(readFileSync(settingsFile(home), 'utf8')).api_key
    : undefined

function setup() {
  const fake = createFakeOpenRouter()
  fake.config.keys[OTHER_KEY] = {
    label: 'other key',
    limit: null,
    limit_remaining: null,
    usage: 3,
  }
  const home = newHome()
  const cli = (args: string[], options: RunCliOptions = {}) =>
    runCli(args, { fetch: fake.fetch, home, ...options })
  const save = (key = VALID_KEY) => cli(['auth', '--stdin', '--json'], { stdin: `${key}\n` })
  return { fake, home, cli, save }
}

const errorOf = (json: unknown) => (json as { error: { code: string; message: string } }).error

describe('auth --stdin (FR-047)', () => {
  test('a valid key is checked, saved, and its label returned', async () => {
    const { fake, home, save } = setup()
    const result = await save()
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({ saved: true, label: 'sk-or-v1-fak...000' })
    expect(savedKey(home)).toBe(VALID_KEY)
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /key'])
    expect(fake.requests[0]?.headers.authorization).toBe(`Bearer ${VALID_KEY}`)
  })

  test.skipIf(isWindows)('the settings file is owner-only', async () => {
    const { home, save } = setup()
    await save()
    expect(statSync(settingsFile(home)).mode & 0o777).toBe(0o600)
  })

  test('surrounding whitespace is ignored', async () => {
    const { home, cli } = setup()
    const result = await cli(['auth', '--stdin'], { stdin: `  ${VALID_KEY}\r\n\n` })
    expect(result.exitCode).toBe(0)
    expect(savedKey(home)).toBe(VALID_KEY)
  })

  test('text mode shows the label', async () => {
    const { cli } = setup()
    const result = await cli(['auth', '--stdin'], { stdin: VALID_KEY })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('sk-or-v1-fak...000')
  })

  test('a new key replaces the saved one', async () => {
    const { home, save } = setup()
    await save()
    await save(OTHER_KEY)
    expect(savedKey(home)).toBe(OTHER_KEY)
  })

  test('an invalid key saves nothing and exits 3', async () => {
    const { home, save } = setup()
    const result = await save(BAD_KEY)
    expect(result.exitCode).toBe(3)
    expect(errorOf(result.json).code).toBe('auth')
    expect(existsSync(settingsFile(home))).toBe(false)
  })

  test('an invalid key leaves an already saved key alone', async () => {
    const { home, save } = setup()
    await save()
    await save(BAD_KEY)
    expect(savedKey(home)).toBe(VALID_KEY)
  })

  test('an empty stdin exits 2 without asking OpenRouter', async () => {
    const { fake, home, cli } = setup()
    const result = await cli(['auth', '--stdin', '--json'], { stdin: '  \n' })
    expect(result.exitCode).toBe(2)
    expect(fake.requests).toEqual([])
    expect(existsSync(settingsFile(home))).toBe(false)
  })

  test('a network failure saves nothing and exits 7', async () => {
    const { fake, home, save } = setup()
    fake.config.offline = true
    const result = await save()
    expect(result.exitCode).toBe(7)
    expect(existsSync(settingsFile(home))).toBe(false)
  })

  test('without a TTY and without --stdin: exit 2 before reading anything (FR-043)', async () => {
    const { fake, home, cli } = setup()
    const result = await cli(['auth', '--json'], { stdin: VALID_KEY, stdinIsTTY: false })
    expect(result.exitCode).toBe(2)
    expect(errorOf(result.json).message).toContain('--stdin')
    expect(fake.requests).toEqual([])
    expect(existsSync(settingsFile(home))).toBe(false)
  })

  test('with OPENROUTER_API_KEY set, the key is saved with a warning that the env var wins', async () => {
    const { home, cli } = setup()
    const result = await cli(['auth', '--stdin', '--json'], {
      stdin: OTHER_KEY,
      env: { OPENROUTER_API_KEY: VALID_KEY },
    })
    expect(result.exitCode).toBe(0)
    expect(savedKey(home)).toBe(OTHER_KEY)
    expect(result.stderr).toMatch(/warning:.*OPENROUTER_API_KEY/)
  })

  test('without OPENROUTER_API_KEY there is no warning', async () => {
    const { save } = setup()
    const result = await save()
    expect(result.stderr).not.toContain('warning')
  })
})

describe('auth on a terminal (behavior only)', () => {
  const typed = (home: string, input: string, args: string[] = []) => {
    const fake = createFakeOpenRouter()
    return runCli(['auth', ...args], { fetch: fake.fetch, home, stdin: input, stdinIsTTY: true })
  }

  test('the key typed and Enter is saved, and never echoed', async () => {
    const home = newHome()
    const result = await typed(home, `${VALID_KEY}\r`)
    expect(result.exitCode).toBe(0)
    expect(savedKey(home)).toBe(VALID_KEY)
    expect(result.stderr).not.toBe('')
    expect(result.stdout + result.stderr).not.toContain(VALID_KEY)
    expect(result.stdout + result.stderr).not.toContain(VALID_KEY.slice(0, 20))
  })

  test('Backspace removes a character', async () => {
    const home = newHome()
    const result = await typed(home, `${VALID_KEY}xy\x7f\b\r`)
    expect(result.exitCode).toBe(0)
    expect(savedKey(home)).toBe(VALID_KEY)
  })

  test('Enter finishes; what comes after is ignored', async () => {
    const home = newHome()
    await typed(home, `${VALID_KEY}\rmore`)
    expect(savedKey(home)).toBe(VALID_KEY)
  })

  test.each([[[]], [['--json']]])('Ctrl-C aborts without saving and exits 130 %j', async (args) => {
    const home = newHome()
    const result = await typed(home, 'sk-or-v1-half\x03', args)
    expect(result.exitCode).toBe(130)
    expect(result.stdout).toBe('')
    expect(existsSync(settingsFile(home))).toBe(false)
  })

  test('nothing typed exits 2', async () => {
    const home = newHome()
    const result = await typed(home, '\r', ['--json'])
    expect(result.exitCode).toBe(2)
    expect(existsSync(settingsFile(home))).toBe(false)
  })
})

describe('auth status (FR-048)', () => {
  const ORG_BUDGET = {
    scope: 'member',
    guardrail_id: 'g-1',
    budget_id: null,
    limit_usd: 50,
    spend_usd: 40,
    remaining_usd: 10,
    reset_interval: 'weekly',
    resets_at: '2026-11-09T00:00:00.000Z',
    include_byok: false,
  }

  test('an org or workspace budget that blocks first is shown as budget', async () => {
    const { fake, cli } = setup()
    const record = fake.config.keys[VALID_KEY]
    if (!record) throw new Error('no key record')
    record.budgets = [ORG_BUDGET]
    record.effective_budget = ORG_BUDGET
    const result = await cli(['auth', 'status', '--json'], {
      env: { OPENROUTER_API_KEY: VALID_KEY },
    })
    expect(result.exitCode).toBe(0)
    expect(result.json).toMatchObject({
      budget: {
        scope: 'member',
        limit_usd: 50,
        remaining_usd: 10,
        resets_at: '2026-11-09T00:00:00.000Z',
      },
    })
    const text = await cli(['auth', 'status'], { env: { OPENROUTER_API_KEY: VALID_KEY } })
    expect(text.stdout).toMatch(
      /Budget: +\$10\.00 of \$50\.00 left \(member, resets 2026-11-09T00:00:00\.000Z\)/,
    )
  })

  test("the key's own limit as effective_budget isn't repeated as budget", async () => {
    const { fake, cli } = setup()
    const record = fake.config.keys[VALID_KEY]
    if (!record) throw new Error('no key record')
    record.effective_budget = { ...ORG_BUDGET, scope: 'key_limit' }
    const result = await cli(['auth', 'status', '--json'], {
      env: { OPENROUTER_API_KEY: VALID_KEY },
    })
    expect(result.json).toMatchObject({ budget: null })
  })

  test('an effective_budget of an unexpected shape is ignored, not a failure', async () => {
    const { fake, cli } = setup()
    const record = fake.config.keys[VALID_KEY]
    if (!record) throw new Error('no key record')
    record.effective_budget = { scope: 3 }
    const result = await cli(['auth', 'status', '--json'], {
      env: { OPENROUTER_API_KEY: VALID_KEY },
    })
    expect(result.exitCode).toBe(0)
    expect(result.json).toMatchObject({ valid: true, budget: null })
  })

  const nothing = {
    valid: null,
    label: null,
    limit_usd: null,
    limit_remaining_usd: null,
    usage_usd: null,
    balance_usd: null,
    budget: null,
  }

  test('no key: source none, the rest null, exit 0, nothing fetched', async () => {
    const { fake, cli } = setup()
    const result = await cli(['auth', 'status', '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({ source: 'none', ...nothing })
    expect(fake.requests).toEqual([])
  })

  test('a saved key: source file, with its limit, usage and the balance', async () => {
    const { fake, cli, save } = setup()
    await save()
    fake.requests.length = 0
    const result = await cli(['auth', 'status', '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({
      source: 'file',
      valid: true,
      label: 'sk-or-v1-fak...000',
      limit_usd: 100,
      limit_remaining_usd: 74.5,
      usage_usd: 25.5,
      balance_usd: 74.75,
      budget: null,
    })
    expect(fake.requests.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /credits',
      'GET /key',
    ])
    for (const request of fake.requests) {
      expect(request.headers.authorization).toBe(`Bearer ${VALID_KEY}`)
    }
  })

  test('the env var wins over a saved key', async () => {
    const { cli, save } = setup()
    await save()
    const result = await cli(['auth', 'status', '--json'], {
      env: { OPENROUTER_API_KEY: OTHER_KEY },
    })
    expect(result.json).toMatchObject({ source: 'env', valid: true, label: 'other key' })
  })

  test('a key without a limit has null limits', async () => {
    const { cli } = setup()
    const result = await cli(['auth', 'status', '--json'], {
      env: { OPENROUTER_API_KEY: OTHER_KEY },
    })
    expect(result.json).toMatchObject({ limit_usd: null, limit_remaining_usd: null, usage_usd: 3 })
  })

  test('the balance is null when /credits is refused', async () => {
    const { fake, cli } = setup()
    fake.config.creditsRefused = true
    const result = await cli(['auth', 'status', '--json'], {
      env: { OPENROUTER_API_KEY: VALID_KEY },
    })
    expect(result.exitCode).toBe(0)
    expect(result.json).toMatchObject({ valid: true, balance_usd: null, usage_usd: 25.5 })
  })

  test('a rejected key is valid: false, exit 0', async () => {
    const { cli } = setup()
    const result = await cli(['auth', 'status', '--json'], {
      env: { OPENROUTER_API_KEY: BAD_KEY },
    })
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({ source: 'env', ...nothing, valid: false })
  })

  test('a network failure exits 7', async () => {
    const { fake, cli } = setup()
    fake.config.offline = true
    const result = await cli(['auth', 'status', '--json'], {
      env: { OPENROUTER_API_KEY: VALID_KEY },
    })
    expect(result.exitCode).toBe(7)
  })

  test('text mode says where the key comes from', async () => {
    const { cli, save } = setup()
    expect((await cli(['auth', 'status'])).stdout).toMatch(/no key/i)
    await save()
    const saved = await cli(['auth', 'status'])
    expect(saved.stdout).toContain('sk-or-v1-fak...000')
    expect(saved.stdout).toContain('$74.75')
    const env = await cli(['auth', 'status'], { env: { OPENROUTER_API_KEY: BAD_KEY } })
    expect(env.stdout).toContain('OPENROUTER_API_KEY')
    expect(env.stdout).toMatch(/rejected/i)
  })
})

describe('auth logout', () => {
  test('removes the saved key, then has nothing to remove', async () => {
    const { home, cli, save } = setup()
    await save()
    const first = await cli(['auth', 'logout', '--json'])
    expect(first).toMatchObject({ exitCode: 0, json: { removed: true } })
    expect(savedKey(home)).toBeUndefined()
    const status = await cli(['auth', 'status', '--json'])
    expect(status.json).toMatchObject({ source: 'none' })

    const second = await cli(['auth', 'logout', '--json'])
    expect(second).toMatchObject({ exitCode: 0, json: { removed: false } })
  })

  test('leaves OPENROUTER_API_KEY alone: it was never saved', async () => {
    const { cli } = setup()
    const result = await cli(['auth', 'logout', '--json'], {
      env: { OPENROUTER_API_KEY: VALID_KEY },
    })
    expect(result.json).toEqual({ removed: false })
  })
})

describe('the key is never printed or written elsewhere (FR-049)', () => {
  function filesUnder(dir: string): string[] {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .map((name) => join(dir, name))
      .filter((path) => statSync(path).isFile())
  }

  test('across every auth command, text and JSON', async () => {
    const { fake, home, cli } = setup()
    const runs = [
      await cli(['auth', '--stdin'], { stdin: VALID_KEY }),
      await cli(['auth', '--stdin', '--json'], { stdin: VALID_KEY }),
      await cli(['auth', '--stdin', '--json'], { stdin: BAD_KEY }),
      await cli(['auth'], { stdin: `${VALID_KEY}\r`, stdinIsTTY: true }),
      await cli(['auth', 'status']),
      await cli(['auth', 'status', '--json']),
    ]
    fake.config.creditsRefused = true
    runs.push(await cli(['auth', 'status', '--json']))
    fake.config.offline = true
    runs.push(await cli(['auth', 'status', '--json']))
    runs.push(await cli(['auth', 'status']))
    fake.config.offline = false
    runs.push(await cli(['auth', 'logout']))
    runs.push(await cli(['auth', 'logout', '--json']))

    for (const result of runs) {
      for (const key of [VALID_KEY, BAD_KEY]) {
        expect(result.stdout).not.toContain(key)
        expect(result.stderr).not.toContain(key)
      }
    }
    // The settings file is gone after logout; nothing else may hold the key.
    for (const file of [...filesUnder(home), ...runs.flatMap((r) => filesUnder(r.cwd))]) {
      expect(readFileSync(file, 'utf8')).not.toContain(VALID_KEY)
    }
  })

  test('only the settings file holds a saved key', async () => {
    const { home, save } = setup()
    await save()
    const holders = filesUnder(home).filter((file) =>
      readFileSync(file, 'utf8').includes(VALID_KEY),
    )
    expect(holders).toEqual([settingsFile(home)])
  })
})
