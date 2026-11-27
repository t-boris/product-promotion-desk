// A goal's number and date (DEC-067): a count the application makes itself from what it sent and what the sites show, how far it is, and by when.
// Visits, sign-ups and sales are not among the measures: the application has no access to the owner's site.

/** `visits` is offered only for a product whose site visits the application can read (DEC-073). */
export const GOAL_MEASURES = ['posts', 'replies', 'likes', 'comments', 'people', 'visits'] as const
export type GoalMeasure = (typeof GOAL_MEASURES)[number]

export const GOAL_MEASURE_LABEL: Record<GoalMeasure, string> = {
  posts: 'Posts sent',
  replies: 'Replies sent',
  likes: 'Points and likes under what was sent',
  comments: 'Comments received under what was sent',
  people: 'People added to People',
  visits: 'Visitors of the site (from its analytics)'
}

/** The measure inside a sentence: "12 of 40 posts sent". */
export const GOAL_MEASURE_WORDS: Record<GoalMeasure, string> = {
  posts: 'posts sent',
  replies: 'replies sent',
  likes: 'points and likes',
  comments: 'comments received',
  people: 'people met',
  visits: 'visitors of the site'
}

export const MAX_GOAL_NUMBER = 1_000_000

export interface GoalTarget {
  goalId: string
  measure: GoalMeasure
  number: number
  /** The local date it is due by, the whole day included: 2026-12-31. */
  by: string
  /** When the count started: the moment the target was set. */
  since: string
}

export type GoalState = 'running' | 'reached' | 'missed'

export interface GoalProgress extends GoalTarget {
  /** Counted by the application from the start to now, or to the end of the due day. */
  count: number
  state: GoalState
  /** Whole days left, the due day included; 0 once it has passed. */
  daysLeft: number
  /** Why the count could not be made now (the analytics service did not answer); the count is then the last known one or 0. */
  problem?: string
}

const DAY_MS = 86_400_000

/** A date as the owner types it: 2026-12-31, and a real day of the calendar. */
export function isDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) return false
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return date.getFullYear() === Number(m[1]) && date.getMonth() === Number(m[2]) - 1 && date.getDate() === Number(m[3])
}

/** The moment the due day ends, in the computer's own time. */
export function endOfDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d + 1).getTime()
}

export function goalState(count: number, number: number, nowMs: number, by: string): GoalState {
  return count >= number ? 'reached' : nowMs >= endOfDay(by) ? 'missed' : 'running'
}

export function daysLeft(nowMs: number, by: string): number {
  return Math.max(0, Math.ceil((endOfDay(by) - nowMs) / DAY_MS))
}

/** "12 of 40 comments received · 18 days left", "Reached: 41 of 40 …", "Not reached: 12 of 40 … by Dec 31". */
export function progressLine(p: Pick<GoalProgress, 'count' | 'number' | 'measure' | 'state' | 'daysLeft' | 'by'>): string {
  const core = `${p.count} of ${p.number} ${GOAL_MEASURE_WORDS[p.measure]}`
  if (p.state === 'reached') return `Reached: ${core}`
  if (p.state === 'missed') return `Not reached: ${core} by ${p.by}`
  return `${core} · ${p.daysLeft === 1 ? 'the last day' : `${p.daysLeft} days left`}`
}
