import { mkdtempSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WEB_TOKEN_HEADER } from '../shared/api'
import { makeTestCore, type TestCore } from '../core/testing/fakes'
import { startWebServer, type RunningWebServer } from './web-server'

const TOKEN = 'test-token-123'

function http(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: unknown }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers: { host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body))
    req.end()
  })
}

describe('web mode server', () => {
  let t: TestCore
  let server: RunningWebServer

  beforeEach(async () => {
    t = makeTestCore()
    const dir = mkdtempSync(join(tmpdir(), 'ppd-static-'))
    writeFileSync(join(dir, 'index.html'), '<html>ui</html>')
    server = await startWebServer({ core: t.core, port: 0, token: TOKEN, staticDir: dir })
  })

  afterEach(async () => {
    await server.close()
    await t.core.shutdown()
  })

  it('binds to loopback and serves the UI shell', async () => {
    const res = await http(server.port, { path: '/' })
    expect(res.status).toBe(200)
    expect(res.body).toContain('ui')
    expect(server.url.startsWith('http://127.0.0.1:')).toBe(true)
  })

  it('refuses API calls without the token or with a wrong one', async () => {
    expect((await http(server.port, { method: 'POST', path: '/api/app.info', body: {} })).status).toBe(401)
    expect((await http(server.port, { method: 'POST', path: '/api/app.info', headers: { [WEB_TOKEN_HEADER]: 'nope' }, body: {} })).status).toBe(401)
  })

  it('answers API calls with the token', async () => {
    const res = await http(server.port, { method: 'POST', path: '/api/app.info', headers: { [WEB_TOKEN_HEADER]: TOKEN }, body: {} })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, result: { version: '0.0.0-test' } })
  })

  it('rejects foreign Host headers (DNS rebinding) and foreign Origins', async () => {
    const host = await http(server.port, { method: 'POST', path: '/api/app.info', headers: { host: 'evil.example:80', [WEB_TOKEN_HEADER]: TOKEN }, body: {} })
    expect(host.status).toBe(403)
    const origin = await http(server.port, { method: 'POST', path: '/api/app.info', headers: { origin: 'https://evil.example', [WEB_TOKEN_HEADER]: TOKEN }, body: {} })
    expect(origin.status).toBe(403)
    const ok = await http(server.port, { method: 'POST', path: '/api/app.info', headers: { origin: `http://127.0.0.1:${server.port}`, [WEB_TOKEN_HEADER]: TOKEN }, body: {} })
    expect(ok.status).toBe(200)
  })

  it('reports unknown methods and does not leak files outside the UI directory', async () => {
    const unknown = await http(server.port, { method: 'POST', path: '/api/does.not.exist', headers: { [WEB_TOKEN_HEADER]: TOKEN }, body: {} })
    expect(unknown.status).toBe(404)
    const traversal = await http(server.port, { path: '/..%2f..%2f..%2f..%2fetc%2fpasswd' })
    expect(traversal.body).not.toContain('root:')
  })

  it('streams core events to authorized clients only', async () => {
    expect((await http(server.port, { path: '/events' })).status).toBe(401)
    const received = await new Promise<string>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.port, path: `/events?token=${TOKEN}`, headers: { host: `127.0.0.1:${server.port}` } }, (res) => {
        res.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          if (text.includes('data:')) {
            req.destroy()
            resolve(text)
          }
        })
      })
      req.on('error', (e) => (e as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(e))
      req.end()
      setTimeout(() => t.core.events.changed('logs'), 50)
    })
    expect(received).toContain('"scope":"logs"')
  })
})
