import { createInterface } from 'node:readline'
import type { Context } from './context.js'
import { InterruptedError } from './hidden-input.js'

/**
 * Asks questions on a terminal, one visible line each. Questions go to stderr, as stdout is
 * for data. The end of input answers with an empty line; Ctrl-C throws InterruptedError.
 * Call `close` when done, or the process waits on the terminal and never exits.
 */
export function createPrompt(ctx: Context): {
  ask(question: string): Promise<string>
  close(): void
} {
  const lines = createInterface({ input: ctx.stdin, terminal: false })[Symbol.asyncIterator]()
  return {
    async ask(question) {
      if (ctx.signal.aborted) throw new InterruptedError()
      ctx.stderr.write(question)
      let onAbort = () => {}
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new InterruptedError())
        ctx.signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        const next = await Promise.race([lines.next(), aborted])
        return next.done ? '' : next.value
      } finally {
        ctx.signal.removeEventListener('abort', onAbort)
      }
    },
    close() {
      lines.return?.()
      ctx.stdin.pause()
    },
  }
}
