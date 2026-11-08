import type { MetricReading } from '../../shared/types'
import type { RedditApi } from './api'
import type { RedditPost } from './mapping'

/** Sum over items; null when the list is unknown or any item hides the value (a partial sum would understate it). */
function total<T>(items: T[] | null, pick: (item: T) => number | null): number | null {
  if (!items) return null
  let sum = 0
  for (const item of items) {
    const value = pick(item)
    if (value === null) return null
    sum += value
  }
  return sum
}

const reading = (key: string, label: string, value: number | null): MetricReading => ({ key, label, value, available: value !== null })

/**
 * Platform metrics for a community and the account's own activity in it. A value Reddit does not expose
 * (or a read that failed) is `null` / unavailable — never 0. A real zero (no own posts yet) is reported as 0.
 */
export async function collectMetrics(api: RedditApi, subreddit: string, identity: string | null): Promise<MetricReading[]> {
  const out: MetricReading[] = []
  const about = await api.about(subreddit)
  out.push(reading('subscribers', 'Community subscribers', about.ok ? about.value.subscribers : null))
  out.push(reading('active_users', 'Users online now', about.ok ? about.value.activeUsers : null))

  const name = identity ?? (await api.me())
  const own = name ? await api.ownSubmitted(name, 100) : null
  const mine = own?.ok ? own.value.filter((p) => p.subreddit.toLowerCase() === subreddit.toLowerCase()) : null

  out.push(reading('own_posts', 'Own posts here', mine ? mine.length : null))
  out.push(reading('own_post_score', 'Score of own posts', total(mine, (p: RedditPost) => p.score)))
  out.push(reading('own_post_comments', 'Comments on own posts', total(mine, (p: RedditPost) => p.numComments)))

  const ownComments = name ? await api.ownComments(name, 100) : null
  const comments = ownComments?.ok ? ownComments.value.filter((c) => c.subreddit.toLowerCase() === subreddit.toLowerCase()) : null
  out.push(reading('own_comments', 'Own comments here', comments ? comments.length : null))
  out.push(reading('own_comment_score', 'Score of own comments', total(comments, (c) => c.score)))
  return out
}
