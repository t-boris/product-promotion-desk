// The core's one way to the network for connectors that work through a platform's own API (DEC-055). A connector never calls fetch itself: it
// asks this port, so a test hands it a fake and nothing else in the application learns how a request is made.
import { openAsBlob } from 'node:fs'
import type { HttpPort, HttpRequest, HttpResponse } from '../ports'

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000
/** An upload of a video may take minutes on a slow line. */
export const UPLOAD_HTTP_TIMEOUT_MS = 10 * 60_000

/** A request that got no answer at all (no connection, a timeout): whether the platform acted on it is not known. */
export class HttpNoAnswerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HttpNoAnswerError'
  }
}

/** How long the platform asked to wait, from a Retry-After header in seconds; null when it did not say. */
export function retryAfterMs(headers: Record<string, string>): number | null {
  const seconds = Number(headers['retry-after'])
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** The real port: Node's fetch. A file of a form is read from its path as a stream, never loaded whole (lesson 322). */
export function createHttpPort(fetchImpl: Fetch = (url, init) => fetch(url, init)): HttpPort {
  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const headers: Record<string, string> = { ...(req.headers ?? {}) }
      let body: string | FormData | Blob | undefined
      let hasFile = false
      if (req.json !== undefined) {
        headers['content-type'] = 'application/json'
        body = JSON.stringify(req.json)
      } else if (req.form) {
        const form = new FormData()
        for (const [name, value] of Object.entries(req.form)) {
          if (typeof value === 'string') form.append(name, value)
          else {
            hasFile = true
            form.append(name, await openAsBlob(value.path, { type: value.mime }), value.name)
          }
        }
        body = form
      } else if (req.file) {
        hasFile = true
        headers['content-type'] = req.file.mime
        body = await openAsBlob(req.file.path, { type: req.file.mime })
      }
      const timeoutMs = req.timeoutMs ?? (hasFile ? UPLOAD_HTTP_TIMEOUT_MS : DEFAULT_HTTP_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetchImpl(req.url, { method: req.method, headers, body, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
      } catch (error) {
        // The address may hold a key (Telegram puts the bot token in the path): the error never repeats it.
        const name = error instanceof Error ? error.name : ''
        throw new HttpNoAnswerError(name === 'TimeoutError' || name === 'AbortError' ? `no answer within ${Math.round(timeoutMs / 1000)} seconds` : 'the connection failed')
      }
      const answer: Record<string, string> = {}
      response.headers.forEach((value, key) => (answer[key.toLowerCase()] = value))
      let text: string
      try {
        text = await response.text()
      } catch {
        throw new HttpNoAnswerError('the answer broke off')
      }
      return { status: response.status, headers: answer, text }
    }
  }
}
