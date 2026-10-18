import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, test } from 'vitest'

// Constitution VI: src/core holds the logic. It never imports from the CLI, prints or
// exits the process.
const coreDir = join(import.meta.dirname, '..', 'src', 'core')

const forbidden: [RegExp, string][] = [
  [/(?:from|import)\s*\(?\s*['"][^'"]*\/cli(?:\/[^'"]*)?['"]/, 'imports from src/cli'],
  [/\bconsole\./, 'uses console'],
  [/\bprocess\.exit\b/, 'calls process.exit'],
  [/\bprocess\.(?:stdout|stderr)\b/, 'writes to process.stdout/stderr'],
]

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(dir, name))
}

test('src/core never imports from src/cli, prints or exits', () => {
  const violations = sourceFiles(coreDir).flatMap((file) => {
    const source = readFileSync(file, 'utf8')
    return forbidden
      .filter(([pattern]) => pattern.test(source))
      .map(([, what]) => `${relative(coreDir, file)} ${what}`)
  })
  expect(violations).toEqual([])
})
