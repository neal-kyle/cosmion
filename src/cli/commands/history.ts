import { z } from 'zod'
import { CosmionError } from '../../core/errors.js'
import { defineCommand } from '../define.js'
import { type LedgerEntry, ledgerEntrySchema, readLedger } from '../ledger.js'
import { formatTime, formatUsd, table } from '../output.js'
import { fitTable, shortTime, style } from '../pretty.js'

const outputSchema = z.strictObject({ entries: z.array(ledgerEntrySchema) })

/** How much of a prompt text mode shows. */
const PROMPT_WIDTH = 40

export const history = defineCommand({
  name: 'history',
  summary: 'List past generations, newest first',
  options: [
    {
      name: 'limit',
      flag: '--limit <n>',
      type: 'integer',
      description: 'How many to list (default: 20)',
    },
    {
      name: 'model',
      flag: '--model <id>',
      alias: '-m',
      type: 'string',
      description: 'Only generations with this model',
    },
  ],
  output: outputSchema,
  async run(input, ctx) {
    const limit = input.limit ?? 20
    if (limit < 1) throw new CosmionError('usage', '--limit must be at least 1.')
    const entries = (await readLedger(ctx))
      .filter((entry) => input.model === undefined || entry.model === input.model)
      .reverse()
      // Concurrent runs can append slightly out of order; the sort is stable for ties.
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .slice(0, limit)
    return { data: { entries } }
  },
  text: ({ entries }) =>
    entries.length === 0
      ? ''
      : table([['ID', 'TIME', 'MODEL', 'COST', 'PROMPT', 'PATH'], ...entries.map(row)]),
  pretty: ({ entries }, columns) =>
    entries.length === 0
      ? style('dim', 'No generations yet.')
      : fitTable(
          [
            { header: 'id', value: (entry) => entry.id, role: () => 'accent' },
            {
              header: 'time',
              value: (entry) => shortTime(entry.created_at),
              role: () => 'dim',
              drop: 2,
            },
            {
              header: 'cost',
              value: costText,
              role: (entry) => (entry.cost_usd === null ? 'dim' : undefined),
              right: true,
            },
            { header: 'model', value: (entry) => entry.model, drop: 3 },
            { header: 'prompt', value: (entry) => shorten(entry.prompt), min: 16 },
            {
              header: 'path',
              value: pathText,
              path: (entry) => entry.images[0]?.path,
              drop: 4,
            },
          ],
          entries,
          columns,
        ),
})

function row(entry: LedgerEntry): string[] {
  return [
    entry.id,
    formatTime(entry.created_at),
    entry.model,
    costText(entry),
    shorten(entry.prompt),
    pathText(entry),
  ]
}

function costText(entry: LedgerEntry): string {
  return entry.cost_usd === null ? 'unknown' : formatUsd(entry.cost_usd)
}

function pathText(entry: LedgerEntry): string {
  const [first, ...rest] = entry.images
  return first ? first.path + (rest.length ? ` (+${rest.length} more)` : '') : '-'
}

function shorten(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim()
  return oneLine.length <= PROMPT_WIDTH ? oneLine : `${oneLine.slice(0, PROMPT_WIDTH - 1)}…`
}
