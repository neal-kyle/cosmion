import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readVersion } from '../../src/cli/version.js'
import { type RunCliOptions, runCli } from '../helpers/run-cli.js'

const VERSION = readVersion()

function setup() {
  const homeDir = mkdtempSync(join(tmpdir(), 'cosmion-user-'))
  const cwd = mkdtempSync(join(tmpdir(), 'cosmion-project-'))
  const cli = (args: string[], options: RunCliOptions = {}) =>
    runCli(args, { homeDir, cwd, ...options })
  const skill = (folder: string) => join(folder, 'cosmion', 'SKILL.md')
  /** Marks an installed copy as written by another version. */
  const age = (file: string) =>
    writeFileSync(file, readFileSync(file, 'utf8').replace(`"${VERSION}"`, '"0.0.1"'))
  const versionOf = (file: string) =>
    /cosmion-version: "([^"]*)"/.exec(readFileSync(file, 'utf8'))?.[1]
  return { homeDir, cwd, cli, skill, age, versionOf }
}

describe('skill update (FR-104, FR-105)', () => {
  test('rewrites copies from another version, global and project, and reports each', async () => {
    const t = setup()
    await t.cli(['skill', 'install', '--agent', 'claude-code', '--agent', 'codex', '--global'])
    await t.cli(['skill', 'install', '--agent', 'codex', '--project'])
    const globalClaude = t.skill(join(t.homeDir, '.claude/skills'))
    const globalShared = t.skill(join(t.homeDir, '.agents/skills'))
    const project = t.skill(join(t.cwd, '.agents/skills'))
    t.age(globalClaude)
    t.age(project)

    const result = await t.cli(['skill', 'update', '--json'])
    expect(result.exitCode).toBe(0)
    const skills = (result.json as { skills: { path: string; status: string }[] }).skills
    expect(skills).toEqual(
      expect.arrayContaining([
        { path: globalClaude, status: 'updated' },
        { path: globalShared, status: 'current' },
        { path: project, status: 'updated' },
      ]),
    )
    expect(skills).toHaveLength(3)
    for (const file of [globalClaude, globalShared, project])
      expect(t.versionOf(file)).toBe(VERSION)
  })

  test('--dir copies are updated when their folder is named', async () => {
    const t = setup()
    await t.cli(['skill', 'install', '--dir', 'mine'])
    const file = t.skill(join(t.cwd, 'mine'))
    t.age(file)

    const without = await t.cli(['skill', 'update', '--json'])
    expect((without.json as { skills: unknown[] }).skills).toEqual([])
    expect(t.versionOf(file)).toBe('0.0.1')

    const named = await t.cli(['skill', 'update', '--dir', 'mine', '--json'])
    expect((named.json as { skills: unknown[] }).skills).toEqual([
      { path: file, status: 'updated' },
    ])
    expect(t.versionOf(file)).toBe(VERSION)
  })

  test("leaves a SKILL.md that isn't Cosmion's alone", async () => {
    const t = setup()
    const theirs = t.skill(join(t.homeDir, '.claude/skills'))
    mkdirSync(join(theirs, '..'), { recursive: true })
    writeFileSync(theirs, 'not ours')
    const result = await t.cli(['skill', 'update', '--json'])
    expect((result.json as { skills: unknown[] }).skills).toEqual([])
    expect(readFileSync(theirs, 'utf8')).toBe('not ours')
  })

  test('other commands never change an installed copy', async () => {
    const t = setup()
    await t.cli(['skill', 'install', '--agent', 'codex', '--global'])
    const file = t.skill(join(t.homeDir, '.agents/skills'))
    t.age(file)
    await t.cli(['history', '--json'])
    expect(t.versionOf(file)).toBe('0.0.1')
  })

  test('text mode says what it did, or that nothing is installed', async () => {
    const t = setup()
    const none = await t.cli(['skill', 'update'])
    expect(none.stdout).toContain('cosmion skill install')
    await t.cli(['skill', 'install', '--agent', 'codex', '--global'])
    t.age(t.skill(join(t.homeDir, '.agents/skills')))
    const updated = await t.cli(['skill', 'update'])
    expect(updated.stdout).toContain(t.skill(join(t.homeDir, '.agents/skills')))
  })
})

describe('skill uninstall (FR-106, FR-107)', () => {
  test('with no options removes every global and project copy', async () => {
    const t = setup()
    await t.cli(['skill', 'install', '--agent', 'claude-code', '--agent', 'codex', '--global'])
    await t.cli(['skill', 'install', '--agent', 'antigravity', '--project'])
    const result = await t.cli(['skill', 'uninstall', '--json'])
    expect(result.exitCode).toBe(0)
    const removed = (result.json as { removed: { path: string; agents: string[] }[] }).removed
    expect(removed.map((r) => r.path).sort()).toEqual(
      [
        t.skill(join(t.homeDir, '.claude/skills')),
        t.skill(join(t.homeDir, '.agents/skills')),
        t.skill(join(t.cwd, '.agents/skills')),
      ].sort(),
    )
    // The listed agents are every agent using that folder, not only those installed for.
    const shared = removed.find((r) => r.path === t.skill(join(t.homeDir, '.agents/skills')))
    expect(shared?.agents).toEqual(['codex', 'opencode', 'cursor', 'grok-build', 'copilot'])
    expect(existsSync(join(t.homeDir, '.claude/skills/cosmion'))).toBe(false)
    expect(existsSync(join(t.homeDir, '.claude/skills'))).toBe(true)
  })

  test('with options removes only those copies', async () => {
    const t = setup()
    await t.cli(['skill', 'install', '--agent', 'claude-code', '--agent', 'codex', '--global'])
    await t.cli(['skill', 'install', '--agent', 'claude-code', '--project'])
    await t.cli(['skill', 'install', '--dir', 'mine'])

    const result = await t.cli([
      'skill',
      'uninstall',
      '--agent',
      'claude-code',
      '--global',
      '--json',
    ])
    expect((result.json as { removed: { path: string }[] }).removed).toEqual([
      { path: t.skill(join(t.homeDir, '.claude/skills')), agents: ['claude-code'] },
    ])
    expect(existsSync(t.skill(join(t.homeDir, '.agents/skills')))).toBe(true)
    expect(existsSync(t.skill(join(t.cwd, '.claude/skills')))).toBe(true)

    const dir = await t.cli(['skill', 'uninstall', '--dir', 'mine', '--json'])
    expect((dir.json as { removed: unknown[] }).removed).toEqual([
      { path: t.skill(join(t.cwd, 'mine')), agents: [] },
    ])
    expect(existsSync(t.skill(join(t.homeDir, '.agents/skills')))).toBe(true)
  })

  test("never removes a SKILL.md that isn't Cosmion's, or anything beside it", async () => {
    const t = setup()
    const theirs = t.skill(join(t.homeDir, '.claude/skills'))
    mkdirSync(join(theirs, '..'), { recursive: true })
    writeFileSync(theirs, 'not ours')
    await t.cli(['skill', 'install', '--agent', 'codex', '--global'])
    const extra = join(t.homeDir, '.agents/skills/cosmion/notes.txt')
    writeFileSync(extra, 'mine')

    const result = await t.cli(['skill', 'uninstall', '--json'])
    expect((result.json as { removed: unknown[] }).removed).toHaveLength(1)
    expect(readFileSync(theirs, 'utf8')).toBe('not ours')
    // The cosmion folder stays while something else is in it.
    expect(readFileSync(extra, 'utf8')).toBe('mine')
    expect(existsSync(t.skill(join(t.homeDir, '.agents/skills')))).toBe(false)
  })
})
