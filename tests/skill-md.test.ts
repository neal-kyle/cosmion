import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { commands } from '../src/cli/commands/index.js'
import type { CommandDefinition } from '../src/cli/define.js'
import { exitCodes } from '../src/cli/exit-codes.js'
import { genOptions } from '../src/cli/gen-options.js'

const skill = readFileSync(new URL('../SKILL.md', import.meta.url), 'utf8')

/** Every command that runs, by its full name (`auth status`), with its definition. */
function walk(list: readonly CommandDefinition[], prefix = ''): [string, CommandDefinition][] {
  return list.flatMap((command) => {
    const name = `${prefix}${command.name}`
    const own: [string, CommandDefinition][] = command.run ? [[name, command]] : []
    return [...own, ...walk(command.subcommands, `${name} `)]
  })
}

/** The text under a `### ` heading matching the pattern, up to the next heading. */
function section(heading: RegExp): string | undefined {
  const lines = skill.split('\n')
  const start = lines.findIndex((line) => heading.test(line))
  if (start === -1) return undefined
  const end = lines.findIndex((line, index) => index > start && /^#{1,3} /.test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

describe('SKILL.md (FR-045)', () => {
  // The gen options are described once, in their own section, which commands refer to.
  const shared = section(/^### Gen options$/) ?? ''
  const isShared = (flag: string) => genOptions.some((option) => option.flag === flag)

  test.each(walk(commands))(
    'describes `cosmion %s` and every one of its options',
    (name, command) => {
      const text = section(new RegExp(`^### \`cosmion ${name}( [^\`]*)?\`$`))
      expect(text, `no "### \`cosmion ${name}\`" section`).toBeDefined()
      for (const option of command.options) {
        const sharedOption = isShared(option.flag)
        const where = sharedOption ? shared : text
        if (sharedOption) {
          expect(text, `${name}: refers to the gen options`).toContain('gen options')
        }
        const flag = option.flag.split(' ')[0] ?? option.flag
        expect(where, `${name}: ${flag}`).toContain(flag)
        if (option.alias) expect(where, `${name}: ${option.alias}`).toContain(option.alias)
      }
    },
  )

  test('lists every exit code with its error code', () => {
    for (const [name, { code }] of Object.entries(exitCodes)) {
      expect(skill, `exit ${code}`).toMatch(new RegExp(`^\\| ${code} \\|`, 'm'))
      if (!['ok', 'partial', 'interrupted'].includes(name)) {
        expect(skill, `error.code ${name}`).toContain(`\`${name}\``)
      }
    }
  })

  test('mentions csn, COSMION_MODEL, COSMION_HOME and the batch budget rule', () => {
    expect(skill).toContain('csn')
    expect(skill).toContain('COSMION_MODEL')
    expect(skill).toContain('COSMION_HOME')
    expect(skill).toContain('--no-budget')
    expect(skill).toMatch(/always pass `--budget`/i)
  })

  test("doesn't mention the test-only OpenRouter address (FR-058)", () => {
    expect(skill).not.toContain('COSMION_TEST_OPENROUTER_URL')
  })
})
