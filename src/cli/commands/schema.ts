import { z } from 'zod'
import {
  type CommandDefinition,
  defineCommand,
  jsonOption,
  type OptionDefinition,
} from '../define.js'
import { exitCodes } from '../exit-codes.js'
import { errorOutputSchema } from '../output.js'
import { readVersion } from '../version.js'
// index.ts lists this command too; the list is only read when `schema` runs, by which time
// both modules are loaded.
import { commands } from './index.js'

const jsonSchema = z.record(z.string(), z.unknown())

const outputSchema = z.strictObject({
  version: z.string(),
  commands: z.array(
    z.strictObject({
      /** With its parents' names: `auth status`. */
      name: z.string(),
      summary: z.string(),
      args: z.array(
        z.strictObject({ name: z.string(), required: z.boolean(), description: z.string() }),
      ),
      options: z.array(
        z.strictObject({
          name: z.string(),
          flag: z.string(),
          alias: z.string().nullable(),
          type: z.enum(['string', 'integer', 'number', 'boolean']),
          values: z.array(z.string()).nullable(),
          required: z.boolean(),
          repeatable: z.boolean(),
          description: z.string(),
        }),
      ),
      /** The `--json` result, as JSON Schema. */
      output: jsonSchema,
    }),
  ),
  error: jsonSchema,
  exit_codes: z.array(z.strictObject({ name: z.string(), code: z.number(), meaning: z.string() })),
})
type Schema = z.infer<typeof outputSchema>

export const schema = defineCommand({
  name: 'schema',
  summary: 'Describe every command, option, JSON output and exit code, as JSON (for agents)',
  output: outputSchema,
  // No text(): it always prints JSON.
  async run() {
    const data: Schema = {
      version: readVersion(),
      commands: describeAll(commands),
      error: z.toJSONSchema(errorOutputSchema),
      exit_codes: Object.entries(exitCodes).map(([name, { code, meaning }]) => ({
        name,
        code,
        meaning,
      })),
    }
    return { data }
  },
})

/** Every command that runs, parents before their subcommands. */
function describeAll(list: readonly CommandDefinition[], prefix = ''): Schema['commands'] {
  return list.flatMap((command) => {
    const name = `${prefix}${command.name}`
    const own =
      command.run && command.output
        ? [
            {
              name,
              summary: command.summary,
              args: command.args.map((arg) => ({
                name: arg.name,
                required: arg.required ?? false,
                description: arg.description,
              })),
              options: [...command.options, jsonOption].map(describeOption),
              output: z.toJSONSchema(command.output),
            },
          ]
        : []
    return [...own, ...describeAll(command.subcommands, `${name} `)]
  })
}

function describeOption(option: OptionDefinition): Schema['commands'][number]['options'][number] {
  return {
    name: option.name,
    flag: option.flag,
    alias: option.alias ?? null,
    type: option.type,
    values: option.values ? [...option.values] : null,
    required: option.required ?? false,
    repeatable: option.repeatable ?? false,
    description: option.description,
  }
}
