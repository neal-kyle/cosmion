import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A complete FR-050 ledger entry, with whatever the test changes. */
export function ledgerEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: 'k3f9x2ab',
    created_at: '2026-10-17T14:03:11.204Z',
    model: 'bytedance-seed/seedream-4.5',
    prompt: 'a lighthouse at dusk',
    settings: { aspect_ratio: '16:9', resolution: '2K' },
    references: [],
    images: [{ path: '/tmp/cosmion-k3f9x2ab.jpg', width: 2560, height: 1440, format: 'jpeg' }],
    cost_usd: 0.04,
    usage: { prompt_tokens: 17, completion_tokens: 16384, total_tokens: 16401 },
    provider: 'Seed',
    generation_id: 'gen-img-1792258557-72RzSYF8DvW74eAvO3UL',
    batch_id: null,
    row: null,
    regen_of: null,
    ...overrides,
  }
}

/** Writes the ledger file of a COSMION_HOME. Strings are written as they are (bad lines). */
export function writeLedger(home: string, lines: (Record<string, unknown> | string)[]): string {
  const file = join(home, 'data', 'ledger.jsonl')
  mkdirSync(join(home, 'data'), { recursive: true })
  const text = lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
  writeFileSync(file, `${text.join('\n')}\n`)
  return file
}
