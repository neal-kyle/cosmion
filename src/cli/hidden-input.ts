import type { Context } from './context.js'

/**
 * Ctrl-C while typing (in raw mode it arrives as a character, not as SIGINT), or during a
 * generation. The message is printed on stderr; exit 130.
 */
export class InterruptedError extends Error {
  constructor(message = 'Interrupted.') {
    super(message)
    this.name = 'InterruptedError'
  }
}

/**
 * Reads one line from a terminal without echoing it: Enter finishes, Backspace removes a
 * character, Ctrl-C throws InterruptedError. The prompt goes to stderr, stdout is for data.
 */
export function readHidden(ctx: Context, prompt: string): Promise<string> {
  const { stdin } = ctx
  ctx.stderr.write(prompt)
  stdin.setRawMode?.(true)

  return new Promise((resolve, reject) => {
    let line = ''
    const finish = (error?: Error) => {
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      ctx.signal.removeEventListener('abort', onAbort)
      stdin.setRawMode?.(false)
      // Stop reading, or the process waits on the terminal and never exits.
      stdin.pause()
      ctx.stderr.write('\n')
      if (error) reject(error)
      else resolve(line)
    }
    const onData = (chunk: Buffer | string) => {
      for (const char of String(chunk)) {
        // Ctrl-D finishes too, as it ends input elsewhere.
        if (char === '\r' || char === '\n' || char === '\x04') return finish()
        if (char === '\x03') return finish(new InterruptedError())
        if (char === '\x7f' || char === '\b') line = line.slice(0, -1)
        else if (char >= ' ') line += char
      }
    }
    const onEnd = () => finish()
    const onAbort = () => finish(new InterruptedError())
    stdin.on('data', onData)
    stdin.on('end', onEnd)
    ctx.signal.addEventListener('abort', onAbort)
  })
}
