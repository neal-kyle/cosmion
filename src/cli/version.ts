import { readFileSync } from 'node:fs'

/** The CLI's version, from package.json. */
export function readVersion(): string {
  // ../../package.json from both src/cli (tests) and dist/cli (the built CLI).
  const packageJson = new URL('../../package.json', import.meta.url)
  return JSON.parse(readFileSync(packageJson, 'utf8')).version
}
