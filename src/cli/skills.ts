import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CosmionError } from '../core/errors.js'
import type { Context } from './context.js'
import { readVersion } from './version.js'

/**
 * The agents and the one folder Cosmion uses for each, per scope (FR-108): the shared
 * `.agents/skills` wherever the agent reads it, otherwise its own. Global folders are under
 * the home folder, project folders under the current one. `home` is the folder whose
 * presence pre-selects the agent.
 */
export const AGENTS = [
  {
    name: 'claude-code',
    title: 'Claude Code',
    global: ['.claude/skills'],
    project: '.claude/skills',
    home: '.claude',
  },
  {
    name: 'codex',
    title: 'Codex',
    global: ['.agents/skills'],
    project: '.agents/skills',
    home: '.codex',
  },
  {
    name: 'opencode',
    title: 'OpenCode',
    global: ['.agents/skills'],
    project: '.agents/skills',
    home: '.config/opencode',
  },
  {
    name: 'antigravity',
    title: 'Antigravity',
    // The app and the CLI are separate products, each with its own global folder.
    global: ['.gemini/config/skills', '.gemini/antigravity-cli/skills'],
    project: '.agents/skills',
    home: '.gemini',
  },
  {
    name: 'cursor',
    title: 'Cursor',
    global: ['.agents/skills'],
    project: '.agents/skills',
    home: '.cursor',
  },
  {
    name: 'grok-build',
    title: 'Grok Build',
    global: ['.agents/skills'],
    project: '.agents/skills',
    home: '.grok',
  },
  {
    name: 'copilot',
    title: 'Copilot',
    global: ['.agents/skills'],
    project: '.agents/skills',
    home: '.copilot',
  },
] as const

export type Agent = (typeof AGENTS)[number]
export type AgentName = Agent['name']
export type Scope = 'global' | 'project'

export const AGENT_NAMES = AGENTS.map((agent) => agent.name)

/** A skills folder and the agents that use it there. */
export interface Folder {
  folder: string
  scope: Scope | 'dir'
  agents: AgentName[]
}

/** Each agent's folders for the scope, one entry per distinct folder (FR-102). */
export function foldersFor(ctx: Context, agents: readonly Agent[], scope: Scope): Folder[] {
  const byPath = new Map<string, Folder>()
  for (const agent of agents) {
    const relative = scope === 'global' ? agent.global : [agent.project]
    const base = scope === 'global' ? ctx.homeDir : ctx.cwd
    for (const folder of relative.map((path) => join(base, path))) {
      const entry = byPath.get(folder) ?? { folder, scope, agents: [] }
      entry.agents.push(agent.name)
      byPath.set(folder, entry)
    }
  }
  return [...byPath.values()]
}

/** Every folder of the table, global then the current project's. */
export function allFolders(ctx: Context): Folder[] {
  return [...foldersFor(ctx, AGENTS, 'global'), ...foldersFor(ctx, AGENTS, 'project')]
}

/** Where Cosmion's copy goes inside a skills folder. */
export function skillFile(folder: string): string {
  return join(folder, 'cosmion', 'SKILL.md')
}

/**
 * What's at a skill file: nothing, a file that isn't Cosmion's, or Cosmion's copy with the
 * version that wrote it (FR-103).
 */
export async function readCopy(
  file: string,
): Promise<{ kind: 'none' } | { kind: 'other' } | { kind: 'cosmion'; version: string }> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' }
    throw new CosmionError('internal', `Couldn't read ${file} (${reasonOf(error)}).`)
  }
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
  const version = /^ {2}cosmion-version: "([^"]*)"$/m.exec(frontmatter)?.[1]
  return version === undefined ? { kind: 'other' } : { kind: 'cosmion', version }
}

/** The packaged SKILL.md, marked with this version in its frontmatter (FR-103). */
export async function markedSkill(): Promise<string> {
  // ../../SKILL.md from both src/cli (tests) and dist/cli (the installed package).
  const text = await readFile(new URL('../../SKILL.md', import.meta.url), 'utf8')
  const end = text.indexOf('\n---', 3)
  const mark = `\nmetadata:\n  cosmion-version: "${readVersion()}"`
  return `${text.slice(0, end)}${mark}${text.slice(end)}`
}

/** Writes a copy; a temp file renamed into place, so an agent never reads half of one. */
export async function writeCopy(file: string, text: string): Promise<void> {
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temporary, text)
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw new CosmionError('internal', `Couldn't write ${file} (${reasonOf(error)}).`)
  }
}

/**
 * Cosmion's copies in these folders, each folder once (FR-105). Found by looking, so a
 * copy someone else committed to the project is found too.
 */
export async function findCopies(
  folders: readonly Folder[],
): Promise<(Folder & { file: string; version: string })[]> {
  const seen = new Set<string>()
  const found: (Folder & { file: string; version: string })[] = []
  for (const folder of folders) {
    if (seen.has(folder.folder)) continue
    seen.add(folder.folder)
    const file = skillFile(folder.folder)
    const copy = await readCopy(file)
    if (copy.kind === 'cosmion') found.push({ ...folder, file, version: copy.version })
  }
  return found
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
