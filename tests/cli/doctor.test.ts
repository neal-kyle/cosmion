import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createFakeOpenRouter, VALID_KEY } from '../helpers/fake-openrouter.js'
import { type RunCliOptions, runCli } from '../helpers/run-cli.js'

const isWindows = process.platform === 'win32'
const BAD_KEY = 'sk-or-v1-fake0rejected0key000000000000000000000000000000000000000000'

interface Check {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message: string
  fix: string | null
}

function setup() {
  const fake = createFakeOpenRouter()
  const home = mkdtempSync(join(tmpdir(), 'cosmion-home-'))
  const doctor = async (options: RunCliOptions = {}) => {
    const result = await runCli(['doctor', '--json'], {
      fetch: fake.fetch,
      home,
      env: { OPENROUTER_API_KEY: VALID_KEY },
      ...options,
    })
    const checks = (result.json as { checks: Check[] }).checks
    const check = (name: string) => {
      const found = checks.find((c) => c.name === name)
      if (!found) throw new Error(`No check named ${name} in ${JSON.stringify(checks)}`)
      return found
    }
    return { ...result, checks, check }
  }
  return { fake, home, doctor }
}

const keyRequests = (fake: ReturnType<typeof createFakeOpenRouter>) =>
  fake.requests.filter((r) => r.path === '/key')

