import { type CommandDefinition, jsonOption } from './define.js'
import { cut, style } from './pretty.js'

const WORDMARK = ['▄▀▀ ▄▀▄ ▄▀▀ █▄ ▄█ █ ▄▀▄ █▄ █', '▀▄▄ ▀▄▀ ▄██ █ ▀ █ █ ▀▄▀ █ ▀█']
/** Two dim stars glinting off the N's top corner. */
const SPARKLE = `${' '.repeat(27)}· +`

const GROUPS = [
  ['Make', ['gen', 'batch', 'regen']],
  ['Choose', ['models', 'price']],
  ['Look back', ['history', 'show', 'usage']],
  ['Set up', ['auth', 'doctor', 'skill', 'schema']],
] as const

const OPTIONS = [
  ['-V, --version', 'Print the version'],
  [jsonOption.flag, jsonOption.description],
  ['-h, --help', 'Show help'],
] as const

/** What bare `cosmion` and `cosmion --help` show on a terminal. Off one they print commander's help. */
export function homeScreen(
  commands: readonly CommandDefinition[],
  description: string,
  version: string,
  columns: number,
): string {
  const NAME_WIDTH = 15
  const entry = (name: string, about: string) =>
    `  ${style('accent', name.padEnd(NAME_WIDTH))}${cut(about, columns - NAME_WIDTH - 2)}`
  const groups = GROUPS.flatMap(([title, names]) => [
    '',
    style('dim', title),
    ...names.flatMap((name) => {
      const command = commands.find((candidate) => candidate.name === name)
      return command ? [entry(name, command.summary)] : []
    }),
  ])
  const [top = '', bottom = ''] = WORDMARK
  return [
    style('dim', SPARKLE),
    style('accent', top),
    `${style('accent', bottom)}  ${style('dim', version)}`,
    '',
    cut(description, columns),
    ...groups,
    '',
    style('dim', 'Options'),
    ...OPTIONS.map(([flag, about]) => entry(flag, about)),
    '',
    `${style('dim', 'Try')}  cosmion gen "a lighthouse on a tiny moon" -m bytedance-seed/seedream-4.5`,
    style('dim', 'Run cosmion <command> --help for its options; csn is the short form of cosmion.'),
    '',
  ].join('\n')
}
