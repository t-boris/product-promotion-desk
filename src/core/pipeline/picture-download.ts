// Fetching one picture of a post from the address the page gave (the AI listed it from a snapshot of a page it visited). The address is a stranger's, so the
// application checks it before it goes anywhere: https only, no name or password in it, the usual port, a host that is a name (not a local one) or a public
// address, and every address the name resolves to is a public one. It follows at most three redirects, each checked the same way, sends no cookie and no
// header of the account, reads at most `PICTURE_MAX_BYTES` and keeps the bytes only when they are a PNG, a JPEG, a GIF or a WebP by their first bytes.
//
// The name is resolved here and again by `fetch`: a site that answers differently the second time is the one residual risk, and it can only make a
// request without credentials to an address that is not shown to anyone; what comes back is kept only when it is a picture.

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { sniffMime } from './attachments'

export const PICTURE_MAX_BYTES = 8 * 1024 * 1024
export const PICTURE_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 3

export type PictureResult = { ok: true; bytes: Buffer; mime: string } | { ok: false; reason: string }

export interface DownloadDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  /** Every address a name resolves to. */
  lookup: (host: string) => Promise<string[]>
}

export const defaultDownloadDeps: DownloadDeps = {
  fetch: (url, init) => fetch(url, init),
  lookup: async (host) => (await dnsLookup(host, { all: true })).map((entry) => entry.address)
}

/** Whether an IP address is one of the public internet: not loopback, private, link-local, carrier, documentation, multicast or reserved. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const [a, b] = address.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 168 || (b === 0 && address.startsWith('192.0.0.')) || (b === 0 && address.startsWith('192.0.2.')))) return false
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && address.startsWith('198.51.100.')))) return false
    if (a === 203 && b === 0 && address.startsWith('203.0.113.')) return false
    return true
  }
  if (version === 6) {
    const lower = address.toLowerCase()
    if (lower === '::' || lower === '::1') return false
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
    if (mapped) return isPublicAddress(mapped[1])
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff') || lower.startsWith('2001:db8')) return false
    return true
  }
  return false
}

/** Why an address is not fetched, in words; null when it may be. Syntax only: the name is resolved apart. */
export function addressProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'The address of the picture is not an address.'
  }
  if (url.protocol !== 'https:') return 'Only https addresses are fetched.'
  if (url.username || url.password) return 'An address with a name or a password in it is not fetched.'
  if (url.port !== '' && url.port !== '443') return 'Only the usual port is used.'
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return 'That address is on this computer or its network.'
  if (isIP(host) !== 0 && !isPublicAddress(host)) return 'That address is on this computer or its network.'
  if (isIP(host) === 0 && !host.includes('.')) return 'That is not a name on the internet.'
  return null
}

/** Reads the body up to the limit; null when it is longer. */
async function readBody(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > PICTURE_MAX_BYTES) return null
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > PICTURE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/** Fetches the picture at the address, or says why not. Never throws. */
export async function downloadPicture(address: string, deps: DownloadDeps = defaultDownloadDeps): Promise<PictureResult> {
  let current = address
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const problem = addressProblem(current)
      if (problem) return { ok: false, reason: problem }
      const host = new URL(current).hostname.replace(/^\[|\]$/g, '')
      const addresses = isIP(host) !== 0 ? [host] : await deps.lookup(host)
      if (addresses.length === 0 || !addresses.every(isPublicAddress)) return { ok: false, reason: 'That address is on this computer or its network.' }
      const response = await deps.fetch(current, {
        redirect: 'manual',
        credentials: 'omit',
        headers: { accept: 'image/png,image/jpeg,image/gif,image/webp;q=0.9,*/*;q=0.1' },
        signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS)
      })
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get('location')
        if (!next) return { ok: false, reason: 'The site sent the picture somewhere without saying where.' }
        current = new URL(next, current).href
        continue
      }
      if (response.status === 401 || response.status === 403) return { ok: false, reason: 'The site does not give this picture to anyone who is not signed in.' }
      if (!response.ok) return { ok: false, reason: `The site answered ${response.status}.` }
      const bytes = await readBody(response)
      if (bytes === null) return { ok: false, reason: `The picture is larger than ${PICTURE_MAX_BYTES / 1024 / 1024} MB.` }
      const mime = sniffMime(bytes.subarray(0, 16))
      if (!mime) return { ok: false, reason: 'What the site sent is not a PNG, JPEG, GIF or WebP picture.' }
      return { ok: true, bytes, mime }
    }
    return { ok: false, reason: 'The address was passed on too many times.' }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'The site did not answer in time.' : 'The picture could not be fetched.' }
  }
}
