// The address on this Mac a platform sends the browser back to after the owner allowed the application in the platform's own window
// (OAuth with a code, RFC 8252 section 7.3). It is open only while a sign-in is going on, answers only on 127.0.0.1, and takes one answer:
// the one that carries the random word this sign-in was started with.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

/** The port and the path are fixed: a platform compares the address with the one registered in the owner's app, letter by letter. */
export const SIGN_IN_PORT = 47821
export const SIGN_IN_PATH = '/signin'
export const SIGN_IN_CALLBACK = `http://127.0.0.1:${SIGN_IN_PORT}${SIGN_IN_PATH}`

export interface SignInWait {
  /** The address the platform is told to send the browser back to. */
  redirectUri: string
  /** What the platform sent back (the code, or its refusal). Rejects when nobody answered in time or the wait was stopped. */
  answer: Promise<URLSearchParams>
  stop(): void
}

export interface SignInListener {
  listen(state: string, timeoutMs: number): Promise<SignInWait>
}

const page = (words: string): string => `<!doctype html><meta charset="utf-8"><title>Product Promotion Desk</title><body style="font: 16px system-ui; margin: 3em"><p>${words}</p>`

/** `port` 0 takes any free port (tests); the application uses the fixed one. */
export function createSignInListener(port = SIGN_IN_PORT): SignInListener {
  return {
    listen: (state, timeoutMs) =>
      new Promise<SignInWait>((resolve, reject) => {
        let settle: { got(params: URLSearchParams): void; failed(error: Error): void } | null = null
        const answer = new Promise<URLSearchParams>((got, failed) => (settle = { got, failed }))
        // A wait that is stopped before anyone listens to it must not end the process.
        answer.catch(() => undefined)
        let done = false
        const finish = (act: () => void): void => {
          if (done) return
          done = true
          clearTimeout(timer)
          server.close()
          server.closeAllConnections()
          act()
        }
        const server = createServer((req, res) => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          const html = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
          if (req.method !== 'GET' || url.pathname !== SIGN_IN_PATH || url.searchParams.get('state') !== state) {
            res.writeHead(404, html).end(page('This is not the answer Product Promotion Desk is waiting for.'))
            return
          }
          res.writeHead(200, html).end(page('Product Promotion Desk has the answer. You can close this window and go back to the application.'), () => finish(() => settle?.got(url.searchParams)))
        })
        const timer = setTimeout(() => finish(() => settle?.failed(new Error(`Nobody allowed it within ${Math.round(timeoutMs / 60_000)} minutes, so the application stopped waiting. Press the sign-in button again.`))), timeoutMs)
        server.once('error', (error: NodeJS.ErrnoException) => {
          clearTimeout(timer)
          reject(
            new Error(
              error.code === 'EADDRINUSE'
                ? `Another program on this Mac uses the address a sign-in answers to (127.0.0.1:${port}), or a sign-in is going on already. Close it or wait, and try again.`
                : `The address a sign-in answers to could not be opened (${error.message}).`
            )
          )
        })
        server.listen(port, '127.0.0.1', () => {
          resolve({ redirectUri: `http://127.0.0.1:${(server.address() as AddressInfo).port}${SIGN_IN_PATH}`, answer, stop: () => finish(() => settle?.failed(new Error('The sign-in was stopped.'))) })
        })
      })
  }
}
