import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { describe, expect, test } from 'vitest'
import { readVersion } from '../../src/cli/version.js'
import { type RunCliOptions, runCli } from '../helpers/run-cli.js'

const PACKAGED = readFileSync(new URL('../../SKILL.md', import.meta.url), 'utf8')
const VERSION = readVersion()

interface Installed {
  path: string
  scope: 'global' | 'project' | 'dir'
  agents: string[]
}

function setup() {
  const homeDir = mkdtempSync(join(tmpdir(), 'cosmion-user-'))
  const cwd = mkdtempSync(join(tmpdir(), 'cosmion-project-'))
  const cli = (args: string[], options: RunCliOptions = {}) =>
    runCli(args, { homeDir, cwd, ...options })
  const install = async (args: string[], options: RunCliOptions = {}) => {
    const result = await cli(['skill', 'install', ...args, '--json'], options)
    // Nothing on stdout after Ctrl-C.
    const installed = (result.json as { installed?: Installed[] } | undefined)?.installed ?? []
    return { ...result, installed }
  }
  const skill = (folder: string) => join(folder, 'cosmion', 'SKILL.md')
  return { homeDir, cwd, cli, install, skill }
}

const errorOf = (json: unknown) => (json as { error: { code: string; message: string } }).error

/** The installed text without its version mark, which should be the packaged SKILL.md. */
const unmarked = (text: string) => text.replace(/metadata:\n {2}cosmion-version: "[^"]*"\n/, '')

