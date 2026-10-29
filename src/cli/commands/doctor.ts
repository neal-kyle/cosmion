import { randomBytes } from 'node:crypto'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { CosmionError } from '../../core/errors.js'
import { createOpenRouterClient, type KeyInfo } from '../../core/openrouter.js'
import { loadCatalog } from '../catalog-cache.js'
import type { Context } from '../context.js'
import { defineCommand } from '../define.js'
import { findKey, KEY_ENV, settingsFile } from '../key.js'
import { readLedgerLines } from '../ledger.js'
import { ENV_PREFIX, TITLE } from '../name.js'
import { formatUsd } from '../output.js'
import { resolvePaths } from '../paths.js'

const checkSchema = z.strictObject({
  name: z.string(),
  status: z.enum(['ok', 'warn', 'fail']),
  message: z.string(),
  /** What to do about a warning or failure; null when the check passed. */
  fix: z.string().nullable(),
})
type Check = z.infer<typeof checkSchema>

const ok = (name: string, message: string): Check => ({ name, status: 'ok', message, fix: null })
const warn = (name: string, message: string, fix: string): Check => ({
  name,
  status: 'warn',
  message,
  fix,
})
const fail = (name: string, message: string, fix: string): Check => ({
  name,
  status: 'fail',
  message,
  fix,
})

const MIN_NODE = { major: 22, minor: 12 }
/** Under this share of the key's limit left, warn. */
const LOW_LIMIT_SHARE = 0.1

export const doctor = defineCommand({
  name: 'doctor',
  summary: 'Check that Node, the key, OpenRouter and the local files are all in order',
  output: z.strictObject({ checks: z.array(checkSchema) }),
  async run(_input, ctx) {
    const paths = resolvePaths(ctx.env)
    const checks: Check[] = [
      checkNode(ctx),
      ...(await checkKey(ctx)),
      await checkSettingsFile(ctx),
      await checkOpenRouter(ctx),
      await checkCatalog(ctx),
      await checkFolder('config_folder', paths.config),
      await checkFolder('data_folder', paths.data),
      await checkFolder('cache_folder', paths.cache),
      await checkLedger(ctx),
    ]
    // Warnings are fine; a failure is exit 8, with the checks printed as usual (FR-096).
    const failed = checks.some((check) => check.status === 'fail')
    return failed ? { data: { checks }, exitCode: 8 } : { data: { checks } }
  },
  text: ({ checks }) => {
    const width = Math.max(...checks.map((check) => check.name.length))
    return checks
      .flatMap((check) => {
        const line = `${check.status.padEnd(4)}  ${check.name.padEnd(width)}  ${check.message}`
        const indent = ' '.repeat(6 + width + 2)
        return check.fix ? [line, `${indent}fix: ${check.fix}`] : [line]
      })
      .join('\n')
  },
})

function checkNode(ctx: Context): Check {
  const [major = 0, minor = 0] = ctx.nodeVersion.replace(/^v/, '').split('.').map(Number)
  const minimum = `${MIN_NODE.major}.${MIN_NODE.minor}`
  if (major > MIN_NODE.major || (major === MIN_NODE.major && minor >= MIN_NODE.minor)) {
    return ok('node', `Node ${ctx.nodeVersion}`)
  }
  return fail(
    'node',
    `Node ${ctx.nodeVersion} is older than ${minimum}.`,
    `Install Node ${minimum} or newer from https://nodejs.org.`,
  )
}

/**
 * The key's presence, OpenRouter's verdict on it and its limit, from one `GET /key`. The
 * checks that need a key, or an answer about it, are left out when there isn't one.
 */
async function checkKey(ctx: Context): Promise<Check[]> {
  let found: Awaited<ReturnType<typeof findKey>>
  try {
    found = await findKey(ctx)
  } catch (error) {
    if (!(error instanceof CosmionError)) throw error
    return [fail('key', error.message, `Fix or delete ${settingsFile(ctx)}.`)]
  }
  if (found.source === 'none') {
    return [fail('key', 'No key.', `Run \`cosmion auth\` to save one, or set ${KEY_ENV}.`)]
  }
  const source = found.source === 'env' ? `Key from ${KEY_ENV}.` : 'Key saved with `cosmion auth`.'
  const keyCheck = ok('key', source)

  let info: KeyInfo
  try {
    info = await client(ctx).getKey(found.key)
  } catch (error) {
    if (!(error instanceof CosmionError) || ctx.signal.aborted) throw error
    if (error.code === 'auth') {
      return [
        keyCheck,
        fail(
          'key_accepted',
          'OpenRouter rejected the key.',
          `Create a key at https://openrouter.ai/settings/keys and save it with \`cosmion auth\`${found.source === 'env' ? `, or fix ${KEY_ENV}` : ''}.`,
        ),
      ]
    }
    return [
      keyCheck,
      warn(
        'key_accepted',
        `Couldn't check the key: ${error.message}`,
        'See the openrouter check, then run `cosmion doctor` again.',
      ),
    ]
  }
  return [keyCheck, ok('key_accepted', 'OpenRouter accepts the key.'), checkLimit(info)]
}

