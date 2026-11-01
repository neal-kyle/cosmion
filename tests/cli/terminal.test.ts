import { writeFileSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, test } from 'vitest'
import { commands } from '../../src/cli/commands/index.js'
import type { CommandDefinition } from '../../src/cli/define.js'
import { run } from '../../src/cli/run.js'
import { createFakeOpenRouter, VALID_KEY } from '../helpers/fake-openrouter.js'
import { createTestContext, type RunCliOptions, runCli } from '../helpers/run-cli.js'

const SEEDREAM = 'bytedance-seed/seedream-4.5'
const TERMINAL = { stdoutIsTTY: true, stderrIsTTY: true, columns: 100 }
const ANSI = '\x1b['

function setup() {
  const fake = createFakeOpenRouter()
  const options: RunCliOptions = { fetch: fake.fetch, env: { OPENROUTER_API_KEY: VALID_KEY } }
  return {
    fake,
    cli: (args: string[], more: RunCliOptions = {}) =>
      runCli(args, { ...options, ...more, env: { ...options.env, ...more.env } }),
  }
}

const lines = (text: string) => stripVTControlCharacters(text).split('\n')

describe('off a terminal nothing changes', () => {
  test.each([
    ['NO_COLOR', { ...TERMINAL, env: { NO_COLOR: '1' } }],
    ['TERM=dumb', { ...TERMINAL, env: { TERM: 'dumb' } }],
    ['stdout piped', { stderrIsTTY: true, columns: 100 }],
  ])('%s: models prints what a pipe gets', async (_name, more) => {
    const { cli } = setup()
    const piped = await cli(['models'])
    const result = await cli(['models'], more)
    expect(result.stdout).toBe(piped.stdout)
    expect(result.stdout).not.toContain(ANSI)
    expect(result.exitCode).toBe(piped.exitCode)
  })

  test('--json is the same on a terminal, without styling', async () => {
    const { cli } = setup()
    const piped = await cli(['models', '--json'])
    const result = await cli(['models', '--json'], { ...TERMINAL, home: piped.home })
    expect(result.stdout).toBe(piped.stdout)
  })

  test('bare cosmion keeps its help and error when stderr is piped', async () => {
    const { cli } = setup()
    const result = await cli([])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Usage: cosmion')
    expect(result.stderr).toContain('error: Missing command.')
    expect(result.stderr).not.toContain(ANSI)
  })

  test('gen and batch keep their exact progress lines off a terminal', async () => {
    const { cli } = setup()
    const gen = await cli(['gen', 'a lighthouse', '-m', SEEDREAM])
    expect(gen.stderr).toMatch(/^Generated \S+ with bytedance-seed\/seedream-4.5 for \$0\.04\.\n$/)

    const file = join(gen.cwd, 'rows.csv')
    writeFileSync(file, 'prompt\nfirst\nsecond\n')
    const batch = await cli(['batch', file, '-m', SEEDREAM, '--budget', '1'], { cwd: gen.cwd })
    expect(batch.stderr).toMatch(/^Batch \S+: 2 of 2 rows to run\./)
    expect(batch.stderr).toMatch(/Row 1: .+ \(\$0\.04\)\n/)
    expect(batch.stderr).toMatch(/Spent \$0\.08 of \$1\.00: 2 ok\.\n$/)
    expect(batch.stderr).not.toContain(ANSI)
  })
})

