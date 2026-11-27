// Account health (DEC-064): two things counted by the application for one account. The share of what it sent that carries the product's own
// site address, as a number (no judgement is attached: only what a site enforces stops a press, DEC-050). And, per channel, the latest posts'
// points against that channel's own earlier posts, to see when reach fell.
import { hostOf } from './answer-check'
import type { PostNumbers } from './post-numbers'

/** The share is counted over what was sent in this many days. */
export const HEALTH_DAYS = 30
/** Reach: the latest posts compared with the ones before them. */
export const RECENT_POSTS = 3
export const MIN_EARLIER = 3
/** "Fell" is at most this part of the usual; "rose" is at least this many times it. */
export const FELL_AT = 0.5
export const ROSE_AT = 1.5

/** Whether a sent text or its link field carries an address of the product's own site. */
export function carriesOwnLink(text: string, link: string | null, websiteUrl: string | null): boolean {
  const own = hostOf(websiteUrl)
  if (!own) return false
  const linkHost = hostOf(link)
  if (linkHost !== null && (linkHost === own || linkHost.endsWith(`.${own}`))) return true
  const escaped = own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9-])(?:[a-z0-9-]+\\.)*${escaped}(?![a-z0-9-]|\\.[a-z0-9])`, 'i').test(text)
}

export interface LinkShare {
  sent: number
  withLink: number
}

/** "3 of 12 (25%)" / "0 of 4" / "nothing sent". */
export function shareLine(share: LinkShare): string {
  if (share.sent === 0) return 'nothing sent'
  return share.withLink === 0 ? `0 of ${share.sent}` : `${share.withLink} of ${share.sent} (${Math.round((share.withLink / share.sent) * 100)}%)`
}

export type ReachStanding = 'fell' | 'usual' | 'rose' | 'unknown'

export interface Reach {
  /** The average of the latest posts' points or likes; null when unknown. */
  recent: number | null
  /** The average of the posts before them. */
  usual: number | null
  standing: ReachStanding
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length

/** The reach of a channel from its posts' numbers, the oldest first. Unknown with fewer than three latest and three earlier posts that have a number. */
export function reachOf(postsOldestFirst: readonly PostNumbers[]): Reach {
  const likes = postsOldestFirst.flatMap((n) => (n.likes === null ? [] : [n.likes]))
  if (likes.length < RECENT_POSTS + MIN_EARLIER) return { recent: null, usual: null, standing: 'unknown' }
  const recent = mean(likes.slice(-RECENT_POSTS))
  const usual = mean(likes.slice(0, -RECENT_POSTS))
  const standing: ReachStanding = usual <= 0 ? 'usual' : recent <= usual * FELL_AT ? 'fell' : recent >= usual * ROSE_AT ? 'rose' : 'usual'
  return { recent, usual, standing }
}
