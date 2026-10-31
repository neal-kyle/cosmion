import { existsSync } from 'node:fs'
import { readdir, rm, rmdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { CosmionError } from '../../core/errors.js'
import type { Context } from '../context.js'
import { defineCommand } from '../define.js'
import { fancy, question } from '../output.js'
import { code, pathLink, style } from '../pretty.js'
import { createPrompt } from '../prompt.js'
import {
  AGENT_NAMES,
  AGENTS,
  type Agent,
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

    const prompt = ctx.stdin.isTTY ? createPrompt(ctx) : undefined
    let folders: Folder[]
    try {
      let agents: Agent[] = AGENTS.filter((agent) => input.agent.includes(agent.name))
      if (agents.length === 0 && input.dir.length === 0) {
        if (!prompt) {
          throw new CosmionError(
            'usage',
            `Pass --agent <name> with --global or --project, or --dir <path>. Agents: ${AGENT_NAMES.join(', ')}.`,
          )
        }
        agents = await askAgents(ctx, prompt)
      }
      let scope: Scope | undefined = input.global ? 'global' : input.project ? 'project' : undefined
      if (agents.length > 0 && !scope) {
        if (!prompt) {
          throw new CosmionError('usage', 'Pass --global (all projects) or --project (this one).')
        }
        scope = await askScope(ctx, prompt)
      }
      folders = [...(scope ? foldersFor(ctx, agents, scope) : []), ...dirFolders(ctx, input.dir)]
    } finally {
      prompt?.close()
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

async function askAgents(ctx: Context, prompt: ReturnType<typeof createPrompt>): Promise<Agent[]> {
  const found = AGENTS.filter((agent) => existsSync(join(ctx.homeDir, agent.home)))
  if (fancy(ctx)) {
    const width = Math.max(...AGENTS.map((agent) => agent.title.length))
    ctx.stderr.write(
      `${style('accent', '?')} ${style('bold', "Install Cosmion's skill for which agents?")}  ${style('dim', '✓ found on this computer')}\n`,
    )
    AGENTS.forEach((agent, index) => {
      const mark = found.includes(agent) ? style('ok', '✓') : ' '
      const number = style('accent', String(index + 1).padStart(3))
      ctx.stderr.write(
        `${number}  ${mark} ${agent.title.padEnd(width)}  ${style('dim', agent.project)}\n`,
      )
    })
  } else {
    ctx.stderr.write("Install Cosmion's skill for which agents? [x] = found on this computer\n")
    AGENTS.forEach((agent, index) => {
      const mark = found.includes(agent) ? 'x' : ' '
      ctx.stderr.write(`  ${index + 1}. [${mark}] ${agent.title} (${agent.project})\n`)
    })
  }
  const answer = (
    await prompt.ask(
      question(
        ctx,
        'Numbers, separated by commas or spaces (Enter for the [x] ones): ',
        'Numbers',
        'separated by commas or spaces, Enter for the ✓ ones',
      ),
    )
  ).trim()
  if (answer === '') {
    if (found.length === 0) throw new CosmionError('usage', 'No agents chosen.')
    return found
  }
  const chosen = answer.split(/[\s,]+/).map((word) => {
    const agent = AGENTS[Number(word) - 1]
    if (!/^\d+$/.test(word) || !agent) {
      throw new CosmionError('usage', `"${word}" isn't a number from the list.`)
    }
    return agent
  })
  return AGENTS.filter((agent) => chosen.includes(agent))
}

async function askScope(ctx: Context, prompt: ReturnType<typeof createPrompt>): Promise<Scope> {
  const answer = (
    await prompt.ask(
      question(
        ctx,
        'Global (all projects) or this project? [g/p]: ',
        'Global (all projects) or this project?',
        'g/p',
      ),
    )
  )
    .trim()
    .toLowerCase()
  if (answer === 'g' || answer === 'global') return 'global'
  if (answer === 'p' || answer === 'project') return 'project'
  throw new CosmionError('usage', 'Answer g (global) or p (this project).')
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
