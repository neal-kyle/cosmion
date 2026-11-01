import type { Context } from './context.js'
import { InterruptedError } from './hidden-input.js'
import { cut, style } from './pretty.js'

export interface PickerRow {
  label: string
  detail: string
}

interface PickOptions {
  title: string
  /** What the finished question says, e.g. `✓ Where  All projects`. */
  doneLabel: string
  rows: readonly PickerRow[]
  /** Several rows, ticked with Space. Otherwise Enter takes the row under the cursor. */
  multiple?: boolean
}

const UP = '\x1b[A'
const DOWN = '\x1b[B'
const CTRL_C = '\x03'
const CTRL_D = '\x04'
const HIDE_CURSOR = '\x1b[?25l'
const SHOW_CURSOR = '\x1b[?25h'

/**
 * Questions answered with the arrow keys, on a terminal. Drawn on stderr, as stdout is for
 * data. Call `close` when done, or the process waits on the terminal and never exits.
 */
export function createPicker(ctx: Context): {
  /** The chosen rows' indexes; empty if input ended first. Ctrl-C throws InterruptedError. */
  pick(options: PickOptions): Promise<number[]>
  close(): void
} {
  const { stdin } = ctx
  const pending: (string | null)[] = []
  let waiting: ((key: string | null) => void) | undefined

  const deliver = (key: string | null) => {
    if (waiting) {
      waiting(key)
      waiting = undefined
    } else {
      pending.push(key)
    }
  }
  const onData = (chunk: Buffer | string) => {
    let text = String(chunk)
    while (text) {
      // An arrow key arrives as three characters; several keys can share one chunk.
      const length = text.startsWith('\x1b[') ? 3 : 1
      deliver(text.slice(0, length))
      text = text.slice(length)
    }
  }
  const onEnd = () => deliver(null)
  const onAbort = () => deliver(CTRL_C)
  const nextKey = () =>
    new Promise<string | null>((resolve) => {
      if (pending.length > 0) resolve(pending.shift() ?? null)
      else waiting = resolve
    })

  stdin.setRawMode?.(true)
  stdin.on('data', onData)
  stdin.on('end', onEnd)
  ctx.signal.addEventListener('abort', onAbort)
  if (ctx.signal.aborted) onAbort()

  return {
    async pick({ title, doneLabel, rows, multiple = false }) {
      const columns = (ctx.stderr.columns ?? 80) - 1
      const labelWidth = Math.max(...rows.map((row) => row.label.length))
      const ticked = new Set<number>()
      let cursor = 0
      let warning = false
      let drawn = 0

      const render = () => {
        const lines = [`${style('accent', '?')} ${style('bold', cut(title, columns - 2))}`]
        rows.forEach((row, index) => {
          const here = index === cursor
          const pointer = here ? style('accent', '❯') : ' '
          const box = !multiple
            ? ''
            : ticked.has(index)
              ? `${style('ok', '◉')} `
              : `${style('dim', '◯')} `
          const prefix = multiple ? 4 : 2
          const label = row.label.padEnd(labelWidth)
          const room = columns - prefix - labelWidth - 2
          lines.push(
            `${pointer} ${box}${here ? style('bold', label) : label}  ${style('dim', cut(row.detail, room))}`,
          )
        })
        const hint = multiple ? '↑↓ move · space select · enter confirm' : '↑↓ move · enter confirm'
        lines.push(
          warning
            ? `  ${style('warn', '!')} Select at least one with space`
            : style('dim', `  ${hint}`),
        )
        return lines
      }
      const erase = () => (drawn > 0 ? `\x1b[${drawn}A\r\x1b[J` : '')
      const draw = () => {
        const lines = render()
        ctx.stderr.write(`${erase()}${lines.join('\n')}\n`)
        drawn = lines.length
      }

      ctx.stderr.write(HIDE_CURSOR)
      try {
        draw()
        while (true) {
          const key = await nextKey()
          if (key === CTRL_C) {
            ctx.stderr.write(erase())
            throw new InterruptedError()
          }
          if (key === null || key === CTRL_D) {
            ctx.stderr.write(erase())
            return multiple ? [...ticked].sort((a, b) => a - b) : []
          }
          if (key === UP) cursor = (cursor - 1 + rows.length) % rows.length
          else if (key === DOWN) cursor = (cursor + 1) % rows.length
          else if (key === ' ' && multiple) {
            warning = false
            if (!ticked.delete(cursor)) ticked.add(cursor)
          } else if (key === '\r' || key === '\n') {
            const chosen = multiple ? [...ticked].sort((a, b) => a - b) : [cursor]
            if (chosen.length > 0) {
              const names = chosen.map((index) => rows[index]?.label).join(', ')
              ctx.stderr.write(
                `${erase()}${style('ok', '✓')} ${style('dim', doneLabel)}  ${names}\n`,
              )
              return chosen
            }
            warning = true
          } else continue
          draw()
        }
      } finally {
        ctx.stderr.write(SHOW_CURSOR)
      }
    },
    close() {
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      ctx.signal.removeEventListener('abort', onAbort)
      stdin.setRawMode?.(false)
      // Stop reading, or the process waits on the terminal and never exits.
      stdin.pause()
    },
  }
}
