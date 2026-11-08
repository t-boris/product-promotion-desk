// The application's side of the MCP server of an AI mission (DEC-018): a Unix socket (owner-only) on which the small program the engine
// started (src/mcp-shim) hands over each MCP message, and the core's tool host answers it. One grant per mission: a random token in the
// server's environment names the mission, and it stops working when the mission ends. The core never sees a socket.

import { randomBytes } from 'node:crypto'
import { chmodSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { handleMcpMessage, type AgentBridge, type McpLaunch, type McpToolHost } from '../core/mcp/protocol'

export interface McpGatewayOptions {
  /** Where the socket is created. Its folder is the user's temporary folder, which only they can read. */
  socketPath: string
  /** What the engine runs for the server: the application's own binary, as plain Node. */
  command: string
  /** The server program (the built src/mcp-shim). */
  shimPath: string
}

interface Grant {
  host: McpToolHost
  sockets: Set<Socket>
}

/** A message is a line of JSON: a line longer than this is not one. */
const MAX_LINE = 4 * 1024 * 1024

export class McpGateway implements AgentBridge {
  private server: Server | null = null
  private readonly grants = new Map<string, Grant>()

  constructor(private readonly options: McpGatewayOptions) {}

  async start(): Promise<void> {
    rmSync(this.options.socketPath, { force: true })
    const server = createServer((socket) => this.connection(socket))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.options.socketPath, () => resolve())
    })
    chmodSync(this.options.socketPath, 0o600)
    this.server = server
  }

  stop(): void {
    for (const grant of this.grants.values()) for (const socket of grant.sockets) socket.destroy()
    this.grants.clear()
    this.server?.close()
    this.server = null
    rmSync(this.options.socketPath, { force: true })
  }

  async open(host: McpToolHost): Promise<{ launch: McpLaunch; close: () => void }> {
    if (!this.server) throw new Error('The tool server of the application is not running.')
    const token = randomBytes(24).toString('hex')
    const grant: Grant = { host, sockets: new Set() }
    this.grants.set(token, grant)
    return {
      launch: {
        command: this.options.command,
        args: [this.options.shimPath],
        env: { ELECTRON_RUN_AS_NODE: '1', PPD_MCP_SOCKET: this.options.socketPath, PPD_MCP_TOKEN: token }
      },
      close: () => {
        this.grants.delete(token)
        for (const socket of grant.sockets) socket.destroy()
      }
    }
  }

  /** The first line of a connection names the mission; every later line is an MCP message. */
  private connection(socket: Socket): void {
    socket.setEncoding('utf8')
    let buffer = ''
    let grant: Grant | null = null
    socket.on('error', () => undefined)
    socket.on('close', () => grant?.sockets.delete(socket))
    socket.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > MAX_LINE && !buffer.includes('\n')) return void socket.destroy()
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (!grant) {
          grant = this.greet(line)
          if (!grant) return void socket.destroy()
          grant.sockets.add(socket)
        } else if (line.trim()) {
          void this.answer(grant.host, line, socket)
        }
      }
    })
  }

  private greet(line: string): Grant | null {
    try {
      const hello = JSON.parse(line) as { token?: unknown }
      return typeof hello.token === 'string' ? (this.grants.get(hello.token) ?? null) : null
    } catch {
      return null
    }
  }

  /** Each message is answered on its own, so a call that waits for the owner never holds up the others. */
  private async answer(host: McpToolHost, line: string, socket: Socket): Promise<void> {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const reply = await handleMcpMessage(host, message)
    if (reply && !socket.destroyed) socket.write(`${JSON.stringify(reply)}\n`)
  }
}
