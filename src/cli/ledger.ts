import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { CosmionError } from '../core/errors.js'
import { type Settings, sameSettingsKey } from '../core/options.js'
import type { Context } from './context.js'
import { warn } from './output.js'
import { resolvePaths } from './paths.js'

/** Options as sent, under their API field names. */
export const settingsSchema = z.record(z.string(), z.union([z.string(), z.number()]))

/**
 * One generation request and its result (FR-050). Unknown fields pass through, so an
 * entry from a newer CLI that only added fields still reads (FR-052).
 */
export const ledgerEntrySchema = z.looseObject({
  v: z.literal(1),
  id: z.string().regex(/^[a-z0-9]{8}$/),
  created_at: z.string(),
  model: z.string(),
  prompt: z.string(),
  settings: settingsSchema,
  /** Absolute paths and URLs. */
  references: z.array(z.string()),
  images: z.array(
    z.looseObject({
      path: z.string(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      format: z.string(),
    }),
  ),
  cost_usd: z.number().nullable(),
  usage: z
    .looseObject({
      prompt_tokens: z.number(),
      completion_tokens: z.number(),
      total_tokens: z.number(),
    })
    .nullable(),
  provider: z.string().nullable(),
  generation_id: z.string().nullable(),
  batch_id: z.string().nullable(),
  row: z.number().int().nullable(),
  regen_of: z.string().nullable(),
})
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>

export function ledgerFile(env: Context['env']): string {
  return join(resolvePaths(env).data, 'ledger.jsonl')
}

/**
 * Adds one entry at the end of the ledger (FR-051). The whole line goes in one `write` to
 * a file opened for appending, so entries from processes running at once never mix.
 */
export async function appendEntry(ctx: Context, entry: LedgerEntry): Promise<void> {
  const file = ledgerFile(ctx.env)
  await mkdir(dirname(file), { recursive: true })
  const handle = await open(file, 'a')
  try {
    await handle.write(`${JSON.stringify(entry)}\n`)
  } finally {
    await handle.close()
  }
}

/**
 * Every readable entry, in the order written. A line that doesn't parse (cut off by a
 * crash) or has an unknown `v` is skipped with a warning on stderr (FR-052).
 */
export async function readLedger(ctx: Context): Promise<LedgerEntry[]> {
  const { file, entries, skipped } = await readLedgerLines(ctx)
  for (const { line, why } of skipped) warn(ctx, `Skipped line ${line} of ${file}: ${why}`)
  return entries
}

/** The ledger's entries and, without warning about them, the lines that were skipped. */
export async function readLedgerLines(ctx: Context): Promise<{
  file: string
  entries: LedgerEntry[]
  skipped: { line: number; why: string }[]
}> {
  const file = ledgerFile(ctx.env)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { file, entries: [], skipped: [] }
    const reason = error instanceof Error ? error.message : String(error)
    throw new CosmionError('internal', `Couldn't read the ledger at ${file} (${reason}).`)
  }

  const entries: LedgerEntry[] = []
  const skipped: { line: number; why: string }[] = []
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return
    const skip = (why: string) => skipped.push({ line: index + 1, why })
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      skip("it isn't complete JSON (perhaps cut off by a crash).")
      return
    }
    const version = (value as { v?: unknown } | null)?.v
    if (version !== undefined && version !== 1) {
      skip(`it was written by a newer version of Cosmion (format v${String(version)}).`)
      return
    }
    const parsed = ledgerEntrySchema.safeParse(value)
    if (parsed.success) entries.push(parsed.data)
    else skip("it isn't a valid ledger entry.")
  })
  return { file, entries, skipped }
}

/** The newest entry with this model and the same settings (FR-034), if any. */
export function findNewestMatch(
  entries: readonly LedgerEntry[],
  model: string,
  settings: Settings,
  refCount: number,
): LedgerEntry | undefined {
  const key = sameSettingsKey(settings, refCount)
  return entries.findLast(
    (entry) =>
      entry.model === model && sameSettingsKey(entry.settings, entry.references.length) === key,
  )
}
