import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    opencode: { global: ['.agents/skills'], project: '.agents/skills' },
    antigravity: {
      global: ['.gemini/config/skills', '.gemini/antigravity-cli/skills'],
      project: '.agents/skills',
    },
    cursor: { global: ['.agents/skills'], project: '.agents/skills' },
    'grok-build': { global: ['.agents/skills'], project: '.agents/skills' },
    copilot: { global: ['.agents/skills'], project: '.agents/skills' },
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

  test('agents sharing a folder get one copy, listed with each of them (FR-102)', async () => {
    const t = setup()
    const both = await t.install([
      '--agent',
      'codex',
      '--agent',
      'opencode',
      '--agent',
      'copilot',
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
        agents: ['codex', 'opencode', 'copilot'],
      },
    ])
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
    expect(result.stdout).toContain('Codex, Cursor')
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
  const tty = (stdin: string): RunCliOptions => ({ stdin, stdinIsTTY: true })

  test('lists the agents, those found on this machine marked, and Enter installs them', async () => {
    const t = setup()
    mkdirSync(join(t.homeDir, '.claude'))
    mkdirSync(join(t.homeDir, '.cursor'))
    const result = await t.install(['--global'], tty('\n'))
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toMatch(/1\. \[x\] Claude Code/)
    expect(result.stderr).toMatch(/2\. \[ \] Codex/)
    expect(result.stderr).toMatch(/5\. \[x\] Cursor/)
    expect(result.installed.map((i) => i.agents)).toEqual([['claude-code'], ['cursor']])
  })

  test('typed numbers choose the agents, and the scope is asked', async () => {
    const t = setup()
    const result = await t.install([], tty('2, 7\np\n'))
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toMatch(/Global .* or this project\?/)
    expect(result.installed).toEqual([
      {
        path: t.skill(join(t.cwd, '.agents/skills')),
        scope: 'project',
        agents: ['codex', 'copilot'],
      },
    ])
  })

  test('a number that is not in the list exits 2', async () => {
    const t = setup()
    const result = await t.install(['--global'], tty('9\n'))
    expect(result.exitCode).toBe(2)
  })

  test('nothing chosen exits 2', async () => {
    const t = setup()
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
