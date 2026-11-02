import { basename } from 'node:path'
import { z } from 'zod'
import { type RowResult, type RowStatus, schedule } from '../../core/batch.js'
import { CosmionError, ERROR_CODES } from '../../core/errors.js'
import { newId } from '../../core/ids.js'
import { toNano, toUsd } from '../../core/money.js'
import { type Settings, sameSettingsKey } from '../../core/options.js'
import { type PriceResult, price as priceOf, weakestKind } from '../../core/pricing.js'
import { type BatchRow, readBatchFile } from '../batch-file.js'
import { loadModel } from '../catalog-cache.js'
import type { Context } from '../context.js'
import { defineCommand } from '../define.js'
import { modelOption } from '../gen-options.js'
import { ChargedError, execute, type PreparedGeneration, prepare } from '../generate.js'
import { findNewestMatch, type LedgerEntry, readLedger } from '../ledger.js'
import { fancy, formatUsd, liveLine, warn } from '../output.js'
import { bar, code, fitTable, pathLink, type Role, style } from '../pretty.js'
import { priceColumn, priceSchema, priceText } from './price.js'

const METER_CELLS = 24
const STATUSES = ['ok', 'failed', 'skipped_budget', 'skipped_resumed', 'not_run'] as const

const reportSchema = z.strictObject({
  batch_id: z.string(),
  /** Null with --no-budget. */
  budget_usd: z.number().nullable(),
  spent_usd: z.number(),
  stopped: z
    .strictObject({ code: z.enum([...ERROR_CODES, 'unknown_cost']), message: z.string() })
    .nullable(),
  rows: z.array(
    z.strictObject({
      row: z.number().int(),
      status: z.enum(STATUSES),
      id: z.string().nullable(),
      paths: z.array(z.string()),
      cost_usd: z.number().nullable(),
      price: priceSchema.nullable(),
      error: z
        .strictObject({
          code: z.enum(ERROR_CODES),
          message: z.string(),
          /** Only when OpenRouter said how long to wait (`Retry-After`). */
          retry_after_seconds: z.number().optional(),
        })
        .nullable(),
    }),
  ),
})

const dryRunSchema = z.strictObject({
  rows: z.array(z.strictObject({ row: z.number().int(), price: priceSchema })),
  total: priceSchema,
})

type Report = z.infer<typeof reportSchema>
type DryRun = z.infer<typeof dryRunSchema>
type ReportRow = Report['rows'][number]

/** What a row run in this batch left behind. */
interface Ran {
  id: string
  paths: string[]
  cost: number | null
}

