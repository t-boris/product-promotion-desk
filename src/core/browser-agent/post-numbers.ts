// The numbers look (DEC-075, changing DEC-056 on the owner's order): a watch mission whose record is not posts but the numbers the site
// shows under the owner's OWN sent posts, on a channel whose connector cannot read them (Instagram, Facebook, Threads, any site worked in
// the browser). The AI only reads, with the very tools of a watch mission. What it may record is held here: a post of the brief by its
// number, whole counts in a sane range, and an address on the platform's own domains. Whether a recorded page is that post is the flow's check.
import { isRecord } from '../assist/kit'
import { canonicalWatchUrl } from './watch'

/** The tool calls a numbers look has in all. */
export const NUMBERS_MAX_CALLS = 60
/** The posts one look is asked about, the newest first. */
export const NUMBERS_MAX_POSTS = 10
export const NUMBERS_MAX_ITEMS_PER_CALL = 10
const MAX_COUNT = 100_000_000

/** One of the owner's sent posts, as the brief names it. */
export interface OwnPostBrief {
  /** Its number in the brief, from 1. */
  n: number
  sentAt: string
  /** The first words of what was sent. */
  text: string
  /** The post's own address when it is known. */
  url: string | null
}

export interface PostNumbersItem {
  post: number
  likes: number | null
  comments: number | null
  views: number | null
  /** The post's own address as the AI gave it, on the platform's domains; null when it gave none. */
  url: string | null
  /** The text the application itself read on that address's page during this look; null when that page was not looked at. */
  body: string | null
}

/** What the toolbox is held to when the watch mission reads numbers. */
export interface NumbersSetup {
  /** How many posts the brief lists. */
  posts: number
  record: (items: PostNumbersItem[]) => { stored: number; refused?: string[] }
}

const count = (value: unknown): number | null | undefined => {
  if (value === undefined || value === null) return null
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : undefined
}

/** Reads what the AI handed to numbers_record. An entry that names no post of the brief, gives no count, or gives a count that is not a whole number is refused with the reason. */
export function readNumberItems(raw: unknown, hosts: string[], posts: number, bodies: ReadonlyMap<string, string>): { items: PostNumbersItem[]; refused: string[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: `items must be a list of 1 to ${NUMBERS_MAX_ITEMS_PER_CALL} posts, each with post and the counts the page shows.` }
  if (raw.length > NUMBERS_MAX_ITEMS_PER_CALL) return { error: `At most ${NUMBERS_MAX_ITEMS_PER_CALL} posts in one call; send the rest in the next one.` }
  const items: PostNumbersItem[] = []
  const refused: string[] = []
  raw.forEach((entry: unknown, index) => {
    const at = `Entry ${index + 1}`
    if (!isRecord(entry)) return void refused.push(`${at}: not an object.`)
    if (typeof entry.post !== 'number' || !Number.isInteger(entry.post) || entry.post < 1 || entry.post > posts) return void refused.push(`${at}: post must be the number of a post of your brief, from 1 to ${posts}.`)
    const likes = count(entry.likes)
    const comments = count(entry.comments)
    const views = count(entry.views)
    if (likes === undefined || comments === undefined || views === undefined) return void refused.push(`${at}: a count is a whole number as the page shows it (1,234 is 1234; 1.2K is 1200). Leave out a count the page does not show.`)
    if (likes === null && comments === null && views === null) return void refused.push(`${at}: no count given. Record a post only when the page shows at least one number under it.`)
    const given = entry.url === undefined || entry.url === null || entry.url === ''
    const url = given ? null : canonicalWatchUrl(entry.url, hosts)
    if (!given && url === null) return void refused.push(`${at}: url must be the post's own address on this site, as browser_snapshot lists it; or leave it out.`)
    items.push({ post: entry.post, likes, comments, views, url, body: url ? (bodies.get(url) ?? null) : null })
  })
  return { items, refused }
}
