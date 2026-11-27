// Conversations (DEC-063): when a post has "taken off" against its channel's own usual, and how long a comment addressed to the account has
// waited. Both are worked out by the application from what it read on the sites; the AI has no part in them.
import type { PostNumbers } from './post-numbers'

/** A post can be said to have taken off only in its first days: later the talk under it is over. */
export const TOOK_OFF_DAYS = 4
/** The channel's usual needs this many earlier posts with numbers. */
export const MIN_EARLIER_POSTS = 3
/** Taken off: at least this many times the usual, and not less than the floor (twice a usual of one is nothing). */
export const TIMES_USUAL = 2
export const FLOOR = { likes: 10, comments: 5 } as const

export interface Usual {
  likes: number | null
  comments: number | null
}

const mean = (values: number[]): number | null => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length)

/** The channel's usual: the average of its earlier posts' numbers, each kind from the posts that have it; null with too few posts. */
export function usualOf(earlier: readonly PostNumbers[]): Usual | null {
  if (earlier.length < MIN_EARLIER_POSTS) return null
  return {
    likes: mean(earlier.flatMap((n) => (n.likes === null ? [] : [n.likes]))),
    comments: mean(earlier.flatMap((n) => (n.comments === null ? [] : [n.comments])))
  }
}

/** Which of a post's numbers are far above the channel's usual; null when none is (or the usual is unknown). */
export function tookOff(numbers: PostNumbers, usual: Usual | null): { likes: boolean; comments: boolean } | null {
  if (!usual) return null
  const above = (value: number | null, usualValue: number | null, floor: number): boolean => value !== null && usualValue !== null && value >= floor && value >= usualValue * TIMES_USUAL
  const result = { likes: above(numbers.likes, usual.likes, FLOOR.likes), comments: above(numbers.comments, usual.comments, FLOOR.comments) }
  return result.likes || result.comments ? result : null
}

/** A comment to the account is worth a note once it has waited this long; after the window an answer is rarely read. */
export const WAITING_FROM_HOURS = 12
export const REPLY_WINDOW_HOURS = 48

/** What an Inbox item says about a waiting comment, or '' while it is fresh. */
export function waitedNote(waitedMs: number): string {
  const hours = Math.floor(waitedMs / 3_600_000)
  if (hours < WAITING_FROM_HOURS) return ''
  if (hours >= REPLY_WINDOW_HOURS) return `Has waited ${Math.floor(hours / 24)} days: an answer this late is rarely read. `
  return `Has waited ${hours} hours: an answer within two days is the one that is read. `
}
