import type { NormalizedTarget } from '../../core/ports'

const NAME = '[A-Za-z0-9_]{2,21}'
const SHORT_FORM = new RegExp(`^/?r/(${NAME})(?:/.*)?$`, 'i')
/** Pseudo-communities that aggregate other communities: not a place to promote anything. */
const AGGREGATES = new Set(['all', 'popular', 'random', 'friends', 'mod', 'home'])

function redditHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'reddit.com' || host.endsWith('.reddit.com')
}

/** Subreddit name from "r/name", "/r/name", or any reddit.com URL under /r/name; null when not recognized. */
export function parseSubreddit(input: string): string | null {
  const text = input.trim()
  const short = SHORT_FORM.exec(text)
  if (short) return short[1]
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (!redditHost(url.hostname)) return null
  const match = SHORT_FORM.exec(url.pathname)
  return match ? match[1] : null
}

export function isRedditAddress(input: string): boolean {
  return parseSubreddit(input) !== null
}

export function normalizeRedditTarget(input: string): NormalizedTarget {
  const name = parseSubreddit(input)
  if (!name) throw new Error(`Not a Reddit community address: ${input}`)
  if (AGGREGATES.has(name.toLowerCase())) throw new Error(`r/${name} is a feed of other communities; choose a specific community`)
  return { target: `r/${name}`, url: `https://www.reddit.com/r/${name}/` }
}

/** Post id (without "t3_") from a reddit URL like /r/x/comments/abc123/slug/. */
export function postIdFromUrl(url: string): string | null {
  const match = /\/comments\/([a-z0-9]+)(?:\/|$|\?)/i.exec(url)
  return match ? match[1] : null
}

export function stripPrefix(fullname: string): string {
  return fullname.replace(/^t[1-6]_/, '')
}

const FULLNAME = /^t[13]_[a-z0-9]{1,12}$/i
export function isFullname(value: string): boolean {
  return FULLNAME.test(value)
}
