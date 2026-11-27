// The weekly review of a product (DEC-057): what went out in a week, what the sites showed under it, and how that stands against the product's
// own usual. Everything here is counted by the application from its own records; the AI only writes words beside these numbers.
import type { PostNumbers } from './post-numbers'

export const WEEK_MS = 7 * 86_400_000
/** How many weeks before make "usual". */
export const USUAL_WEEKS = 4
/** A week with fewer sends has nothing to review: the page says so and the AI is not asked. */
export const MIN_SENDS_TO_REVIEW = 2
/** The local day and hour the review of the week that ended is prepared: Monday, 9:00. */
export const REVIEW_HOUR = 9
/** An accepted change steers the AI's drafts this long after the week it was made for ended. */
export const CHANGE_LASTS_MS = 2 * WEEK_MS

/** One confirmed send of the owner's: a post or a reply. */
export interface WeekSend {
  channelId: string
  kind: 'post' | 'reply'
  sentAtMs: number
  removed: boolean
  numbers: PostNumbers | null
}

export interface WeekSums {
  posts: number
  replies: number
  removed: number
  /** Sums over the posts the site showed a number for; null when it showed none. */
  likes: number | null
  comments: number | null
  views: number | null
  /** How many of the posts have a reading at all. */
  read: number
}

export interface UsualSums {
  /** The average week of the weeks before; null when those weeks have nothing to compare with. */
  posts: number | null
  replies: number | null
  likes: number | null
  comments: number | null
  views: number | null
  removed: number | null
}

export interface ChannelWeek {
  channelId: string
  week: WeekSums
  usual: UsualSums
}

export interface WeekNumbers {
  week: WeekSums
  before: WeekSums
  usual: UsualSums
  channels: ChannelWeek[]
}

/** The start of the week a moment falls in: Monday 00:00 of the computer's own time. */
export function weekStartOf(at: Date): Date {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

/** The Monday `weeks` weeks away from a week's start (calendar days, so a clock change does not move it). */
export function shiftWeeks(weekStart: Date, weeks: number): Date {
  return new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7 * weeks)
}

/** The week that ended last, and whether its review is due (Monday 9:00 has come). */
export function lastFullWeek(now: Date): { start: Date; end: Date; due: boolean } {
  const end = weekStartOf(now)
  const dueAt = new Date(end.getFullYear(), end.getMonth(), end.getDate(), REVIEW_HOUR)
  return { start: shiftWeeks(end, -1), end, due: now.getTime() >= dueAt.getTime() }
}

/** The local date of a week's start as text, the key a review is kept under: 2026-11-23. */
export function weekKey(weekStart: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${weekStart.getFullYear()}-${two(weekStart.getMonth() + 1)}-${two(weekStart.getDate())}`
}

export function weekOfKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return weekKey(date) === key && date.getDay() === 1 ? date : null
}

function sums(sends: readonly WeekSend[]): WeekSums {
  const posts = sends.filter((s) => s.kind === 'post')
  const total = (key: keyof PostNumbers): number | null => {
    const values = posts.map((p) => p.numbers?.[key]).filter((v): v is number => typeof v === 'number')
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null
  }
  return {
    posts: posts.length,
    replies: sends.length - posts.length,
    removed: sends.filter((s) => s.removed).length,
    likes: total('likes'),
    comments: total('comments'),
    views: total('views'),
    read: posts.filter((p) => p.numbers !== null).length
  }
}

/** The average week of the weeks before. A number the sites never showed in those weeks has no usual; weeks with nothing sent at all have none either. */
function usual(weeks: readonly WeekSums[]): UsualSums {
  const active = weeks.some((w) => w.posts + w.replies > 0)
  const mean = (pick: (w: WeekSums) => number | null): number | null => {
    if (!active || weeks.every((w) => pick(w) === null)) return null
    return Math.round((weeks.reduce((a, w) => a + (pick(w) ?? 0), 0) / weeks.length) * 10) / 10
  }
  return { posts: mean((w) => w.posts), replies: mean((w) => w.replies), likes: mean((w) => w.likes), comments: mean((w) => w.comments), views: mean((w) => w.views), removed: mean((w) => w.removed) }
}

/** The numbers of the week that starts at `weekStart`, against the weeks before it, for the product and for each channel that sent anything in those weeks. */
export function weekNumbers(sends: readonly WeekSend[], weekStart: Date): WeekNumbers {
  const bounds = Array.from({ length: USUAL_WEEKS + 2 }, (_, i) => shiftWeeks(weekStart, i - USUAL_WEEKS).getTime())
  // bounds[USUAL_WEEKS] is the week's start, the last one its end; the ones before open the earlier weeks.
  const inWeek = (list: readonly WeekSend[], index: number): WeekSend[] => list.filter((s) => s.sentAtMs >= (bounds[index] as number) && s.sentAtMs < (bounds[index + 1] as number))
  const of = (list: readonly WeekSend[]): { week: WeekSums; before: WeekSums; usual: UsualSums } => {
    const earlier = Array.from({ length: USUAL_WEEKS }, (_, i) => sums(inWeek(list, i)))
    return { week: sums(inWeek(list, USUAL_WEEKS)), before: earlier[USUAL_WEEKS - 1] as WeekSums, usual: usual(earlier) }
  }
  const all = of(sends)
  const ids = [...new Set(sends.filter((s) => s.sentAtMs >= (bounds[0] as number) && s.sentAtMs < (bounds[USUAL_WEEKS + 1] as number)).map((s) => s.channelId))]
  const channels = ids
    .map((channelId) => {
      const mine = of(sends.filter((s) => s.channelId === channelId))
      return { channelId, week: mine.week, usual: mine.usual }
    })
    .filter((c) => c.week.posts + c.week.replies > 0)
    .sort((a, b) => b.week.posts + b.week.replies - (a.week.posts + a.week.replies))
  return { ...all, channels }
}

/** How a number of the week stands against its usual: 'up' or 'down' when it differs by a fifth or more, 'same' otherwise; null when there is nothing to compare. */
export function against(value: number | null, usualValue: number | null): 'up' | 'down' | 'same' | null {
  if (value === null || usualValue === null) return null
  if (usualValue === 0) return value > 0 ? 'up' : 'same'
  const ratio = value / usualValue
  return ratio >= 1.2 ? 'up' : ratio <= 0.8 ? 'down' : 'same'
}

/** "Nov 23 – Nov 29" for the week that starts at `weekStart`. */
export function weekLabel(weekStart: Date): string {
  const last = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)
  const text = (d: Date): string => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${text(weekStart)} – ${text(last)}`
}
