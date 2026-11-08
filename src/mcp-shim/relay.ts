// The MCP server an AI engine starts for one mission (DEC-018) is this program: the application's own binary run as plain Node
// (ELECTRON_RUN_AS_NODE), the way MarkView runs `MarkView --mcp-browser`. It speaks MCP on stdin/stdout (one JSON message per line) and does
// nothing else than pass each line over a Unix socket to the running application, which answers it. No tool logic lives here: the
// application decides what every call may do, so this file stays small and without dependencies.

import { connect } from 'node:net'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

export interface RelayOptions {
  socketPath: string
  /** Proves to the application which mission this connection belongs to. */
  token: string
  input: Readable
  output: Writable
  /** Where a problem is reported (the engine shows it as the server's stderr). */
  complain: (message: string) => void
}

/** Relays until the engine closes its end or the application hangs up; resolves with the exit code. */
export function relay(options: RelayOptions): Promise<number> {
  return new Promise((resolve) => {
    const socket = connect(options.socketPath)
    let inputClosed = false
    let finished = false
    const finish = (code: number): void => {
      if (finished) return
      finished = true
      socket.destroy()
      resolve(code)
    }

    socket.on('error', (error) => {
      options.complain(`Cannot reach the application (${error.message}). Is Product Promotion Desk running?`)
      finish(1)
    })
    socket.on('close', () => {
      if (!inputClosed) options.complain('The application ended this mission.')
      finish(inputClosed ? 0 : 1)
    })
    socket.write(`${JSON.stringify({ token: options.token })}\n`)

    // A readline interface re-emits the errors of its input; the socket's own 'error' above already handles them.
    const fromApp = createInterface({ input: socket })
    fromApp.on('error', () => undefined)
    fromApp.on('line', (line) => {
      if (line.trim()) options.output.write(`${line}\n`)
    })
    const fromEngine = createInterface({ input: options.input })
    fromEngine.on('error', () => undefined)
    fromEngine.on('line', (line) => {
      if (line.trim() && !socket.destroyed) socket.write(`${line}\n`)
    })
    fromEngine.on('close', () => {
      inputClosed = true
      finish(0)
    })
  })
}
