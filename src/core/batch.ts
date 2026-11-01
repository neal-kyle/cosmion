import type { ErrorCode } from './errors.js'
import { toNano, toUsd } from './money.js'

/** A batch row as the scheduler sees it. */
export interface ScheduledRow {
  /** 1-based, in file order. */
  row: number
  /** Rows with the same model and settings share a price (FR-073). */
  group: string
  /** USD for the whole row; null when unknown. */
  price: number | null
}

/** What running a row came to. */
export interface RowResult {
  /** OpenRouter answered (or may have charged), so the row costs `costUsd`. */
  charged: boolean
  /** The actual cost; null when OpenRouter didn't say. */
  costUsd: number | null
  error: { code: ErrorCode; message: string } | null
}

export type RowStatus = 'ok' | 'failed' | 'skipped_budget' | 'not_run'

export interface RowOutcome {
  row: number
  status: RowStatus
  /** The price the row was started (or skipped) at, after any raise; null when unknown. */
  price: number | null
  result: RowResult | null
}

export interface Stopped {
  code: ErrorCode | 'unknown_cost'
  message: string
}

export interface ScheduleInput {
  rows: readonly ScheduledRow[]
  /** USD; null for --no-budget. */
  budget: number | null
  /** What this batch already spent (--resume). */
  spent: number
  concurrency: number
  /** Why the batch stopped when a row with no price came back with no cost (FR-073a). */
  unknownCostMessage: string
  runRow(row: number): Promise<RowResult>
}

export interface ScheduleResult {
  rows: RowOutcome[]
  /** Everything spent, including `spent` from the input. */
  spent: number
  stopped: Stopped | null
}

/**
 * Runs the rows in file order within the budget (FR-073, FR-073a, FR-075). A known-price
 * row starts when its price fits in the budget minus what is spent and what is running; an
 * unknown-price row runs alone, and its cost then prices the rest of its group. A row that
 * costs more than its price raises its group's price. Files and the ledger are `runRow`'s
 * business. If `runRow` throws (Ctrl-C), running rows finish and the error is rethrown.
 */
export async function schedule(input: ScheduleInput): Promise<ScheduleResult> {
  const budget = input.budget === null ? null : toNano(input.budget)
  let spent = toNano(input.spent)
  const groupPrices = new Map<string, number | null>()
  // Rows in a group are priced alike, so the first row's price is the group's.
  for (const row of input.rows) {
    if (!groupPrices.has(row.group)) groupPrices.set(row.group, nano(row.price))
  }

  const outcomes = new Map<number, RowOutcome>()
  /** Running rows: their price (nano, null when unknown) and the promise that settles them. */
  const running = new Map<number, { price: number | null; done: Promise<void> }>()
  let stopped: Stopped | null = null
  let thrown: { error: unknown } | null = null

  const stop = (reason: Stopped) => {
    stopped ??= reason
  }

  const finish = (row: ScheduledRow, price: number | null, result: RowResult) => {
    running.delete(row.row)
    if (result.charged) {
      if (result.costUsd !== null) {
        const cost = toNano(result.costUsd)
        spent += cost
        const groupPrice = groupPrices.get(row.group) ?? null
        if (groupPrice === null || cost > groupPrice) groupPrices.set(row.group, cost)
      } else if (price !== null) {
        spent += price
      } else if (budget !== null) {
        stop({ code: 'unknown_cost', message: input.unknownCostMessage })
      }
    }
    if (result.error && (result.error.code === 'credits' || result.error.code === 'auth')) {
      stop({ code: result.error.code, message: result.error.message })
    }
    outcomes.set(row.row, {
      row: row.row,
      status: result.error ? 'failed' : 'ok',
      price: usd(price),
      result,
    })
  }

  const start = (row: ScheduledRow, price: number | null) => {
    const done = input.runRow(row.row).then(
      (result) => finish(row, price, result),
      (error: unknown) => {
        running.delete(row.row)
        thrown ??= { error }
        outcomes.set(row.row, { row: row.row, status: 'not_run', price: usd(price), result: null })
      },
    )
    running.set(row.row, { price, done })
  }

  const waitForOne = () => Promise.race([...running.values()].map((entry) => entry.done))

  for (const row of input.rows) {
    while (true) {
      const price = groupPrices.get(row.group) ?? null
      if (stopped || thrown) {
        outcomes.set(row.row, { row: row.row, status: 'not_run', price: usd(price), result: null })
        break
      }
      if (running.size >= input.concurrency) {
        await waitForOne()
        continue
      }
      if (budget === null) {
        start(row, price)
        break
      }
      if (price === null) {
        // Unknown: only alone, and only while there is room left (FR-073).
        if (running.size > 0) {
          await waitForOne()
          continue
        }
        if (spent < budget) {
          start(row, price)
          await waitForOne()
        } else {
          outcomes.set(row.row, {
            row: row.row,
            status: 'skipped_budget',
            price: null,
            result: null,
          })
        }
        break
      }
      let reserved = 0
      for (const entry of running.values()) reserved += entry.price ?? 0
      if (price <= budget - spent - reserved) {
        start(row, price)
        break
      }
      if (running.size > 0) {
        await waitForOne()
        continue
      }
      outcomes.set(row.row, {
        row: row.row,
        status: 'skipped_budget',
        price: usd(price),
        result: null,
      })
      break
    }
  }
  await Promise.all([...running.values()].map((entry) => entry.done))

  if (thrown) throw (thrown as { error: unknown }).error
  return {
    rows: input.rows.map((row) => outcomes.get(row.row) as RowOutcome),
    spent: toUsd(spent),
    stopped,
  }
}

function nano(usd: number | null): number | null {
  return usd === null ? null : toNano(usd)
}

function usd(nano: number | null): number | null {
  return nano === null ? null : toUsd(nano)
}
