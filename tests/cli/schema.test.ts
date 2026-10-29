import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { commands } from '../../src/cli/commands/index.js'
import type { CommandDefinition } from '../../src/cli/define.js'
import { exitCodes } from '../../src/cli/exit-codes.js'
import { errorOutputSchema } from '../../src/cli/output.js'
import { runCli } from '../helpers/run-cli.js'

interface Described {
  name: string
  summary: string
  args: { name: string; required: boolean; description: string }[]
  options: {
    name: string
    flag: string
    alias: string | null
    type: string
    values: string[] | null
    required: boolean
    repeatable: boolean
    description: string
  }[]
  output: Record<string, unknown>
}
interface Schema {
  version: string
  commands: Described[]
  error: Record<string, unknown>
  exit_codes: { code: number; name: string; meaning: string }[]
}

/** Every command that runs, with its full name: `auth status`, `models rank`. */
function walk(list: readonly CommandDefinition[], prefix = ''): [string, CommandDefinition][] {
  return list.flatMap((command) => {
    const name = `${prefix}${command.name}`
    const own: [string, CommandDefinition][] = command.run ? [[name, command]] : []
    return [...own, ...walk(command.subcommands, `${name} `)]
  })
}

const version = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version

describe('schema (FR-098, FR-099)', () => {
  test('prints JSON with --json', async () => {
    const result = await runCli(['schema', '--json'])
    expect(result.exitCode).toBe(0)
    expect((result.json as Schema).version).toBe(version)
  })

  test('prints the same JSON without --json', async () => {
    const result = await runCli(['schema'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual((await runCli(['schema', '--json'])).json)
  })

  test('lists every command, from the same definitions the CLI parses', async () => {
    const schema = (await runCli(['schema', '--json'])).json as Schema
    const expected = walk(commands)
    expect(schema.commands.map((c) => c.name)).toEqual(expected.map(([name]) => name))
    expect(schema.commands.map((c) => c.name)).toContain('schema')
    expect(schema.commands.map((c) => c.name)).toContain('auth status')

    for (const [name, definition] of expected) {
      const described = schema.commands.find((c) => c.name === name)
      expect(described?.summary, name).toBe(definition.summary)
      expect(described?.args, name).toEqual(
        definition.args.map((arg) => ({
          name: arg.name,
          required: arg.required ?? false,
          description: arg.description,
        })),
      )
      const options = definition.options.map((option) => ({
        name: option.name,
        flag: option.flag,
        alias: option.alias ?? null,
        type: option.type,
        values: option.values ? [...option.values] : null,
        required: option.required ?? false,
        repeatable: option.repeatable ?? false,
        description: option.description,
      }))
      expect(described?.options, name).toEqual([
        ...options,
        expect.objectContaining({ name: 'json', flag: '--json', type: 'boolean' }),
      ])
      expect(described?.output, name).toEqual(
        z.toJSONSchema(definition.output as z.ZodType) as Record<string, unknown>,
      )
    }
  })

  test("options' aliases, allowed values and repeatability are included", async () => {
    const schema = (await runCli(['schema', '--json'])).json as Schema
    const options = schema.commands.flatMap((c) => c.options)
    expect(options.some((o) => o.alias !== null)).toBe(true)
    expect(options.some((o) => o.values !== null && o.values.length > 0)).toBe(true)
    expect(options.some((o) => o.repeatable)).toBe(true)
  })

  test('includes the error schema and the exit code table', async () => {
    const schema = (await runCli(['schema', '--json'])).json as Schema
    expect(schema.error).toEqual(z.toJSONSchema(errorOutputSchema))
    expect(schema.exit_codes).toEqual(
      Object.entries(exitCodes).map(([name, { code, meaning }]) => ({ name, code, meaning })),
    )
    expect(schema.exit_codes.map((e) => e.code)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 130])
  })
})
