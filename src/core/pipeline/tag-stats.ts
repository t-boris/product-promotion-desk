// The numbers of the tags of the Feed. Every number here is counted by the application from the posts it holds and from the numbers the SITES showed for them:
// the AI only names the tags and says which post carries which (finding-tags.ts); it counts nothing. A number a site did not show stays missing, never zero.

import type { FeedPeriod, Id, TagStat, TagsView } from '../../shared/types'
import { dayRange, localDay } from '../../shared/local-day'

const DAY_MS = 86_400_000
/** The days the small picture of a tag shows. */
export const TAG_DAYS = 30

/** One noted post as the counting reads it. */
export interface TaggedPost {
  id: Id
  /** When the application first saw the post. */
  createdAt: string
  replies: number | null
  score: number | null
  /** The AI has been through this post (it may have given it no tag at all). */
  tagged: boolean
  tagIds: Id[]
}

export interface TagName {
  id: Id
  name: string
}

/**
 * The tags of a period: for each tag, how many noted posts of the period carry it (and of the period before, to tell a tag that grows from one that fades),
 * the comments and the score the sites showed for them, and its posts of each of the last thirty days. Ranked by how many posts it has, then by its comments, then
 * by name. `posts` counts every noted post of the period and `untagged` the ones the AI has not been through yet.
 */
export function countTags(input: { tags: readonly TagName[]; posts: readonly TaggedPost[]; days: FeedPeriod; channelId: Id | null; now: Date; offsetMinutes: number }): TagsView {
  const now = input.now.getTime()
  const edge = now - input.days * DAY_MS
  const start = now - 2 * input.days * DAY_MS
  const thirty = now - TAG_DAYS * DAY_MS
  const today = localDay(input.now, input.offsetMinutes)
  const days = dayRange(localDay(now - (TAG_DAYS - 1) * DAY_MS, input.offsetMinutes), today)
  const column = new Map(days.map((day, i) => [day, i]))
  const stats = new Map<Id, TagStat & { _replies: number[]; _scores: number[] }>(
    input.tags.map((tag) => [tag.id, { id: tag.id, name: tag.name, posts: 0, before: 0, replies: null, score: null, known: 0, daily: days.map(() => 0), _replies: [], _scores: [] }])
  )
  let posts = 0
  let untagged = 0
  let beforeTagged = 0
  for (const post of input.posts) {
    const at = Date.parse(post.createdAt)
    if (!Number.isFinite(at) || at > now + 60_000) continue
    const current = at >= edge
    const earlier = at >= start && at < edge
    if (current) {
      posts += 1
      if (!post.tagged) untagged += 1
    }
    if (earlier && post.tagged && post.tagIds.length > 0) beforeTagged += 1
    const day = column.get(localDay(at, input.offsetMinutes))
    for (const id of post.tagIds) {
      const stat = stats.get(id)
      if (!stat) continue
      if (current) {
        stat.posts += 1
        if (post.replies !== null) stat._replies.push(post.replies)
        if (post.score !== null) stat._scores.push(post.score)
        if (post.replies !== null || post.score !== null) stat.known += 1
      } else if (earlier) stat.before += 1
      if (at >= thirty && day !== undefined) stat.daily[day] += 1
    }
  }
  const tags: TagStat[] = [...stats.values()]
    .filter((stat) => stat.posts > 0)
    .map(({ _replies, _scores, ...stat }) => ({ ...stat, replies: _replies.length > 0 ? _replies.reduce((a, b) => a + b, 0) : null, score: _scores.length > 0 ? _scores.reduce((a, b) => a + b, 0) : null }))
  tags.sort((a, b) => b.posts - a.posts || (b.replies ?? -1) - (a.replies ?? -1) || a.name.localeCompare(b.name))
  return { days: input.days, channelId: input.channelId, tags, posts, untagged, compared: beforeTagged > 0 }
}