describe('skill install (FR-100–FR-103, FR-108)', () => {
  const folders: Record<string, { global: string[]; project: string }> = {
    'claude-code': { global: ['.claude/skills'], project: '.claude/skills' },
    codex: { global: ['.agents/skills'], project: '.agents/skills' },
    opencode: { global: ['.config/opencode/skills'], project: '.opencode/skills' },
    antigravity: { global: ['.gemini/config/skills'], project: '.agents/skills' },
    cursor: { global: ['.cursor/skills'], project: '.cursor/skills' },
    'grok-build': { global: ['.grok/skills'], project: '.grok/skills' },
    copilot: { global: ['.copilot/skills'], project: '.github/skills' },
    shared: { global: ['.agents/skills'], project: '.agents/skills' },
  }

  test.each(Object.entries(folders))('%s, globally and in a project', async (agent, where) => {
    const t = setup()
    const global = await t.install(['--agent', agent, '--global'])
    expect(global.exitCode).toBe(0)
    expect(global.installed).toEqual(
      where.global.map((folder) => ({
        path: t.skill(join(t.homeDir, folder)),
        scope: 'global',
        agents: [agent],
      })),
    )
    for (const folder of where.global)
      expect(existsSync(t.skill(join(t.homeDir, folder)))).toBe(true)

    const project = await t.install(['--agent', agent, '--project'])
    expect(project.exitCode).toBe(0)
    expect(project.installed).toEqual([
      { path: t.skill(join(t.cwd, where.project)), scope: 'project', agents: [agent] },
    ])
  })

  test('the copy is the packaged SKILL.md with the version in its frontmatter', async () => {
    const t = setup()
    await t.install(['--agent', 'codex', '--global'])
    const text = readFileSync(t.skill(join(t.homeDir, '.agents/skills')), 'utf8')
    expect(text).toContain(`metadata:\n  cosmion-version: "${VERSION}"\n---`)
    expect(unmarked(text)).toBe(PACKAGED)
  })

  test('agents using one folder get one copy, listed with each of them (FR-102)', async () => {
    const t = setup()
    const both = await t.install([
      '--agent',
      'codex',
      '--agent',
      'antigravity',
      '--agent',
      'shared',
      '--agent',
      'claude-code',
      '--project',
    ])
    expect(both.exitCode).toBe(0)
    // In the table's order: Claude Code's folder first.
    expect(both.installed).toEqual([
      { path: t.skill(join(t.cwd, '.claude/skills')), scope: 'project', agents: ['claude-code'] },
      {
        path: t.skill(join(t.cwd, '.agents/skills')),
        scope: 'project',
        agents: ['codex', 'antigravity', 'shared'],
      },
    ])
  })

  test('an agent with its own folder stays out of the shared one', async () => {
    const t = setup()
    const result = await t.install(['--agent', 'opencode', '--global'])
    expect(result.exitCode).toBe(0)
    expect(existsSync(t.skill(join(t.homeDir, '.config/opencode/skills')))).toBe(true)
    expect(existsSync(join(t.homeDir, '.agents'))).toBe(false)
  })

  test('--dir installs into any folder, and can be repeated', async () => {
    const t = setup()
    const result = await t.install(['--dir', 'one', '--dir', join(t.homeDir, 'two')])
    expect(result.exitCode).toBe(0)
    expect(result.installed).toEqual([
      { path: t.skill(join(t.cwd, 'one')), scope: 'dir', agents: [] },
      { path: t.skill(join(t.homeDir, 'two')), scope: 'dir', agents: [] },
    ])
    expect(unmarked(readFileSync(t.skill(join(t.cwd, 'one')), 'utf8'))).toBe(PACKAGED)
  })

  test("an existing SKILL.md that isn't Cosmion's is never replaced without --force", async () => {
    const t = setup()
    const theirs = t.skill(join(t.cwd, '.claude/skills'))
    mkdirSync(join(theirs, '..'), { recursive: true })
    writeFileSync(theirs, '---\nname: cosmion\ndescription: someone else\n---\n')

    const refused = await t.install(['--agent', 'claude-code', '--agent', 'codex', '--project'])
    expect(refused.exitCode).toBe(2)
    expect(errorOf(refused.json).message).toContain(theirs)
    expect(errorOf(refused.json).message).toContain('--force')
    expect(readFileSync(theirs, 'utf8')).toContain('someone else')
    // Nothing at all is written when one target is refused.
    expect(existsSync(t.skill(join(t.cwd, '.agents/skills')))).toBe(false)

    const forced = await t.install(['--agent', 'claude-code', '--project', '--force'])
    expect(forced.exitCode).toBe(0)
    expect(unmarked(readFileSync(theirs, 'utf8'))).toBe(PACKAGED)
  })

  test("Cosmion's own copy is replaced without --force", async () => {
    const t = setup()
    const file = t.skill(join(t.cwd, '.agents/skills'))
    await t.install(['--agent', 'codex', '--project'])
    writeFileSync(file, readFileSync(file, 'utf8').replace(VERSION, '0.0.1'))
    const again = await t.install(['--agent', 'codex', '--project'])
    expect(again.exitCode).toBe(0)
    expect(readFileSync(file, 'utf8')).toContain(`cosmion-version: "${VERSION}"`)
  })

  test("no other file in the agents' folders changes (FR-107)", async () => {
    const t = setup()
    const other = join(t.homeDir, '.claude/skills/other/SKILL.md')
    mkdirSync(join(other, '..'), { recursive: true })
    writeFileSync(other, 'mine')
    await t.install(['--agent', 'claude-code', '--global'])
    expect(readFileSync(other, 'utf8')).toBe('mine')
  })

  test('text mode says where it installed, for which agents', async () => {
    const t = setup()
    const result = await t.cli([
      'skill',
      'install',
      '--agent',
      'codex',
      '--agent',
      'cursor',
      '--global',
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(t.skill(join(t.homeDir, '.agents/skills')))
    expect(result.stdout).toContain('Installed for Codex')
    expect(result.stdout).toContain(t.skill(join(t.homeDir, '.cursor/skills')))
    expect(result.stdout).toContain('Installed for Cursor')
  })
})

describe('skill install without a terminal (FR-101)', () => {
  test.each([
    [[], '--agent'],
    [['--agent', 'codex'], '--global'],
    [['--agent', 'codex', '--global', '--project'], '--global'],
    [['--dir', 'x', '--global'], '--dir'],
    [['--agent', 'aider', '--global'], 'claude-code'],
  ])('%j exits 2, naming %s', async (args, named) => {
    const t = setup()
    const result = await t.install(args)
    expect(result.exitCode).toBe(2)
    expect(errorOf(result.json).code).toBe('usage')
    expect(errorOf(result.json).message).toContain(named)
    expect(existsSync(join(t.homeDir, '.agents'))).toBe(false)
  })
})

describe('skill install on a terminal (FR-101)', () => {
  const UP = '\x1b[A'
  const DOWN = '\x1b[B'
  const ENTER = '\r'
  const SPACE = ' '
  const CTRL_C = '\x03'
  const keys = (stdin: string): RunCliOptions => ({
    stdin,
    stdinIsTTY: true,
    stderrIsTTY: true,
    columns: 100,
  })

  test('asks where first, then lists every agent, whatever is on this computer', async () => {
    const t = setup()
    const result = await t.install([], keys(ENTER + SPACE + ENTER))
    expect(result.exitCode).toBe(0)
    const screen = stripVTControlCharacters(result.stderr)
    expect(screen.indexOf('where?')).toBeLessThan(screen.indexOf('Which agents?'))
    for (const row of [
      'Claude Code',
      'OpenCode',
      'Antigravity',
      'Cursor',
      'Grok Build',
      'Copilot',
      'Shared folder',
    ]) {
      expect(screen).toContain(row)
    }
    expect(screen).toContain('~/.config/opencode/skills')
    expect(screen).not.toContain('Codex')
    expect(screen).not.toContain('--dir')
    expect(result.installed.map((i) => i.path)).toEqual([
      t.skill(join(t.homeDir, '.claude/skills')),
    ])
  })

  test('nothing starts ticked: Enter alone chooses nothing, and says so', async () => {
    const t = setup()
    mkdirSync(join(t.homeDir, '.claude'))
    const result = await t.install(['--global'], keys(ENTER))
    expect(result.exitCode).toBe(2)
    expect(stripVTControlCharacters(result.stderr)).toContain('Select at least one')
    expect(errorOf(result.json).message).toContain('No agents chosen')
    expect(existsSync(join(t.homeDir, '.claude/skills'))).toBe(false)
  })

  test("one agent's row installs only in its own folder", async () => {
    const t = setup()
    const result = await t.install(['--global'], keys(DOWN + SPACE + ENTER))
    expect(result.installed).toEqual([
      {
        path: t.skill(join(t.homeDir, '.config/opencode/skills')),
        scope: 'global',
        agents: ['opencode'],
      },
    ])
    expect(existsSync(join(t.homeDir, '.agents'))).toBe(false)
  })

  test('the shared row is last and installs only in the shared folder', async () => {
    const t = setup()
    const result = await t.install(['--global'], keys(UP + SPACE + ENTER))
    expect(result.installed).toEqual([
      { path: t.skill(join(t.homeDir, '.agents/skills')), scope: 'global', agents: ['shared'] },
    ])
  })

  test('Antigravity has its own row globally, in the folder all its products read', async () => {
    const t = setup()
    const result = await t.install(['--global'], keys(DOWN + DOWN + SPACE + ENTER))
    expect(result.installed.map((i) => i.path)).toEqual([
      t.skill(join(t.homeDir, '.gemini/config/skills')),
    ])
  })

  test('in a project Antigravity has no row: it reads the shared folder', async () => {
    const t = setup()
    const result = await t.install([], keys(DOWN + ENTER + UP + SPACE + ENTER))
    expect(result.exitCode).toBe(0)
    const asked = stripVTControlCharacters(result.stderr)
    expect(asked.slice(asked.indexOf('Which agents?'))).not.toContain('Antigravity  ')
    expect(asked).toContain('.github/skills')
    expect(result.installed).toEqual([
      { path: t.skill(join(t.cwd, '.agents/skills')), scope: 'project', agents: ['shared'] },
    ])
  })

  test('several rows can be ticked, Space unticks, and the arrows wrap around', async () => {
    const t = setup()
    const result = await t.install(
      ['--project'],
      // Up from the first row lands on the last; tick it, tick the first, untick and retick.
      keys(UP + SPACE + DOWN + SPACE + SPACE + SPACE + ENTER),
    )
    expect(result.installed.map((i) => i.path)).toEqual([
      t.skill(join(t.cwd, '.claude/skills')),
      t.skill(join(t.cwd, '.agents/skills')),
    ])
  })

  test('--global or --project skips the first question', async () => {
    const t = setup()
    const result = await t.install(['--project'], keys(SPACE + ENTER))
    expect(stripVTControlCharacters(result.stderr)).not.toContain('where?')
    expect(result.installed[0]?.scope).toBe('project')
  })

  test('--agent skips the agents question', async () => {
    const t = setup()
    const result = await t.install(['--agent', 'codex'], keys(ENTER))
    expect(stripVTControlCharacters(result.stderr)).not.toContain('Which agents?')
    expect(result.installed[0]?.agents).toEqual(['codex'])
  })

  test('Ctrl-C in the picker exits 130, writes nothing and brings the cursor back', async () => {
    const t = setup()
    const result = await t.install([], keys(ENTER + SPACE + CTRL_C))
    expect(result.exitCode).toBe(130)
    expect(existsSync(join(t.homeDir, '.claude/skills'))).toBe(false)
    expect(result.stderr.lastIndexOf('\x1b[?25h')).toBeGreaterThan(
      result.stderr.lastIndexOf('\x1b[?25l'),
    )
  })

  test('input ending in the first question exits 2', async () => {
    const t = setup()
    const result = await t.install([], keys(''))
    expect(result.exitCode).toBe(2)
  })

  describe("where a picker can't be drawn (NO_COLOR, TERM=dumb, stderr piped)", () => {
    const tty = (stdin: string): RunCliOptions => ({ stdin, stdinIsTTY: true })

    test('the same rows are numbered, and nothing is marked', async () => {
      const t = setup()
      mkdirSync(join(t.homeDir, '.claude'))
      const result = await t.install(['--global'], tty('1\n'))
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toMatch(/1\. Claude Code \(~\/\.claude\/skills\)/)
      expect(result.stderr).toMatch(/2\. OpenCode \(~\/\.config\/opencode\/skills\)/)
      expect(result.stderr).toMatch(/7\. Shared folder \(~\/\.agents\/skills\)\n/)
      expect(result.stderr).not.toContain('[x]')
      expect(result.stderr).not.toContain('\x1b[')
      expect(result.installed.map((i) => i.agents)).toEqual([['claude-code']])
    })

    test('NO_COLOR on a terminal gets the numbered list too', async () => {
      const t = setup()
      const result = await t.install(['--global'], {
        ...keys('1\n'),
        env: { NO_COLOR: '1' },
      })
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toMatch(/1\. Claude Code/)
    })

    test('the scope is asked first, then typed numbers choose the rows', async () => {
      const t = setup()
      const result = await t.install([], tty('p\n6\n'))
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toMatch(/Global .* or this project\?/)
      expect(result.installed).toEqual([
        {
          path: t.skill(join(t.cwd, '.agents/skills')),
          scope: 'project',
          agents: ['shared'],
        },
      ])
    })

    test('a number that is not in the list exits 2', async () => {
      const t = setup()
      const result = await t.install(['--global'], tty('9\n'))
      expect(result.exitCode).toBe(2)
    })

    test('Enter alone chooses nothing and exits 2', async () => {
      const t = setup()
      mkdirSync(join(t.homeDir, '.claude'))
      const result = await t.install(['--global'], tty('\n'))
      expect(result.exitCode).toBe(2)
    })

    test('Ctrl-C exits 130 and writes nothing', async () => {
      const t = setup()
      const controller = new AbortController()
      controller.abort()
      const result = await t.install([], { ...tty(''), signal: controller.signal })
      expect(result.exitCode).toBe(130)
      expect(existsSync(join(t.homeDir, '.agents'))).toBe(false)
      expect(existsSync(join(t.cwd, '.agents'))).toBe(false)
    })
  })
})
