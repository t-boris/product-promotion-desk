// The Model Context Protocol, the small part an AI engine needs to use the application's tools (DEC-018): JSON-RPC 2.0 messages,
// `initialize`, `tools/list`, `tools/call`. The core knows nothing about sockets or processes: the main process relays one message at a
// time, and this module answers it. A tool that fails answers with an error result the AI can read; it never throws out of here.

export const MCP_PROTOCOL_VERSION = '2025-06-18'

export interface McpTool {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] }
}

export interface McpToolResult {
  text: string
  /** True when the tool could not do what was asked; the AI reads `text` and decides what to do. */
  isError?: boolean
}

/** What the AI can use during one mission. */
export interface McpToolHost {
  /** Shown to the AI by its client when the server starts. */
  readonly instructions: string
  readonly tools: McpTool[]
  call(name: string, args: Record<string, unknown>): Promise<McpToolResult>
}

/** How the main process starts the server for one engine run: the command line and the environment the engine passes to it. */
export interface McpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

/** Offers a tool host to the engine of one run and tells how to reach it; implemented where sockets are (the main process). */
export interface AgentBridge {
  open(host: McpToolHost): Promise<{ launch: McpLaunch; close: () => void }>
}

type JsonRpcId = string | number

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The answer to one message, or null for a notification (a message without an id needs none). */
export async function handleMcpMessage(host: McpToolHost, message: unknown): Promise<JsonRpcResponse | null> {
  if (!isRecord(message)) return null
  const id = message.id
  if (typeof id !== 'string' && typeof id !== 'number') return null
  const method = typeof message.method === 'string' ? message.method : ''
  const params = isRecord(message.params) ? message.params : {}
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result })

  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'ppd', version: '1' },
        instructions: host.instructions
      })
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({ tools: host.tools })
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = isRecord(params.arguments) ? params.arguments : {}
      if (!host.tools.some((tool) => tool.name === name)) return ok(toolResult({ text: `There is no tool called "${name}".`, isError: true }))
      try {
        return ok(toolResult(await host.call(name, args)))
      } catch (error) {
        return ok(toolResult({ text: `The tool failed: ${error instanceof Error ? error.message : String(error)}`, isError: true }))
      }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  }
}

function toolResult(result: McpToolResult): { content: { type: 'text'; text: string }[]; isError: boolean } {
  return { content: [{ type: 'text', text: result.text }], isError: result.isError === true }
}
