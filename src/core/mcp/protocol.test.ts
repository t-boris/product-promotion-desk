import { describe, expect, it } from 'vitest'
import { handleMcpMessage, MCP_PROTOCOL_VERSION, type McpToolHost } from './protocol'

const host = (call: McpToolHost['call']): McpToolHost => ({
  instructions: 'Use these tools.',
  tools: [{ name: 'echo', description: 'Echoes.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }],
  call
})

describe('MCP protocol handler', () => {
  it('answers initialize with the instructions and echoes the version the client asked for', async () => {
    const reply = await handleMcpMessage(host(async () => ({ text: '' })), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
    expect(reply).toMatchObject({ id: 1, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, instructions: 'Use these tools.' } })
    const fallback = await handleMcpMessage(host(async () => ({ text: '' })), { jsonrpc: '2.0', id: 2, method: 'initialize' })
    expect(fallback).toMatchObject({ result: { protocolVersion: MCP_PROTOCOL_VERSION } })
  })

  it('lists the tools and answers ping', async () => {
    const h = host(async () => ({ text: '' }))
    expect(await handleMcpMessage(h, { jsonrpc: '2.0', id: 3, method: 'tools/list' })).toMatchObject({ result: { tools: [{ name: 'echo' }] } })
    expect(await handleMcpMessage(h, { jsonrpc: '2.0', id: 4, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 4, result: {} })
  })

  it('calls a tool and wraps its text; a tool error is a result the AI can read', async () => {
    const calls: unknown[] = []
    const h = host(async (name, args) => {
      calls.push([name, args])
      return args.text === 'bad' ? { text: 'No.', isError: true } : { text: `got ${String(args.text)}` }
    })
    expect(await handleMcpMessage(h, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } })).toEqual({
      jsonrpc: '2.0',
      id: 5,
      result: { content: [{ type: 'text', text: 'got hi' }], isError: false }
    })
    expect(await handleMcpMessage(h, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo', arguments: { text: 'bad' } } })).toMatchObject({ result: { isError: true } })
    expect(calls).toEqual([['echo', { text: 'hi' }], ['echo', { text: 'bad' }]])
  })

  it('never throws out of a tool: a crash becomes an error result; an unknown tool is refused without being called', async () => {
    const boom = host(async () => {
      throw new Error('page gone')
    })
    expect(await handleMcpMessage(boom, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'echo', arguments: {} } })).toMatchObject({
      result: { isError: true, content: [{ text: 'The tool failed: page gone' }] }
    })
    let called = false
    const h = host(async () => ((called = true), { text: '' }))
    expect(await handleMcpMessage(h, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'shell', arguments: {} } })).toMatchObject({ result: { isError: true } })
    expect(called).toBe(false)
  })

  it('does not answer notifications or junk, and refuses an unknown method', async () => {
    const h = host(async () => ({ text: '' }))
    expect(await handleMcpMessage(h, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect(await handleMcpMessage(h, 'nonsense')).toBeNull()
    expect(await handleMcpMessage(h, { jsonrpc: '2.0', id: 9, method: 'resources/list' })).toMatchObject({ id: 9, error: { code: -32601 } })
  })
})