describe('doctor (FR-095, FR-096)', () => {
  test('a healthy setup passes every check and exits 0 (Story 11.1)', async () => {
    const { fake, doctor } = setup()
    const result = await doctor()
    expect(result.exitCode).toBe(0)
    expect(result.checks.map((c) => c.name)).toEqual([
      'node',
      'key',
      'key_accepted',
      'key_limit',
      'settings_file',
      'openrouter',
      'catalog',
      'config_folder',
      'data_folder',
      'cache_folder',
      'ledger',
    ])
    for (const check of result.checks) {
      expect(check, check.name).toMatchObject({ status: 'ok', fix: null })
    }
    expect(keyRequests(fake)).toHaveLength(1)
  })

  test('a healthy setup with a saved key passes too', async () => {
    const { home, doctor, fake } = setup()
    await runCli(['auth', '--stdin'], { fetch: fake.fetch, home, stdin: VALID_KEY })
    // The real platform, so Windows reports its own way of not checking permissions.
    const result = await doctor({ env: {}, platform: process.platform })
    expect(result.exitCode).toBe(0)
    expect(result.check('key').message).toContain('cosmion auth')
  })

  test('text mode lists the checks', async () => {
    const { fake, home } = setup()
    const result = await runCli(['doctor'], {
      fetch: fake.fetch,
      home,
      env: { OPENROUTER_API_KEY: VALID_KEY },
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/ok\s+node/)
  })

  test('Node older than 22.12 fails', async () => {
    const { doctor } = setup()
    const result = await doctor({ nodeVersion: '22.11.0' })
    expect(result.exitCode).toBe(8)
    expect(result.check('node')).toMatchObject({ status: 'fail', fix: expect.any(String) })
    expect(result.check('node').message).toContain('22.11.0')
  })

  test('Node 23 and later pass', async () => {
    const { doctor } = setup()
    expect((await doctor({ nodeVersion: '24.0.0' })).check('node').status).toBe('ok')
  })

  test('no key fails, with the fix, and the key checks that need one are left out', async () => {
    const { fake, doctor } = setup()
    const result = await doctor({ env: {} })
    expect(result.exitCode).toBe(8)
    expect(result.check('key')).toMatchObject({ status: 'fail' })
    expect(result.check('key').fix).toContain('cosmion auth')
    expect(result.checks.map((c) => c.name)).not.toContain('key_accepted')
    expect(result.checks.map((c) => c.name)).not.toContain('key_limit')
    expect(keyRequests(fake)).toHaveLength(0)
  })

  test("the key's source is reported", async () => {
    const { doctor } = setup()
    expect((await doctor()).check('key').message).toContain('OPENROUTER_API_KEY')
  })

  test('a rejected key fails, with the fix', async () => {
    const { doctor } = setup()
    const result = await doctor({ env: { OPENROUTER_API_KEY: BAD_KEY } })
    expect(result.exitCode).toBe(8)
    expect(result.check('key_accepted')).toMatchObject({ status: 'fail', fix: expect.any(String) })
    expect(result.checks.map((c) => c.name)).not.toContain('key_limit')
  })

  test('a key limit under 10% remaining warns, and exits 0', async () => {
    const { fake, doctor } = setup()
    const record = fake.config.keys[VALID_KEY]
    if (!record) throw new Error('no key record')
    record.limit = 100
    record.limit_remaining = 9.99
    const result = await doctor()
    expect(result.exitCode).toBe(0)
    expect(result.check('key_limit')).toMatchObject({ status: 'warn', fix: expect.any(String) })
  })

  test('a key without a limit is ok', async () => {
    const { fake, doctor } = setup()
    const record = fake.config.keys[VALID_KEY]
    if (!record) throw new Error('no key record')
    record.limit = null
    record.limit_remaining = null
    expect((await doctor()).check('key_limit').status).toBe('ok')
  })

  test.skipIf(isWindows)(
    'a settings file readable by others fails with the fix, and exits 8 (Story 11.2)',
    async () => {
      const { home, doctor } = setup()
      mkdirSync(join(home, 'config'), { recursive: true })
      const file = join(home, 'config', 'settings.json')
      writeFileSync(file, '{}\n')
      chmodSync(file, 0o644)
      const result = await doctor()
      expect(result.exitCode).toBe(8)
      expect(result.check('settings_file')).toMatchObject({ status: 'fail' })
      expect(result.check('settings_file').fix).toContain('chmod 600')
    },
  )

  test('on Windows the settings file permissions are not checked', async () => {
    const { doctor } = setup()
    const result = await doctor({ platform: 'win32' })
    expect(result.check('settings_file')).toMatchObject({ status: 'ok' })
    expect(result.check('settings_file').message).toContain('not checked on Windows')
  })

  test('OpenRouter unreachable fails, with the fix', async () => {
    const { fake, doctor } = setup()
    fake.config.offline = true
    const result = await doctor()
    expect(result.exitCode).toBe(8)
    expect(result.check('openrouter')).toMatchObject({ status: 'fail', fix: expect.any(String) })
    // Without an answer the key is neither accepted nor rejected.
    expect(result.check('key_accepted').status).toBe('warn')
  })

  test('a catalog neither fresh nor refreshable fails', async () => {
    const { fake, doctor } = setup()
    fake.config.failPaths = ['/endpoints']
    const result = await doctor()
    expect(result.exitCode).toBe(8)
    expect(result.check('catalog')).toMatchObject({ status: 'fail', fix: expect.any(String) })
  })

  test('a stale catalog that cannot be refreshed warns', async () => {
    const { fake, home, doctor } = setup()
    await runCli(['models', '--json'], { fetch: fake.fetch, home })
    const file = join(home, 'cache', 'catalog.json')
    const cache = JSON.parse(readFileSync(file, 'utf8'))
    cache.fetched_at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    writeFileSync(file, JSON.stringify(cache))
    fake.config.failPaths = ['/endpoints']
    const result = await doctor()
    expect(result.check('catalog')).toMatchObject({ status: 'warn', fix: expect.any(String) })
  })

  test('an unwritable folder fails, with the fix', async () => {
    const { home, doctor } = setup()
    // A file where the folder should be: no one can write into it, root included.
    writeFileSync(join(home, 'data'), 'not a folder')
    const result = await doctor()
    expect(result.exitCode).toBe(8)
    expect(result.check('data_folder')).toMatchObject({ status: 'fail', fix: expect.any(String) })
    expect(result.check('data_folder').message).toContain(join(home, 'data'))
    expect(result.check('config_folder').status).toBe('ok')
  })

  test('a ledger with skipped lines warns with the count, and exits 0', async () => {
    const { home, doctor } = setup()
    mkdirSync(join(home, 'data'), { recursive: true })
    writeFileSync(join(home, 'data', 'ledger.jsonl'), '{"cut off\nnot json either\n')
    const result = await doctor()
    expect(result.exitCode).toBe(0)
    expect(result.check('ledger')).toMatchObject({ status: 'warn', fix: expect.any(String) })
    expect(result.check('ledger').message).toContain('2')
  })
})
