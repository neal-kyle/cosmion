import type { z } from 'zod'
import type { Context } from './context.js'

export interface ArgumentDefinition {
  /** The key in the command's input. */
  readonly name: string
  readonly required?: boolean
  readonly description: string
}

export interface OptionDefinition {
  /** The key in the command's input, e.g. `dryRun`. */
  readonly name: string
  /** The long flag with its value placeholder, e.g. `--model <id>`, or `--force`. */
  readonly flag: string
  /** The short flag, e.g. `-m`. */
  readonly alias?: string
  readonly type: 'string' | 'integer' | 'number' | 'boolean'
  /** The only values allowed. */
  readonly values?: readonly string[]
  readonly required?: boolean
  readonly repeatable?: boolean
  readonly description: string
}

/**
 * What `run` returns. Exit 8 isn't an error: the result is printed as usual (FR-041). A
 * batch stopped by an auth or credits error exits 3 or 4 with its report (FR-078).
 */
export interface CommandResult<Output> {
  data: Output
  exitCode?: 3 | 4 | 8
}

/** A command as `run.ts` and `schema` see it. */
export interface CommandDefinition {
  readonly name: string
  readonly summary: string
  readonly args: readonly ArgumentDefinition[]
  readonly options: readonly OptionDefinition[]
  readonly subcommands: readonly CommandDefinition[]
  /** The `--json` result. Absent for a parent that only groups subcommands. */
  readonly output?: z.ZodType
  run?(input: Record<string, unknown>, ctx: Context): Promise<CommandResult<unknown>>
  /** stdout in text mode; without it, text mode prints the JSON. */
  text?(data: unknown): string
}

type Value<O extends OptionDefinition> = O['type'] extends 'boolean'
  ? boolean
  : O['type'] extends 'integer' | 'number'
    ? number
    : O['values'] extends readonly string[]
      ? O['values'][number]
      : string

/** Omitted options: booleans are false, repeatables empty, the rest undefined. */
type OptionInput<O extends OptionDefinition> = O['type'] extends 'boolean'
  ? boolean
  : O['repeatable'] extends true
    ? Value<O>[]
    : O['required'] extends true
      ? Value<O>
      : Value<O> | undefined

/**
 * The typed input a command's `run` gets, built from its arguments and options. An option
 * list declared outside defineCommand() needs `as const satisfies readonly
 * OptionDefinition[]`, or its names and types widen to `string`.
 */
export type Input<
  A extends readonly ArgumentDefinition[],
  O extends readonly OptionDefinition[],
> = { [K in A[number] as K['name']]: K['required'] extends true ? string : string | undefined } & {
  [K in O[number] as K['name']]: OptionInput<K>
}

interface CommandSpec<
  A extends readonly ArgumentDefinition[],
  O extends readonly OptionDefinition[],
  Output,
> {
  name: string
  summary: string
  args?: A
  options?: O
  subcommands?: readonly CommandDefinition[]
  output: z.ZodType<Output>
  run(input: Input<A, O>, ctx: Context): Promise<CommandResult<Output>>
  text?(data: Output): string
}

interface GroupSpec {
  name: string
  summary: string
  subcommands: readonly CommandDefinition[]
}

/** Describes a command once; that one description drives parsing, help, output and schema. */
export function defineCommand<
  const A extends readonly ArgumentDefinition[] = [],
  const O extends readonly OptionDefinition[] = [],
  Output = unknown,
>(spec: CommandSpec<A, O, Output>): CommandDefinition
/** A parent that only groups subcommands. */
export function defineCommand(spec: GroupSpec): CommandDefinition
export function defineCommand(spec: CommandSpec<[], [], unknown> | GroupSpec): CommandDefinition {
  return { args: [], options: [], subcommands: [], ...spec }
}
