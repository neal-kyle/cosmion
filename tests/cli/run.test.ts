import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { defineCommand } from '../../src/cli/define.js'
import { spinner, warn } from '../../src/cli/output.js'
import { CosmionError, ERROR_CODES } from '../../src/core/errors.js'
import { runCli } from '../helpers/run-cli.js'

// Test-only commands: the real ones arrive in later phases.

const echo = defineCommand({
  name: 'echo',
  summary: 'Echo the input back',
  args: [{ name: 'text', required: true, description: 'What to echo' }],
  options: [
    { name: 'times', flag: '--times <n>', alias: '-t', type: 'integer', description: 'A count' },
    { name: 'ratio', flag: '--ratio <x>', type: 'number', description: 'A number' },
    { name: 'tag', flag: '--tag <tag>', type: 'string', repeatable: true, description: 'Tags' },
    { name: 'loud', flag: '--loud', type: 'boolean', description: 'Shout' },
    {
      name: 'by',
      flag: '--by <what>',
      type: 'string',
      values: ['model', 'day'],
      description: 'By',
    },
  ],
  output: z.strictObject({
    text: z.string(),
    times: z.number().int().optional(),
    ratio: z.number().optional(),
    tag: z.array(z.string()),
    loud: z.boolean(),
    by: z.enum(['model', 'day']).optional(),
  }),
  async run(input) {
    return { data: input }
  },
  text: (data) => (data.loud ? data.text.toUpperCase() : data.text),
})

const child = defineCommand({
  name: 'child',
  summary: 'A child command',
  output: z.strictObject({ ran: z.literal('child') }),
  async run() {
    return { data: { ran: 'child' as const } }
  },
})

const parent = defineCommand({
  name: 'parent',
  summary: 'A parent with its own run',
  args: [{ name: 'id', description: 'Something to show' }],
  subcommands: [child],
  output: z.strictObject({ ran: z.literal('parent'), id: z.string().nullable() }),
  async run(input) {
    return { data: { ran: 'parent' as const, id: input.id ?? null } }
  },
})

const group = defineCommand({
  name: 'group',
  summary: 'A parent without a run of its own',
  subcommands: [child],
})

const fail = defineCommand({
  name: 'fail',
  summary: 'Throw a CosmionError',
  options: [
    {
      name: 'code',
      flag: '--code <code>',
      type: 'string',
      values: ERROR_CODES,
      required: true,
      description: 'The error code',
    },
    { name: 'notRetryable', flag: '--not-retryable', type: 'boolean', description: 'Override' },
  ],
  output: z.strictObject({}),
  async run(input): Promise<{ data: Record<string, never> }> {
    const options = input.notRetryable ? { retryable: false } : {}
    throw new CosmionError(input.code, `failed with ${input.code}`, options)
  },
})

function crashForTest(): never {
  throw new Error('boom\nsecond line')
}

const crash = defineCommand({
  name: 'crash',
  summary: 'Throw an unexpected error',
  output: z.strictObject({}),
  async run(): Promise<{ data: Record<string, never> }> {
    return crashForTest()
  },
})

const partial = defineCommand({
  name: 'partial',
  summary: 'Finish with some parts failed',
  output: z.strictObject({ ok: z.number(), failed: z.number() }),
  async run() {
    return { data: { ok: 1, failed: 1 }, exitCode: 8 as const }
  },
  text: (data) => `${data.ok} ok, ${data.failed} failed`,
})

const wait = defineCommand({
  name: 'wait',
  summary: 'Wait until interrupted',
  output: z.strictObject({}),
  async run(_input, ctx) {
    await new Promise((_resolve, reject) => {
      ctx.signal.throwIfAborted()
      ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason))
    })
    return { data: {} }
  },
})

const careful = defineCommand({
  name: 'careful',
  summary: 'Warn, spin and return a result',
  output: z.strictObject({ done: z.boolean() }),
  async run(_input, ctx) {
    warn(ctx, 'mind the gap')
    spinner(ctx, 'working').stop()
    return { data: { done: true } }
  },
  text: () => 'all done',
})

const leak = defineCommand({
  name: 'leak',
  summary: 'Try to print the key',
  options: [{ name: 'throw', flag: '--throw', type: 'boolean', description: 'Fail instead' }],
  output: z.strictObject({ said: z.string() }),
  async run(input, ctx) {
    const key = ctx.env.OPENROUTER_API_KEY
    warn(ctx, `the key is ${key}`)
    if (input.throw) throw new CosmionError('auth', `key ${key} was rejected`)
    return { data: { said: `key=${key}` } }
  },
  text: (data) => data.said,
})

const cat = defineCommand({
  name: 'cat',
  summary: 'Echo stdin',
  output: z.strictObject({ stdin: z.string(), isTTY: z.boolean() }),
  async run(_input, ctx) {
    let stdin = ''
    for await (const chunk of ctx.stdin) stdin += chunk
    return { data: { stdin, isTTY: ctx.stdin.isTTY === true } }
  },
})