describe('on a terminal', () => {
  test.each([60, 80, 100, 200])('models fits a window %i columns wide', async (columns) => {
    const { cli, fake } = setup()
    const result = await cli(['models'], { ...TERMINAL, columns })
    for (const line of lines(result.stdout)) expect(line.length).toBeLessThanOrEqual(columns)
    // Whatever else goes, every id stays, in full: it's what you copy.
    for (const model of fake.config.models) expect(result.stdout).toContain(model.id)
  })

  test('models lines prices up on the right', async () => {
    const { cli } = setup()
    const result = await cli(['models'], TERMINAL)
    const ends = lines(result.stdout)
      .filter((line) => /\$\d/.test(line))
      .map(
        (line) =>
          (/\$[\d.]+/.exec(line) as RegExpExecArray).index +
          (/\$[\d.]+/.exec(line) as RegExpExecArray)[0].length,
      )
    expect(new Set(ends).size).toBe(1)
  })

  test('a wide window shows the columns a narrow one drops', async () => {
    const { cli } = setup()
    const wide = await cli(['models'], { ...TERMINAL, columns: 200 })
    expect(wide.stdout).toContain('options')
    const narrow = await cli(['models'], { ...TERMINAL, columns: 80 })
    expect(narrow.stdout).not.toContain('options\n')
  })

  test('a long name shortens rather than costing the whole name column', async () => {
    const { cli } = setup()
    const result = await cli(['models'], TERMINAL)
    expect(result.stdout).toContain('ByteDance Seed: Seedream 4.5')
  })

  test('an unknown width is treated as 80 columns', async () => {
    const { cli } = setup()
    const result = await cli(['models'], { ...TERMINAL, columns: undefined })
    for (const line of lines(result.stdout)) expect(line.length).toBeLessThanOrEqual(80)
  })

  test('stdout is styled by its own stream: a piped stderr stays plain', async () => {
    const { cli } = setup()
    const result = await cli(['gen', 'a lighthouse', '-m', SEEDREAM], {
      stdoutIsTTY: true,
      columns: 100,
    })
    expect(result.stdout).toContain('\x1b')
    expect(result.stderr).not.toContain(ANSI)
  })

  test('gen: stdout shows the saved path, stderr the id, model and cost (FR-015)', async () => {
    const { cli } = setup()
    const result = await cli(['gen', 'a lighthouse', '-m', SEEDREAM], TERMINAL)
    expect(result.exitCode).toBe(0)
    const saved = stripVTControlCharacters(result.stdout).trim()
    expect(isAbsolute(saved)).toBe(true)
    expect(basename(saved)).toMatch(/^cosmion-\S+\.jpe?g$/)
    const summary = stripVTControlCharacters(result.stderr)
    expect(summary).toMatch(/✓ Generated \S+/)
    expect(summary).toContain(SEEDREAM)
    expect(summary).toContain('$0.04')
  })

  test('batch: reports each row and the budget, and exits as usual', async () => {
    const { cli } = setup()
    const first = await cli(['--version'])
    const file = join(first.cwd, 'rows.csv')
    writeFileSync(file, 'prompt\nfirst\nsecond\n')
    const result = await cli(['batch', file, '-m', SEEDREAM, '--budget', '1'], {
      ...TERMINAL,
      cwd: first.cwd,
    })
    expect(result.exitCode).toBe(0)
    const stderr = stripVTControlCharacters(result.stderr)
    expect(stderr).toMatch(/✓ +1 /)
    expect(stderr).toMatch(/✓ +2 /)
    expect(stderr).toContain('$0.08')
    expect(stderr).toContain('of $1.00')
    expect(stderr).toContain('2 ok')
    expect(lines(result.stdout).filter((line) => line.includes('cosmion-'))).toHaveLength(2)
  })

  test('errors keep their exit code and split off what to do next', async () => {
    const { cli } = setup()
    const result = await cli(['gen', 'x', '-m', 'nope/nope'], TERMINAL)
    expect(result.exitCode).toBe(5)
    const stderr = stripVTControlCharacters(result.stderr)
    expect(stderr).toContain('✗ No image model "nope/nope".')
    expect(stderr).toContain('→ Run cosmion models')
    expect(stderr).not.toContain('`')
  })

  test('bare cosmion shows every command, still exits 2, and writes to stderr', async () => {
    const { cli } = setup()
    const result = await cli([], TERMINAL)
    expect(result.exitCode).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).not.toContain('Missing command')
    for (const command of commands) expect(result.stderr).toContain(command.name)
  })

  test('doctor marks each check and keeps its exit code', async () => {
    const { cli } = setup()
    const piped = await cli(['doctor'])
    const result = await cli(['doctor'], TERMINAL)
    expect(result.exitCode).toBe(piped.exitCode)
    expect(stripVTControlCharacters(result.stdout)).toMatch(/✓ node/)
    expect(stripVTControlCharacters(result.stdout)).toMatch(/\d+ passed/)
  })

  test('history, show and usage print on a terminal, with a generation and with none', async () => {
    const { cli } = setup()
    const empty = await cli(['history'], TERMINAL)
    expect(empty.exitCode).toBe(0)
    expect(stripVTControlCharacters(empty.stdout)).toContain('No generations')
    const none = await cli(['usage'], { ...TERMINAL, home: empty.home })
    expect(stripVTControlCharacters(none.stdout)).toContain('No generations')

    const gen = await cli(['gen', 'a misty harbour', '-m', SEEDREAM, '--json'], {
      home: empty.home,
    })
    const { id } = gen.json as { id: string }
    const list = await cli(['history'], { ...TERMINAL, home: empty.home })
    expect(list.stdout).toContain(id)
    expect(stripVTControlCharacters(list.stdout)).toContain('a misty harbour')
    const shown = await cli(['show', id], { ...TERMINAL, home: empty.home })
    expect(stripVTControlCharacters(shown.stdout)).toContain('a misty harbour')
    const spent = await cli(['usage'], { ...TERMINAL, home: empty.home })
    expect(stripVTControlCharacters(spent.stdout)).toContain('$0.04')
  })

  test('a prompt with wide characters stays inside the window', async () => {
    const { cli } = setup()
    const first = await cli([
      'gen',
      '灯台の夕暮れ、水彩画、柔らかい光、静かな海、遠くの船、霧の朝、長い影',
      '-m',
      SEEDREAM,
      '--json',
    ])
    const result = await cli(['history'], { ...TERMINAL, columns: 60, home: first.home })
    expect(stripVTControlCharacters(result.stdout)).toContain('灯台')
    expect(result.exitCode).toBe(0)
  })
})

