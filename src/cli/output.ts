import { styleText } from 'node:util'
import { z } from 'zod'
import { ERROR_CODES } from '../core/errors.js'
import type { PriceKind } from '../core/pricing.js'
import type { Context, OutStream } from './context.js'

/** What `--json` prints on failure (FR-041). */
export const errorOutputSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    retryable: z.boolean(),
  }),
})

export function printJson(ctx: Context, value: unknown): void {
  ctx.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function printText(ctx: Context, text: string): void {
  if (text === '') return
  ctx.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
}

export function warn(ctx: Context, message: string): void {
  ctx.stderr.write(`${paint(ctx, 'yellow', 'warning:')} ${message}\n`)
}

/** Colors and animation only on a terminal, and never with NO_COLOR (FR-042). */
function fancy(ctx: Context): boolean {
  return ctx.stderr.isTTY && !ctx.env.NO_COLOR
}

/** Colors text for stderr. */
export function paint(ctx: Context, format: Parameters<typeof styleText>[0], text: string): string {
  // We decide about color ourselves; newer Node versions would otherwise check stdout.
  return fancy(ctx) ? styleText(format, text, { validateStream: false }) : text
}

/** A spinner on stderr while something slow runs; draws nothing off a terminal. */
export function spinner(ctx: Context, label: string): { stop(): void } {
  if (!fancy(ctx)) return { stop() {} }
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  let frame = 0
  const draw = () => ctx.stderr.write(`\r${frames[frame++ % frames.length]} ${label}`)
  draw()
  const timer = setInterval(draw, 80)
  timer.unref()
  return {
    stop() {
      clearInterval(timer)
      ctx.stderr.write('\r\x1b[K')
    },
  }
}

/**
 * A price for text output (FR-037): under $1, three significant figures without trailing
 * zeros ($0.04, $0.0387); from $1, two decimals ($12.34). `≤` marks a ceiling, `~` an
 * estimate. JSON keeps the full number.
 */
export function formatUsd(usd: number, kind?: PriceKind): string {
  const prefix = kind === 'at_most' ? '≤' : kind === 'estimate' ? '~' : ''
  return `${prefix}$${amount(usd)}`
}

function amount(usd: number): string {
  if (usd === 0) return '0'
  if (usd < 1) {
    const decimals = 2 - Math.floor(Math.log10(usd))
    const text = usd.toFixed(decimals)
    // Something like 0.9996 rounds up to a dollar, and is shown like one.
    if (Number(text) < 1) return text.replace(/0+$/, '').replace(/\.$/, '')
  }
  return usd.toFixed(2)
}

/**
 * Replaces the key in everything written to the stream (FR-049). Nothing should format
 * it in the first place; this catches an error body that echoes a header.
 */
export function redactKey(stream: OutStream, env: Context['env']): OutStream {
  const key = env.OPENROUTER_API_KEY?.trim()
  // A real key is about 70 characters; a short value would garble every message.
  if (!key || key.length < 8) return stream
  return {
    write: (text) => stream.write(text.replaceAll(key, '[redacted]')),
    isTTY: stream.isTTY,
  }
}
