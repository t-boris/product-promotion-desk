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

function failure(res: FetchResult): { ok: false; status: number; reason: string } {
  const json = asRecord(res.json)
  const reason = str(json?.reason) || str(json?.message)
  let text: string
  if (res.status === 0) text = res.text || 'network error'
  else if (res.status === 404) text = 'not found'
  else if (res.status === 401 || res.status === 403) text = reason ? `access denied (${reason})` : 'access denied'
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

  /** Expands "load more" stubs, at most `maxRequests` calls of 100 ids each. Failures keep what was read so far. */
  async expandMore(postFullname: string, moreIds: string[], postPermalink: string, maxRequests = 3): Promise<MappedComments> {
    const out: MappedComments = { comments: [], moreIds: [], skipped: 0 }
    const pending = [...new Set(moreIds)].filter((id) => POST_ID.test(id))
    for (let call = 0; call < maxRequests && pending.length > 0; call += 1) {
      const batch = pending.splice(0, 100)
      const res = await this.get(
        `/api/morechildren.json?api_type=json&raw_json=1&link_id=${postFullname}&children=${batch.join(',')}`
      )
      if (res.status !== 200) break
      const mapped = mapMoreChildren(res.json, postPermalink)
      out.comments.push(...mapped.comments)
      out.skipped += mapped.skipped
      pending.push(...mapped.moreIds.filter((id) => POST_ID.test(id)))
    }
    out.moreIds = pending
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
