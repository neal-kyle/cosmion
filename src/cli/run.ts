import { Command, CommanderError, type Help, InvalidArgumentError, Option } from 'commander'
import { CosmionError, type ErrorCode } from '../core/errors.js'
import { commands as allCommands } from './commands/index.js'
import type { Context } from './context.js'
import { type CommandDefinition, jsonOption, type OptionDefinition } from './define.js'
import { exitCodes } from './exit-codes.js'
import { InterruptedError } from './hidden-input.js'
import { homeScreen } from './home.js'
import { fancy, printJson, printText, redactKey } from './output.js'
import { code, style } from './pretty.js'
import { readVersion } from './version.js'

const DESCRIPTION = 'Generate images with any model on OpenRouter, using your own key.'
/** The width to fit when the terminal doesn't say. */
const DEFAULT_COLUMNS = 80
const ROOT_HELP = ['--help', '-h', 'help']

/** Help on a terminal, in the same style as the rest of the output. */
const HELP_STYLE: Partial<Help> = {
  styleTitle: (text) => style('dim', text),
  styleCommandText: (text) => style('bold', text),
  styleOptionTerm: (text) => style('accent', text),
  styleSubcommandTerm: (text) => style('accent', text),
  styleArgumentTerm: (text) => style('accent', text),
  styleCommandDescription: code,
  styleOptionDescription: code,
  styleSubcommandDescription: code,
  styleArgumentDescription: code,
}

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
  const home = (columns = DEFAULT_COLUMNS) =>
    homeScreen(commands, DESCRIPTION, readVersion(), columns)
  if (args.length === 0 && fancy(ctx)) {
    ctx.stderr.write(home(ctx.stderr.columns))
    return exitCodes.usage.code
  }
  if (args.length === 1 && ROOT_HELP.includes(args[0] as string) && fancy(ctx, ctx.stdout)) {
    ctx.stdout.write(home(ctx.stdout.columns))
    return exitCodes.ok.code
  }
  // Read from the arguments, not commander, so a parse error can be printed as JSON too.
  const json = wantsJson(args)
  const prettyOut = !json && fancy(ctx, ctx.stdout)
  let exitCode: number = exitCodes.ok.code

  const program = buildProgram(commands, ctx, async (definition, input) => {
    if (!definition.run) return
    const result = await definition.run(input, { ...ctx, prettyOut })
    if (json || !definition.text) printJson(ctx, result.data)
    else if (definition.pretty && prettyOut) {
      printText(ctx, definition.pretty(result.data, ctx.stdout.columns ?? DEFAULT_COLUMNS))
    } else printText(ctx, definition.text(result.data))
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
  const styled = fancy(ctx, ctx.stdout)
  // Settings made here are inherited by every command added afterwards.
  const program = new Command('cosmion')
    .description(DESCRIPTION)
    .version(readVersion(), '-V, --version', 'Print the version')
    .helpOption('-h, --help', 'Show help')
    .helpCommand('help [command]', 'Show help for a command')
    .option(jsonOption.flag, jsonOption.description)
    .addHelpText('after', '\n`csn` is the short form of `cosmion`, e.g. `csn --help`.')
    .configureHelp(styled ? HELP_STYLE : {})
    .exitOverride()
    .configureOutput({
      writeOut: (text) => ctx.stdout.write(text),
      writeErr: (text) => ctx.stderr.write(text),
      // Parse errors are printed by report(), as text or JSON.
      outputError: () => {},
      getOutHasColors: () => styled,
      getErrHasColors: () => styled && fancy(ctx),
    })
  for (const definition of commands) addCommand(program, definition, onRun)
  return program
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
  command.option(jsonOption.flag, jsonOption.description)

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
  // A `--no-x` flag is an option of its own, not `--x` switched off (batch's `--no-budget`).
  option.negate = false
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
  if (ctx.signal.aborted || error instanceof InterruptedError) {
    // Nothing on stdout, even with --json (FR-041).
    const message = error instanceof InterruptedError ? error.message : 'Interrupted.'
    ctx.stderr.write(fancy(ctx) ? `${style('warn', '!')} ${message}\n` : `${message}\n`)
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
  else if (fancy(ctx)) ctx.stderr.write(styledError(message))
  else ctx.stderr.write(`error: ${message}\n`)
  return exitCodes[code].code
}

/** `✗ What went wrong`, then what to do about it on its own line when the message says. */
function styledError(message: string): string {
  const parts = /^(.*[.!?:])\s+(Run `.*)$/s.exec(message)
  const headline = `${style('error', '✗')} ${code(parts?.[1] ?? message)}\n`
  return parts?.[2] ? `${headline}  ${style('dim', '→')} ${code(parts[2])}\n` : headline
}
