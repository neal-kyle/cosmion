import { join } from 'node:path'
import envPaths from 'env-paths'
import type { Context } from './context.js'
import { ENV_PREFIX, FOLDER_NAME } from './name.js'

export interface Paths {
  config: string
  data: string
  cache: string
}

/**
 * Where Cosmion keeps its files: under COSMION_HOME when set (FR-057), otherwise the
 * per-OS folders. env-paths appends `-nodejs` unless told not to.
 */
export function resolvePaths(env: Context['env']): Paths {
  const home = env[`${ENV_PREFIX}HOME`]
  if (home) {
    return { config: join(home, 'config'), data: join(home, 'data'), cache: join(home, 'cache') }
  }
  const { config, data, cache } = envPaths(FOLDER_NAME, { suffix: '' })
  return { config, data, cache }
}
