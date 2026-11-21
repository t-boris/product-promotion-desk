// What the tags of the analysis card say: their numbers as a line, the picture of the last thirty days, and the lines of its empty states. Every number is counted
// by the application from the posts and from the numbers the sites showed (the AI only names the tags), so a number a site did not show is never written as zero.
// Pure, so it is tested from src/main.

import type { FeedPeriod, TagStat, TagsView } from '../../../../shared/types'
import { periodWords } from './analysis-card'

/** What the card says while no post has a tag. */
export function tagsIntro(days: FeedPeriod): string {
  return `The AI gives each post noted in ${periodWords(days)} a few short tags, so you can see which subjects come up, search them and filter the posts by them. It uses no browser and posts nothing.`
}

/** "12 posts have no tags yet" (or null when every post has been through the AI). */
export function untaggedLine(view: Pick<TagsView, 'untagged'>): string | null {
  if (view.untagged <= 0) return null
  return `${view.untagged.toLocaleString('en-US')} ${view.untagged === 1 ? 'post has' : 'posts have'} no tags yet.`
}

/** How the posts of the period were counted: "40 posts noted, 12 with no tags yet". */
export function tagsBasis(view: Pick<TagsView, 'posts' | 'untagged'>): string {
  const posts = `${view.posts.toLocaleString('en-US')} ${view.posts === 1 ? 'post' : 'posts'} noted`
  return view.untagged > 0 ? `${posts} · ${view.untagged.toLocaleString('en-US')} with no tags yet` : posts
}

/** A sentence that stands in for the little picture of a tag (a text alternative): where its posts of the last thirty days are. */
export function dailyDescription(tag: Pick<TagStat, 'name' | 'daily'>): string {
  const total = tag.daily.reduce((a, b) => a + b, 0)
  const busiest = Math.max(0, ...tag.daily)
  return `${tag.name}: ${total} ${total === 1 ? 'post' : 'posts'} in the last 30 days${busiest > 0 ? `, at most ${busiest} in one day` : ''}`
}

/** The values of the picture: one reading for each of the thirty days (a day with no post is a real zero, not a missing reading). */
export function dailyValues(tag: Pick<TagStat, 'daily'>): number[] {
  return [...tag.daily]
}

/** The line beside the removable tags over the stream: how many posts carry every tag picked. */
export function tagFilterLine(selected: readonly string[], shown: number): string {
  const posts = `${shown.toLocaleString('en-US')} ${shown === 1 ? 'post' : 'posts'}`
  return selected.length === 1 ? `${posts} carry this tag.` : `${posts} carry all ${selected.length} tags.`
}
