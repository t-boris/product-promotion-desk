// Entry of the MCP server process (see relay.ts). Started by the engine with PPD_MCP_SOCKET and PPD_MCP_TOKEN in its environment.

import { relay } from './relay'

const socketPath = process.env.PPD_MCP_SOCKET
const token = process.env.PPD_MCP_TOKEN

if (!socketPath || !token) {
  process.stderr.write('Product Promotion Desk: this MCP server is started by the application for one AI mission.\n')
  process.exit(2)
}

void relay({
  socketPath,
  token,
  input: process.stdin,
  output: process.stdout,
  complain: (message) => process.stderr.write(`Product Promotion Desk: ${message}\n`)
}).then((code) => process.exit(code))
