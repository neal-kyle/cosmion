import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CosmionError } from './errors.js'

/**
 * The parsed JSON of a settings file, or undefined when there is none. Messages never
 * quote the contents: the file holds the key (FR-049).
 */
export async function readSettingsFile(file: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new CosmionError('internal', `Couldn't read ${file} (${reasonOf(error)}).`)
  }
  try {
    return JSON.parse(text)
  } catch {
    // JSON.parse's own message quotes the text around the error.
    throw new CosmionError('internal', `${file} isn't valid JSON. Fix it or delete it.`)
  }
}

/**
 * Writes the value as JSON, owner-only (0600; ignored on Windows, where the file sits in the
 * user's own profile). A new file is renamed into place, so a reader never sees half a file
 * and an existing file's wider permissions go with it.
 */
export async function writeSettingsFile(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    // The umask can change the mode given at creation.
    await chmod(temporary, 0o600)
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true })
    throw new CosmionError('internal', `Couldn't save ${file} (${reasonOf(error)}).`)
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
