import type { ErrorCode } from '../core/errors.js'

/**
 * The FR-040 exit codes, once. Keys that are error codes are also the `error.code` printed
 * with `--json`; `partial` (8) and `interrupted` (130) aren't errors.
 */
export const exitCodes = {
  ok: { code: 0, meaning: 'Success' },
  internal: { code: 1, meaning: 'Unexpected error, or a local write failed' },
  usage: {
    code: 2,
    meaning:
      'Invalid usage or input (flags, values, files, paths, interactive input needed without a TTY, OpenRouter 400)',
  },
  auth: { code: 3, meaning: 'No key, or key rejected (401)' },
  credits: { code: 4, meaning: 'Insufficient credits or key limit reached (402)' },
  not_found: { code: 5, meaning: 'Unknown model or ledger id (incl. OpenRouter 404)' },
  rate_limited: { code: 6, meaning: 'Rate limited (429)' },
  upstream: {
    code: 7,
    meaning: 'OpenRouter, provider or network failure, or timeout (5xx, 524)',
  },
  partial: {
    code: 8,
    meaning: 'Finished, but some parts failed or were skipped (batch rows, doctor checks)',
  },
  interrupted: { code: 130, meaning: 'Interrupted (Ctrl-C); nothing on stdout' },
} as const satisfies Record<
  ErrorCode | 'ok' | 'partial' | 'interrupted',
  { code: number; meaning: string }
>