export const batch = defineCommand({
  name: 'batch',
  summary: 'Generate every row of a CSV or JSONL file, within a budget',
  args: [
    {
      name: 'file',
      required: true,
      description:
        'A .csv (with a header row) or .jsonl file; columns: prompt, model, the gen options, ref, out',
    },
  ],
  options: [
    {
      name: 'budget',
      flag: '--budget <usd>',
      type: 'number',
      description: 'The most this run may spend, in USD (this or --no-budget is required)',
    },
    {
      name: 'noBudget',
      flag: '--no-budget',
      type: 'boolean',
      description:
        "Run without a cap: the only limit is the key's spending limit on OpenRouter. Agents: use it only when the user asks",
    },
    { ...modelOption, description: 'The model for rows without one (default: COSMION_MODEL)' },
    {
      name: 'out',
      flag: '--out <folder>',
      type: 'string',
      description: 'The folder for rows without an out (default: the current folder)',
    },
    {
      name: 'concurrency',
      flag: '--concurrency <n>',
      type: 'integer',
      description: 'How many rows run at once, 1 to 8 (default: 2)',
    },
    {
      name: 'force',
      flag: '--force',
      type: 'boolean',
      description: 'Replace files that already exist',
    },
    {
      name: 'dryRun',
      flag: '--dry-run',
      type: 'boolean',
      description: 'Check every row and show the prices, without spending anything',
    },
    {
      name: 'resume',
      flag: '--resume <batch-id>',
      type: 'string',
      description: 'Continue a batch: rows it already saved are skipped, its spending counts',
    },
  ],
  output: z.union([reportSchema, dryRunSchema]),
  async run(input, ctx) {
    const budget = input.dryRun ? null : checkBudget(input.budget, input.noBudget)
    const concurrency = input.concurrency ?? 2
    if (concurrency < 1 || concurrency > 8) {
      throw new CosmionError('usage', '--concurrency must be from 1 to 8.')
    }
    const rows = await readBatchFile(ctx, input.file)
    const ledger = await readLedger(ctx)

    let batchId: string
    let earlier: LedgerEntry[] = []
    if (input.resume !== undefined) {
      batchId = input.resume
      earlier = ledger.filter((entry) => entry.batch_id === batchId)
      if (earlier.length === 0) {
        throw new CosmionError('not_found', `No batch "${batchId}" in the ledger.`)
      }
    } else {
      const batchIds = new Set(ledger.map((entry) => entry.batch_id))
      batchId = newId((id) => batchIds.has(id))
    }
    // FR-076: a row is done once it saved at least one image.
    const done = new Map<number, LedgerEntry>()
    for (const entry of earlier) {
      if (entry.row !== null && entry.images.length > 0) done.set(entry.row, entry)
    }

    const prepared = await prepareRows(ctx, input, rows, done, batchId, ledger)
    const prices = new Map<number, PriceResult>()
    for (const [row, generation] of prepared) {
      const { model, settings, refs } = generation
      const lastMatch = findNewestMatch(ledger, model.id, settings, refs.length)
      prices.set(row, priceOf(model, { settings, refCount: refs.length }, lastMatch ?? null))
    }
    if (input.dryRun) return { data: dryRun(prices) }

    const resumeAdvice = `cosmion batch ${input.file} --no-budget --resume ${batchId}`
    const { spent, groupCosts } = await earlierSpending(ctx, earlier, ledger, budget, resumeAdvice)

    ctx.stderr.write(
      fancy(ctx)
        ? `${style('bold', `Batch ${batchId}`)}  ${style('dim', `${prepared.size} of ${rows.length} rows · continue with --resume ${batchId}`)}\n`
        : `Batch ${batchId}: ${prepared.size} of ${rows.length} rows to run. If it stops, continue with --resume ${batchId}.\n`,
    )
    if (budget === null) {
      warn(ctx, "No budget: this batch's only cap is your key's spending limit on OpenRouter.")
    }

    const groups = new Map<number, string>()
    const scheduled = [...prepared].map(([row, generation]) => {
      const group = groupOf(generation.model.id, generation.settings, generation.refs.length)
      groups.set(row, group)
      const listed = prices.get(row)?.cost_usd ?? null
      const earlierCost = groupCosts.get(group)
      return {
        row,
        group,
        price: earlierCost === undefined ? listed : Math.max(listed ?? 0, earlierCost),
      }
    })

    const ran = new Map<number, Ran>()
    // Only for the progress line: `schedule` keeps the count that decides anything.
    let finished = 0
    let spentNow = toNano(spent)
    const progress = liveLine(ctx, () => {
      const count = `${finished} of ${prepared.size} rows`
      return `${count}  ${spendingText(toUsd(spentNow), budget)}`
    })
    const rowCtx = { ...ctx, stderr: progress.stream }
    let result: Awaited<ReturnType<typeof schedule>>
    try {
      result = await schedule({
        rows: scheduled,
        budget,
        spent,
        concurrency,
        unknownCostMessage: `A row came back without its cost and had no known price, so the budget can't be tracked; no further rows were started. To continue without a cap: ${resumeAdvice}`,
        runRow: async (row) => {
          const rowResult = await runRow(rowCtx, prepared.get(row) as PreparedGeneration, ran)
          finished++
          if (rowResult.costUsd !== null) spentNow += toNano(rowResult.costUsd)
          return rowResult
        },
      })
    } finally {
      progress.stop()
    }

    const outcomes = new Map(result.rows.map((outcome) => [outcome.row, outcome]))
    const reportRows = rows.map((row): ReportRow => {
      const entry = done.get(row.row)
      if (entry) {
        return {
          row: row.row,
          status: 'skipped_resumed',
          id: entry.id,
          paths: entry.images.map((image) => image.path),
          cost_usd: entry.cost_usd,
          price: null,
          error: null,
        }
      }
      const outcome = outcomes.get(row.row)
      const listed = prices.get(row.row) ?? null
      const scheduledPrice = outcome?.price ?? null
      const raised =
        listed !== null && scheduledPrice !== null && scheduledPrice !== listed.cost_usd
          ? {
              kind: 'estimate' as const,
              cost_usd: scheduledPrice,
              notes: ['From the actual cost of an earlier row with the same model and settings.'],
            }
          : listed
      const status: RowStatus = outcome?.status ?? 'not_run'
      const own = ran.get(row.row)
      return {
        row: row.row,
        status,
        id: own?.id ?? null,
        paths: own?.paths ?? [],
        cost_usd: own?.cost ?? null,
        price: raised,
        error: outcome?.result?.error ?? null,
      }
    })

    const report: Report = {
      batch_id: batchId,
      budget_usd: budget,
      spent_usd: result.spent,
      stopped: result.stopped,
      rows: reportRows,
    }
    summarize(ctx, report)
    if (result.stopped?.code === 'credits') return { data: report, exitCode: 4 }
    if (result.stopped?.code === 'auth') return { data: report, exitCode: 3 }
    const allDone = reportRows.every(
      (row) => row.status === 'ok' || row.status === 'skipped_resumed',
    )
    return allDone ? { data: report } : { data: report, exitCode: 8 }
  },
  text: (data) =>
    'total' in data ? dryRunText(data) : data.rows.flatMap((row) => row.paths).join('\n'),
  pretty: (data, columns) =>
    'total' in data
      ? dryRunPretty(data, columns)
      : data.rows
          .flatMap((row) => row.paths)
          .map((path) => pathLink(path))
          .join('\n'),
})

