import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { planOutPaths } from '../../src/cli/out-paths.js'
import { CosmionError } from '../../src/core/errors.js'
import { createTestContext } from '../helpers/run-cli.js'

const id = 'abcd1234'

function plan(out: string | undefined, count = 1, force = false) {
  const t = createTestContext()
  return {
    t,
    plan: (o = out, c = count, f = force) =>
      planOutPaths(t.ctx, { id, out: o, count: c, force: f }),
  }
}

async function usageError(promise: Promise<unknown>): Promise<CosmionError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(CosmionError)
  expect((error as CosmionError).code).toBe('usage')
  return error as CosmionError
}

// Permissions don't stop root, and Windows ignores the mode bits.
const canTestPermissions = process.platform !== 'win32' && process.getuid?.() !== 0

describe('default names in the cwd (FR-007)', () => {
  test('one image: cosmion-<id>.<ext>, the extension from the image', async () => {
    const { t, plan: p } = plan(undefined)
    const paths = await p()
    expect(paths.folder).toBe(t.cwd)
    expect(paths.exact).toBeNull()
    expect(paths.pathFor(1, '.jpg')).toBe(join(t.cwd, `cosmion-${id}.jpg`))
    expect(paths.pathFor(1, '.svg')).toBe(join(t.cwd, `cosmion-${id}.svg`))
  })

  test('several images: cosmion-<id>-<k>.<ext>, k from 1', async () => {
    const { t, plan: p } = plan(undefined, 3)
    const paths = await p()
    expect(paths.pathFor(1, '.png')).toBe(join(t.cwd, `cosmion-${id}-1.png`))
    expect(paths.pathFor(3, '.png')).toBe(join(t.cwd, `cosmion-${id}-3.png`))
  })
})

describe('--out (FR-008)', () => {
  test('an existing folder: default names inside it', async () => {
    const { t, plan: p } = plan('shots')
    mkdirSync(join(t.cwd, 'shots'))
    const paths = await p()
    expect(paths.folder).toBe(join(t.cwd, 'shots'))
    expect(paths.exact).toBeNull()
    expect(paths.pathFor(1, '.webp')).toBe(join(t.cwd, 'shots', `cosmion-${id}.webp`))
  })

  test.each([['new/'], ['new\\']])(
    '%s, ending in a separator: a folder, not created yet',
    async (out) => {
      const { t, plan: p } = plan(out, 2)
      const paths = await p()
      expect(paths.folder).toBe(join(t.cwd, 'new'))
      expect(paths.pathFor(2, '.jpg')).toBe(join(t.cwd, 'new', `cosmion-${id}-2.jpg`))
      expect(existsSync(join(t.cwd, 'new'))).toBe(false)
    },
  )

  test('a file path is written exactly, whatever the format; its folder is not created yet', async () => {
    const { t, plan: p } = plan('assets/hero.png')
    const paths = await p()
    expect(paths.folder).toBe(join(t.cwd, 'assets'))
    expect(paths.exact).toBe(join(t.cwd, 'assets', 'hero.png'))
    expect(paths.pathFor(1, '.webp')).toBe(join(t.cwd, 'assets', 'hero.png'))
    expect(existsSync(join(t.cwd, 'assets'))).toBe(false)
  })

  test('a file path for several images becomes <stem>-<k><ext>', async () => {
    const { t, plan: p } = plan('hero.png', 2)
    const paths = await p()
    expect(paths.pathFor(1, '.jpg')).toBe(join(t.cwd, 'hero-1.png'))
    expect(paths.pathFor(2, '.jpg')).toBe(join(t.cwd, 'hero-2.png'))
  })

  test('a path without an extension is written exactly', async () => {
    const { t, plan: p } = plan('hero')
    expect((await p()).pathFor(1, '.png')).toBe(join(t.cwd, 'hero'))
    expect((await p('hero', 2)).pathFor(2, '.png')).toBe(join(t.cwd, 'hero-2'))
  })

  test('an absolute path is used as it is', async () => {
    const { t, plan: p } = plan(undefined)
    const target = join(t.home, 'elsewhere', 'a.jpg')
    expect((await p(target)).pathFor(1, '.jpg')).toBe(target)
  })
})

describe('an existing file is refused without --force (FR-011)', () => {
  test('an exact path', async () => {
    const { t, plan: p } = plan('logo.png')
    writeFileSync(join(t.cwd, 'logo.png'), 'old')
    const error = await usageError(p())
    expect(error.message).toContain(join(t.cwd, 'logo.png'))
    expect(error.message).toContain('--force')
    await expect(p('logo.png', 1, true)).resolves.toBeDefined()
  })

  test('one of several numbered paths', async () => {
    const { t, plan: p } = plan('logo.png', 3)
    writeFileSync(join(t.cwd, 'logo-2.png'), 'old')
    const error = await usageError(p())
    expect(error.message).toContain('logo-2.png')
  })

  test.each([['png'], ['jpg'], ['webp'], ['svg'], ['gif']])(
    'cosmion-<id>.%s, since the format is only known afterwards',
    async (extension) => {
      const { t, plan: p } = plan(undefined)
      writeFileSync(join(t.cwd, `cosmion-${id}.${extension}`), 'old')
      await usageError(p())
      await expect(p(undefined, 1, true)).resolves.toBeDefined()
    },
  )

  test('a numbered default name', async () => {
    const { t, plan: p } = plan(undefined, 2)
    writeFileSync(join(t.cwd, `cosmion-${id}-2.webp`), 'old')
    await usageError(p())
  })
})

describe('the folder must be writable', () => {
  test.skipIf(!canTestPermissions)('an existing folder that is not', async () => {
    const { t, plan: p } = plan('locked/a.png')
    mkdirSync(join(t.cwd, 'locked'))
    chmodSync(join(t.cwd, 'locked'), 0o500)
    try {
      const error = await usageError(p())
      expect(error.message).toContain(join(t.cwd, 'locked'))
    } finally {
      chmodSync(join(t.cwd, 'locked'), 0o700)
    }
  })

  test.skipIf(!canTestPermissions)(
    'a folder that does not exist yet: the nearest existing one above it',
    async () => {
      const { t, plan: p } = plan('locked/deeper/still/a.png')
      mkdirSync(join(t.cwd, 'locked'))
      chmodSync(join(t.cwd, 'locked'), 0o500)
      try {
        const error = await usageError(p())
        expect(error.message).toContain(join(t.cwd, 'locked'))
        expect(existsSync(join(t.cwd, 'locked', 'deeper'))).toBe(false)
      } finally {
        chmodSync(join(t.cwd, 'locked'), 0o700)
      }
    },
  )

  test('a folder path that runs through a file', async () => {
    const { t, plan: p } = plan('notes.txt/a.png')
    writeFileSync(join(t.cwd, 'notes.txt'), 'text')
    const error = await usageError(p())
    expect(error.message).toContain('notes.txt')
  })
})
