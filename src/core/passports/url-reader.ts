// Reading a product website with Node's built-in fetch. Only http(s) addresses are accepted, every request has a
// timeout and a size cap, and only same-site pages are followed (pricing, about, features, ...). A site that cannot
// be read is reported as data, never thrown: the product is kept and the user can continue from other sources.

import { ApiError } from '../../shared/api'
import { collapseWhitespace, htmlToPageText, truncate } from './text'

export interface SitePage {
  url: string
  title: string
  description: string
  siteName: string
  lang: string
  text: string
  fetchedAt: string
}

export interface SiteReadResult {
  pages: SitePage[]
  failures: { url: string; error: string }[]
}

export interface FetchLimits {
  timeoutMs: number
  maxBytes: number
  maxPages: number
  maxTextPerPage: number
}

export const DEFAULT_FETCH_LIMITS: FetchLimits = { timeoutMs: 10_000, maxBytes: 600 * 1024, maxPages: 5, maxTextPerPage: 30_000 }

const LINK_HINT = /(?:pric|plan|about|feature|faq|terms|how|product|contact|download|subscri|tariff|licen|help|support|why|benefit|solution)/i
const ASSET_EXTENSION = /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|pdf|zip|mp4|mp3|woff2?|ttf)(?:$|\?)/i

/**
 * Normalizes what the user typed into an http(s) URL. "example.com" becomes "https://example.com/". Any other scheme
 * (file:, javascript:, ftp:, ...) and embedded credentials are refused.
 */
export function normalizeHttpUrl(input: string): string {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) throw new ApiError('invalid_input', 'The website address is empty.')
  let candidate = raw
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    // "host:port" and "host/path" are web addresses without a scheme; "javascript:..." or "mailto:..." are not.
    const looksLikeHost = /^[^\s/:@]+(?::\d+)?(?:[/?#].*)?$/.test(raw)
    if (!looksLikeHost) throw new ApiError('invalid_input', 'Only http and https website addresses are supported.')
    candidate = `https://${raw}`
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new ApiError('invalid_input', `"${raw}" is not a valid website address.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ApiError('invalid_input', 'Only http and https website addresses are supported.')
  if (url.username || url.password) throw new ApiError('invalid_input', 'Do not put a user name or password into the website address.')
  if (!url.hostname) throw new ApiError('invalid_input', `"${raw}" is not a valid website address.`)
  url.hash = ''
  return url.toString()
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause
    const code = cause?.code
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'the site did not answer in time'
    if (code === 'ECONNREFUSED') return 'the connection was refused'
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'the address could not be resolved'
    return code ? `${error.message} (${code})` : error.message
  }
  return String(error)
}

/** Reads at most `maxBytes` of a response body. */
async function readBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    chunks.push(value)
    if (total >= maxBytes) {
      await reader.cancel()
      break
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, maxBytes).toString('utf8')
}

interface Fetched {
  html: string
  finalUrl: string
}

async function fetchHtml(url: string, limits: FetchLimits, signal: AbortSignal | undefined, userAgent: string): Promise<Fetched> {
  const timeout = AbortSignal.timeout(limits.timeoutMs)
  const response = await fetch(url, {
    redirect: 'follow',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,text/plain;q=0.8' }
  })
  const finalUrl = response.url || url
  if (!/^https?:\/\//i.test(finalUrl)) throw new Error('the site redirected to an unsupported address')
  if (!response.ok) throw new Error(`the site answered with HTTP ${response.status}`)
  const type = response.headers.get('content-type') ?? ''
  if (type && !/(?:text\/|application\/xhtml)/i.test(type)) throw new Error(`the address is not a web page (${type.split(';')[0]})`)
  return { html: await readBody(response, limits.maxBytes), finalUrl }
}

/** Same-site links worth reading next, most promising first. */
export function discoverLinks(html: string, baseUrl: string, max: number): string[] {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }
  const found: string[] = []
  const seen = new Set<string>([base.toString().replace(/\/$/, '')])
  const anchor = /<a\b[^>]{0,500}?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]{0,500}>([\s\S]{0,200}?)<\/a>/gi
  for (const match of html.matchAll(anchor)) {
    const href = (match[1] ?? match[2] ?? '').trim()
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href)) continue
    let target: URL
    try {
      target = new URL(href, base)
    } catch {
      continue
    }
    if (target.origin !== base.origin || ASSET_EXTENSION.test(target.pathname)) continue
    target.hash = ''
    target.search = ''
    const key = target.toString().replace(/\/$/, '')
    if (seen.has(key)) continue
    const label = collapseWhitespace((match[3] ?? '').replace(/<[^>]*>/g, ' '))
    if (!LINK_HINT.test(target.pathname) && !LINK_HINT.test(label)) continue
    seen.add(key)
    found.push(target.toString())
    if (found.length >= max) break
  }
  return found
}

function toPage(fetched: Fetched, limits: FetchLimits, fetchedAt: string): SitePage {
  const parsed = htmlToPageText(fetched.html)
  return {
    url: fetched.finalUrl,
    title: parsed.title,
    description: parsed.description,
    siteName: parsed.siteName,
    lang: parsed.lang,
    text: truncate(parsed.text, limits.maxTextPerPage),
    fetchedAt
  }
}

/**
 * Reads the main page of a site and a few related same-site pages. Failures are collected, never thrown; a failure of
 * the main page ends the attempt for that site.
 */
export async function readSite(
  startUrl: string,
  options: { signal?: AbortSignal; limits?: Partial<FetchLimits>; now: () => Date; userAgent: string }
): Promise<SiteReadResult> {
  const limits = { ...DEFAULT_FETCH_LIMITS, ...options.limits }
  const result: SiteReadResult = { pages: [], failures: [] }
  let main: Fetched
  try {
    main = await fetchHtml(startUrl, limits, options.signal, options.userAgent)
  } catch (error) {
    if (options.signal?.aborted) throw error
    result.failures.push({ url: startUrl, error: describeFetchError(error) })
    return result
  }
  result.pages.push(toPage(main, limits, options.now().toISOString()))
  for (const link of discoverLinks(main.html, main.finalUrl, limits.maxPages - 1)) {
    if (options.signal?.aborted) break
    try {
      const page = await fetchHtml(link, limits, options.signal, options.userAgent)
      result.pages.push(toPage(page, limits, options.now().toISOString()))
    } catch (error) {
      if (options.signal?.aborted) throw error
      result.failures.push({ url: link, error: describeFetchError(error) })
    }
  }
  return result
}
