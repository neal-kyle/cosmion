import { join } from 'node:path'
import envPaths from 'env-paths'
import { describe, expect, test } from 'vitest'
import { resolvePaths } from '../../src/cli/paths.js'

describe('with COSMION_HOME (FR-057)', () => {
  const home = join('somewhere', 'cosmion-home')
  const paths = resolvePaths({ COSMION_HOME: home })

  test('config, data and cache are folders under it', () => {
    expect(paths).toEqual({
      config: join(home, 'config'),
      data: join(home, 'data'),
      cache: join(home, 'cache'),
    })
  })

  test('nothing is used outside it', () => {
    for (const folder of Object.values(paths)) expect(folder.startsWith(home)).toBe(true)
  })

  test('an empty value counts as unset', () => {
    expect(resolvePaths({ COSMION_HOME: '' })).toEqual(resolvePaths({}))
  })
})

describe('without COSMION_HOME', () => {
  const expected = envPaths('cosmion-cli', { suffix: '' })
  const paths = resolvePaths({})

  test('the folders come from env-paths for cosmion-cli', () => {
    expect(paths).toEqual({ config: expected.config, data: expected.data, cache: expected.cache })
  })

  test('with no -nodejs suffix', () => {
    for (const folder of Object.values(paths)) {
      expect(folder).toContain('cosmion-cli')
      expect(folder).not.toContain('-nodejs')
    }
  })
})
