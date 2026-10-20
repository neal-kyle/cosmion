import { readFileSync } from 'node:fs'
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander'
import { CosmionError, type ErrorCode } from '../core/errors.js'
import { commands as allCommands } from './commands/index.js'
import type { Context } from './context.js'
import type { CommandDefinition, OptionDefinition } from './define.js'
import { exitCodes } from './exit-codes.js'
import { paint, printJson, printText, redactKey } from './output.js'

type OnRun = (definition: CommandDefinition, input: Record<string, unknown>) => Promise<void>

/** Parses the arguments, runs the command, prints its result or error and returns the exit code. */
export async function run(
  args: readonly string[],
  context: Context,
  commands: readonly CommandDefinition[] = allCommands,
): Promise<number> {
  const ctx: Context = {
    ...context,
    stdout: redactKey(context.stdout, context.env),
    stderr: redactKey(context.stderr, context.env),
  }
  // Read from the arguments, not commander, so a parse error can be printed as JSON too.
  const json = wantsJson(args)
  let exitCode: number = exitCodes.ok.code

  const program = buildProgram(commands, ctx, async (definition, input) => {
    if (!definition.run) return
    const result = await definition.run(input, ctx)
    if (json || !definition.text) printJson(ctx, result.data)
    else printText(ctx, definition.text(result.data))
    exitCode = result.exitCode ?? exitCodes.ok.code
  })

  try {
    await program.parseAsync(args, { from: 'user' })
    return exitCode
  } catch (error) {
    return report(ctx, error, json)
  }
}

function wantsJson(args: readonly string[]): boolean {
  const end = args.indexOf('--')
  return (end === -1 ? args : args.slice(0, end)).includes('--json')
}

function buildProgram(commands: readonly CommandDefinition[], ctx: Context, onRun: OnRun) {
  // Settings made here are inherited by every command added afterwards.
  const program = new Command('cosmion')
    .description('Generate images with any model on OpenRouter, using your own key.')
    .version(readVersion(), '-V, --version', 'Print the version')
    .helpOption('-h, --help', 'Show help')
    .helpCommand('help [command]', 'Show help for a command')
    .option('--json', jsonDescription)
    .addHelpText('after', '\n`csn` is the short form of `cosmion`, e.g. `csn --help`.')
    .exitOverride()
    .configureOutput({
      writeOut: (text) => ctx.stdout.write(text),
      writeErr: (text) => ctx.stderr.write(text),
      // Parse errors are printed by report(), as text or JSON.
      outputError: () => {},
      getOutHasColors: () => false,
      getErrHasColors: () => false,
    })
  for (const definition of commands) addCommand(program, definition, onRun)
  return program
}

const jsonDescription = 'Print the result as one JSON object'

function readVersion(): string {
  // ../../package.json from both src/cli (tests) and dist/cli (the built CLI).
  const packageJson = new URL('../../package.json', import.meta.url)
  return JSON.parse(readFileSync(packageJson, 'utf8')).version
}

function addCommand(parent: Command, definition: CommandDefinition, onRun: OnRun): void {
  const command = parent.command(definition.name).description(definition.summary)
  for (const arg of definition.args) {
    command.argument(arg.required ? `<${arg.name}>` : `[${arg.name}]`, arg.description)
  }
  const options = definition.options.map((option) => ({
    definition: option,
    option: toOption(option),
  }))
  for (const { option } of options) command.addOption(option)
  command.option('--json', jsonDescription)

  if (definition.run) {
    command.action(async () => {
      const input: Record<string, unknown> = {}
      definition.args.forEach((arg, index) => {
        input[arg.name] = command.processedArgs[index]
      })
      const values = command.opts()
      for (const { definition: option, option: parsed } of options) {
        const value = values[parsed.attributeName()]
        if (option.type === 'boolean') input[option.name] = value === true
        else if (option.repeatable) input[option.name] = value ?? []
        else input[option.name] = value
      }
      await onRun(definition, input)
    })
  }
  for (const subcommand of definition.subcommands) addCommand(command, subcommand, onRun)
}

function toOption(definition: OptionDefinition): Option {
  const flags = definition.alias ? `${definition.alias}, ${definition.flag}` : definition.flag
  const option = new Option(flags, definition.description)
  // choices() lists the values in --help; the parser below checks them.
  if (definition.values) option.choices(definition.values)
  if (definition.required) option.makeOptionMandatory()
  if (definition.type !== 'boolean') {
    option.argParser((value: string, previous: unknown) => {
      const parsed = parseValue(definition, value)
      if (!definition.repeatable) return parsed
      return [...(Array.isArray(previous) ? previous : []), parsed]
    })
  }
  return option
}

/** Throws InvalidArgumentError, which commander turns into a usage error naming the flag. */
function parseValue(definition: OptionDefinition, value: string): string | number {
  if (definition.values && !definition.values.includes(value)) {
    throw new InvalidArgumentError(`Allowed values: ${definition.values.join(', ')}.`)
  }
  if (definition.type === 'integer') {
    if (!/^-?\d+$/.test(value)) throw new InvalidArgumentError('It must be a whole number.')
    return Number(value)
  }
  if (definition.type === 'number') {
    const number = Number(value)
    if (value.trim() === '' || !Number.isFinite(number)) {
      throw new InvalidArgumentError('It must be a number.')
    }
    return number
  }
  return value
}

/** Prints an error as text on stderr or as JSON on stdout, and returns its exit code. */
function report(ctx: Context, error: unknown, json: boolean): number {
  if (error instanceof CommanderError) {
    // --help, --version and `help <command>` end this way too.
    if (error.exitCode === 0) return exitCodes.ok.code
    return printError(ctx, json, 'usage', usageMessage(error), false)
  }
  if (ctx.signal.aborted) {
    // Nothing on stdout, even with --json (FR-041).
    ctx.stderr.write('Interrupted.\n')
    return exitCodes.interrupted.code
  }
  if (error instanceof CosmionError) {
    return printError(ctx, json, error.code, error.message, error.retryable)
  }

  const message = error instanceof Error ? error.message : String(error)
  if (ctx.env.COSMION_DEBUG === '1' && error instanceof Error && error.stack) {
    ctx.stderr.write(`${error.stack}\n`)
  }
  const firstLine = message.split('\n')[0]
  return printError(ctx, json, 'internal', `Unexpected error: ${firstLine}`, false)
}

function usageMessage(error: CommanderError): string {
  // A parent run without a subcommand: commander has already shown its help on stderr.
  if (error.code === 'commander.help')
    return 'Missing command. Run with --help to see the commands.'
  return error.message.replace(/^error: /, '')
}

function printError(
  ctx: Context,
  json: boolean,
  code: ErrorCode,
  message: string,
  retryable: boolean,
): number {
  if (json) printJson(ctx, { error: { code, message, retryable } })
  else ctx.stderr.write(`${paint(ctx, 'red', 'error:')} ${message}\n`)
  return exitCodes[code].code
}
