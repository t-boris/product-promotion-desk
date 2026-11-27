// What the weekly review page says, as plain data: the totals with their usual, a channel's row, what followed an accepted change.
import { likesWord, shortCount } from '../../../../shared/post-numbers'
import type { WeeklyReviewView } from '../../../../shared/types'
import { against, type UsualSums, type WeekSums } from '../../../../shared/weekly-review'

export interface Figure {
  label: string
  /** The number as shown; an em dash when the sites showed none. */
  value: string
  /** "usual 22" or "3 the week before"; empty when there is nothing to compare with. */
  beside: string
  /** Whether the number stands above or below its usual; for "taken down" more is worse. */
  tone: 'good' | 'bad' | null
}

const count = (n: number | null): string => (n === null ? '—' : shortCount(n))
const usualText = (n: number | null): string => (n === null ? '' : `usual ${Number.isInteger(n) ? shortCount(n) : n.toFixed(1)}`)

function tone(value: number | null, usual: number | null, moreIsWorse = false): Figure['tone'] {
  const how = against(value, usual)
  if (how === null || how === 'same') return null
  return (how === 'up') !== moreIsWorse ? 'good' : 'bad'
}

/** The word for likes over several platforms: the platform's own word when every channel is on one platform, "Likes" otherwise. */
export function likesHeading(platforms: readonly string[]): string {
  const distinct = [...new Set(platforms)]
  const word = distinct.length === 1 ? likesWord(distinct[0] as string, 2) : distinct.includes('reddit') ? 'points and likes' : 'likes'
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The totals of the week. A number no site showed in the week or in the weeks before is left out, never drawn as a zero. */
export function totals(view: WeeklyReviewView): Figure[] {
  const { week, usual } = view.numbers
  const likes = likesHeading(Object.values(view.channels).map((c) => c.platform))
  const figures: (Figure | null)[] = [
    { label: 'Posts sent', value: count(week.posts), beside: usualText(usual.posts), tone: null },
    { label: 'Replies sent', value: count(week.replies), beside: usualText(usual.replies), tone: null },
    week.views !== null || usual.views !== null ? { label: 'Views', value: count(week.views), beside: usualText(usual.views), tone: tone(week.views, usual.views) } : null,
    week.likes !== null || usual.likes !== null ? { label: likes, value: count(week.likes), beside: usualText(usual.likes), tone: tone(week.likes, usual.likes) } : null,
    week.comments !== null || usual.comments !== null ? { label: 'Comments received', value: count(week.comments), beside: usualText(usual.comments), tone: tone(week.comments, usual.comments) } : null,
    week.removed > 0 || (usual.removed ?? 0) > 0 ? { label: 'Taken down', value: count(week.removed), beside: usualText(usual.removed), tone: week.removed > 0 ? 'bad' : null } : null
  ]
  return figures.filter((f): f is Figure => f !== null)
}

/** For how many of the week's posts the numbers are known, in words; null when for all of them (or there are no posts). */
export function knownNote(week: WeekSums): string | null {
  if (week.posts === 0 || week.read === week.posts) return null
  return week.read === 0 ? 'The sites showed no numbers for the posts of this week yet, or the application cannot read them there.' : `Numbers are known for ${week.read} of ${week.posts} posts; the others are not read yet, or the application cannot read them there.`
}

export interface ChannelCell {
  value: string
  beside: string
  tone: Figure['tone']
}

export function channelCell(value: number | null, usual: number | null): ChannelCell {
  return { value: count(value), beside: usualText(usual), tone: tone(value, usual) }
}

/** Which of the three numbers the channel table has a column for: only those some channel has a value or a usual for. */
export function channelColumns(view: WeeklyReviewView): ('views' | 'likes' | 'comments')[] {
  return (['views', 'likes', 'comments'] as const).filter((key) => view.numbers.channels.some((c) => c.week[key] !== null || c.usual[key] !== null))
}

/** What followed an accepted change: the week after against the week it was made from, in the numbers both weeks have. */
export function followedText(followed: { from: WeekSums; to: WeekSums } | null, state: string): string {
  if (state !== 'accepted') return ''
  if (!followed) return 'The week after is not over yet'
  const parts: string[] = [`Posts ${followed.from.posts} → ${followed.to.posts}`]
  const pair = (label: string, key: 'likes' | 'comments' | 'views'): void => {
    const from = followed.from[key]
    const to = followed.to[key]
    if (from !== null && to !== null) parts.push(`${label} ${shortCount(from)} → ${shortCount(to)}`)
  }
  pair('likes', 'likes')
  pair('comments', 'comments')
  pair('views', 'views')
  return parts.join(' · ')
}

export const usualOf = (usual: UsualSums, key: 'views' | 'likes' | 'comments'): number | null => usual[key]
