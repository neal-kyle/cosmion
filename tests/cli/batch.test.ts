import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { createFakeOpenRouter, VALID_KEY } from '../helpers/fake-openrouter.js'
import { createTestContext, type RunCliOptions, runCli } from '../helpers/run-cli.js'

const SEEDREAM = 'bytedance-seed/seedream-4.5'
/** Priced per token: unknown until the first image with these settings. */
const GEMINI = 'google/gemini-3.1-flash-image'

interface ReportRow {
  row: number
  status: string
  id: string | null
  paths: string[]
  cost_usd: number | null
  price: { kind: string; cost_usd: number | null; notes: string[] } | null
  error: { code: string; message: string } | null
}
interface Report {
  batch_id: string
  budget_usd: number | null
  spent_usd: number
  stopped: { code: string; message: string } | null
  rows: ReportRow[]
}
interface DryRun {
  rows: { row: number; price: { kind: string; cost_usd: number | null; notes: string[] } }[]
  total: { kind: string; cost_usd: number | null; notes: string[] }
}

/** A fake, a home and a cwd shared by every run of one test. */
function setup() {
  const fake = createFakeOpenRouter()
  const { home, cwd } = createTestContext()
  const batch = (args: string[], options: RunCliOptions = {}) =>
    runCli(['batch', ...args], {
      fetch: fake.fetch,
      home,
      cwd,
      ...options,
      env: { OPENROUTER_API_KEY: VALID_KEY, ...options.env },
    })
  const file = (name: string, text: string) => {
    writeFileSync(join(cwd, name), text)
    return name
  }
  /** A CSV of prompts `p1`, `p2`, … with the same model and extra columns. */
  const csv = (count: number, model = SEEDREAM, extra: Record<string, string> = {}) =>
    file(
      'jobs.csv',
      [
        ['prompt', 'model', ...Object.keys(extra)].join(','),
        ...Array.from({ length: count }, (_, i) =>
          [`p${i + 1}`, model, ...Object.values(extra)].join(','),
        ),
      ].join('\n'),
    )
  const ledger = () => {
    const path = join(home, 'data', 'ledger.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }
  const prompts = () => fake.imageRequests().map((request) => request.json.prompt)
  return { fake, home, cwd, batch, file, csv, ledger, prompts }
}

const statuses = (report: Report) => report.rows.map((row) => row.status)

describe('batch within a budget (Story 7)', () => {
  test('5 rows at $0.04 with --budget 0.20 all run (Story 7.1)', async () => {
    const t = setup()
    const result = await t.batch([t.csv(5), '--budget', '0.20', '--json'])
    const report = result.json as Report
    expect(result.exitCode).toBe(0)
    expect(statuses(report)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(report.spent_usd).toBeCloseTo(0.2, 9)
    expect(report.budget_usd).toBe(0.2)
    expect(report.stopped).toBeNull()
    expect(report.rows[0]).toMatchObject({ row: 1, cost_usd: 0.04, error: null })
    expect(report.rows[0]?.paths).toHaveLength(1)
    expect(existsSync(report.rows[0]?.paths[0] as string)).toBe(true)
  })

  test('each finished row has its own ledger entry with batch_id and row (FR-074)', async () => {
    const t = setup()
    const report = (await t.batch([t.csv(3), '--budget', '1', '--json'])).json as Report
    const entries = t.ledger()
    expect(entries.map((entry) => entry.row).sort()).toEqual([1, 2, 3])
    expect(entries.every((entry) => entry.batch_id === report.batch_id)).toBe(true)
    expect(report.rows.map((row) => row.id)).toEqual(
      [1, 2, 3].map((row) => entries.find((entry) => entry.row === row)?.id),
    )
  })

  test('--budget 0.10: 2 run, 3 are skipped_budget, exit 8 (Story 7.2)', async () => {
    const t = setup()
    const result = await t.batch([t.csv(5), '--budget', '0.10', '--concurrency', '1', '--json'])
    const report = result.json as Report
    expect(result.exitCode).toBe(8)
    expect(statuses(report)).toEqual([
      'ok',
      'ok',
      'skipped_budget',
      'skipped_budget',
      'skipped_budget',
    ])
    expect(t.fake.imageRequests()).toHaveLength(2)
  })

  test('a row with an unsupported option: nothing is generated, exit 2 naming the row (Story 7.3)', async () => {
    const t = setup()
    const file = t.file(
      'jobs.csv',
      `prompt,model,quality\np1,${SEEDREAM},\np2,${SEEDREAM},\np3,${SEEDREAM},\np4,${SEEDREAM},high\n`,
    )
    const result = await t.batch([file, '--budget', '1', '--json'])
    expect(result.exitCode).toBe(2)
    expect((result.json as { error: { message: string } }).error.message).toMatch(/row 4.*quality/i)
    expect(t.fake.imageRequests()).toHaveLength(0)
  })

  test('every invalid row is listed in one error before anything is spent (FR-072)', async () => {
    const t = setup()
    const file = t.file(
      'jobs.jsonl',
      [
        `{"prompt": "p1", "model": "${SEEDREAM}"}`,
        `{"prompt": "p2", "model": "no/such-model"}`,
        `{"prompt": "p3", "model": "${SEEDREAM}", "aspect": "7:3"}`,
        `{"prompt": "p4", "model": "${SEEDREAM}", "ref": ["missing.png"]}`,
      ].join('\n'),
    )
    const result = await t.batch([file, '--budget', '1', '--json'])
    expect(result.exitCode).toBe(2)
    const message = (result.json as { error: { message: string } }).error.message
    expect(message).toMatch(/row 2.*no\/such-model/i)
    expect(message).toMatch(/row 3.*aspect/i)
    expect(message).toMatch(/row 4.*missing\.png/i)
    expect(message).not.toMatch(/row 1\b/i)
    expect(t.fake.imageRequests()).toHaveLength(0)
  })

  test('two rows writing the same path are refused', async () => {
    const t = setup()
    const file = t.file(
      'jobs.csv',
      `prompt,model,out\np1,${SEEDREAM},a.png\np2,${SEEDREAM},a.png\n`,
    )
    const result = await t.batch([file, '--budget', '1', '--json'])
    expect(result.exitCode).toBe(2)
    expect((result.json as { error: { message: string } }).error.message).toMatch(
      /row 1.*row 2|rows 1 and 2/i,
    )
    expect(t.fake.imageRequests()).toHaveLength(0)
  })

  test('4 rows of a per-token model: the first runs alone and prices the rest (Story 7.6)', async () => {
    const t = setup()
    t.fake.config.images.usage = {
      prompt_tokens: 10,
      completion_tokens: 1290,
      total_tokens: 1300,
      cost: 0.03,
    }
    t.fake.config.images.delayMs = 5
    const result = await t.batch([
      t.csv(4, GEMINI),
      '--budget',
      '0.10',
      '--concurrency',
      '4',
      '--json',
    ])
    const report = result.json as Report
    expect(statuses(report)).toEqual(['ok', 'ok', 'ok', 'skipped_budget'])
    expect(report.rows[0]?.price?.kind).toBe('unknown')
    expect(report.rows[1]?.price?.cost_usd).toBe(0.03)
    expect(report.spent_usd).toBeCloseTo(0.09, 9)
    expect(result.exitCode).toBe(8)
  })

  test('a failing row is failed and the batch goes on (FR-075)', async () => {
    const t = setup()
    t.fake.config.images.byPrompt = { p2: { status: 500 } }
    const result = await t.batch([t.csv(3), '--budget', '1', '--json'])
    const report = result.json as Report
    expect(result.exitCode).toBe(8)
    expect(statuses(report)).toEqual(['ok', 'failed', 'ok'])
    expect(report.rows[1]?.error?.code).toBe('upstream')
    expect(report.rows[1]?.cost_usd).toBeNull()
    expect(report.stopped).toBeNull()
  })

  test('rows are never retried (FR-075)', async () => {
    const t = setup()
    t.fake.config.images.byPrompt = { p1: { status: 429 } }
    await t.batch([t.csv(1), '--budget', '1', '--json'])
    expect(t.fake.imageRequests()).toHaveLength(1)
  })
})

describe('--budget and --no-budget (FR-071)', () => {
  test('neither exits 2 saying to pass one of them (Story 7.7)', async () => {
    const t = setup()
    const result = await t.batch([t.csv(1), '--json'])
    expect(result.exitCode).toBe(2)
    const message = (result.json as { error: { message: string } }).error.message
    expect(message).toMatch(/--budget/)
    expect(message).toMatch(/--no-budget/)
    expect(t.fake.imageRequests()).toHaveLength(0)
  })

  test('both exit 2, in either order', async () => {
    const t = setup()
    for (const args of [
      ['--budget', '1', '--no-budget'],
      ['--no-budget', '--budget', '1'],
    ]) {
      const result = await t.batch([t.csv(1), ...args, '--json'])
      expect(result.exitCode).toBe(2)
    }
    expect(t.fake.imageRequests()).toHaveLength(0)
  })

  test('a budget that is not a number above 0 exits 2', async () => {
    const t = setup()
    for (const budget of ['0', '-1', 'abc']) {
      const result = await t.batch([t.csv(1), '--budget', budget, '--json'])
      expect(result.exitCode, budget).toBe(2)
    }
  })

  test('--no-budget runs every row, warns first and reports budget_usd null (Story 7.8)', async () => {
    const t = setup()
    const result = await t.batch([t.csv(4, GEMINI), '--no-budget', '--json'])
    const report = result.json as Report
    expect(result.exitCode).toBe(0)
    expect(statuses(report)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(report.budget_usd).toBeNull()
    expect(result.stderr).toMatch(/warning:.*spending limit.*OpenRouter/i)
  })

  test("--no-budget's help says agents use it only when the user asks", async () => {
    const result = await runCli(['batch', '--help'])
    expect(result.stdout).toMatch(/--no-budget[\s\S]*only\s+when\s+the\s+user\s+asks/i)
  })
})

describe('defaults and options', () => {
  test('rows without a model use --model, then COSMION_MODEL (FR-002)', async () => {
    const t = setup()
    const file = t.file('jobs.csv', `prompt,model\np1,\np2,${GEMINI}\n`)
    await t.batch([file, '--model', SEEDREAM, '--no-budget', '--json'])
    expect(
      t.fake
        .imageRequests()
        .map((r) => [r.json.prompt, r.json.model])
        .sort(),
    ).toEqual([
      ['p1', SEEDREAM],
      ['p2', GEMINI],
    ])

    const u = setup()
    const other = u.file('jobs.csv', 'prompt\np1\n')
    await u.batch([other, '--no-budget', '--json'], { env: { COSMION_MODEL: GEMINI } })
    expect(u.fake.imageRequests()[0]?.json.model).toBe(GEMINI)
  })

  test('a row with no model and no default exits 2', async () => {
    const t = setup()
    const result = await t.batch([t.file('jobs.csv', 'prompt\np1\n'), '--no-budget', '--json'])
    expect(result.exitCode).toBe(2)
    expect((result.json as { error: { message: string } }).error.message).toMatch(/row 1/i)
  })

  test('--out <folder> is where rows without out go; a row out wins', async () => {
    const t = setup()
    const file = t.file('jobs.csv', `prompt,model,out\np1,${SEEDREAM},\np2,${SEEDREAM},mine.jpg\n`)
    const report = (await t.batch([file, '--out', 'pics', '--no-budget', '--json'])).json as Report
    expect(dirname(report.rows[0]?.paths[0] as string)).toBe(join(t.cwd, 'pics'))
    expect(report.rows[1]?.paths).toEqual([join(t.cwd, 'mine.jpg')])
    expect(readdirSync(join(t.cwd, 'pics'))).toHaveLength(1)
  })

  test('--concurrency outside 1-8 exits 2; within, it is never exceeded', async () => {
    const t = setup()
    for (const value of ['0', '9']) {
      expect(
        (await t.batch([t.csv(1), '--no-budget', '--concurrency', value, '--json'])).exitCode,
      ).toBe(2)
    }
    t.fake.config.images.delayMs = 20
    const result = await t.batch([t.csv(7), '--no-budget', '--concurrency', '3', '--json'])
    expect(result.exitCode).toBe(0)
    expect(t.fake.maxInFlight()).toBeLessThanOrEqual(3)
  })

  test('an existing output file is refused without --force and replaced with it', async () => {
    const t = setup()
    t.file('taken.jpg', 'old')
    const file = t.file('jobs.csv', `prompt,model,out\np1,${SEEDREAM},taken.jpg\n`)
    expect((await t.batch([file, '--no-budget', '--json'])).exitCode).toBe(2)
    expect((await t.batch([file, '--no-budget', '--force', '--json'])).exitCode).toBe(0)
    expect(readFileSync(join(t.cwd, 'taken.jpg'), 'utf8')).not.toBe('old')
  })
})

describe('--dry-run (FR-077)', () => {
  test('validates, shows each price and the total, spends nothing (Story 7.4)', async () => {
    const t = setup()
    const result = await t.batch([t.csv(5), '--dry-run', '--json'])
    const dry = result.json as DryRun
    expect(result.exitCode).toBe(0)
    expect(dry.rows.map((row) => row.price.cost_usd)).toEqual([0.04, 0.04, 0.04, 0.04, 0.04])
    expect(dry.total.kind).toBe('exact')
    expect(dry.total.cost_usd).toBeCloseTo(0.2, 9)
    expect(t.fake.imageRequests()).toHaveLength(0)
    expect(t.ledger()).toHaveLength(0)
  })

  test('needs neither --budget nor --no-budget, and ignores them', async () => {
    const t = setup()
    for (const extra of [[], ['--budget', '1', '--no-budget'], ['--budget', '0']]) {
      expect((await t.batch([t.csv(1), '--dry-run', ...extra, '--json'])).exitCode).toBe(0)
    }
  })

  test('still validates every row', async () => {
    const t = setup()
    const file = t.file('jobs.csv', `prompt,model,quality\np1,${SEEDREAM},high\n`)
    expect((await t.batch([file, '--dry-run', '--json'])).exitCode).toBe(2)
  })

  test('with an unknown row, the total is unknown with the known subtotal and count in notes', async () => {
    const t = setup()
    const file = t.file('jobs.csv', `prompt,model\np1,${SEEDREAM}\np2,${GEMINI}\np3,${SEEDREAM}\n`)
    const dry = (await t.batch([file, '--dry-run', '--json'])).json as DryRun
    expect(dry.total.kind).toBe('unknown')
    expect(dry.total.cost_usd).toBeNull()
    const notes = dry.total.notes.join(' ')
    expect(notes).toMatch(/\$0\.08/)
    expect(notes).toMatch(/1 row/)
  })
})

describe('--resume (FR-076, Story 7.5)', () => {
  test('skips rows already saved, re-runs failed ones, and counts earlier spending', async () => {
    const t = setup()
    t.fake.config.images.byPrompt = { p3: { status: 500 } }
    const first = (await t.batch([t.csv(4), '--budget', '1', '--json'])).json as Report
    expect(statuses(first)).toEqual(['ok', 'ok', 'failed', 'ok'])

    t.fake.config.images.byPrompt = {}
    const before = t.fake.imageRequests().length
    // $0.12 spent: with a $0.15 budget row 3 ($0.04) no longer fits.
    const short = await t.batch([
      t.csv(4),
      '--budget',
      '0.15',
      '--resume',
      first.batch_id,
      '--json',
    ])
    const shortReport = short.json as Report
    expect(statuses(shortReport)).toEqual([
      'skipped_resumed',
      'skipped_resumed',
      'skipped_budget',
      'skipped_resumed',
    ])
    expect(shortReport.spent_usd).toBeCloseTo(0.12, 9)
    expect(t.fake.imageRequests()).toHaveLength(before)

    const resumed = await t.batch([
      t.csv(4),
      '--budget',
      '0.16',
      '--resume',
      first.batch_id,
      '--json',
    ])
    const report = resumed.json as Report
    expect(resumed.exitCode).toBe(0)
    expect(statuses(report)).toEqual([
      'skipped_resumed',
      'skipped_resumed',
      'ok',
      'skipped_resumed',
    ])
    expect(t.prompts().slice(before)).toEqual(['p3'])
    expect(report.batch_id).toBe(first.batch_id)
    expect(report.spent_usd).toBeCloseTo(0.16, 9)
    expect(report.rows[0]?.id).toBe(first.rows[0]?.id)
    expect(t.ledger().filter((entry) => entry.row === 3)).toHaveLength(1)
  })

  test('a row that was paid for but not saved runs again', async () => {
    const t = setup()
    t.fake.config.images.byPrompt = { p2: { data: [] } }
    const first = (await t.batch([t.csv(2), '--budget', '1', '--json'])).json as Report
    expect(statuses(first)).toEqual(['ok', 'failed'])
    expect(first.spent_usd).toBeCloseTo(0.08, 9)

    t.fake.config.images.byPrompt = {}
    const report = (
      await t.batch([t.csv(2), '--budget', '1', '--resume', first.batch_id, '--json'])
    ).json as Report
    expect(statuses(report)).toEqual(['skipped_resumed', 'ok'])
    expect(report.spent_usd).toBeCloseTo(0.12, 9)
  })

  test("earlier actual costs set their groups' prices", async () => {
    const t = setup()
    t.fake.config.images.usage = {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
      cost: 0.05,
    }
    t.fake.config.images.byPrompt = { p2: { status: 500 } }
    const first = (await t.batch([t.csv(2, GEMINI), '--budget', '1', '--json'])).json as Report

    t.fake.config.images.byPrompt = {}
    const report = (
      await t.batch([t.csv(2, GEMINI), '--budget', '1', '--resume', first.batch_id, '--json'])
    ).json as Report
    expect(report.rows[1]?.price?.cost_usd).toBe(0.05)
  })

  test('an earlier entry with no cost but a known price counts that price', async () => {
    const t = setup()
    t.fake.config.images.byPrompt = {
      p1: { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    }
    const first = (await t.batch([t.csv(3), '--budget', '0.08', '--concurrency', '1', '--json']))
      .json as Report
    expect(statuses(first)).toEqual(['ok', 'ok', 'skipped_budget'])
    expect(first.spent_usd).toBeCloseTo(0.08, 9)

    t.fake.config.images.byPrompt = {}
    const again = (
      await t.batch([t.csv(3), '--budget', '0.10', '--resume', first.batch_id, '--json'])
    ).json as Report
    expect(statuses(again)).toEqual(['skipped_resumed', 'skipped_resumed', 'skipped_budget'])
    expect(again.spent_usd).toBeCloseTo(0.08, 9)
  })

  test('an unknown batch id exits 5', async () => {
    const t = setup()
    const result = await t.batch([t.csv(1), '--budget', '1', '--resume', 'zzzz9999', '--json'])
    expect(result.exitCode).toBe(5)
  })
})

describe('stopping (FR-073a, FR-075, FR-078)', () => {
  test('an unknown price with no cost stops a budgeted batch, with the --no-budget advice (Story 7.9)', async () => {
    const t = setup()
    t.fake.config.images.usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    const result = await t.batch([t.csv(3, GEMINI), '--budget', '1', '--json'])
    const report = result.json as Report
    expect(result.exitCode).toBe(8)
    expect(statuses(report)).toEqual(['ok', 'not_run', 'not_run'])
    const advice = `cosmion batch jobs.csv --no-budget --resume ${report.batch_id}`
    expect(report.stopped?.code).toBe('unknown_cost')
    expect(report.stopped?.message).toContain(advice)
    expect(result.stderr).toContain(advice)

    const withBudget = await t.batch([
      t.csv(3, GEMINI),
      '--budget',
      '1',
      '--resume',
      report.batch_id,
      '--json',
    ])
    expect(withBudget.exitCode).toBe(2)
    expect((withBudget.json as { error: { message: string } }).error.message).toContain(advice)

    const noBudget = await t.batch([
      t.csv(3, GEMINI),
      '--no-budget',
      '--resume',
      report.batch_id,
      '--json',
    ])
    expect(noBudget.exitCode).toBe(0)
    expect(statuses(noBudget.json as Report)).toEqual(['skipped_resumed', 'ok', 'ok'])
  })

  test("a 403 for the key's limit stops new rows like any credits error", async () => {
    const t = setup()
    t.fake.config.images.byPrompt = {
      p2: { status: 403, errorMessage: 'Key limit exceeded (daily limit).' },
    }
    const result = await t.batch([t.csv(4), '--budget', '1', '--concurrency', '1', '--json'])
    const report = result.json as Report
    expect(result.exitCode).toBe(4)
    expect(statuses(report)).toEqual(['ok', 'failed', 'not_run', 'not_run'])
    expect(report.stopped?.code).toBe('credits')
    expect(t.fake.imageRequests()).toHaveLength(2)
  })

  test('an in-flight refusal fails only its row', async () => {
    const t = setup()
    t.fake.config.images.byPrompt = {
      p2: { status: 402, errorMetadata: { limit_source: 'openrouter_in_flight_budget' } },
    }
    const result = await t.batch([t.csv(3), '--budget', '1', '--concurrency', '1', '--json'])
    const report = result.json as Report
    expect(result.exitCode).toBe(8)
    expect(statuses(report)).toEqual(['ok', 'failed', 'ok'])
    expect(report.stopped).toBeNull()
    expect(report.rows[1]?.error?.code).toBe('rate_limited')
  })

  test('a refused 403 fails only its row', async () => {
    const t = setup()
    t.fake.config.images.byPrompt = {
      p2: { status: 403, errorMessage: 'Your input was flagged' },
    }
    const result = await t.batch([t.csv(3), '--budget', '1', '--concurrency', '1', '--json'])
    const report = result.json as Report
    expect(result.exitCode).toBe(8)
    expect(statuses(report)).toEqual(['ok', 'failed', 'ok'])
    expect(report.rows[1]?.error?.code).toBe('usage')
  })

  for (const [status, code, exitCode] of [
    [402, 'credits', 4],
    [401, 'auth', 3],
  ] as const) {
    test(`a ${code} error stops new rows: exit ${exitCode}, the rest not_run`, async () => {
      const t = setup()
      t.fake.config.images.byPrompt = { p2: { status } }
      const result = await t.batch([t.csv(4), '--budget', '1', '--concurrency', '1', '--json'])
      const report = result.json as Report
      expect(result.exitCode).toBe(exitCode)
      expect(statuses(report)).toEqual(['ok', 'failed', 'not_run', 'not_run'])
      expect(report.stopped?.code).toBe(code)
      expect(report.stopped?.message).toBe(report.rows[1]?.error?.message)
      expect(t.fake.imageRequests()).toHaveLength(2)
    })
  }

  test('text mode: paths on stdout, the batch id on stderr at the start', async () => {
    const t = setup()
    const result = await t.batch([t.csv(2), '--budget', '1'])
    expect(result.exitCode).toBe(0)
    const paths = result.stdout.trim().split('\n')
    expect(paths).toHaveLength(2)
    for (const path of paths) expect(existsSync(path)).toBe(true)
    const id = (t.ledger()[0] as { batch_id: string }).batch_id
    expect(result.stderr.split('\n')[0]).toContain(id)
  })

  test('Ctrl-C leaves finished rows in the ledger and exits 130 (FR-040)', async () => {
    const t = setup()
    const controller = new AbortController()
    t.fake.config.images.byPrompt = { p2: { delayMs: 500 } }
    const running = t.batch([t.csv(3), '--budget', '1', '--concurrency', '1', '--json'], {
      signal: controller.signal,
    })
    for (let i = 0; i < 2000 && t.fake.imageRequests().length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    controller.abort()
    const result = await running
    expect(result.exitCode).toBe(130)
    expect(result.stdout).toBe('')
    expect(t.ledger().map((entry) => entry.row)).toEqual([1])
  })
})
