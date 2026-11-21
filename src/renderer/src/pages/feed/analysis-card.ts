// What the card "What is going on in your channels" says about the analysis of the Feed: its periods, the words of a theme's numbers, what stands out,
// and which posts a theme or a question opens. Pure, so it is tested from src/main.

import type { FeedAnalysisView, FeedPeriod, FeedTheme, Id } from '../../../../shared/types'
import type { FindingRow } from './finding-rows'

export const PERIOD_OPTIONS: readonly { value: FeedPeriod; label: string }[] = [
  { value: 1, label: '24 hours' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' }
]

export const periodWords = (days: FeedPeriod): string => (days === 1 ? 'the last 24 hours' : `the last ${days} days`)

const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/**
 * The numbers of a theme as a line: its posts (and how that compares with the period before), the comments under them and their score. A number no site
 * showed is not written as zero: it is left out, and a line says for how many of the posts the sites gave one.
 */
export function themeNumbers(theme: FeedTheme): string {
  const parts = [count(theme.posts, 'post')]
  if (theme.before > 0 || theme.posts > 0) {
    const delta = theme.posts - theme.before
    parts[0] += theme.before === 0 && theme.posts > 0 ? ' (new)' : delta === 0 ? ' (as before)' : ` (${delta > 0 ? '+' : '−'}${Math.abs(delta)} against before)`
  }
  if (theme.replies !== null) parts.push(count(theme.replies, 'comment'))
  if (theme.score !== null) parts.push(`score ${theme.score.toLocaleString('en-US')}`)
  return parts.join(' · ')
}

/** Said under the numbers when only some of the posts had numbers: "Comments and score known for 2 of 3 posts". Empty when all had them, or none (then there are no numbers to qualify). */
export function themeKnown(theme: FeedTheme): string {
  if (theme.known === 0 || theme.known >= theme.posts) return ''
  return `Comments and score known for ${theme.known} of ${theme.posts} posts.`
}

/** The marks a theme earns, in the order they are shown. */
export function themeBadges(theme: FeedTheme): { label: string; tone: 'info' | 'good' | 'warn' }[] {
  const out: { label: string; tone: 'info' | 'good' | 'warn' }[] = []
  if (theme.mostAnswered) out.push({ label: 'Most answered', tone: 'info' })
  if (theme.mostPopular) out.push({ label: 'Most popular', tone: 'info' })
  if (theme.growing) out.push({ label: 'Growing', tone: 'good' })
  if (theme.fading) out.push({ label: 'Fading', tone: 'warn' })
  return out
}

/** How wide a theme's bar is, in percent of the widest, never less than a sliver for a theme with posts. */
export function barPercent(posts: number, widest: number): number {
  if (posts <= 0 || widest <= 0) return 0
  return Math.max(4, Math.round((posts / widest) * 100))
}

/** "62 posts noted, 5 read in full" (and "the newest 80 of 120" when the period had more than were read). */
export function basisLine(view: Pick<FeedAnalysisView, 'posts' | 'readInFull' | 'total' | 'other'>): string {
  const parts = [`${count(view.posts, 'post')} analyzed`]
  if (view.total > view.posts) parts[0] = `the newest ${view.posts} of ${view.total} posts analyzed`
  parts.push(view.readInFull === 0 ? 'none read in full' : `${view.readInFull} read in full`)
  if (view.other > 0) parts.push(`${view.other} fit no theme`)
  return parts.join(' · ')
}

/** What the card offers while there is no analysis, or why one cannot be made. */
export function introWords(days: FeedPeriod): string {
  return `The AI reads the posts noted in ${periodWords(days)} and says which themes people raise, which one draws the most comments and which grows. It uses no browser and posts nothing.`
}

/** The rows of the stream that belong to the opened theme or question; every row when nothing is opened. */
export function rowsOfFocus(rows: readonly FindingRow[], focus: { ids: ReadonlySet<Id> } | null): FindingRow[] {
  return focus === null ? [...rows] : rows.filter((row) => focus.ids.has(row.id))
}

/** The line over the stream while it shows one theme: what it is, and how many of its posts the list holds (the list may hold fewer than the theme: a post that left it). */
export function focusLine(label: string, shown: number, of: number): string {
  return shown === of ? `Showing ${count(shown, 'post')} of “${label}”.` : `Showing ${shown} of the ${of} posts of “${label}” (the rest are not in this list).`
}
