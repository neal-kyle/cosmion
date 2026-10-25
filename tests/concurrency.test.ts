import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { createFakeOpenRouter, serveFakeOpenRouter, VALID_KEY } from './helpers/fake-openrouter.js'

const run = promisify(execFile)
const main = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js')

// SC-006: every entry lands as a complete line, however many processes append at once.
test('20 gen processes at once leave 20 complete ledger lines', { timeout: 60_000 }, async () => {
  if (!existsSync(main)) throw new Error('dist/ is missing: run `npm run build` (npm test does)')
  const fake = createFakeOpenRouter()
  const server = await serveFakeOpenRouter(fake)
  const home = mkdtempSync(join(tmpdir(), 'cosmion-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'cosmion-cwd-'))
  const env = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    COSMION_HOME: home,
    COSMION_TEST_OPENROUTER_URL: server.url,
    OPENROUTER_API_KEY: VALID_KEY,
  }
  try {
    const gen = (i: number) =>
      run(
        process.execPath,
        [main, 'gen', `image ${i}`, '-m', 'bytedance-seed/seedream-4.5', '--json'],
        {
          cwd,
          env,
        },
      )
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => gen(i)))

    const lines = readFileSync(join(home, 'data', 'ledger.jsonl'), 'utf8').split('\n')
    expect(lines.pop()).toBe('')
    const entries = lines.map((line) => JSON.parse(line))
    expect(entries).toHaveLength(20)
    expect(new Set(entries.map((entry) => entry.prompt)).size).toBe(20)
    expect(entries.map((entry) => entry.id).sort()).toEqual(
      results.map((result) => JSON.parse(result.stdout).id).sort(),
    )
  } finally {
    await server.close()
  }
})
