import { defineCommand } from '../define.js'
import { genOptions, modelOption } from '../gen-options.js'
import { execute, prepare } from '../generate.js'
import { ledgerEntrySchema } from '../ledger.js'
import { formatUsd } from '../output.js'

export const gen = defineCommand({
  name: 'gen',
  summary: 'Generate images, save them, and record what they cost',
  args: [
    {
      name: 'prompt',
      required: true,
      description: 'What to generate, or - to read it from stdin',
    },
  ],
  options: [
    modelOption,
    ...genOptions,
    {
      name: 'out',
      flag: '--out <path>',
      type: 'string',
      description:
        'A file to write, or a folder (existing, or ending in /) for default names (default: the current folder)',
    },
    {
      name: 'force',
      flag: '--force',
      type: 'boolean',
      description: 'Replace files that already exist',
    },
  ],
  output: ledgerEntrySchema,
  async run(input, ctx) {
    let prompt = input.prompt
    if (prompt === '-') {
      prompt = ''
      for await (const chunk of ctx.stdin) prompt += chunk
    }
    const prepared = await prepare(ctx, {
      prompt,
      model: input.model,
      options: input,
      refs: input.ref,
      out: input.out,
      force: input.force,
    })
    const entry = await execute(ctx, prepared)
    const cost = entry.cost_usd === null ? 'an unknown cost' : formatUsd(entry.cost_usd)
    ctx.stderr.write(`Generated ${entry.id} with ${entry.model} for ${cost}.\n`)
    return { data: entry }
  },
  text: (entry) => entry.images.map((image) => image.path).join('\n'),
})