function checkLimit(info: KeyInfo): Check {
  if (info.limit === null || info.limit_remaining === null) {
    return ok('key_limit', 'The key has no spending limit.')
  }
  const left = `${formatUsd(info.limit_remaining)} of the key's ${formatUsd(info.limit)} limit is left.`
  if (info.limit <= 0 || info.limit_remaining / info.limit < LOW_LIMIT_SHARE) {
    return warn(
      'key_limit',
      left,
      'Raise the limit at https://openrouter.ai/settings/keys if you need more.',
    )
  }
  return ok('key_limit', left)
}

/** Only the owner may read the saved key (FR-047). Windows keeps it in the user's profile. */
async function checkSettingsFile(ctx: Context): Promise<Check> {
  const name = 'settings_file'
  if (ctx.platform === 'win32') return ok(name, 'Permissions not checked on Windows.')
  const file = settingsFile(ctx)
  let mode: number
  try {
    mode = (await stat(file)).mode
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ok(name, 'No settings file.')
    return fail(
      name,
      `Couldn't check ${file} (${reasonOf(error)}).`,
      `Check that ${file} exists and is yours.`,
    )
  }
  if ((mode & 0o077) !== 0) {
    return fail(
      name,
      `${file} can be read or changed by other users.`,
      `Run \`chmod 600 ${file}\`.`,
    )
  }
  return ok(name, `${file} is readable by you only.`)
}

async function checkOpenRouter(ctx: Context): Promise<Check> {
  try {
    await client(ctx).listImageModels()
    return ok('openrouter', 'OpenRouter answers.')
  } catch (error) {
    if (!(error instanceof CosmionError) || ctx.signal.aborted) throw error
    return fail(
      'openrouter',
      error.message,
      'Check your internet connection, and https://status.openrouter.ai.',
    )
  }
}

async function checkCatalog(ctx: Context): Promise<Check> {
  const fix = 'Once the openrouter check passes, run `cosmion models --refresh`.'
  try {
    const { catalog, stale } = await loadCatalog(ctx)
    if (stale) {
      return warn(
        'catalog',
        `Couldn't refresh the model catalog; using the copy fetched at ${catalog.fetched_at}.`,
        fix,
      )
    }
    return ok('catalog', `Model catalog fetched at ${catalog.fetched_at}.`)
  } catch (error) {
    if (!(error instanceof CosmionError) || ctx.signal.aborted) throw error
    return fail('catalog', `No model catalog: ${error.message}`, fix)
  }
}

async function checkFolder(name: string, folder: string): Promise<Check> {
  const probe = join(folder, `.doctor-${randomBytes(4).toString('hex')}.tmp`)
  try {
    await mkdir(folder, { recursive: true })
    await writeFile(probe, '')
    await rm(probe)
    return ok(name, `${folder} is writable.`)
  } catch (error) {
    return fail(
      name,
      `Can't write to ${folder} (${reasonOf(error)}).`,
      `Make ${folder} a folder you can write to, or set ${ENV_PREFIX}HOME to one.`,
    )
  }
}

async function checkLedger(ctx: Context): Promise<Check> {
  try {
    const { file, entries, skipped } = await readLedgerLines(ctx)
    if (skipped.length > 0) {
      const lines = skipped.length === 1 ? '1 line' : `${skipped.length} lines`
      return warn(
        'ledger',
        `${lines} of ${file} can't be read and ${skipped.length === 1 ? 'is' : 'are'} left out of history and usage.`,
        `Lines cut off by a crash can be deleted from ${file}; \`cosmion history\` names each one.`,
      )
    }
    return ok(
      'ledger',
      `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} in ${file}.`,
    )
  } catch (error) {
    if (!(error instanceof CosmionError)) throw error
    return fail(
      'ledger',
      error.message,
      `Check that ${resolvePaths(ctx.env).data} is a folder you can read.`,
    )
  }
}

function client(ctx: Context) {
  return createOpenRouterClient({
    baseUrl: ctx.baseUrl,
    fetch: ctx.fetch,
    title: TITLE,
    signal: ctx.signal,
  })
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