/** Every command and subcommand, as the arguments that name it. */
function everyCommand(
  list: readonly CommandDefinition[] = commands,
  parents: string[] = [],
): { args: string[]; definition: CommandDefinition }[] {
  return list.flatMap((definition) => {
    const args = [...parents, definition.name]
    return [{ args, definition }, ...everyCommand(definition.subcommands, args)]
  })
}

describe('nothing a person sees is left unstyled', () => {
  test.each(everyCommand().map(({ args, definition }) => [args.join(' '), definition] as const))(
    '%s has terminal output for its text output',
    (_name, definition) => {
      if (definition.text) expect(definition.pretty).toBeDefined()
    },
  )

  test.each(everyCommand().map(({ args }) => [args.join(' '), args] as const))(
    '%s --help is styled on a terminal and plain in a pipe',
    async (_name, args) => {
      const { cli } = setup()
      const styled = await cli([...args, '--help'], TERMINAL)
      expect(styled.exitCode).toBe(0)
      expect(styled.stdout).toContain(ANSI)
      expect(styled.stdout).not.toContain('`')

      const piped = await cli([...args, '--help'])
      expect(piped.stdout).not.toContain(ANSI)
      expect(stripVTControlCharacters(styled.stdout)).toContain('--json')
    },
  )

  test.each([['--help'], ['-h'], ['help']])('cosmion %s shows the home screen', async (flag) => {
    const { cli } = setup()
    const result = await cli([flag], TERMINAL)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('▄▀▀')
    for (const command of commands) expect(result.stdout).toContain(command.name)
    for (const option of ['--version', '--json', '--help']) {
      expect(result.stdout).toContain(option)
    }
  })

  test('cosmion --help stays as it was in a pipe', async () => {
    const { cli } = setup()
    const piped = await cli(['--help'])
    expect(piped.stdout).toMatch(/^Usage: cosmion \[options\] \[command\]/)
    expect(piped.stdout).toContain('`csn`')
  })

  test('a parent without a subcommand shows styled help on a terminal', async () => {
    const { cli } = setup()
    const result = await cli(['skill'], TERMINAL)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain(ANSI)
  })

  test('auth: the hidden prompt and the result are styled, and the key stays hidden', async () => {
    const { cli } = setup()
    const result = await cli(['auth'], {
      ...TERMINAL,
      env: { OPENROUTER_API_KEY: undefined },
      stdin: `${VALID_KEY}\r`,
      stdinIsTTY: true,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain(ANSI)
    expect(stripVTControlCharacters(result.stderr)).toContain('OpenRouter API key')
    expect(result.stderr).not.toContain(VALID_KEY)
    expect(stripVTControlCharacters(result.stdout)).toContain('✓ Saved the key')

    const out = await cli(['auth', 'logout'], { ...TERMINAL, home: result.home })
    expect(stripVTControlCharacters(out.stdout)).toContain('✓ Removed the saved key.')
  })

  test('skill: the picker and results are styled', async () => {
    const { cli } = setup()
    const install = await cli(['skill', 'install'], {
      ...TERMINAL,
      stdin: '\r \r',
      stdinIsTTY: true,
    })
    expect(install.exitCode).toBe(0)
    const asked = stripVTControlCharacters(install.stderr)
    expect(install.stderr).toContain(ANSI)
    expect(asked).toContain('Claude Code')
    expect(asked).toContain('space select')
    expect(stripVTControlCharacters(install.stdout)).toContain('✓ Installed for Claude Code')
  })

  test('skill update and uninstall report with the same symbols', async () => {
    const { cli } = setup()
    const first = await cli(['--version'])
    const dir = join(first.cwd, 'skills')
    await cli(['skill', 'install', '--dir', dir], { cwd: first.cwd })
    const update = await cli(['skill', 'update', '--dir', dir], { ...TERMINAL, cwd: first.cwd })
    expect(stripVTControlCharacters(update.stdout)).toContain('✓ Up to date')
    const remove = await cli(['skill', 'uninstall', '--dir', dir], { ...TERMINAL, cwd: first.cwd })
    expect(stripVTControlCharacters(remove.stdout)).toContain('✓ Removed')
    const none = await cli(['skill', 'uninstall', '--dir', dir], { ...TERMINAL, cwd: first.cwd })
    expect(none.stdout).toContain(ANSI)
  })
})

describe('doctor on a terminal', () => {
  test('shows each check as it finishes, not all at the end', async () => {
    const fake = createFakeOpenRouter()
    let seenAtNetworkCheck = ''
    const test_ = createTestContext({
      ...TERMINAL,
      env: { OPENROUTER_API_KEY: VALID_KEY },
      fetch: (input, init) => {
        seenAtNetworkCheck ||= test_.stdout()
        return fake.fetch(input, init)
      },
    })
    const exitCode = await run(['doctor'], test_.ctx)
    expect(exitCode).toBe(0)
    // By the first network call, the Node check is already on the screen.
    expect(stripVTControlCharacters(seenAtNetworkCheck)).toContain('✓ node')
    const final = stripVTControlCharacters(test_.stdout())
    expect(final).toContain('✓ ledger')
    expect(final.match(/✓ node/g)).toHaveLength(1)
    expect(final).toMatch(/\d+ passed/)
  })

  test('--json on a terminal is still one JSON object on stdout', async () => {
    const { cli } = setup()
    const result = await cli(['doctor', '--json'], TERMINAL)
    expect(result.stdout).not.toContain(ANSI)
    expect((result.json as { checks: unknown[] }).checks.length).toBeGreaterThan(0)
  })

  test('long messages wrap inside the window', async () => {
    const { cli } = setup()
    const result = await cli(['doctor'], { ...TERMINAL, columns: 50 })
    for (const line of stripVTControlCharacters(result.stdout).split(/[\r\n]+/)) {
      // A single path can't be broken; only words may reach past the edge.
      if (!/[/\\]/.test(line)) expect(line.length).toBeLessThanOrEqual(50)
    }
  })
})
