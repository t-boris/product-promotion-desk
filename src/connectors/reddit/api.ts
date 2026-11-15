// Reddit reads. Every call is a same-origin fetch executed inside the account's logged-in page,
// so the account's cookies apply and nothing leaves the browser session.

import type { BrowserPage } from '../../core/ports'
import { fetchJsonScript, type FetchResult } from '../page-scripts'
import { asRecord, str } from '../text'
import {
  mapAbout,
  mapListing,
  mapMe,
  mapMoreChildren,
  mapOwnComments,
  mapRules,
  mapThread,
  type AboutInfo,
  type MappedComments,
  type MappedThread,
  type OwnComment,
  type RedditPost
} from './mapping'

function isRedditUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'reddit.com' || host.endsWith('.reddit.com')
  } catch {
    return false
  }
}

/** Same-origin fetches need the page to sit on a reddit.com document; load `fallbackUrl` if it does not. */
export async function ensureRedditOrigin(page: BrowserPage, fallbackUrl: string): Promise<void> {
  if (!isRedditUrl(await page.url())) await page.goto(fallbackUrl, { timeoutMs: 30_000 })
}

export type ApiOutcome<T> = { ok: true; value: T } | { ok: false; status: number; reason: string }

const USERNAME = /^[A-Za-z0-9_-]{3,20}$/
const POST_ID = /^[a-z0-9]{1,12}$/i

/** Longest stretch of a site's own words that is shown: it ends up in the owner's table, the log and, for a refused ability, a prompt. */
const MAX_WORDS = 100

/**
 * Plain words and nothing else: letters, digits, spaces and a few marks. A handle after u/ or @, an e-mail, an address and a long token are
 * dropped before anything is shown. A bare word that is somebody's name cannot be told from any other word: Reddit's reasons are codes and
 * sentences, not an echo of the account, and what is kept is cut short.
 */
