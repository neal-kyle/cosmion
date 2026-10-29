import { describe, expect, test } from 'vitest'
import { commands } from '../../src/cli/commands/index.js'
import type { CommandDefinition } from '../../src/cli/define.js'
import { createFakeOpenRouter } from '../helpers/fake-openrouter.js'
import { runCli } from '../helpers/run-cli.js'

/** Every command as its words, e.g. `['auth', 'status']`, with its definition. */
function walk(
  list: readonly CommandDefinition[],
  prefix: string[] = [],
): { words: string[]; command: CommandDefinition }[] {
  return list.flatMap((command) => {
    const words = [...prefix, command.name]
    return [{ words, command }, ...walk(command.subcommands, words)]
  })
}

const all = walk(commands).map(({ words }) => words)
const runnable = walk(commands)
  .filter(({ command }) => command.run)
  .map(({ words }) => words)

describe('the agent interface, for every command (Story 2, SC-003)', () => {
  test('the twelve commands and the subcommands of auth are all here', () => {
    expect(runnable.map((words) => words.join(' ')).sort()).toEqual(
      [
        'auth',
        'auth logout',
        'auth status',
        'batch',
        'doctor',
        'gen',
        'history',
        'models',
        'models rank',
        'price',
        'regen',
        'schema',
        'show',
        'usage',
      ].sort(),
    )
  })

  test.each(all)('%s has --help (FR-044)', async (...words) => {
    const result = await runCli([...words, '--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`Usage: cosmion ${words.join(' ')}`)
  })

  test.each(runnable)(
    '%s with --json prints one error object with the FR-040 exit code (Story 2.2)',
    async (...words) => {
      // runCli checks stdout is one error object whose code matches the exit code.
      const result = await runCli([...words, '--not-an-option', '--json'])
      expect(result.exitCode).toBe(2)
      expect(result.json).toMatchObject({ error: { code: 'usage' } })
      expect(result.stderr).toBe('')
    },
  )

  test.each(runnable)(
    "%s doesn't prompt when stdin isn't a TTY (FR-043, Story 2.3)",
    async (...words) => {
      // A command waiting for input would never finish: stdin here is empty, not a terminal.
      const result = await runCli([...words, '--json'], {
        fetch: createFakeOpenRouter().fetch,
        stdinIsTTY: false,
      })
      expect(result.exitCode).not.toBe(130)
      expect(result.json).toBeTypeOf('object')
    },
  )
})