/** The budget in USD, or null for --no-budget; exactly one must be given (FR-071). */
function checkBudget(budget: number | undefined, noBudget: boolean): number | null {
  if (budget === undefined && !noBudget) {
    throw new CosmionError(
      'usage',
      'Pass --budget <usd> to cap what this batch spends, or --no-budget to run without a cap.',
    )
  }
  if (budget !== undefined && noBudget) {
    throw new CosmionError('usage', 'Pass either --budget or --no-budget, not both.')
  }
  if (budget === undefined) return null
  if (!(budget > 0)) throw new CosmionError('usage', '--budget must be a number above 0.')
  return budget
}

/**
 * Prepares every row that will run, as gen would (FR-072). Every bad row is reported in
 * one usage error, including two rows writing the same path.
 */
async function prepareRows(
  ctx: Context,
  input: { model: string | undefined; out: string | undefined; force: boolean; file: string },
  rows: readonly BatchRow[],
  done: ReadonlyMap<number, LedgerEntry>,
  batchId: string,
  ledger: readonly LedgerEntry[],
): Promise<Map<number, PreparedGeneration>> {
  // --out names a folder for rows without their own out, even one that doesn't exist yet.
  const folder = input.out === undefined || /[\\/]$/.test(input.out) ? input.out : `${input.out}/`
  const takenIds = new Set(ledger.map((entry) => entry.id))
  const problems: string[] = []
  const prepared = new Map<number, PreparedGeneration>()
  const writers = new Map<string, number>()

  for (const row of rows) {
    if (done.has(row.row)) continue
    let generation: PreparedGeneration
    try {
      generation = await prepare(
        ctx,
        {
          prompt: row.prompt,
          model: row.model ?? input.model,
          options: row.options,
          refs: row.refs,
          out: row.out ?? folder,
          force: input.force,
        },
        takenIds,
      )
    } catch (error) {
      // A row's own problem; anything else (no key, OpenRouter down) stops the batch as is.
      if (error instanceof CosmionError && (error.code === 'usage' || error.code === 'not_found')) {
        problems.push(`Row ${row.row}: ${error.message}`)
        continue
      }
      throw error
    }
    const count = typeof generation.settings.n === 'number' ? generation.settings.n : 1
    for (let k = 1; k <= count; k++) {
      // Without the extension: default names get theirs only once the image is back.
      const path = generation.paths.pathFor(k, '')
      const other = writers.get(path)
      if (other !== undefined) problems.push(`Rows ${other} and ${row.row} both write ${path}.`)
      else writers.set(path, row.row)
    }
    prepared.set(row.row, { ...generation, batch: { id: batchId, row: row.row } })
  }

  if (problems.length > 0) {
    throw new CosmionError(
      'usage',
      `Nothing was generated: ${input.file} has rows that can't run.\n${problems.map((p) => `  ${p}`).join('\n')}`,
    )
  }
  return prepared
}

