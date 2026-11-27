// What a site shows under a post the owner sent: how it is read again over time, and how it is said. The numbers are read by the application
// from the site (never by the AI, lesson 298); one the site does not show is null and is never drawn as a zero.

export interface PostNumbers {
  /** Likes, or what the platform has in their place (Reddit's points). */
  likes: number | null
  comments: number | null
  views: number | null
}

export const NO_NUMBERS: PostNumbers = { likes: null, comments: null, views: null }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A post is read again for this long after it went out. */
export const NUMBERS_WINDOW_MS = 30 * DAY
/** The first reading: a post has nothing to show in its first minutes. */
export const FIRST_NUMBERS_AFTER_MS = 15 * MINUTE

/** How long until the next reading, by the post's age at the last one: hourly in the first day, four times a day in the first week, then daily. */
export function nextNumbersDelayMs(ageAtReadingMs: number): number {
  if (ageAtReadingMs < DAY) return HOUR
  if (ageAtReadingMs < 7 * DAY) return 6 * HOUR
  return DAY
}

/** Whether a sent post is due for a reading now. */
export function numbersDue(sentAtMs: number, lastReadMs: number | null, nowMs: number): boolean {
  const age = nowMs - sentAtMs
  if (age < FIRST_NUMBERS_AFTER_MS || age > NUMBERS_WINDOW_MS) return false
  if (lastReadMs === null) return true
  return nowMs - lastReadMs >= nextNumbersDelayMs(lastReadMs - sentAtMs)
}

/** What a platform calls its likes. */
export const likesWord = (platform: string, count: number): string => (platform === 'reddit' ? (count === 1 ? 'point' : 'points') : count === 1 ? 'like' : 'likes')

/** "1.2k": a count as a row shows it. */
export function shortCount(count: number): string {
  const abs = Math.abs(count)
  if (abs < 1000) return String(count)
  if (abs < 1_000_000) return `${(count / 1000).toFixed(abs < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** One line of what the site shows under a post: "84 points · 12 comments". Null when nothing is known. */
export function numbersLine(platform: string, numbers: PostNumbers): string | null {
  const parts: string[] = []
  if (numbers.views !== null) parts.push(`${shortCount(numbers.views)} ${numbers.views === 1 ? 'view' : 'views'}`)
  if (numbers.likes !== null) parts.push(`${shortCount(numbers.likes)} ${likesWord(platform, numbers.likes)}`)
  if (numbers.comments !== null) parts.push(`${shortCount(numbers.comments)} ${numbers.comments === 1 ? 'comment' : 'comments'}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
