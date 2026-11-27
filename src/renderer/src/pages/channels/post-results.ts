// What the Results tab of a channel shows, as plain data: which columns the site has numbers for, the totals, and each post's line over time.
import { likesWord, type PostNumbers } from '../../../../shared/post-numbers'
import type { PostResult, PostResultsView } from '../../../../shared/types'

export type NumberKey = keyof PostNumbers

export const NUMBER_ORDER: readonly NumberKey[] = ['views', 'likes', 'comments']

/** The heading of a column, in the platform's own word for its likes. */
export function columnLabel(key: NumberKey, platform: string): string {
  if (key === 'views') return 'Views'
  if (key === 'comments') return 'Comments'
  const word = likesWord(platform, 2)
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The columns to draw: only those the site showed a number for on at least one post. A column nobody has is not drawn (never a column of dashes). */
export function shownColumns(posts: readonly PostResult[]): NumberKey[] {
  return NUMBER_ORDER.filter((key) => posts.some((post) => post.numbers?.[key] !== null && post.numbers?.[key] !== undefined))
}

/** The sum of a column over the posts that have it, and how many of the posts that is. */
export function totalOf(posts: readonly PostResult[], key: NumberKey): { sum: number; known: number } {
  const values = posts.map((post) => post.numbers?.[key]).filter((v): v is number => typeof v === 'number')
  return { sum: values.reduce((a, b) => a + b, 0), known: values.length }
}

/** The line a post's row draws: the first shown column over its readings. */
export function lineOf(post: PostResult, key: NumberKey): (number | null)[] {
  return post.readings.map((reading) => reading[key])
}

/** Why the tab has nothing to show, in words; null when it has. */
export function emptyReason(view: PostResultsView): string | null {
  if (!view.readable) return 'The application cannot read the numbers under posts on this channel yet. It reads them where it reads the site itself; here the posts are made in the browser and their numbers are on the site.'
  if (view.posts.length === 0) return 'No post of yours has gone out to this channel yet. When one does, what the site shows under it (views, likes, comments) is read here by itself.'
  return null
}
