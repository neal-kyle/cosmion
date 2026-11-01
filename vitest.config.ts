import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

// Anything that slips past a test's own temp folder lands here, never in the user's
// real settings, ledger or cache (SC-004, FR-064).
const home = mkdtempSync(join(tmpdir(), 'cosmion-test-home-'))

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/setup.ts'],
    env: { COSMION_HOME: home },
  },
})
