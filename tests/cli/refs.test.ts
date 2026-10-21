import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { readRefs } from '../../src/cli/refs.js'
import type { CatalogModel } from '../../src/core/catalog.js'
import { CosmionError } from '../../src/core/errors.js'
import { loadCatalogFixtures } from '../helpers/fake-openrouter.js'
import { createTestContext } from '../helpers/run-cli.js'

const images = join(import.meta.dirname, '..', 'helpers', 'fixtures', 'images')

function fixture(id: string): CatalogModel {
  const { models, endpoints } = loadCatalogFixtures()
  const found = models.find((model) => model.id === id)
  if (!found) throw new Error(`No fixture model ${id}`)
  return { ...found, endpoints: endpoints[id]?.endpoints ?? [] } as unknown as CatalogModel
}

// Takes up to 14 references.
const seedream = fixture('bytedance-seed/seedream-4.5')

/** A test context whose cwd holds the tiny fixture images, named as given. */
function withFiles(files: Record<string, string> = {}) {
  const t = createTestContext()
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(join(t.cwd, name, '..'), { recursive: true })
    copyFileSync(join(images, source), join(t.cwd, name))
  }
  return t
}

async function usageError(promise: Promise<unknown>): Promise<CosmionError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof CosmionError && error.code === 'usage') return error
    throw error
  }
  throw new Error('expected a usage error')
}

const base64 = (name: string) => readFileSync(join(images, name)).toString('base64')

describe('local files', () => {
  test.each([
    ['tiny.png', 'image/png'],
    ['tiny.jpg', 'image/jpeg'],
    ['tiny.webp', 'image/webp'],
  ])('%s becomes a base64 data URL of type %s', async (name, type) => {
    const t = withFiles({ [name]: name })
    const [ref] = await readRefs(t.ctx, seedream, [name])
    expect(ref?.url).toBe(`data:${type};base64,${base64(name)}`)
  })

  test('the type comes from the bytes, not the extension', async () => {
    const t = withFiles({ 'really-a-png.jpg': 'tiny.png' })
    const [ref] = await readRefs(t.ctx, seedream, ['really-a-png.jpg'])
    expect(ref?.url).toMatch(/^data:image\/png;base64,/)
  })

  test('relative paths are read from the cwd and recorded absolute', async () => {
    const t = withFiles({ 'sketches/a.png': 'tiny.png' })
    const [ref] = await readRefs(t.ctx, seedream, ['sketches/a.png'])
    expect(ref?.source).toBe(join(t.cwd, 'sketches', 'a.png'))
  })

  test('an absolute path is recorded as it is', async () => {
    const t = createTestContext()
    const [ref] = await readRefs(t.ctx, seedream, [join(images, 'tiny.png')])
    expect(ref?.source).toBe(join(images, 'tiny.png'))
  })

  test('several refs keep their order', async () => {
    const t = withFiles({ 'a.png': 'tiny.png', 'b.webp': 'tiny.webp' })
    const refs = await readRefs(t.ctx, seedream, ['b.webp', 'a.png'])
    expect(refs.map((ref) => ref.source)).toEqual([join(t.cwd, 'b.webp'), join(t.cwd, 'a.png')])
  })
})

describe('URLs', () => {
  test('https:// URLs pass unchanged and are recorded as they are', async () => {
    const t = createTestContext()
    const url = 'https://example.com/sketch.png?size=large'
    expect(await readRefs(t.ctx, seedream, [url])).toEqual([{ url, source: url }])
  })

  test('other URLs exit 2', async () => {
    const t = createTestContext()
    const error = await usageError(readRefs(t.ctx, seedream, ['http://example.com/a.png']))
    expect(error.message).toContain('https://')
  })
})

describe('exit 2 (FR-006)', () => {
  test('for a model without image input', async () => {
    const t = withFiles({ 'a.png': 'tiny.png' })
    const error = await usageError(
      readRefs(t.ctx, fixture('cosmion-test/no-references'), ['a.png']),
    )
    expect(error.message).toContain('cosmion-test/no-references')
    expect(error.message).toContain('--ref')
  })

  test('for an unreadable file, naming it', async () => {
    const t = createTestContext()
    const error = await usageError(readRefs(t.ctx, seedream, ['missing.png']))
    expect(error.message).toContain('missing.png')
  })

  test('for a folder', async () => {
    const t = createTestContext()
    mkdirSync(join(t.cwd, 'folder.png'))
    await usageError(readRefs(t.ctx, seedream, ['folder.png']))
  })

  test.each([
    ['another image type', 'tiny.gif'],
    ['a file that is not an image', 'notes.txt'],
  ])('for %s', async (_what, name) => {
    const t = withFiles(name === 'tiny.gif' ? { 'pic.png': 'tiny.gif' } : {})
    if (name === 'notes.txt') writeFileSync(join(t.cwd, 'pic.png'), 'just some text')
    const error = await usageError(readRefs(t.ctx, seedream, ['pic.png']))
    expect(error.message).toContain('pic.png')
    expect(error.message).toMatch(/PNG, JPEG or WebP/)
  })

  test("for more refs than the model's input_references maximum", async () => {
    // Gemini 2.5 Flash Image takes up to 3.
    const gemini = fixture('google/gemini-2.5-flash-image')
    const t = withFiles({ 'a.png': 'tiny.png' })
    expect(await readRefs(t.ctx, gemini, ['a.png', 'a.png', 'a.png'])).toHaveLength(3)
    const error = await usageError(readRefs(t.ctx, gemini, ['a.png', 'a.png', 'a.png', 'a.png']))
    expect(error.message).toContain('google/gemini-2.5-flash-image')
    expect(error.message).toContain('3')
  })
})

test('no refs: nothing to check, even for a model without image input', async () => {
  const t = createTestContext()
  expect(await readRefs(t.ctx, fixture('cosmion-test/no-references'), [])).toEqual([])
})
