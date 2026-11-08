// Helpers for the passports tests. Not imported by production code.
// No real network or AI is used: pages are served from a loopback HTTP server and the engine is scripted.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Product } from '../../shared/types'
import type { EngineId, EngineStatus } from '../../shared/types'
import type { Core } from '../core'
import { AiError, type AiEngine, type AiRunOptions, type AiTask } from '../ports'
import { makeTestCore, type TestCore } from '../testing/fakes'

type Handler = (task: AiTask) => string | Promise<string>

/** An AI engine whose answers are scripted per task label; it honours the abort signal like the real adapters. */
export class ScriptedEngine implements AiEngine {
  readonly calls: AiTask[] = []
  private readonly handlers = new Map<string, Handler>()
  installed = true

  constructor(
    readonly id: EngineId = 'claude',
    readonly label = 'Scripted engine'
  ) {}

  on(label: string, handler: string | Handler): this {
    this.handlers.set(label, typeof handler === 'string' ? () => handler : handler)
    return this
  }

  callsFor(label: string): AiTask[] {
    return this.calls.filter((c) => c.label === label)
  }

  async check(): Promise<EngineStatus> {
    return {
      id: this.id,
      label: this.label,
      installed: this.installed,
      version: '0.0-test',
      path: '/fake',
      ready: this.installed,
      detail: this.installed ? 'ok' : `${this.label} is not installed`,
      checkedAt: new Date().toISOString()
    }
  }

  async run(task: AiTask, options: AiRunOptions = {}): Promise<string> {
    this.calls.push(task)
    if (options.signal?.aborted) throw new AiError('cancelled', 'cancelled')
    if (!this.installed) throw new AiError('unavailable', `${this.label} is not installed`)
    // A repair request (label.repair) is answered by the handler of the original label unless scripted separately.
    const handler = this.handlers.get(task.label) ?? this.handlers.get(task.label.replace(/\.repair$/, ''))
    if (!handler) throw new AiError('failed', `No scripted answer for ${task.label}`)
    return new Promise<string>((resolve, reject) => {
      const onAbort = (): void => reject(new AiError('cancelled', 'cancelled'))
      options.signal?.addEventListener('abort', onAbort, { once: true })
      Promise.resolve()
        .then(() => handler(task))
        .then(resolve, reject)
        .finally(() => options.signal?.removeEventListener('abort', onAbort))
    })
  }
}

/** The evidence keys offered in a prompt, in order: <source key="W1" ...>. */
export function keysIn(prompt: string): string[] {
  return [...prompt.matchAll(/<source key="([A-Z]\d+)"/g)].map((m) => m[1])
}

export const json = (value: unknown): string => JSON.stringify(value)

export interface Deferred<T = void> {
  promise: Promise<T>
  resolve: (value: T) => void
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

export interface Site {
  url: string
  hits: string[]
  close(): Promise<void>
}

/** A loopback web server serving `pages` (path -> html). Anything else answers 404. */
export async function startSite(pages: Record<string, string>): Promise<Site> {
  const hits: string[] = []
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    hits.push(path)
    const body = pages[path]
    if (body === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/** An address on which nothing listens (connection refused). */
export async function unusedUrl(): Promise<string> {
  const site = await startSite({})
  const url = site.url
  await site.close()
  return url
}

export function html(title: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="en"><head><title>${title}</title>${extraHead}</head><body>${body}</body></html>`
}

/** Creates files under a fresh temp directory. Paths may contain subdirectories. */
export function makeFolder(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'ppd-folder-'))
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

export interface Harness extends Omit<TestCore, 'engine'> {
  engine: ScriptedEngine
  call: Core['router']['call']
}

/** A test core whose selected engine is a ScriptedEngine. */
export function makeHarness(engines: ScriptedEngine[] = [new ScriptedEngine()]): Harness {
  const t = makeTestCore({ engines })
  const [first] = engines
  t.core.settings.updateApp({ engineId: first.id })
  return { ...t, engine: first, call: t.core.router.call.bind(t.core.router) }
}

/** Waits until the analysis of a product has settled (no longer running). */
export async function waitForAnalysis(core: Core, productId: string, timeoutMs = 5000): Promise<Product> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const product = core.repos.product(productId)
    if (product.analysisStatus !== 'running') return product
    if (Date.now() > end) throw new Error('analysis did not settle in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}

export async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const end = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}
