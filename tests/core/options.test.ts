import { describe, expect, test } from 'vitest'
import { CosmionError } from '../../src/core/errors.js'
import type { ImageModel } from '../../src/core/openrouter.js'
import { flagOf, randomSeed, sameSettingsKey, toSettings } from '../../src/core/options.js'

function model(supported_parameters: ImageModel['supported_parameters']): ImageModel {
  return { id: 'test/model', name: 'Test', description: '', supported_parameters }
}

const seedream = model({
  resolution: { type: 'enum', values: ['1K', '2K', '4K'] },
  aspect_ratio: { type: 'enum', values: ['1:1', '16:9'] },
  n: { type: 'range', min: 1, max: 10 },
  input_references: { type: 'range', min: 0, max: 14 },
  seed: { type: 'boolean' },
})

function usageError(fn: () => unknown): CosmionError {
  try {
    fn()
  } catch (error) {
    if (error instanceof CosmionError && error.code === 'usage') return error
    throw error
  }
  throw new Error('expected a usage error')
}

describe('toSettings', () => {
  test('maps each passed option to its API field, and only those', () => {
    const settings = toSettings(seedream, { aspect: '16:9', resolution: '2K', count: 3, seed: 7 })
    expect(settings).toEqual({ aspect_ratio: '16:9', resolution: '2K', n: 3, seed: 7 })
    expect(toSettings(seedream, {})).toEqual({})
  })

  test('maps every option of FR-003', () => {
    const all = model({
      aspect_ratio: { type: 'enum', values: ['1:1'] },
      resolution: { type: 'enum', values: ['1K'] },
      quality: { type: 'enum', values: ['high'] },
      background: { type: 'enum', values: ['transparent'] },
      n: { type: 'range', min: 1, max: 4 },
      seed: { type: 'boolean' },
      output_format: { type: 'enum', values: ['png'] },
      output_compression: { type: 'range', min: 0, max: 100 },
    })
    const options = {
      aspect: '1:1',
      resolution: '1K',
      quality: 'high',
      background: 'transparent',
      count: 2,
      seed: 1,
      format: 'png',
      compression: 80,
    }
    expect(toSettings(all, options)).toEqual({
      aspect_ratio: '1:1',
      resolution: '1K',
      quality: 'high',
      background: 'transparent',
      n: 2,
      seed: 1,
      output_format: 'png',
      output_compression: 80,
    })
  })

  test('an option whose key is absent is unsupported (FR-005)', () => {
    const error = usageError(() => toSettings(seedream, { quality: 'high' }))
    expect(error.message).toContain('--quality')
    expect(error.message).toContain('test/model')
    // It lists what the model does take.
    expect(error.message).toContain('--resolution')
  })

  test('an enum accepts only its listed values, and the message lists them', () => {
    expect(toSettings(seedream, { resolution: '4K' })).toEqual({ resolution: '4K' })
    const error = usageError(() => toSettings(seedream, { resolution: '8K' }))
    expect(error.message).toContain('--resolution')
    expect(error.message).toContain('test/model')
    expect(error.message).toContain('1K, 2K, 4K')
  })

  test('enum values are matched exactly', () => {
    usageError(() => toSettings(seedream, { resolution: '2k' }))
  })

  test('a range accepts only integers in range, and the message gives the range', () => {
    expect(toSettings(seedream, { count: 1 })).toEqual({ n: 1 })
    expect(toSettings(seedream, { count: 10 })).toEqual({ n: 10 })
    for (const count of [0, 11, 2.5]) {
      const error = usageError(() => toSettings(seedream, { count }))
      expect(error.message).toContain('--count')
      expect(error.message).toContain('test/model')
      expect(error.message).toContain('1 to 10')
    }
  })

  test('a boolean descriptor accepts any integer', () => {
    expect(toSettings(seedream, { seed: 2_147_483_647 })).toEqual({ seed: 2_147_483_647 })
  })

  test('a seed with a range descriptor is checked against it', () => {
    const ranged = model({ seed: { type: 'range', min: 0, max: 100 } })
    expect(toSettings(ranged, { seed: 100 })).toEqual({ seed: 100 })
    usageError(() => toSettings(ranged, { seed: 101 }))
  })
})

describe('randomSeed (FR-004)', () => {
  test('is within 0–2,147,483,647 when the seed option has no range', () => {
    for (let i = 0; i < 50; i++) {
      const seed = randomSeed(seedream)
      expect(Number.isInteger(seed)).toBe(true)
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(2_147_483_647)
    }
  })

  test("is within the model's seed range", () => {
    const ranged = model({ seed: { type: 'range', min: 5, max: 7 } })
    const seen = new Set<number | undefined>()
    for (let i = 0; i < 100; i++) seen.add(randomSeed(ranged))
    expect([...seen].sort()).toEqual([5, 6, 7])
  })

  test('is undefined for a model without a seed option', () => {
    expect(randomSeed(model({}))).toBeUndefined()
  })
})

describe('sameSettingsKey', () => {
  test('ignores the seed', () => {
    expect(sameSettingsKey({ resolution: '2K', seed: 1 }, 0)).toBe(
      sameSettingsKey({ resolution: '2K', seed: 2 }, 0),
    )
    expect(sameSettingsKey({ resolution: '2K', seed: 1 }, 0)).toBe(
      sameSettingsKey({ resolution: '2K' }, 0),
    )
  })

  test('ignores key order', () => {
    expect(sameSettingsKey({ resolution: '2K', aspect_ratio: '1:1' }, 0)).toBe(
      sameSettingsKey({ aspect_ratio: '1:1', resolution: '2K' }, 0),
    )
  })

  test('includes the number of references', () => {
    expect(sameSettingsKey({}, 1)).not.toBe(sameSettingsKey({}, 2))
  })

  test('differs when any other setting differs, including the count and format', () => {
    const base = sameSettingsKey({ resolution: '2K' }, 0)
    expect(sameSettingsKey({ resolution: '1K' }, 0)).not.toBe(base)
    expect(sameSettingsKey({ resolution: '2K', n: 2 }, 0)).not.toBe(base)
    expect(sameSettingsKey({ resolution: '2K', output_format: 'png' }, 0)).not.toBe(base)
  })
})

describe('flagOf', () => {
  test('gives the flag that sets an API field', () => {
    expect(flagOf('n')).toBe('--count')
    expect(flagOf('aspect_ratio')).toBe('--aspect')
    expect(flagOf('input_references')).toBe('--ref')
    expect(flagOf('seed')).toBe('--seed')
  })

  test('is undefined for a field no flag sets', () => {
    expect(flagOf('mystery')).toBeUndefined()
  })
})
