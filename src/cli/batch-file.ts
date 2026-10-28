import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { parse } from 'csv-parse/sync'
import { CosmionError } from '../core/errors.js'
import { type GenOptions, type OptionName, SETTING_FIELDS } from '../core/options.js'
import type { Context } from './context.js'

/** One row of a batch file (FR-070): what `gen` would get from its arguments. */
export interface BatchRow {
  /** 1-based, in file order. */
  row: number
  prompt: string
  model: string | undefined
  options: GenOptions
  refs: string[]
  out: string | undefined
}

const INTEGER_OPTIONS: readonly OptionName[] = ['count', 'seed', 'compression']
const OPTION_NAMES = Object.keys(SETTING_FIELDS) as OptionName[]
const COLUMNS = ['prompt', 'model', ...OPTION_NAMES, 'ref', 'out']

/**
 * Reads a CSV (with a header row) or JSONL batch file, chosen by its extension. Every
 * problem is collected and reported at once with its row number, as a usage error.
 */
export async function readBatchFile(ctx: Context, file: string): Promise<BatchRow[]> {
  const extension = extname(file).toLowerCase()
  if (extension !== '.csv' && extension !== '.jsonl') {
    throw new CosmionError('usage', `${file}: a batch file must end in .csv or .jsonl.`)
  }
  let text: string
  try {
    text = await readFile(resolve(ctx.cwd, file), 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CosmionError('usage', `Couldn't read ${file} (${reason}).`)
  }

  const problems: string[] = []
  const records = extension === '.csv' ? csvRecords(file, text) : jsonlRecords(text, problems)
  const rows: BatchRow[] = []
  for (const [index, record] of records.entries()) {
    if (record === null) continue
    const row = toRow(index + 1, record, problems)
    if (row) rows.push(row)
  }
  if (records.length === 0) problems.push('it has no rows.')
  if (problems.length > 0) {
    throw new CosmionError(
      'usage',
      `${file} has problems:\n${problems.map((p) => `  ${p}`).join('\n')}`,
    )
  }
  return rows
}

function csvRecords(file: string, text: string): Record<string, unknown>[] {
  let records: Record<string, string>[]
  try {
    records = parse(text, { bom: true, columns: true, skip_empty_lines: true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new CosmionError('usage', `${file} isn't valid CSV (${reason}).`)
  }
  // In CSV an empty cell means the option isn't given, and refs are separated by `|`.
  return records.map((record) => {
    const values: Record<string, unknown> = {}
    for (const [column, value] of Object.entries(record)) {
      if (value === '') continue
      values[column] =
        column === 'ref'
          ? value
              .split('|')
              .map((ref) => ref.trim())
              .filter(Boolean)
          : value
    }
    return values
  })
}

/** One record per non-blank line; null for a line that isn't a JSON object. */
function jsonlRecords(text: string, problems: string[]): (Record<string, unknown> | null)[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  return lines.map((line, index) => {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      value = undefined
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      problems.push(`Row ${index + 1}: not a JSON object.`)
      return null
    }
    return value as Record<string, unknown>
  })
}

function toRow(row: number, record: Record<string, unknown>, problems: string[]): BatchRow | null {
  const before = problems.length
  const problem = (message: string) => problems.push(`Row ${row}: ${message}`)

  for (const column of Object.keys(record)) {
    if (!COLUMNS.includes(column)) {
      problem(`unknown column "${column}". The columns are ${COLUMNS.join(', ')}.`)
    }
  }
  const text = (column: string): string | undefined => {
    const value = record[column]
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') {
      problem(`${column} must be text.`)
      return undefined
    }
    return value
  }

  const prompt = text('prompt')
  if (prompt === undefined || prompt.trim() === '') problem('prompt is missing or empty.')
  const options: GenOptions = {}
  for (const name of OPTION_NAMES) {
    const value = record[name]
    if (value === undefined || value === null) continue
    if (INTEGER_OPTIONS.includes(name)) {
      const number =
        typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value
      if (typeof number === 'number' && Number.isInteger(number)) options[name] = number
      else problem(`${name} must be a whole number.`)
    } else {
      const value = text(name)
      if (value !== undefined) options[name] = value
    }
  }
  const refs = record.ref ?? []
  if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== 'string')) {
    problem('ref must be a list of paths or URLs.')
  }

  if (problems.length > before) return null
  return {
    row,
    prompt: prompt as string,
    model: text('model'),
    options,
    refs: refs as string[],
    out: text('out'),
  }
}
