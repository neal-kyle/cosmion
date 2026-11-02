/** The `error.code` values of FR-040. `internal` is anything unexpected, or a failed local write. */
export const ERROR_CODES = [
  'internal',
  'usage',
  'auth',
  'credits',
  'not_found',
  'rate_limited',
  'upstream',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/**
 * An error the CLI reports with its own exit code. `retryable` defaults to true for
 * `rate_limited` and `upstream`; Cosmion's own timeout passes `retryable: false`, since
 * the provider may already have charged (FR-017).
 */
export class CosmionError extends Error {
  readonly code: ErrorCode
  readonly retryable: boolean
  /** How long OpenRouter said to wait before retrying (its `Retry-After`), when it did. */
  readonly retryAfterSeconds: number | null

  constructor(
    code: ErrorCode,
    message: string,
    options: { retryable?: boolean; retryAfterSeconds?: number | null } = {},
  ) {
    super(message)
    this.name = 'CosmionError'
    this.code = code
    this.retryable = options.retryable ?? (code === 'rate_limited' || code === 'upstream')
    this.retryAfterSeconds = options.retryAfterSeconds ?? null
  }
}
