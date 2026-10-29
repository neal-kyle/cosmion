import { join } from 'node:path'
import { z } from 'zod'
import { CosmionError } from '../core/errors.js'
import { readSettingsFile, writeSettingsFile } from '../core/settings-file.js'
import type { Context } from './context.js'
import { resolvePaths } from './paths.js'

export const KEY_ENV = 'OPENROUTER_API_KEY'

export type FoundKey = { source: 'env' | 'file'; key: string } | { source: 'none'; key: null }

const settingsSchema = z.looseObject({ api_key: z.string().optional() })
type Settings = z.infer<typeof settingsSchema>

/** The key in use: OPENROUTER_API_KEY if set, otherwise the saved one (FR-046). */
export async function findKey(ctx: Context): Promise<FoundKey> {
  const fromEnv = envKey(ctx)
  if (fromEnv) return { source: 'env', key: fromEnv }
  const saved = (await readSettings(ctx)).api_key?.trim()
  if (saved) return { source: 'file', key: saved }
  return { source: 'none', key: null }
}

export function envKey(ctx: Context): string | undefined {
  return ctx.env[KEY_ENV]?.trim() || undefined
}

export async function saveKey(ctx: Context, key: string): Promise<void> {
  await writeSettingsFile(settingsFile(ctx), { ...(await readSettings(ctx)), api_key: key })
}

/** Removes the saved key; false when there was none. */
export async function removeSavedKey(ctx: Context): Promise<boolean> {
  const { api_key, ...rest } = await readSettings(ctx)
  if (api_key === undefined) return false
  await writeSettingsFile(settingsFile(ctx), rest)
  return true
}

/** Where `cosmion auth` saves the key. */
export function settingsFile(ctx: Context): string {
  return join(resolvePaths(ctx.env).config, 'settings.json')
}

async function readSettings(ctx: Context): Promise<Settings> {
  const file = settingsFile(ctx)
  const parsed = settingsSchema.safeParse((await readSettingsFile(file)) ?? {})
  // zod's message could quote the value, which may be the key.
  if (!parsed.success) {
    throw new CosmionError('internal', `${file} isn't in the expected shape. Fix it or delete it.`)
  }
  return parsed.data
}
