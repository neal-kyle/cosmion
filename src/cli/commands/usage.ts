import { z } from 'zod'
import { CosmionError } from '../../core/errors.js'
import { toNano, toUsd } from '../../core/money.js'
import { defineCommand } from '../define.js'
import { type LedgerEntry, readLedger } from '../ledger.js'
import { formatTime, formatUsd, table } from '../output.js'

const totalsSchema = z.strictObject({
  total_usd: z.number(),
  generations: z.number().int(),
  images: z.number().int(),
  /** Generations whose cost OpenRouter didn't give: not in total_usd (FR-081). */
  unknown_cost_count: z.number().int(),
})

const outputSchema = z.strictObject({
  since: z.string(),
  until: z.string(),
  by: z.enum(['model', 'day']),
  ...totalsSchema.shape,
  groups: z.array(z.strictObject({ key: z.string(), ...totalsSchema.shape })),
})
type Usage = z.infer<typeof outputSchema>
type Totals = z.infer<typeof totalsSchema>

const DEFAULT_DAYS = 30

export const usage = defineCommand({
  name: 'usage',
  summary: 'Show what you spent over a period, by model or by day',
  options: [
    {
      name: 'since',
      flag: '--since <when>',
      type: 'string',
      description: `A date such as 2026-10-01, or a number of days back such as 7d (default: ${DEFAULT_DAYS}d)`,
    },
    {
      name: 'until',
      flag: '--until <when>',
      type: 'string',
      description: 'A date (that whole day is included) or a number of days back (default: now)',
    },
    {
      name: 'by',
      flag: '--by <group>',
      type: 'string',
      values: ['model', 'day'],
      description: 'Group by model or by day (default: model)',
    },
  ],
  output: outputSchema,
  async run(input, ctx) {
    const now = new Date()
    const since =
      input.since === undefined
        ? daysBefore(now, DEFAULT_DAYS)
        : parseWhen(input.since, '--since', now)
    const until =
      input.until === undefined ? now : parseWhen(input.until, '--until', now, { wholeDay: true })
    if (since > until) throw new CosmionError('usage', '--since must not be after --until.')
    const by = input.by ?? 'model'

    const entries = (await readLedger(ctx)).filter((entry) => {
      const time = new Date(entry.created_at)
      return time >= since && time < until
    })
    const groups = new Map<string, LedgerEntry[]>()
    if (by === 'day') {
      // Every day in the range, including days with nothing (FR-082: local days).
      for (let day = startOfDay(since); day < until; day = nextDay(day)) groups.set(dayKey(day), [])
    }
    for (const entry of entries) {
      const key = by === 'day' ? dayKey(new Date(entry.created_at)) : entry.model
      groups.set(key, [...(groups.get(key) ?? []), entry])
    }

    const rows = [...groups].map(([key, list]) => ({ key, ...totals(list) }))
    // Days in order; models most expensive first.
    if (by === 'model') rows.sort((a, b) => b.total_usd - a.total_usd || (a.key < b.key ? -1 : 1))
    const data: Usage = {
      since: since.toISOString(),
      until: until.toISOString(),
      by,
      ...totals(entries),
      groups: rows,
    }
    return { data }
  },
  text: usageText,
})

function totals(entries: readonly LedgerEntry[]): Totals {
  let nano = 0
  let unknown = 0
  let images = 0
  for (const entry of entries) {
    if (entry.cost_usd === null) unknown++
    else nano += toNano(entry.cost_usd)
    images += entry.images.length
  }
  return {
    total_usd: toUsd(nano),
    generations: entries.length,
    images,
    unknown_cost_count: unknown,
  }
}

/**
 * `2026-10-01` is local midnight (with `wholeDay`, the midnight after, so that day is
 * included); `7d` is that many days before now.
 */
function parseWhen(
  value: string,
  flag: string,
  now: Date,
  options: { wholeDay?: boolean } = {},
): Date {
  const days = /^(\d+)d$/.exec(value)
  if (days) return daysBefore(now, Number(days[1]))
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (date) {
    const [year, month, day] = [Number(date[1]), Number(date[2]) - 1, Number(date[3])]
    const parsed = new Date(year, month, day)
    // new Date() rolls 2026-02-30 over into March; such a date isn't a real one.
    if (parsed.getFullYear() === year && parsed.getMonth() === month && parsed.getDate() === day) {
      return options.wholeDay ? nextDay(parsed) : parsed
    }
  }
  throw new CosmionError(
    'usage',
    `${flag} ${value}: use a date such as 2026-10-01, or a number of days such as 7d.`,
  )
}

function daysBefore(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() - days)
  return result
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** The next local midnight; not +24 hours, which daylight saving time would break. */
function nextDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
}

function dayKey(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

function usageText(data: Usage): string {
  const row = (key: string, totals: Totals) => [
    key,
    formatUsd(totals.total_usd),
    String(totals.generations),
    String(totals.images),
  ]
  const lines = [
    `${formatTime(data.since)} to ${formatTime(data.until)}`,
    '',
    table([
      [data.by === 'day' ? 'DAY' : 'MODEL', 'COST', 'GENERATIONS', 'IMAGES'],
      ...data.groups.map((group) => row(group.key, group)),
      row('Total', data),
    ]),
  ]
  if (data.unknown_cost_count > 0) {
    const count = data.unknown_cost_count
    lines.push(
      '',
      `${count} ${count === 1 ? 'generation has' : 'generations have'} an unknown cost, not included in the cost.`,
    )
  }
  return lines.join('\n')
}
