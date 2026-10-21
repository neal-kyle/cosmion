import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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
 * Every readable entry, in the order written. A line that doesn't parse (cut off by a
 * crash) or has an unknown `v` is skipped with a warning on stderr (FR-052).
 */
export async function readLedger(ctx: Context): Promise<LedgerEntry[]> {
  const file = ledgerFile(ctx.env)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    const reason = error instanceof Error ? error.message : String(error)
    throw new CosmionError('internal', `Couldn't read the ledger at ${file} (${reason}).`)
  }

  const entries: LedgerEntry[] = []
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return
    const skip = (why: string) => warn(ctx, `Skipped line ${index + 1} of ${file}: ${why}`)
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
  return entries
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
