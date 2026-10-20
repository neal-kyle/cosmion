/** Where a command writes; `isTTY` decides colors and the spinner. */
export interface OutStream {
  write(text: string): void
  isTTY: boolean
}

/**
 * Everything a command gets from the outside world, passed in so tests can swap it
 * (plan: Testing seams). Folders come from COSMION_HOME in `env`.
 */
export interface Context {
  env: Record<string, string | undefined>
  /** Tests can't safely change the process's folder, so commands use this one. */
  cwd: string
  /** `isTTY` decides whether prompting is allowed (FR-043). */
  stdin: NodeJS.ReadableStream & { isTTY?: boolean }
  stdout: OutStream
  stderr: OutStream
  fetch: typeof fetch
  /** `https://openrouter.ai/api/v1`, or COSMION_TEST_OPENROUTER_URL (FR-058). */
  baseUrl: string
  /** Aborted by Ctrl-C. */
  signal: AbortSignal
  platform: NodeJS.Platform
  nodeVersion: string
}