const commands = [echo, parent, group, fail, crash, partial, wait, careful, leak, cat]
const cli = (args: string[], options = {}) => runCli(args, { commands, ...options })

const usageError = (message: unknown = expect.any(String)) => ({
  error: { code: 'usage', message, retryable: false },
})

describe('version and help', () => {
  test('--version prints the package.json version', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    const result = await cli(['--version'])
    expect(result).toMatchObject({ exitCode: 0, stdout: `${pkg.version}\n`, stderr: '' })
  })

  test('--help lists the commands on stdout and mentions csn', async () => {
    const result = await cli(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Usage: cosmion')
    expect(result.stdout).toContain('Echo the input back')
    expect(result.stdout).toMatch(/\bcsn\b/)
  })

  test('<command> --help shows its options, including --json', async () => {
    const result = await cli(['echo', '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: cosmion echo')
    expect(result.stdout).toContain('--times <n>')
    expect(result.stdout).toContain('--json')
  })

  test.each([
    [['parent', '--help'], 'A child command'],
    [['parent', 'child', '--help'], 'Usage: cosmion parent child'],
    [['group', '--help'], 'A child command'],
    [['group', 'child', '--help'], 'Usage: cosmion group child'],
  ])('%j prints help and exits 0', async (args, expected) => {
    const result = await cli(args)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(expected)
  })
})

describe('options and arguments', () => {
  test('values are converted by their declared type', async () => {
    const args = ['echo', 'hi', '-t', '3', '--ratio', '0.5', '--tag', 'a', '--tag', 'b', '--loud']
    const result = await cli([...args, '--by', 'day', '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({
      text: 'hi',
      times: 3,
      ratio: 0.5,
      tag: ['a', 'b'],
      loud: true,
      by: 'day',
    })
  })

  test('omitted options: booleans false, repeatables empty, the rest absent', async () => {
    const result = await cli(['echo', 'hi', '--json'])
    expect(result.json).toEqual({ text: 'hi', tag: [], loud: false })
  })

  test('--json can come before the command', async () => {
    const result = await cli(['--json', 'echo', 'hi'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual({ text: 'hi', tag: [], loud: false })
  })

  test.each([
    [['parent'], { ran: 'parent', id: null }],
    [['parent', 'abc'], { ran: 'parent', id: 'abc' }],
    [['parent', 'child'], { ran: 'child' }],
    [['group', 'child'], { ran: 'child' }],
  ])('%j runs the right command', async (args, expected) => {
    const result = await cli([...args, '--json'])
    expect(result.exitCode).toBe(0)
    expect(result.json).toEqual(expected)
  })

  test.each([
    ['an unknown command', ['nope']],
    ['an unknown option', ['echo', 'hi', '--nope']],
    ['a missing argument', ['echo']],
    ['an extra argument', ['echo', 'hi', 'there']],
    ['a non-integer for an integer option', ['echo', 'hi', '--times', '2.5']],
    ['a word for an integer option', ['echo', 'hi', '--times', 'three']],
    ['a word for a number option', ['echo', 'hi', '--ratio', 'half']],
    ['a value not in the allowed list', ['echo', 'hi', '--by', 'week']],
    ['a missing required option', ['fail']],
    ['a parent without its own run, and no subcommand', ['group']],
    ['no command at all', []],
  ])('%s exits 2', async (_name, args) => {
    const text = await cli(args)
    expect(text.exitCode).toBe(2)
    expect(text.stdout).toBe('')
    expect(text.stderr).not.toBe('')

    const json = await cli([...args, '--json'])
    expect(json.exitCode).toBe(2)
    expect(json.json).toEqual(usageError())
  })

  test('a usage error names what was wrong', async () => {
    const result = await cli(['echo', 'hi', '--times', 'three', '--json'])
    expect(result.json).toEqual(usageError(expect.stringContaining('--times')))
    expect(result.json).toEqual(usageError(expect.not.stringMatching(/^error:/)))
  })
})

describe('errors and exit codes', () => {
  test.each([
    ['internal', 1, false],
    ['usage', 2, false],
    ['auth', 3, false],
    ['credits', 4, false],
    ['not_found', 5, false],
    ['rate_limited', 6, true],
    ['upstream', 7, true],
  ])('a CosmionError "%s" exits %i, retryable %s', async (code, exitCode, retryable) => {
    const result = await cli(['fail', '--code', code, '--json'])
    expect(result.exitCode).toBe(exitCode)
    expect(result.json).toEqual({ error: { code, message: `failed with ${code}`, retryable } })
  })

  test('an upstream error thrown with retryable: false says so (the timeout)', async () => {
    const result = await cli(['fail', '--code', 'upstream', '--not-retryable', '--json'])
    expect(result.exitCode).toBe(7)
    expect(result.json).toEqual({
      error: { code: 'upstream', message: 'failed with upstream', retryable: false },
    })
  })

  test('in text mode the error goes to stderr and stdout stays empty', async () => {
    const result = await cli(['fail', '--code', 'not_found'])
    expect(result).toMatchObject({ exitCode: 5, stdout: '' })
    expect(result.stderr).toContain('failed with not_found')
  })

  test('any other error is internal, exit 1, with a one-line message', async () => {
    const result = await cli(['crash', '--json'])
    expect(result.exitCode).toBe(1)
    expect(result.json).toEqual({
      error: { code: 'internal', message: expect.stringContaining('boom'), retryable: false },
    })
    expect(JSON.stringify(result.json)).not.toContain('second line')
    expect(result.stderr).not.toContain('crashForTest')
  })

  test('COSMION_DEBUG=1 adds the stack trace on stderr', async () => {
    const result = await cli(['crash', '--json'], { env: { COSMION_DEBUG: '1' } })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('crashForTest')
    expect(result.stdout).not.toContain('crashForTest')
  })

  test('exit 8 prints the normal result, not an error', async () => {
    const json = await cli(['partial', '--json'])
    expect(json.exitCode).toBe(8)
    expect(json.json).toEqual({ ok: 1, failed: 1 })

    const text = await cli(['partial'])
    expect(text).toMatchObject({ exitCode: 8, stdout: '1 ok, 1 failed\n' })
  })

  test.each([[['wait']], [['wait', '--json']]])(
    'an interrupted command %j exits 130 with nothing on stdout',
    async (args) => {
      const controller = new AbortController()
      const pending = cli(args, { signal: controller.signal })
      controller.abort()
      const result = await pending
      expect(result.exitCode).toBe(130)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Interrupted')
    },
  )
})

describe('output', () => {
  test('text mode prints text(data) on stdout', async () => {
    const result = await cli(['echo', 'hi', '--loud'])
    expect(result).toMatchObject({ exitCode: 0, stdout: 'HI\n', stderr: '' })
  })

  test('without text(), text mode prints the JSON', async () => {
    const result = await cli(['parent', 'abc'])
    expect(JSON.parse(result.stdout)).toEqual({ ran: 'parent', id: 'abc' })
  })

  test('warnings go to stderr only', async () => {
    const text = await cli(['careful'])
    expect(text.stdout).toBe('all done\n')
    expect(text.stderr).toContain('mind the gap')

    const json = await cli(['careful', '--json'])
    expect(json.json).toEqual({ done: true })
    expect(json.stderr).toContain('mind the gap')
  })

  test('colors and the spinner appear only when stderr is a TTY', async () => {
    const tty = await cli(['careful'], { stderrIsTTY: true })
    expect(tty.stderr).toContain('\x1b[')
    expect(tty.stderr).toContain('working')

    const piped = await cli(['careful'], { stderrIsTTY: false })
    expect(piped.stderr).not.toContain('\x1b[')
    expect(piped.stderr).not.toContain('working')
  })

  test('NO_COLOR turns colors and the spinner off', async () => {
    const result = await cli(['careful'], { stderrIsTTY: true, env: { NO_COLOR: '1' } })
    expect(result.stderr).toContain('mind the gap')
    expect(result.stderr).not.toContain('\x1b[')
    expect(result.stderr).not.toContain('working')
  })

  test('errors are colored only on a TTY', async () => {
    const tty = await cli(['fail', '--code', 'auth'], { stderrIsTTY: true })
    expect(tty.stderr).toContain('\x1b[')
    const piped = await cli(['fail', '--code', 'auth'])
    expect(piped.stderr).not.toContain('\x1b[')
  })

  test('help on stdout has no colors, even on a TTY', async () => {
    const result = await cli(['--help'], { stdoutIsTTY: true })
    expect(result.stdout).not.toContain('\x1b[')
  })

  describe('the key from OPENROUTER_API_KEY is never printed', () => {
    const key = 'sk-or-v1-0123456789abcdef'
    const env = { OPENROUTER_API_KEY: key }

    test.each([
      [['leak']],
      [['leak', '--json']],
      [['leak', '--throw']],
      [['leak', '--throw', '--json']],
    ])('%j', async (args) => {
      const result = await cli(args, { env })
      expect(result.stdout + result.stderr).not.toContain(key)
      expect(result.stdout + result.stderr).toContain('[redacted]')
    })

    test('an empty key redacts nothing', async () => {
      const result = await cli(['echo', 'hi'], { env: { OPENROUTER_API_KEY: '' } })
      expect(result.stdout).toBe('hi\n')
    })
  })

  test('commands read stdin and its TTY flag from the context', async () => {
    const result = await cli(['cat', '--json'], { stdin: 'a prompt', stdinIsTTY: false })
    expect(result.json).toEqual({ stdin: 'a prompt', isTTY: false })
  })
})
