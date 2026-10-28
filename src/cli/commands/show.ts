import { access } from 'node:fs/promises'
import { z } from 'zod'
import { CosmionError } from '../../core/errors.js'
import { defineCommand } from '../define.js'
import { ledgerEntrySchema, readLedger } from '../ledger.js'
import { formatTime, formatUsd } from '../output.js'

const imageSchema = ledgerEntrySchema.shape.images.element
const outputSchema = ledgerEntrySchema.extend({
  images: z.array(imageSchema.extend({ exists: z.boolean() })),
})
type Shown = z.infer<typeof outputSchema>

export const show = defineCommand({
  name: 'show',
  summary: 'Show one generation in full, and whether its images are still there',
  args: [{ name: 'id', required: true, description: 'An id from `cosmion history`' }],
  output: outputSchema,
  async run(input, ctx) {
    const entry = (await readLedger(ctx)).find((candidate) => candidate.id === input.id)
    if (!entry) {
      throw new CosmionError(
        'not_found',
        `No generation "${input.id}". Run \`cosmion history\` to see the ids.`,
      )
    }
    const images = await Promise.all(
      entry.images.map(async (image) => ({ ...image, exists: await exists(image.path) })),
    )
    return { data: { ...entry, images } }
  },
  text: showText,
})

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function showText(entry: Shown): string {
  const settings = Object.entries(entry.settings).map(([name, value]) => `${name}=${value}`)
  const lines = [
    `${entry.id}  ${formatTime(entry.created_at)}`,
    `Model:     ${entry.model}${entry.provider ? ` (${entry.provider})` : ''}`,
    `Cost:      ${entry.cost_usd === null ? 'unknown' : formatUsd(entry.cost_usd)}`,
    `Settings:  ${settings.length ? settings.join(', ') : 'none'}`,
    `Prompt:    ${entry.prompt}`,
  ]
  if (entry.references.length)
    lines.push('References:', ...entry.references.map((ref) => `  ${ref}`))
  lines.push('Images:')
  if (entry.images.length === 0) lines.push('  none saved')
  for (const image of entry.images) {
    const size =
      image.width === null ? image.format : `${image.width}×${image.height} ${image.format}`
    lines.push(
      `  ${image.path}  ${size}${image.exists ? '' : '  (missing: no longer at this path)'}`,
    )
  }
  if (entry.batch_id) lines.push(`Batch:     ${entry.batch_id}, row ${entry.row}`)
  if (entry.regen_of) lines.push(`Regen of:  ${entry.regen_of}`)
  if (entry.generation_id) lines.push(`Generation: ${entry.generation_id}`)
  return lines.join('\n')
}
