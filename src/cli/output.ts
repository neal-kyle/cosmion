import { z } from 'zod'
import { ERROR_CODES } from '../core/errors.js'
import type { PriceKind } from '../core/pricing.js'
import type { Context, OutStream } from './context.js'
import { code, cut, style } from './pretty.js'

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
  if (fancy(ctx)) ctx.stderr.write(`${style('warn', '!')} ${code(message)}\n`)
  else ctx.stderr.write(`warning: ${message}\n`)
}

/**
 * Whether a stream gets styling: colors, animation and tables fitted to the window. Only
 * on a terminal, and never with NO_COLOR (FR-042). Everything else, pipes and agents
 * included, gets the plain text.
 */
export function fancy(ctx: Context, stream: OutStream = ctx.stderr): boolean {
  return stream.isTTY && !ctx.env.NO_COLOR && ctx.env.TERM !== 'dumb'
}

/**
 * A line kept at the bottom of a stream and redrawn while something slow runs. Text written
 * to the returned `stream` appears above it. Draws nothing off a terminal.
 */
export function liveLine(
  ctx: Context,
  render: (room: number) => string,
  stream: OutStream = ctx.stderr,
): { stream: OutStream; stop(): void } {
  if (!fancy(ctx, stream)) return { stream, stop() {} }
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  const clear = '\r\x1b[K'
  // A line that wraps can't be redrawn in place, so it must stay inside the window.
  const room = (stream.columns ?? 80) - 3
  let frame = 0
  const line = () => `${style('accent', frames[frame++ % frames.length] ?? '')} ${render(room)}`
  stream.write(line())
  const timer = setInterval(() => stream.write(clear + line()), 80)
  timer.unref()
  return {
    stream: { ...stream, write: (text) => stream.write(clear + text + line()) },
    stop() {
      clearInterval(timer)
      stream.write(clear)
    },
  }
}

/** What a prompt asks: `plain` off a terminal, otherwise `? text  hint › `. */
export function question(ctx: Context, plain: string, text: string, hint?: string): string {
  if (!fancy(ctx)) return plain
  const after = hint ? `  ${style('dim', hint)}` : ''
  return `${style('accent', '?')} ${style('bold', text)}${after} ${style('accent', '›')} `
}

/** A spinner on stderr with the time so far; draws nothing off a terminal. */
export function spinner(ctx: Context, label: string): { stop(): void } {
  const started = Date.now()
  return liveLine(ctx, (room) => {
    const seconds = Math.floor((Date.now() - started) / 1000)
    const elapsed = seconds > 0 ? `  ${seconds}s` : ''
    return cut(label, room - elapsed.length) + style('dim', elapsed)
  })
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
    columns: stream.columns,
  }
}

/** Left-aligned columns, two spaces apart. */
export function table(rows: string[][]): string {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, column) => {
      widths[column] = Math.max(widths[column] ?? 0, cell.length)
    })
  }
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
        )
        .join('  '),
    )
    .join('\n')
}

/** An ISO time as local `2026-10-17 14:03`, for text output. JSON keeps the ISO string. */
export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