/** Rows with the same model and settings share a price (FR-073). */
function groupOf(model: string, settings: Settings, refCount: number): string {
  return `${model} ${sameSettingsKey(settings, refCount)}`
}

/**
 * What a resumed batch already spent, and the highest actual cost seen in each group
 * (FR-076). An entry without a cost counts its price; if that is unknown too, --budget
 * can't be honoured (FR-073a).
 */
async function earlierSpending(
  ctx: Context,
  earlier: readonly LedgerEntry[],
  ledger: readonly LedgerEntry[],
  budget: number | null,
  resumeAdvice: string,
): Promise<{ spent: number; groupCosts: Map<string, number> }> {
  let spent = 0
  const groupCosts = new Map<string, number>()
  for (const entry of earlier) {
    if (entry.cost_usd === null) continue
    spent += toNano(entry.cost_usd)
    const group = groupOf(entry.model, entry.settings, entry.references.length)
    groupCosts.set(group, Math.max(groupCosts.get(group) ?? 0, entry.cost_usd))
  }
  for (const entry of earlier) {
    if (entry.cost_usd !== null) continue
    const group = groupOf(entry.model, entry.settings, entry.references.length)
    const price = groupCosts.get(group) ?? (await listedPrice(ctx, entry, ledger))
    if (price !== null) {
      spent += toNano(price)
    } else if (budget !== null) {
      throw new CosmionError(
        'usage',
        `Row ${entry.row} of batch ${entry.batch_id} was charged an unknown amount, so --budget can't be tracked. To continue without a cap: ${resumeAdvice}`,
      )
    }
  }
  return { spent: toUsd(spent), groupCosts }
}

/** An earlier entry's price as it was when the row started; null when unknown. */
async function listedPrice(
  ctx: Context,
  entry: LedgerEntry,
  ledger: readonly LedgerEntry[],
): Promise<number | null> {
  let model: Awaited<ReturnType<typeof loadModel>>['model']
  try {
    ;({ model } = await loadModel(ctx, entry.model))
  } catch (error) {
    if (error instanceof CosmionError && error.code === 'not_found') return null
    throw error
  }
  const request = { settings: entry.settings, refCount: entry.references.length }
  // The price the row had when it started: from entries written before it, not itself.
  const before = ledger.slice(0, ledger.indexOf(entry))
  const lastMatch = findNewestMatch(before, entry.model, entry.settings, entry.references.length)
  return priceOf(model, request, lastMatch ?? null).cost_usd
}

