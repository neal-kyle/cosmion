import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters, styleText } from 'node:util'

/** Only colors the terminal's theme defines, so the output follows the person's theme. */
const ROLES = {
  dim: ['dim'],
  bold: ['bold'],
  accent: ['blueBright'],
  strong: ['bold', 'blueBright'],
  ok: ['green'],
  warn: ['yellow'],
  error: ['red'],
  path: ['dim', 'underline'],
} as const satisfies Record<string, readonly Parameters<typeof styleText>[0][]>

export type Role = keyof typeof ROLES

/** Styles text unconditionally: callers only run on a terminal (`fancy` in output.ts). */
export function style(role: Role, text: string): string {
  // We decide about color ourselves; newer Node versions would otherwise check stdout.
  return ROLES[role].reduce<string>(
    (result, format) => styleText(format, result, { validateStream: false }),
    text,
  )
}

/** `cosmion models` in a message becomes colored, without the backticks. */
export function code(message: string): string {
  return message.replace(/`([^`]+)`/g, (_, command: string) => style('accent', command))
}

/** A path you can click in terminals that support it; others just show the text. */
export function pathLink(path: string, text = path): string {
  return `\x1b]8;;${pathToFileURL(path).href}\x1b\\${style('path', text)}\x1b]8;;\x1b\\`
}

// CJK and emoji take two columns. Combining marks are rare enough in prompts to ignore.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u

/** How many columns text takes, ignoring styling. */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of stripVTControlCharacters(text)) width += WIDE.test(char) ? 2 : 1
  return width
}

/** Shortens plain text to `width` columns, ending in `…`. */
export function cut(text: string, width: number): string {
  if (displayWidth(text) <= width) return text
  let result = ''
  let used = 0
  for (const char of text) {
    used += displayWidth(char)
    if (used > width - 1) break
    result += char
  }
  return `${result}…`
}

function pad(text: string, width: number, right = false): string {
  const fill = ' '.repeat(Math.max(0, width - displayWidth(text)))
  return right ? fill + text : text + fill
}

/** Breaks plain text at spaces so each line fits `width`. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && displayWidth(`${line} ${word}`) > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  return [...lines, line]
}

/** `label  value` lines with the values lined up; wrapped values stay in their column. */
export function fields(rows: readonly (readonly [string, string])[], columns: number): string[] {
  const width = Math.max(...rows.map(([label]) => label.length)) + 2
  return rows.flatMap(([label, value]) => {
    const [first, ...rest] = value.includes('\x1b') ? [value] : wrap(value, columns - width)
    return [
      `${style('dim', label.padEnd(width))}${first}`,
      ...rest.map((line) => ' '.repeat(width) + line),
    ]
  })
}

/** A meter: `━━━───`. Anything above nothing shows at least one cell. */
export function bar(part: number, whole: number, cells: number): string {
  const share = whole > 0 ? Math.min(part / whole, 1) : 0
  const filled = part > 0 ? Math.max(1, Math.round(share * cells)) : 0
  return style('accent', '━'.repeat(filled)) + style('dim', '─'.repeat(cells - filled))
}

export interface Column<Row> {
  header: string
  value(row: Row): string
  role?(row: Row): Role | undefined
  /** A file the cell links to. */
  path?(row: Row): string | undefined
  right?: boolean
  /** Removed when the window is too narrow, highest number first. */
  drop?: number
  /** Shortened down to this width when the table is too wide. */
  min?: number
}

/**
 * A table that fits the window, for a person to read. `total` sets the last row apart.
 * Without a terminal, `table()` in output.ts prints everything for other programs.
 */
export function fitTable<Row>(
  columns: readonly Column<Row>[],
  rows: readonly Row[],
  windowWidth: number,
  { total = false } = {},
): string {
  const GAP = 2
  let kept = columns.map((column) => ({
    ...column,
    width: Math.max(column.header.length, ...rows.map((row) => displayWidth(column.value(row)))),
  }))
  const size = () => kept.reduce((sum, { width }) => sum + width, GAP * (kept.length - 1))
  const smallest = () =>
    kept.reduce(
      (sum, { width, min }) => sum + Math.min(width, min ?? width),
      GAP * (kept.length - 1),
    )

  // A column goes only if shortening the others couldn't make the table fit.
  while (smallest() > windowWidth && kept.some((column) => column.drop !== undefined)) {
    const worst = Math.max(...kept.map((column) => column.drop ?? 0))
    kept = kept.filter((column) => column.drop !== worst)
  }
  for (const column of kept) {
    if (column.min !== undefined && size() > windowWidth) {
      column.width = Math.max(column.min, column.width - (size() - windowWidth))
    }
  }

  const join = (cells: string[]) => cells.join(' '.repeat(GAP))
  const rule = style('dim', '─'.repeat(Math.min(size(), windowWidth)))
  const lastIndex = kept.length - 1
  const line = (cell: (column: (typeof kept)[number]) => string) =>
    join(
      kept.map((column, index) =>
        // No padding after the last column: it would wrap at the window's edge.
        index === lastIndex && !column.right
          ? cell(column)
          : pad(cell(column), column.width, column.right),
      ),
    )

  const body = rows.map((row) =>
    line((column) => {
      const text = cut(column.value(row), column.width)
      const role = column.role?.(row)
      const styled = role ? style(role, text) : text
      const path = column.path?.(row)
      return path ? pathLink(path, text) : styled
    }),
  )
  if (total) body.splice(-1, 0, rule)
  return [line((column) => style('dim', column.header)), rule, ...body].join('\n')
}

/** `Oct 28` for a person to read; the year only when it isn't this one. */
export function shortDate(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === now.getFullYear()
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** `17:37` today, `yesterday`, or the date. */
export function shortTime(iso: string, now = new Date()): string {
  const date = new Date(iso)
  const midnight = (day: Date) => new Date(day).setHours(0, 0, 0, 0)
  // Rounded, because daylight saving time makes some days 23 or 25 hours long.
  const days = Math.round((midnight(now) - midnight(date)) / 86_400_000)
  if (days === 0) return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return days === 1 ? 'yesterday' : shortDate(iso, now)
}
