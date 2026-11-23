// Is a post the account published on Reddit still up? Read from the account's own submitted list, which Reddit answers for the account's own
// session and which marks a post that was taken down (`removed_by_category`). A post missing from the list proves nothing (the list is short, a post
// can be deleted or hidden), so it is "could not tell", never "removed".

import type { CommunityNotice } from '../../shared/types'
import { asRecord, str } from '../text'
import type { RedditPost } from './mapping'

export interface PostStandingReading {
  state: 'live' | 'removed'
  /** In words for the owner: who took it down, or that it is up. */
  note: string
  /** A removed post: what the community wrote under it (see `noticeOf`). */
  notice?: CommunityNotice | null
}

/** The longest community message kept: a bot's message is a few paragraphs; anything longer is cut, and the link to the post shows the rest. */
export const NOTICE_LIMIT = 3000

/** How many of the account's newest posts are read: a post checked within three days of its publication is among them. */
export const OWN_POSTS_READ = 50

/** What Reddit's category says, in words. `sub` is the community the post is in (a moderator belongs to it). */
export function removalWords(category: string | null, sub: string): string {
  switch (category) {
    case 'reddit':
      return `Reddit's own filters removed it (the site-wide spam filter acts on new accounts and on promotional posts). The moderators of r/${sub} can approve it: write to them through modmail and ask them to look at the post`
    case 'moderator':
      // AutoModerator acts as a moderator, and many communities have it take every new post down until a person looks: it is not final.
      return `A moderator of r/${sub} or its bot took it down; the moderators can still approve it`
    case 'automod_filtered':
      return `r/${sub}'s AutoModerator held it back for the moderators to check`
    case 'author':
    case 'deleted':
      return 'It was deleted by the account that posted it'
    case 'anti_evil_ops':
    case 'community_ops':
    case 'content_takedown':
    case 'copyright_takedown':
      return 'Reddit removed it for a policy reason'
    default:
      return category ? `Reddit marks it as removed (${category})` : 'Reddit shows it as removed'
  }
}

/** The standing of the post `fullname` among the account's own posts, or null when it is not in the list (could not tell). */
export function standingOfPost(posts: readonly RedditPost[], fullname: string): PostStandingReading | null {
  const post = posts.find((p) => p.fullname.toLowerCase() === fullname.toLowerCase())
  if (!post) return null
  if (!post.removed) return { state: 'live', note: 'The post is up on Reddit.' }
  return { state: 'removed', note: `${removalWords(post.removedBy, post.subreddit)}.` }
}

/**
 * What the community wrote under one of the account's posts that it took down, from the post's page (`/comments/<id>.json`): the first top-level
 * comment of its bot (AutoModerator) or of a moderator speaking as one (distinguished), a pinned one first. Null when there is none. Read-only.
 */
export function noticeOf(json: unknown): CommunityNotice | null {
  if (!Array.isArray(json) || json.length < 2) return null
  const children = asRecord(asRecord(json[1])?.data)?.children
  if (!Array.isArray(children)) return null
  const said = children
    .map((child) => asRecord(child))
    .filter((child) => child?.kind === 't1')
    .map((child) => asRecord(child?.data))
    .filter((data): data is Record<string, unknown> => data !== null && (str(data.author) === 'AutoModerator' || data.distinguished === 'moderator'))
    .filter((data) => str(data.body).trim() !== '' && !['[deleted]', '[removed]'].includes(str(data.body).trim()))
  const first = said.find((data) => data.stickied === true) ?? said[0]
  if (!first) return null
  const text = str(first.body).trim()
  return { by: str(first.author) || 'a moderator', text: text.length > NOTICE_LIMIT ? `${text.slice(0, NOTICE_LIMIT - 1).trimEnd()}…` : text }
}
