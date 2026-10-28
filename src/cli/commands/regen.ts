import { CosmionError } from '../../core/errors.js'
import { defineCommand } from '../define.js'
import { execute, prepare } from '../generate.js'
import { ledgerEntrySchema, readLedger } from '../ledger.js'
import { formatUsd, warn } from '../output.js'

export const regen = defineCommand({
  name: 'regen',
  summary: 'Run a past generation again, with the same model, prompt, settings and references',
  args: [{ name: 'id', required: true, description: 'An id from `cosmion history`' }],
  options: [
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
    const original = (await readLedger(ctx)).find((entry) => entry.id === input.id)
    if (!original) {
      throw new CosmionError(
        'not_found',
        `No generation "${input.id}". Run \`cosmion history\` to see the ids.`,
      )
    }
    // FR-085: the original request, unchanged; only where it is saved can change.
    const prepared = await prepare(ctx, {
      prompt: original.prompt,
      model: original.model,
      options: {},
      settings: original.settings,
      refs: original.references,
      out: input.out,
      force: input.force,
    })
    if (original.settings.seed === undefined) {
      warn(ctx, `${original.id} has no seed, so the result won't be identical.`)
    }
    const entry = await execute(ctx, { ...prepared, regenOf: original.id })
    const cost = entry.cost_usd === null ? 'an unknown cost' : formatUsd(entry.cost_usd)
    ctx.stderr.write(
      `Generated ${entry.id} (again from ${original.id}) with ${entry.model} for ${cost}.\n`,
    )
    return { data: entry }
  },
  text: (entry) => entry.images.map((image) => image.path).join('\n'),
})
