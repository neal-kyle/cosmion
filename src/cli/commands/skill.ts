import { readdir, rm, rmdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { CosmionError } from '../../core/errors.js'
import type { Context } from '../context.js'
import { defineCommand } from '../define.js'
import { fancy } from '../output.js'
import { createPicker } from '../picker.js'
import { code, pathLink, style } from '../pretty.js'
import { createPrompt } from '../prompt.js'
import {
  AGENT_NAMES,
  AGENTS,
  type Agent,
  type AgentRow,
  agentRows,
  allFolders,
  type Folder,
  findCopies,
  foldersFor,
  markedSkill,
  readCopy,
  type Scope,
  skillFile,
  writeCopy,
} from '../skills.js'
import { readVersion } from '../version.js'

const agentOption = {
  name: 'agent',
  flag: '--agent <name>',
  type: 'string',
  values: AGENT_NAMES,
  repeatable: true,
  description: 'An agent to install for (repeatable); agents sharing a folder share one copy',
} as const

const dirOption = {
  name: 'dir',
  flag: '--dir <path>',
  type: 'string',
  repeatable: true,
  description: 'Any folder an agent loads skills from (repeatable)',
} as const

const globalOption = {
  name: 'global',
  flag: '--global',
  type: 'boolean',
  description: 'For all projects, in your home folder',
} as const

const projectOption = {
  name: 'project',
  flag: '--project',
  type: 'boolean',
  description: 'For this project only, in the current folder',
} as const

const agentNamesSchema = z.array(z.enum(AGENT_NAMES))

const install = defineCommand({
  name: 'install',
  summary: "Install Cosmion's SKILL.md for your coding agents",
  options: [
    agentOption,
    dirOption,
    globalOption,
    projectOption,
    {
      name: 'force',
      flag: '--force',
      type: 'boolean',
      description: "Replace a cosmion skill that isn't Cosmion's",
    },
  ],
  output: z.strictObject({
    installed: z.array(
      z.strictObject({
        path: z.string(),
        scope: z.enum(['global', 'project', 'dir']),
        agents: agentNamesSchema,
      }),
    ),
  }),
  async run(input, ctx) {
    if (input.global && input.project) {
      throw new CosmionError('usage', 'Pass --global or --project, not both.')
    }
    if (input.dir.length > 0 && input.agent.length === 0 && (input.global || input.project)) {
      throw new CosmionError(
        'usage',
        '--global and --project choose the folders of --agent; a --dir is used as it is.',
      )
    }

    const asker = ctx.stdin.isTTY ? createAsker(ctx) : undefined
    let folders: Folder[]
    try {
      let agents: readonly Agent[] = AGENTS.filter((agent) => input.agent.includes(agent.name))
      const askForAgents = agents.length === 0 && input.dir.length === 0
      if (askForAgents && !asker) {
        throw new CosmionError(
          'usage',
          `Pass --agent <name> with --global or --project, or --dir <path>. Agents: ${AGENT_NAMES.join(', ')}.`,
        )
      }
      let scope: Scope | undefined = input.global ? 'global' : input.project ? 'project' : undefined
      if ((agents.length > 0 || askForAgents) && !scope) {
        if (!asker) {
          throw new CosmionError('usage', 'Pass --global (all projects) or --project (this one).')
        }
        scope = await asker.scope()
      }
      // Asked second: who shares a folder depends on the scope (FR-108).
      if (askForAgents && asker && scope) agents = await asker.agents(scope)
      folders = [...(scope ? foldersFor(ctx, agents, scope) : []), ...dirFolders(ctx, input.dir)]
    } finally {
      asker?.close()
    }

    // Check every target before writing any (FR-103).
    const refused: string[] = []
    for (const { folder } of folders) {
      const copy = await readCopy(skillFile(folder))
      if (copy.kind === 'other' && !input.force) refused.push(skillFile(folder))
    }
    if (refused.length > 0) {
      throw new CosmionError(
        'usage',
        `Not replacing a SKILL.md that Cosmion didn't write: ${refused.join(', ')}. Pass --force to replace it.`,
      )
    }

    const text = await markedSkill()
    for (const { folder } of folders) await writeCopy(skillFile(folder), text)
    return {
      data: {
        installed: folders.map(({ folder, scope, agents }) => ({
          path: skillFile(folder),
          scope,
          agents,
        })),
      },
    }
  },
  text: ({ installed }) =>
    installed
      .map(({ path, agents }) => {
        const titles = agents.map((name) => AGENTS.find((agent) => agent.name === name)?.title)
        return titles.length > 0
          ? `Installed for ${titles.join(', ')}: ${path}`
          : `Installed: ${path}`
      })
      .join('\n'),
  pretty: ({ installed }) =>
    installed
      .map(({ path, agents }) => {
        const titles = agents.map((name) => AGENTS.find((agent) => agent.name === name)?.title)
        const label = titles.length > 0 ? `Installed for ${titles.join(', ')}` : 'Installed'
        return `${style('ok', '✓')} ${label}  ${pathLink(path)}`
      })
      .join('\n'),
})

interface Asker {
  scope(): Promise<Scope>
  agents(scope: Scope): Promise<readonly Agent[]>
  close(): void
}

const NO_AGENTS = 'No agents chosen.'

/** Arrow keys where a picker can be drawn, typed answers where it can't. */
function createAsker(ctx: Context): Asker {
  return fancy(ctx) ? createPickerAsker(ctx) : createTypedAsker(ctx)
}

function createPickerAsker(ctx: Context): Asker {
  const picker = createPicker(ctx)
  return {
    async scope() {
      const scopes = [
        { label: 'All projects', detail: 'in your home folder', scope: 'global' },
        { label: 'This project', detail: 'in the current folder', scope: 'project' },
      ] as const
      const [chosen] = await picker.pick({
        title: "Install Cosmion's skill where?",
        doneLabel: 'Where',
        rows: scopes,
      })
      if (chosen === undefined) throw new CosmionError('usage', SCOPE_NOT_CHOSEN)
      return scopes[chosen]?.scope as Scope
    },
    async agents(scope) {
      const rows = agentRows(scope)
      const chosen = await picker.pick({
        title: 'Which agents?',
        doneLabel: 'Agents',
        rows,
        multiple: true,
      })
      if (chosen.length === 0) throw new CosmionError('usage', NO_AGENTS)
      return agentsOf(chosen.map((index) => rows[index] as AgentRow))
    },
    close: picker.close,
  }
}

function createTypedAsker(ctx: Context): Asker {
  const prompt = createPrompt(ctx)
  return {
    async scope() {
      const answer = (await prompt.ask('Global (all projects) or this project? [g/p]: '))
        .trim()
        .toLowerCase()
      if (answer === 'g' || answer === 'global') return 'global'
      if (answer === 'p' || answer === 'project') return 'project'
      throw new CosmionError('usage', SCOPE_NOT_CHOSEN)
    },
    async agents(scope) {
      const rows = agentRows(scope)
      ctx.stderr.write("Install Cosmion's skill for which agents?\n")
      rows.forEach(({ label, detail }, index) => {
        ctx.stderr.write(`  ${index + 1}. ${label} (${detail})\n`)
      })
      const answer = (await prompt.ask('Numbers, separated by commas or spaces: ')).trim()
      if (answer === '') throw new CosmionError('usage', NO_AGENTS)
      return agentsOf(
        answer.split(/[\s,]+/).map((word) => {
          const row = rows[Number(word) - 1]
          if (!/^\d+$/.test(word) || !row) {
            throw new CosmionError('usage', `"${word}" isn't a number from the list.`)
          }
          return row
        }),
      )
    },
    close: prompt.close,
  }
}

const SCOPE_NOT_CHOSEN = 'Answer g (global) or p (this project).'

/** The rows' agents, in the table's order. */
function agentsOf(rows: readonly AgentRow[]): Agent[] {
  return AGENTS.filter((agent) => rows.some((row) => row.agent === agent))
}

const update = defineCommand({
  name: 'update',
  summary: "Update Cosmion's installed skills to this version",
  options: [{ ...dirOption, description: 'Also update the copy in this folder (repeatable)' }],
  output: z.strictObject({
    skills: z.array(z.strictObject({ path: z.string(), status: z.enum(['updated', 'current']) })),
  }),
  async run(input, ctx) {
    const copies = await findCopies([...allFolders(ctx), ...dirFolders(ctx, input.dir)])
    const version = readVersion()
    const text = await markedSkill()
    const skills: { path: string; status: 'updated' | 'current' }[] = []
    for (const copy of copies) {
      if (copy.version === version) {
        skills.push({ path: copy.file, status: 'current' })
      } else {
        await writeCopy(copy.file, text)
        skills.push({ path: copy.file, status: 'updated' })
      }
    }
    return { data: { skills } }
  },
  text: ({ skills }) => {
    if (skills.length === 0) {
      return 'No Cosmion skill found. `cosmion skill install` installs one for your agents.'
    }
    return skills
      .map(({ path, status }) =>
        status === 'updated' ? `Updated: ${path}` : `Up to date: ${path}`,
      )
      .join('\n')
  },
  pretty: ({ skills }) => {
    if (skills.length === 0) {
      return `${style('dim', 'No Cosmion skill found.')}\n  ${style('dim', '→')} ${code('`cosmion skill install` installs one for your agents.')}`
    }
    return skills
      .map(
        ({ path, status }) =>
          `${style('ok', '✓')} ${status === 'updated' ? 'Updated' : 'Up to date'}  ${pathLink(path)}`,
      )
      .join('\n')
  },
})

const uninstall = defineCommand({
  name: 'uninstall',
  summary: "Remove Cosmion's installed skills",
  options: [
    { ...agentOption, description: "An agent whose folder's copy to remove (repeatable)" },
    { ...dirOption, description: 'Remove the copy in this folder (repeatable)' },
    { ...globalOption, description: 'Only the global copies' },
    { ...projectOption, description: "Only this project's copies" },
  ],
  output: z.strictObject({
    removed: z.array(z.strictObject({ path: z.string(), agents: agentNamesSchema })),
  }),
  async run(input, ctx) {
    if (input.global && input.project) {
      throw new CosmionError('usage', 'Pass --global or --project, not both.')
    }
    // Only --dir names just those folders; anything else narrows the table's folders.
    const onlyDirs =
      input.dir.length > 0 && input.agent.length === 0 && !input.global && !input.project
    const agents = AGENTS.filter(
      (agent) => input.agent.length === 0 || input.agent.includes(agent.name),
    )
    const scopes: Scope[] = input.global
      ? ['global']
      : input.project
        ? ['project']
        : ['global', 'project']
    const folders = [
      ...(onlyDirs ? [] : scopes.flatMap((scope) => foldersFor(ctx, agents, scope))),
      ...dirFolders(ctx, input.dir),
    ]

    const removed: { path: string; agents: Folder['agents'] }[] = []
    for (const copy of await findCopies(folders)) {
      await rm(copy.file)
      await removeIfEmpty(dirname(copy.file))
      // Every agent using that folder loses it, not only those named.
      const users = allFolders(ctx).find((folder) => folder.folder === copy.folder)
      removed.push({ path: copy.file, agents: copy.scope === 'dir' ? [] : (users?.agents ?? []) })
    }
    return { data: { removed } }
  },
  text: ({ removed }) =>
    removed.length === 0
      ? 'No Cosmion skill found.'
      : removed.map(({ path }) => `Removed: ${path}`).join('\n'),
  pretty: ({ removed }) =>
    removed.length === 0
      ? style('dim', 'No Cosmion skill found.')
      : removed.map(({ path }) => `${style('ok', '✓')} Removed  ${pathLink(path)}`).join('\n'),
})

export const skill = defineCommand({
  name: 'skill',
  summary: "Install Cosmion's SKILL.md for your coding agents, and keep it up to date",
  subcommands: [install, update, uninstall],
})

function dirFolders(ctx: Context, dirs: readonly string[]): Folder[] {
  return dirs.map((dir) => ({ folder: resolve(ctx.cwd, dir), scope: 'dir', agents: [] }))
}

/** The `cosmion` folder goes when the copy was all it held. */
async function removeIfEmpty(folder: string): Promise<void> {
  if ((await readdir(folder)).length === 0) await rmdir(folder)
}
