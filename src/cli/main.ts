#!/usr/bin/env node
import { homedir } from 'node:os'
import type { Context } from './context.js'
import { run } from './run.js'

// Ctrl-C aborts the running command, which then exits 130. A second Ctrl-C kills the
// process the usual way, since `once` removes this handler.
const interrupt = new AbortController()
process.once('SIGINT', () => interrupt.abort())

// A reader that stops early (`cosmion models | head`) closes the pipe. Ignore the write
// error rather than crash: the command may be mid-generation, already paid for.
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})

const ctx: Context = {
  env: process.env,
  cwd: process.cwd(),
  stdin: process.stdin,
  stdout: {
    write: (text) => void process.stdout.write(text),
    isTTY: process.stdout.isTTY === true,
  },
  stderr: {
    write: (text) => void process.stderr.write(text),
    isTTY: process.stderr.isTTY === true,
  },
  fetch: globalThis.fetch,
  // Test-only (FR-058): lets the packaging and concurrency tests use a fake.
  baseUrl: process.env.COSMION_TEST_OPENROUTER_URL || 'https://openrouter.ai/api/v1',
  signal: interrupt.signal,
  platform: process.platform,
  nodeVersion: process.versions.node,
  homeDir: homedir(),
}

// exitCode rather than exit(), so piped output is flushed first.
process.exitCode = await run(process.argv.slice(2), ctx)
