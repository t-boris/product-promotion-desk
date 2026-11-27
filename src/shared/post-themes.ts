// Themes (DEC-070): a named stretch of days in which a product's posts are about one thing. The owner names it and says what it says; while it
// runs the AI's proposed posts are given it, and the application adds up what went out in its days.
import { endOfDay, isDay } from './goal-target'

export const MAX_THEME_NAME = 80
export const MAX_THEME_MESSAGE = 400
export const MAX_THEMES = 50
/** A theme lasts at most this many days: longer is not a theme but the product itself. */
export const MAX_THEME_DAYS = 92

export interface Theme {
  id: string
  productId: string
  name: string
  /** What the theme says, in a sentence or two; given to the AI's proposed posts while the theme runs. */
  message: string
  /** Local days, both included: 2026-12-01. */
  from: string
  to: string
}

export type ThemeState = 'ahead' | 'running' | 'over'

export interface ThemeRecap {
  posts: number
  replies: number
  likes: number
  comments: number
}

export interface ThemeView extends Theme {
  state: ThemeState
  recap: ThemeRecap
}

/** The moment a local day starts. */
export function startOfDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).getTime()
}

export function themeState(nowMs: number, from: string, to: string): ThemeState {
  return nowMs < startOfDay(from) ? 'ahead' : nowMs >= endOfDay(to) ? 'over' : 'running'
}

/** Why the days cannot be a theme's, or null. */
export function daysProblem(from: string, to: string): string | null {
  if (!isDay(from) || !isDay(to)) return 'Choose the first and the last day.'
  if (to < from) return 'The last day must not be before the first.'
  if ((endOfDay(to) - startOfDay(from)) / 86_400_000 > MAX_THEME_DAYS + 1) return `A theme lasts at most ${MAX_THEME_DAYS} days.`
  return null
}

/** Running first, then the ones ahead (the nearest first), then the ones over (the latest first). */
export function orderedThemes<T extends { state: ThemeState; from: string; to: string }>(themes: readonly T[]): T[] {
  const rank: Record<ThemeState, number> = { running: 0, ahead: 1, over: 2 }
  return [...themes].sort((a, b) => rank[a.state] - rank[b.state] || (a.state === 'over' ? b.to.localeCompare(a.to) : a.from.localeCompare(b.from)))
}

/** "3 posts and 5 replies sent · 40 points and likes · 12 comments" / "nothing sent in its days" */
export function recapLine(recap: ThemeRecap): string {
  if (recap.posts + recap.replies === 0) return 'nothing sent in its days'
  const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`
  return `${n(recap.posts, 'post', 'posts')} and ${n(recap.replies, 'reply', 'replies')} sent · ${recap.likes} points and likes · ${n(recap.comments, 'comment', 'comments')}`
}
