import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { ApiError, WEB_TOKEN_HEADER, type ApiEvent, type ApiMethod } from '../shared/api'
import type { Core } from '../core/core'

const MAX_BODY = 5 * 1024 * 1024
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
}

export interface WebServerOptions {
  core: Core
  port: number
  token: string
  /** Directory holding the built renderer (index.html and assets). */
  staticDir: string
}

export interface RunningWebServer {
  url: string
  port: number
  close(): Promise<void>
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false
  return timingSafeEqual(digest(given), digest(expected))
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) throw new ApiError('too_large', 'Request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Loopback web mode (DEC-006): serves the same UI to a browser tab. It binds to 127.0.0.1 only, requires the
 * per-launch token for every API call and event stream, and rejects foreign Host and Origin headers
 * (DNS-rebinding and cross-site protection). Every handler is the same one Electron IPC uses, so no
 * authorization control can be bypassed through it.
 */
export async function startWebServer(options: WebServerOptions): Promise<RunningWebServer> {
  const { core, token, staticDir } = options
  const sseClients = new Set<ServerResponse>()
  const unsubscribe = core.events.subscribe((event: ApiEvent) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`
    for (const client of sseClients) client.write(frame)
  })

  let boundPort = options.port
  const allowedHosts = (): string[] => [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]
  const allowedOrigins = (): string[] => allowedHosts().map((h) => `http://${h}`)

  const server: Server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!res.headersSent) send(res, 500, { ok: false, error: { code: 'internal', message } })
      else res.end()
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!allowedHosts().includes(req.headers.host ?? '')) return send(res, 403, { ok: false, error: { code: 'forbidden_host', message: 'Host not allowed' } })
    const origin = req.headers.origin
    if (origin !== undefined && !allowedOrigins().includes(origin)) return send(res, 403, { ok: false, error: { code: 'forbidden_origin', message: 'Origin not allowed' } })

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const given = req.headers[WEB_TOKEN_HEADER]
      if (!tokenMatches(Array.isArray(given) ? given[0] : given, token)) return send(res, 401, { ok: false, error: { code: 'unauthorized', message: 'Missing or wrong token' } })
      const method = url.pathname.slice('/api/'.length) as ApiMethod
      const raw = await readBody(req)
      let args: unknown
      try {
        args = raw ? (JSON.parse(raw) as { args?: unknown }).args : undefined
      } catch {
        return send(res, 400, { ok: false, error: { code: 'bad_request', message: 'Body is not valid JSON' } })
      }
      try {
        const result = await core.router.call(method, args as never)
        return send(res, 200, { ok: true, result: result ?? null }, { 'content-type': 'application/json' })
      } catch (error) {
        const e = error instanceof ApiError ? error : new ApiError('internal', error instanceof Error ? error.message : String(error))
        return send(res, e.code === 'not_implemented' ? 404 : 400, { ok: false, error: { code: e.code, message: e.message } }, { 'content-type': 'application/json' })
      }
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      if (!tokenMatches(url.searchParams.get('token') ?? undefined, token)) return send(res, 401, { ok: false, error: { code: 'unauthorized', message: 'Missing or wrong token' } })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': connected\n\n')
      sseClients.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 20000)
      req.on('close', () => {
        clearInterval(ping)
        sseClients.delete(res)
      })
      return
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname, res)
    return send(res, 405, { ok: false, error: { code: 'method_not_allowed', message: 'Method not allowed' } })
  }

  async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const requested = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
    let file = join(staticDir, requested)
    if (!file.startsWith(staticDir + sep) && file !== staticDir) return send(res, 403, 'Forbidden', { 'content-type': 'text/plain' })
    try {
      const info = await stat(file)
      if (info.isDirectory()) file = join(file, 'index.html')
    } catch {
      // Unknown path: single-page app fallback.
      file = join(staticDir, 'index.html')
    }
    try {
      const data = await readFile(file)
      send(res, 200, data, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    } catch {
      send(res, 404, 'The UI has not been built (run npm run build).', { 'content-type': 'text/plain' })
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address && typeof address === 'object') boundPort = address.port

  return {
    url: `http://127.0.0.1:${boundPort}/?token=${token}`,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        unsubscribe()
        for (const client of sseClients) client.end()
        sseClients.clear()
        server.close(() => resolve())
        server.closeAllConnections()
      })
  }
}
