import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { commands as allCommands } from '../../src/cli/commands/index.js'
import type { Context } from '../../src/cli/context.js'
import type { CommandDefinition } from '../../src/cli/define.js'
import { exitCodes } from '../../src/cli/exit-codes.js'
import { errorOutputSchema } from '../../src/cli/output.js'
import { run } from '../../src/cli/run.js'

export interface RunCliOptions {
  /** The command list; defaults to the real one. */
  commands?: readonly CommandDefinition[]
  fetch?: typeof fetch
  /** Reuse this COSMION_HOME (a second run in the same home, to see what the first left). */
  home?: string
  /** The only environment the command sees; COSMION_HOME is added. */
  env?: Record<string, string | undefined>
  stdin?: string
  stdinIsTTY?: boolean
  stdoutIsTTY?: boolean
  stderrIsTTY?: boolean
  signal?: AbortSignal
  platform?: NodeJS.Platform
  nodeVersion?: string
}

export interface RunCliResult {
  exitCode: number
  stdout: string
  stderr: string
  /** Parsed stdout when `--json` was passed. */
  json: unknown
  home: string
  cwd: string
}

/**
 * Runs the CLI in-process with a temp COSMION_HOME and cwd. With `--json` it checks
 * stdout is exactly one JSON object matching the command's `output` schema, or the error
 * schema with the exit code FR-040 gives that error, or nothing at all for exit 130.
 */
export async function runCli(args: string[], options: RunCliOptions = {}): Promise<RunCliResult> {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'cosmion-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'cosmion-cwd-'))
  let stdout = ''
  let stderr = ''
  const stdin = Object.assign(Readable.from(options.stdin === undefined ? [] : [options.stdin]), {
    isTTY: options.stdinIsTTY ?? false,
  })

  const ctx: Context = {
    env: { ...options.env, COSMION_HOME: home },
    cwd,
    stdin,
    stdout: {
      write(text) {
        stdout += text
      },
      isTTY: options.stdoutIsTTY ?? false,
    },
    stderr: {
      write(text) {
        stderr += text
      },
      isTTY: options.stderrIsTTY ?? false,
    },
    fetch: options.fetch ?? noFetch,
    baseUrl: 'https://openrouter.test/api/v1',
    signal: options.signal ?? new AbortController().signal,
    platform: options.platform ?? 'linux',
    nodeVersion: options.nodeVersion ?? '22.12.0',
  }
  const commands = options.commands ?? allCommands
  const exitCode = await run(args, ctx, commands)

  let json: unknown
  if (wantsJson(args)) json = checkJson(args, exitCode, stdout, commands)
  return { exitCode, stdout, stderr, json, home, cwd }
}

const noFetch: typeof fetch = async () => {
  throw new Error('This test gave runCli no fetch')
}

function wantsJson(args: string[]): boolean {
  const end = args.indexOf('--')
  const own = end === -1 ? args : args.slice(0, end)
  const informational = ['--help', '-h', '--version', '-V']
  return own.includes('--json') && !own.some((arg) => informational.includes(arg))
}

function checkJson(
  args: string[],
  exitCode: number,
  stdout: string,
  commands: readonly CommandDefinition[],
): unknown {
  if (exitCode === exitCodes.interrupted.code) {
    if (stdout !== '') throw new Error(`Exit 130 must leave stdout empty, got: ${stdout}`)
    return undefined
  }
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    throw new Error(`--json stdout isn't exactly one JSON value:\n${stdout}`)
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`--json stdout isn't a JSON object:\n${stdout}`)
  }

  if (exitCode === exitCodes.ok.code || exitCode === exitCodes.partial.code) {
    const command = findCommand(args, commands)
    if (!command?.output) throw new Error(`No command with an output schema for: ${args.join(' ')}`)
    command.output.parse(json)
  } else {
    const { error } = errorOutputSchema.parse(json)
    const expected = exitCodes[error.code].code
    if (exitCode !== expected) {
      throw new Error(`error.code "${error.code}" should exit ${expected}, exited ${exitCode}`)
    }
  }
  return json
}

/** The command the arguments name: `parent child --x` → child. */
function findCommand(
  args: string[],
  commands: readonly CommandDefinition[],
): CommandDefinition | undefined {
  let found: CommandDefinition | undefined
  let level = commands
  for (const arg of args) {
    if (arg.startsWith('-')) continue
    const next = level.find((command) => command.name === arg)
    if (!next) break
    found = next
    level = next.subcommands
  }
  return found
}