/** Runs one row: generate, save, record (FR-074), and say what it cost. */
async function runRow(
  ctx: Context,
  generation: PreparedGeneration,
  ran: Map<number, Ran>,
): Promise<RowResult> {
  const row = generation.batch?.row as number
  try {
    const entry = await execute(ctx, generation)
    const paths = entry.images.map((image) => image.path)
    ran.set(row, { id: entry.id, paths, cost: entry.cost_usd })
    const cost = entry.cost_usd === null ? 'unknown cost' : formatUsd(entry.cost_usd)
    ctx.stderr.write(
      fancy(ctx)
        ? `${rowMark('ok', '✓', row)}  ${paths.map((path) => pathLink(path, basename(path))).join(', ')}  ${cost}\n`
        : `Row ${row}: ${paths.join(', ')} (${cost})\n`,
    )
    return { charged: true, costUsd: entry.cost_usd, error: null }
  } catch (error) {
    if (ctx.signal.aborted || !(error instanceof CosmionError)) throw error
    ctx.stderr.write(
      fancy(ctx)
        ? `${rowMark('error', '✗', row)}  ${code(error.message)}\n`
        : `Row ${row} failed: ${error.message}\n`,
    )
    const failure = {
      code: error.code,
      message: error.message,
      ...(error.retryAfterSeconds === null ? {} : { retry_after_seconds: error.retryAfterSeconds }),
    }
    if (error instanceof ChargedError) {
      const { entry } = error
      ran.set(row, {
        id: entry.id,
        paths: entry.images.map((image) => image.path),
        cost: entry.cost_usd,
      })
      return { charged: true, costUsd: entry.cost_usd, error: failure }
    }
    // Cosmion's own timeout: the provider may have charged an amount nobody knows (FR-017).
    const charged = error.code === 'upstream' && !error.retryable
    return { charged, costUsd: null, error: failure }
  }
}

function rowMark(role: Role, mark: string, row: number): string {
  return `${style(role, mark)} ${style('dim', String(row).padStart(2))}`
}

/** `━━─────  $0.08 of $1.00`, or just what was spent with --no-budget. */
function spendingText(spent: number, budget: number | null): string {
  return budget === null
    ? `${style('bold', formatUsd(spent))} ${style('dim', 'spent')}`
    : `${bar(spent, budget, METER_CELLS)}  ${style('bold', formatUsd(spent))} ${style('dim', `of ${formatUsd(budget)}`)}`
}

function dryRun(prices: ReadonlyMap<number, PriceResult>): DryRun {
  const rows = [...prices].map(([row, price]) => ({ row, price }))
  let known = 0
  let unknown = 0
  for (const { price } of rows) {
    if (price.cost_usd === null) unknown++
    else known += toNano(price.cost_usd)
  }
  const kind = weakestKind('exact', ...rows.map((row) => row.price.kind))
  const total: PriceResult =
    unknown > 0
      ? {
          kind: 'unknown',
          cost_usd: null,
          notes: [
            `Rows with a known price: ${formatUsd(toUsd(known))}.`,
            `${unknown} ${unknown === 1 ? 'row has' : 'rows have'} an unknown price.`,
          ],
        }
      : { kind, cost_usd: toUsd(known), notes: [] }
  return { rows, total }
}

function dryRunText(data: DryRun): string {
  return [
    ...data.rows.map((row) => `Row ${row.row}  ${priceText(row.price)}`),
    `Total  ${priceText(data.total)}`,
    ...data.total.notes.map((note) => `  ${note}`),
  ].join('\n')
}

function dryRunPretty(data: DryRun, columns: number): string {
  const rows = [...data.rows, { row: 'Total', price: data.total }]
  return [
    fitTable<(typeof rows)[number]>(
      [{ header: 'row', value: ({ row }) => String(row), right: true }, priceColumn],
      rows,
      columns,
      { total: true },
    ),
    ...data.total.notes.map((note) => style('dim', note)),
  ].join('\n')
}

/** One line on stderr: what was spent and what happened to the rows, and why it stopped. */
function summarize(ctx: Context, report: Report): void {
  if (report.stopped) warn(ctx, `Stopped: ${report.stopped.message}`)
  const counts = new Map<string, number>()
  for (const row of report.rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1)
  if (fancy(ctx)) {
    const roles: Partial<Record<string, Role>> = { ok: 'ok', failed: 'error' }
    const parts = [...counts].map(([status, count]) =>
      style(roles[status] ?? 'dim', `${count} ${status.replaceAll('_', ' ')}`),
    )
    ctx.stderr.write(
      `\n${spendingText(report.spent_usd, report.budget_usd)}  ${parts.join('  ')}\n`,
    )
    return
  }
  const parts = [...counts].map(([status, count]) => `${count} ${status}`)
  const budget = report.budget_usd === null ? '' : ` of ${formatUsd(report.budget_usd)}`
  ctx.stderr.write(`Spent ${formatUsd(report.spent_usd)}${budget}: ${parts.join(', ')}.\n`)
}
