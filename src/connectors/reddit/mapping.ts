// Pure mapping from Reddit's documented listing/comment JSON to the connector contract.
// Everything is defensive: a malformed node is skipped instead of failing the whole read.

import type { RemoteComment, RemoteDiscussion } from '../../core/ports'
import { asRecord, isoFromEpochSeconds, num, str } from '../text'

export const REDDIT_ORIGIN = 'https://www.reddit.com'

export interface RedditPost {
  /** Fullname, e.g. "t3_abc123". Used as the discussion's externalId. */
  fullname: string
  title: string
  author: string
  body: string
  permalink: string
  url: string
  createdAt: string | null
  score: number | null
  numComments: number | null
  upvoteRatio: number | null
  locked: boolean
  archived: boolean
  removed: boolean
  subreddit: string
}

export interface MappedComments {
  comments: RemoteComment[]
  /** Ids (without prefix) hidden behind "load more" stubs that can still be expanded. */
  moreIds: string[]
  /** Deleted or removed comments that were left out. */
  skipped: number
}

const DELETED_NAMES = new Set(['[deleted]', '[removed]'])
const DELETED_BODIES = new Set(['[deleted]', '[removed]'])

export function absoluteUrl(permalink: string): string {
  if (/^https?:\/\//i.test(permalink)) return permalink
  return `${REDDIT_ORIGIN}${permalink.startsWith('/') ? '' : '/'}${permalink}`
}

function childrenOf(listing: unknown): unknown[] {
  const data = asRecord(asRecord(listing)?.data)
  return Array.isArray(data?.children) ? data.children : []
}

export function mapPost(thing: unknown): RedditPost | null {
  const node = asRecord(thing)
  const data = asRecord(node?.data)
  if (!data || node?.kind !== 't3') return null
  const fullname = str(data.name) || (str(data.id) ? `t3_${str(data.id)}` : '')
  if (!fullname) return null
  const selftext = str(data.selftext)
  const isSelf = data.is_self === true
  const outbound = str(data.url_overridden_by_dest) || str(data.url)
  const removedCategory = data.removed_by_category
  return {
    fullname,
    title: str(data.title),
    author: str(data.author, '[deleted]'),
    body: selftext || (!isSelf && outbound ? `Link: ${outbound}` : ''),
    permalink: absoluteUrl(str(data.permalink)),
    url: outbound,
    createdAt: isoFromEpochSeconds(data.created_utc),
    score: num(data.score),
    numComments: num(data.num_comments),
    upvoteRatio: num(data.upvote_ratio),
    locked: data.locked === true,
    archived: data.archived === true,
    removed: (typeof removedCategory === 'string' && removedCategory !== '') || selftext === '[removed]',
    subreddit: str(data.subreddit)
  }
}

export function mapListing(json: unknown): RedditPost[] | null {
  const root = asRecord(json)
  if (!root || root.kind !== 'Listing') return null
  return childrenOf(root).flatMap((child) => {
    const post = mapPost(child)
    return post ? [post] : []
  })
}

function mapComment(data: Record<string, unknown>, fallbackBase: string): RemoteComment | 'skipped' | null {
  const fullname = str(data.name) || (str(data.id) ? `t1_${str(data.id)}` : '')
  if (!fullname) return null
  const author = str(data.author)
  const body = str(data.body)
  if (DELETED_NAMES.has(author) || DELETED_BODIES.has(body.trim()) || data.removal_reason || data.banned_by) return 'skipped'
  const permalink = str(data.permalink)
  return {
    externalId: fullname,
    parentExternalId: str(data.parent_id) || null,
    author,
    body,
    url: permalink ? absoluteUrl(permalink) : `${fallbackBase}${str(data.id)}/`,
    postedAt: isoFromEpochSeconds(data.created_utc)
  }
}

/**
 * Flattens a comment tree. Nested replies become entries with `parentExternalId`; deleted and removed
 * comments are skipped (their replies are kept); "load more" stubs are reported in `moreIds`.
 */
export function flattenComments(listing: unknown, postPermalink: string): MappedComments {
  const out: MappedComments = { comments: [], moreIds: [], skipped: 0 }
  const seen = new Set<string>()
  const visit = (nodes: unknown[], depth: number): void => {
    if (depth > 60) return // pathological nesting: stop instead of overflowing the stack
    for (const node of nodes) {
      const thing = asRecord(node)
      const data = asRecord(thing?.data)
      if (!thing || !data) continue
      if (thing.kind === 'more') {
        for (const id of Array.isArray(data.children) ? data.children : []) if (typeof id === 'string' && id && id !== '_') out.moreIds.push(id)
        continue
      }
      if (thing.kind !== 't1') continue
      const mapped = mapComment(data, postPermalink)
      if (mapped === 'skipped') out.skipped += 1
      else if (mapped && !seen.has(mapped.externalId)) {
        seen.add(mapped.externalId)
        out.comments.push(mapped)
      }
      // Replies of a skipped comment are still real discussion content.
      if (data.replies) visit(childrenOf(data.replies), depth + 1)
    }
  }
  visit(childrenOf(listing), 0)
  return out
}

export interface MappedThread {
  post: RedditPost
  mapped: MappedComments
}

/** Maps the two-listing response of /comments/<id>.json. */
export function mapThread(json: unknown): MappedThread | null {
  if (!Array.isArray(json) || json.length < 2) return null
  const posts = mapListing(json[0])
  const post = posts?.[0]
  if (!post) return null
  return { post, mapped: flattenComments(json[1], post.permalink) }
}

/** Items of /api/morechildren.json (a flat list of things). */
export function mapMoreChildren(json: unknown, postPermalink: string): MappedComments {
  const things = asRecord(asRecord(asRecord(json)?.json)?.data)?.things
  const wrapped = { data: { children: Array.isArray(things) ? things : [] } }
  return flattenComments(wrapped, postPermalink)
}

export function toDiscussion(post: RedditPost, comments: RemoteComment[]): RemoteDiscussion {
  return {
    externalId: post.fullname,
    url: post.permalink,
    title: post.title,
    author: post.author,
    body: post.body,
    postedAt: post.createdAt,
    comments
  }
}

export interface AboutInfo {
  displayName: string
  subscribers: number | null
  activeUsers: number | null
  subredditType: string
  submissionType: string
  userIsBanned: boolean
  userIsContributor: boolean
  over18: boolean
}

export function mapAbout(json: unknown): AboutInfo | null {
  const root = asRecord(json)
  const data = asRecord(root?.data)
  if (!data || root?.kind !== 't5') return null
  return {
    displayName: str(data.display_name),
    subscribers: num(data.subscribers),
    activeUsers: num(data.accounts_active) ?? num(data.active_user_count),
    subredditType: str(data.subreddit_type, 'public'),
    submissionType: str(data.submission_type, 'any'),
    userIsBanned: data.user_is_banned === true,
    userIsContributor: data.user_is_contributor === true,
    over18: data.over18 === true || data.over_18 === true
  }
}

export function mapRules(json: unknown): { name: string; text: string }[] | null {
  const rules = asRecord(json)?.rules
  if (!Array.isArray(rules)) return null
  return rules.flatMap((rule) => {
    const r = asRecord(rule)
    if (!r) return []
    const name = str(r.short_name) || str(r.violation_reason)
    return name || str(r.description) ? [{ name, text: str(r.description) }] : []
  })
}

/** Username from /api/me.json (`{data:{name}}`) or /api/v1/me (`{name}`); null when logged out. */
export function mapMe(json: unknown): string | null {
  const root = asRecord(json)
  const name = str(asRecord(root?.data)?.name) || str(root?.name)
  return /^[A-Za-z0-9_-]{3,20}$/.test(name) ? name : null
}

export interface OwnComment {
  fullname: string
  author: string
  parentFullname: string
  body: string
  permalink: string
  createdAt: string | null
  score: number | null
  subreddit: string
}

export function mapOwnComments(json: unknown): OwnComment[] | null {
  const root = asRecord(json)
  if (!root || root.kind !== 'Listing') return null
  return childrenOf(root).flatMap((node) => {
    const thing = asRecord(node)
    const data = asRecord(thing?.data)
    if (!data || thing?.kind !== 't1') return []
    return [
      {
        fullname: str(data.name),
        author: str(data.author),
        parentFullname: str(data.parent_id),
        body: str(data.body),
        permalink: absoluteUrl(str(data.permalink)),
        createdAt: isoFromEpochSeconds(data.created_utc),
        score: num(data.score),
        subreddit: str(data.subreddit)
      }
    ]
  })
}
