// Is a post the account published on Reddit still up? Read from the account's own submitted list, which Reddit answers for the account's own
// session and which marks a post that was taken down (`removed_by_category`). A post missing from the list proves nothing (the list is short, a post
// can be deleted or hidden), so it is "could not tell", never "removed".

import type { RedditPost } from './mapping'

export interface PostStandingReading {
  state: 'live' | 'removed'
  /** In words for the owner: who took it down, or that it is up. */
  note: string
}

/** How many of the account's newest posts are read: a post checked within three days of its publication is among them. */
export const OWN_POSTS_READ = 50

/** What Reddit's category says, in words. `sub` is the community the post is in (a moderator belongs to it). */
export function removalWords(category: string | null, sub: string): string {
  switch (category) {
    case 'reddit':
      return `Reddit's own filters removed it (the site-wide spam filter acts on new accounts and on promotional posts). The moderators of r/${sub} can approve it: write to them through modmail and ask them to look at the post`
    case 'moderator':
      return `A moderator of r/${sub} removed it`
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
