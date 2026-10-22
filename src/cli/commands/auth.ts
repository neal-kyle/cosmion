import { z } from 'zod'
import { CosmionError } from '../../core/errors.js'
import { toNano, toUsd } from '../../core/money.js'
import { createOpenRouterClient, type KeyInfo } from '../../core/openrouter.js'
import type { Context } from '../context.js'
import { defineCommand } from '../define.js'
import { readHidden } from '../hidden-input.js'
import { envKey, findKey, KEY_ENV, removeSavedKey, saveKey } from '../key.js'
import { TITLE } from '../name.js'
import { formatUsd, warn } from '../output.js'

const statusSchema = z.strictObject({
  source: z.enum(['env', 'file', 'none']),
  valid: z.boolean().nullable(),
  label: z.string().nullable(),
  limit_usd: z.number().nullable(),
  limit_remaining_usd: z.number().nullable(),
  usage_usd: z.number().nullable(),
  balance_usd: z.number().nullable(),
})
type Status = z.infer<typeof statusSchema>

const unknown = {
  valid: null,
  label: null,
  limit_usd: null,
  limit_remaining_usd: null,
  usage_usd: null,
  balance_usd: null,
}

function client(ctx: Context) {
  return createOpenRouterClient({
    baseUrl: ctx.baseUrl,
    fetch: ctx.fetch,
    title: TITLE,
    signal: ctx.signal,
  })
}

const status = defineCommand({
  name: 'status',
  summary: 'Show which key is in use, whether OpenRouter accepts it, and what it has left',
  output: statusSchema,
  async run(_input, ctx) {
    const found = await findKey(ctx)
    if (found.source === 'none') return { data: { source: found.source, ...unknown } }

    const openRouter = client(ctx)
    let key: KeyInfo
    try {
      key = await openRouter.getKey(found.key)
    } catch (error) {
      // A rejected key is an answer, not a failure (FR-048).
      if (error instanceof CosmionError && error.code === 'auth') {
        return { data: { source: found.source, ...unknown, valid: false } }
      }
      throw error
    }
    const credits = await openRouter.getCredits(found.key)
    const data: Status = {
      source: found.source,
      valid: true,
      label: key.label,
      limit_usd: key.limit,
      limit_remaining_usd: key.limit_remaining,
      usage_usd: key.usage,
      balance_usd: credits && toUsd(toNano(credits.total_credits) - toNano(credits.total_usage)),
    }
    return { data }
  },
  text: statusText,
})

const logout = defineCommand({
  name: 'logout',
  summary: 'Remove the saved key',
  output: z.strictObject({ removed: z.boolean() }),
  async run(_input, ctx) {
    return { data: { removed: await removeSavedKey(ctx) } }
  },
  text: (data) => (data.removed ? 'Removed the saved key.' : 'There was no saved key.'),
})

export const auth = defineCommand({
  name: 'auth',
  summary: 'Save your OpenRouter key, after checking it with OpenRouter',
  options: [
    {
      name: 'stdin',
      flag: '--stdin',
      type: 'boolean',
      description: 'Read the key from stdin instead of prompting (for scripts and agents)',
    },
  ],
  subcommands: [status, logout],
  output: z.strictObject({ saved: z.literal(true), label: z.string().nullable() }),
  async run(input, ctx) {
    const key = (await readKey(ctx, input.stdin)).trim()
    if (key === '') throw new CosmionError('usage', 'No key given.')
    // A rejected key throws here, before anything is saved.
    const { label } = await client(ctx).getKey(key)
    await saveKey(ctx, key)
    if (envKey(ctx)) {
      warn(ctx, `${KEY_ENV} is set, and is used instead of the saved key while it is.`)
    }
    return { data: { saved: true as const, label } }
  },
  text: (data) => (data.label ? `Saved the key (${data.label}).` : 'Saved the key.'),
})

async function readKey(ctx: Context, fromStdin: boolean): Promise<string> {
  if (fromStdin) {
    let text = ''
    for await (const chunk of ctx.stdin) text += chunk
    return text
  }
  if (!ctx.stdin.isTTY) {
    throw new CosmionError(
      'usage',
      'No terminal to type the key into. Pass it on stdin with --stdin, e.g. `cosmion auth --stdin < key.txt`.',
    )
  }
  return readHidden(ctx, 'OpenRouter API key (hidden as you type): ')
}

function statusText(data: Status): string {
  if (data.source === 'none') {
    return `No key. Run \`cosmion auth\` to save one, or set ${KEY_ENV}.`
  }
  const source = data.source === 'env' ? `from ${KEY_ENV}` : 'saved with `cosmion auth`'
  if (!data.valid) return `Key ${source}: rejected by OpenRouter.`
  const usd = (value: number | null) => (value === null ? 'unavailable' : formatUsd(value))
  const limit =
    data.limit_usd === null
      ? 'none'
      : `${formatUsd(data.limit_usd)} (${usd(data.limit_remaining_usd)} left)`
  return [
    `Key:      ${source}`,
    `Label:    ${data.label ?? '-'}`,
    `Limit:    ${limit}`,
    `Used:     ${usd(data.usage_usd)}`,
    `Balance:  ${usd(data.balance_usd)}`,
  ].join('\n')
}
