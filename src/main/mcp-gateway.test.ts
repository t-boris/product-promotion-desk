import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { relay } from '../mcp-shim/relay'
import type { McpToolHost } from '../core/mcp/protocol'
import { McpGateway } from './mcp-gateway'

let dir: string
let gateway: McpGateway

const host = (call: McpToolHost['call']): McpToolHost => ({
  instructions: 'Use these tools.',
  tools: [{ name: 'echo', description: 'Echoes.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
  call
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ppd-gw-'))
  gateway = new McpGateway({ socketPath: join(dir, 'g.sock'), command: '/Apps/PPD', shimPath: '/Apps/PPD/mcp-shim.js' })
  await gateway.start()
})

afterEach(() => {
  gateway.stop()
  rmSync(dir, { recursive: true, force: true })
})

/** What the engine would do with the server it was given: start it with its environment and talk MCP on stdin/stdout. */
function engineSide(env: Record<string, string>) {
  const input = new PassThrough()
  const output = new PassThrough()
  const lines: string[] = []
  let wake: () => void = () => undefined
  output.setEncoding('utf8')
  let buffer = ''
  output.on('data', (chunk: string) => {
    buffer += chunk
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      lines.push(buffer.slice(0, i))
      buffer = buffer.slice(i + 1)
      wake()
    }
  })
  const complaints: string[] = []
  const done = relay({ socketPath: env.PPD_MCP_SOCKET as string, token: env.PPD_MCP_TOKEN as string, input, output, complain: (m) => complaints.push(m) })
  const send = (message: unknown): void => void input.write(`${JSON.stringify(message)}\n`)
  const next = async (): Promise<unknown> => {
    while (lines.length === 0) await new Promise<void>((resolve) => ((wake = resolve), setTimeout(resolve, 20)))
    return JSON.parse(lines.shift() as string)
  }
  return { send, next, close: () => input.end(), done, complaints }
}

describe('MCP gateway and shim relay', () => {
  it('serves the socket to its owner only', () => {
    expect(statSync(join(dir, 'g.sock')).mode & 0o777).toBe(0o600)
  })

  it('hands the engine a command line that runs the shim as plain Node with the mission\'s token', async () => {
    const { launch } = await gateway.open(host(async () => ({ text: '' })))
    expect(launch.command).toBe('/Apps/PPD')
    expect(launch.args).toEqual(['/Apps/PPD/mcp-shim.js'])
    expect(launch.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', PPD_MCP_SOCKET: join(dir, 'g.sock') })
    expect(launch.env.PPD_MCP_TOKEN).toMatch(/^[0-9a-f]{48}$/)
  })

  it('relays initialize, tools/list and tools/call to the mission\'s tool host and the answers back', async () => {
    const calls: unknown[] = []
    const { launch } = await gateway.open(host(async (name, args) => (calls.push([name, args]), { text: `got ${String(args.text)}` })))
    const engine = engineSide(launch.env)
    engine.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(await engine.next()).toMatchObject({ id: 1, result: { instructions: 'Use these tools.' } })
    engine.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(await engine.next()).toMatchObject({ id: 2, result: { tools: [{ name: 'echo' }] } })
    engine.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    engine.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } })
    expect(await engine.next()).toMatchObject({ id: 3, result: { content: [{ text: 'got hi' }], isError: false } })
    expect(calls).toEqual([['echo', { text: 'hi' }]])
    engine.close()
    expect(await engine.done).toBe(0)
  })

  it('answers a quick call while another call is still waiting (a question to the owner holds nothing up)', async () => {
    let release: (text: string) => void = () => undefined
    const { launch } = await gateway.open(
      host((name, args) => (args.text === 'wait' ? new Promise((resolve) => (release = (text) => resolve({ text }))) : Promise.resolve({ text: 'quick' })))
    )
    const engine = engineSide(launch.env)
    engine.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { text: 'wait' } } })
    engine.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'now' } } })
    expect(await engine.next()).toMatchObject({ id: 2, result: { content: [{ text: 'quick' }] } })
    release('the owner answered')
    expect(await engine.next()).toMatchObject({ id: 1, result: { content: [{ text: 'the owner answered' }] } })
    engine.close()
    await engine.done
  })

  it('refuses a connection with an unknown token, and stops serving a mission when it is closed', async () => {
    const stranger = engineSide({ PPD_MCP_SOCKET: join(dir, 'g.sock'), PPD_MCP_TOKEN: 'guess' })
    expect(await stranger.done).toBe(1)
    expect(stranger.complaints[0]).toContain('ended this mission')

    const grant = await gateway.open(host(async () => ({ text: 'x' })))
    const engine = engineSide(grant.launch.env)
    engine.send({ jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(await engine.next()).toMatchObject({ id: 1 })
    grant.close()
    expect(await engine.done).toBe(1)
    const late = engineSide(grant.launch.env)
    expect(await late.done).toBe(1)
  })

  it('reports that the application is not running when the socket is gone', async () => {
    const { launch } = await gateway.open(host(async () => ({ text: '' })))
    gateway.stop()
    const engine = engineSide(launch.env)
    expect(await engine.done).toBe(1)
    expect(engine.complaints[0]).toContain('Cannot reach the application')
  })

  it('ignores junk lines without dropping the connection', async () => {
    const { launch } = await gateway.open(host(async () => ({ text: '' })))
    const raw = connect(launch.env.PPD_MCP_SOCKET as string)
    raw.write(`${JSON.stringify({ token: launch.env.PPD_MCP_TOKEN })}\nnot json\n${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' })}\n`)
    const reply = await new Promise<string>((resolve) => raw.once('data', (d) => resolve(String(d))))
    expect(JSON.parse(reply)).toMatchObject({ id: 9, result: {} })
    raw.destroy()
  })
})
