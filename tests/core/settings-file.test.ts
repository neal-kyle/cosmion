import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CosmionError } from '../../src/core/errors.js'
import { readSettingsFile, writeSettingsFile } from '../../src/core/settings-file.js'

const isWindows = process.platform === 'win32'

function newFile() {
  const dir = mkdtempSync(join(tmpdir(), 'cosmion-settings-'))
  return { dir, file: join(dir, 'config', 'settings.json') }
}

const modeOf = (file: string) => statSync(file).mode & 0o777

describe('writeSettingsFile', () => {
  test('writes the value as JSON, creating the folder', async () => {
    const { file } = newFile()
    await writeSettingsFile(file, { api_key: 'sk-or-v1-x' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ api_key: 'sk-or-v1-x' })
  })

  test.skipIf(isWindows)('the file is owner-only (0600)', async () => {
    const { file } = newFile()
    await writeSettingsFile(file, { api_key: 'sk-or-v1-x' })
    expect(modeOf(file)).toBe(0o600)
  })

  test.skipIf(isWindows)('an existing file readable by others is reset to 0600', async () => {
    const { file } = newFile()
    await writeSettingsFile(file, { api_key: 'old' })
    chmodSync(file, 0o644)
    await writeSettingsFile(file, { api_key: 'new' })
    expect(modeOf(file)).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ api_key: 'new' })
  })

  test.skipIf(isWindows)('replaces the file by renaming a new one into place', async () => {
    const { file } = newFile()
    await writeSettingsFile(file, { api_key: 'old' })
    const before = statSync(file).ino
    await writeSettingsFile(file, { api_key: 'new' })
    expect(statSync(file).ino).not.toBe(before)
  })

  test('leaves no temporary file behind', async () => {
    const { dir, file } = newFile()
    await writeSettingsFile(file, { api_key: 'a' })
    await writeSettingsFile(file, { api_key: 'b' })
    expect(readdirSync(join(dir, 'config'))).toEqual(['settings.json'])
  })
})

describe('readSettingsFile', () => {
  test('returns what was written', async () => {
    const { file } = newFile()
    await writeSettingsFile(file, { api_key: 'sk-or-v1-x' })
    expect(await readSettingsFile(file)).toEqual({ api_key: 'sk-or-v1-x' })
  })

  test('a missing file returns nothing', async () => {
    const { file } = newFile()
    expect(await readSettingsFile(file)).toBeUndefined()
  })

  test("a file that isn't JSON is an error naming the file, without its contents", async () => {
    const { dir } = newFile()
    const file = join(dir, 'settings.json')
    writeFileSync(file, '{"api_key": "sk-or-v1-secret')
    const error = await readSettingsFile(file).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CosmionError)
    expect((error as CosmionError).message).toContain(file)
    expect((error as CosmionError).message).not.toContain('secret')
  })
})