export function plainWords(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/(?<![\p{L}\p{N}])(?:u|user)\/[\w-]+/giu, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/@[\w.-]+/g, ' ')
    .replace(/\b[\w-]{24,}\b/g, ' ')
    .replace(/[^\p{L}\p{N} .,:;'"()_/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_WORDS)
    .trim()
}

/** What a page that is not data says it is, by words that only such a page uses. Fixed phrases: the page's own text is never passed on. */
const KNOWN_PAGES: [RegExp, string][] = [
  [/blocked by network security|whoa there,? pardner|you['’]ve been blocked|request blocked|access denied by/i, 'a network-security block page'],
  [/verify you are (?:a )?human|just a moment|attention required|checking your browser|captcha/i, 'a human-check page'],
  [/too many requests|rate limit/i, 'a "too many requests" page'],
  [/<title>[^<]*\b(?:log ?in|sign ?in)\b/i, 'a sign-in page']
]

/**
 * What Reddit itself said about a refusal, in safe words, or '' when it said nothing. A JSON answer: its `reason`, else its `message`, as
 * plain words. Anything else (a page): a fixed phrase for a known kind of page, else that it was a page and not data. Never raw text.
 */
export function refusalWords(res: FetchResult): string {
  const json = asRecord(res.json)
  if (json) return plainWords(str(json.reason) || str(json.message))
  const page = KNOWN_PAGES.find(([pattern]) => pattern.test(res.text))
  if (page) return page[1]
  return /html/i.test(res.type ?? '') || /^\s*</.test(res.text) ? 'an HTML page instead of data, with no reason given' : ''
}

function failure(res: FetchResult): { ok: false; status: number; reason: string } {
  const words = refusalWords(res)
  let text: string
  if (res.status === 0) text = plainWords(res.text) || 'network error'
  else if (res.status === 404) text = 'not found'
  else if (res.status === 401 || res.status === 403) text = words ? `access denied (${words}), HTTP ${res.status}` : `access denied, HTTP ${res.status}`
  else if (res.status === 429) text = 'rate limited by Reddit'
  else if (res.status >= 500) text = 'Reddit server error'
  else text = `unexpected response (HTTP ${res.status})`
  return { ok: false, status: res.status, reason: text }
}

export class RedditApi {
  constructor(private readonly page: BrowserPage) {}

  private get(path: string): Promise<FetchResult> {
    return this.page.read<FetchResult>(fetchJsonScript(path))
  }

  /** Logged-in username, or null when the session is logged out. */
  async me(): Promise<string | null> {
    const res = await this.get('/api/me.json?raw_json=1')
    return res.status === 200 ? mapMe(res.json) : null
  }

  async listing(subreddit: string, limit: number): Promise<ApiOutcome<RedditPost[]>> {
    const res = await this.get(`/r/${subreddit}/new.json?limit=${Math.max(1, Math.min(100, limit))}&raw_json=1`)
    if (res.status !== 200) return failure(res)
    const posts = mapListing(res.json)
    return posts ? { ok: true, value: posts } : { ok: false, status: res.status, reason: 'unexpected listing format' }
  }

  async thread(subreddit: string, postFullnameOrId: string): Promise<ApiOutcome<MappedThread>> {
    const id = postFullnameOrId.replace(/^t3_/, '')
    if (!POST_ID.test(id)) return { ok: false, status: 0, reason: 'invalid post id' }
    const res = await this.get(`/r/${subreddit}/comments/${id}.json?limit=500&depth=10&sort=new&raw_json=1`)
    if (res.status !== 200) return failure(res)
    const thread = mapThread(res.json)
    return thread ? { ok: true, value: thread } : { ok: false, status: res.status, reason: 'unexpected thread format' }
  }

  /**
   * Expands "load more" stubs, at most `maxRequests` calls of 100 ids each. Failures keep what was read so far.
   * `moreIds` of the result lists every id that was NOT read (also those of a failed call), and `incomplete` is set
   * whenever anything was left unread, so the caller can tell a whole thread from a partial one.
   */
  async expandMore(postFullname: string, moreIds: string[], postPermalink: string, maxRequests = 3): Promise<MappedComments> {
    const out: MappedComments = { comments: [], moreIds: [], skipped: 0, incomplete: false }
    const unique = [...new Set(moreIds)]
    const pending = unique.filter((id) => POST_ID.test(id))
    if (pending.length < unique.length) out.incomplete = true // ids that cannot be requested at all
    for (let call = 0; call < maxRequests && pending.length > 0; call += 1) {
      const batch = pending.splice(0, 100)
      const res = await this.get(
        `/api/morechildren.json?api_type=json&raw_json=1&link_id=${postFullname}&children=${batch.join(',')}`
      )
      if (res.status !== 200) {
        pending.unshift(...batch) // not read: must stay visible as unread
        break
      }
      const mapped = mapMoreChildren(res.json, postPermalink)
      if (mapped.incomplete) out.incomplete = true
      out.comments.push(...mapped.comments)
      out.skipped += mapped.skipped
      pending.push(...mapped.moreIds.filter((id) => POST_ID.test(id)))
    }
    out.moreIds = pending
    if (pending.length > 0) out.incomplete = true
    return out
  }

  async about(subreddit: string): Promise<ApiOutcome<AboutInfo>> {
    const res = await this.get(`/r/${subreddit}/about.json?raw_json=1`)
    if (res.status !== 200) return failure(res)
    const about = mapAbout(res.json)
    return about ? { ok: true, value: about } : { ok: false, status: res.status, reason: 'unexpected response' }
  }

  async rules(subreddit: string): Promise<ApiOutcome<{ name: string; text: string }[]>> {
    const res = await this.get(`/r/${subreddit}/about/rules.json?raw_json=1`)
    if (res.status !== 200) return failure(res)
    const rules = mapRules(res.json)
    return rules ? { ok: true, value: rules } : { ok: false, status: res.status, reason: 'unexpected response' }
  }

  async ownSubmitted(username: string, limit: number): Promise<ApiOutcome<RedditPost[]>> {
    if (!USERNAME.test(username)) return { ok: false, status: 0, reason: 'invalid username' }
    const res = await this.get(`/user/${username}/submitted.json?limit=${limit}&sort=new&raw_json=1`)
    if (res.status !== 200) return failure(res)
    const posts = mapListing(res.json)
    return posts ? { ok: true, value: posts } : { ok: false, status: res.status, reason: 'unexpected listing format' }
  }

  async ownComments(username: string, limit: number): Promise<ApiOutcome<OwnComment[]>> {
    if (!USERNAME.test(username)) return { ok: false, status: 0, reason: 'invalid username' }
    const res = await this.get(`/user/${username}/comments.json?limit=${limit}&sort=new&raw_json=1`)
    if (res.status !== 200) return failure(res)
    const comments = mapOwnComments(res.json)
    return comments ? { ok: true, value: comments } : { ok: false, status: res.status, reason: 'unexpected listing format' }
  }

  /** One thing by fullname via /api/info.json (post or comment), used to read a fresh submission back. */
  async info(fullname: string): Promise<ApiOutcome<{ posts: RedditPost[]; comments: OwnComment[] }>> {
    if (!/^t[13]_[a-z0-9]{1,12}$/i.test(fullname)) return { ok: false, status: 0, reason: 'invalid id' }
    const res = await this.get(`/api/info.json?id=${fullname}&raw_json=1`)
    if (res.status !== 200) return failure(res)
    return { ok: true, value: { posts: mapListing(res.json) ?? [], comments: mapOwnComments(res.json) ?? [] } }
  }
}
