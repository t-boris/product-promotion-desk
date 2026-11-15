// What a reply answers (DEC-039). A reply opportunity answers a comment, or, when its source is `new_post`, the post itself: it has no comment, and its reply
// is a top-level comment on the post. Everything that used to read "the comment of the opportunity" asks here, so that no consumer assumes one.

import type { Comment, Discussion, Opportunity } from '../../shared/types'
import { commentBodyHash } from './hash'

/** Why automatic mode never sends the reply to a new post: nobody wrote to the account, so the owner decides whether to join in at all. */
export const NEW_POST_NEVER_AUTO_REASON = 'A new post is never answered automatically: the AI only prepares the reply, you decide and send it'

/** The reply to a post, not to a comment. */
export const isPostTarget = (opp: Pick<Opportunity, 'kind' | 'source'>): boolean => opp.kind === 'reply' && opp.source === 'new_post'

/** What a post says, as one text: the title and the body. What the AI judges and what a change of it is detected by. */
export const postText = (post: { title: string; body: string }): string => `${post.title.trim()}\n\n${post.body.trim()}`.trim()

/** Hash of a post's title and text, as `commentBodyHash` is for a comment: edits of the post are told apart from noise between page views. */
export const postHash = (post: { title: string; body: string }): string => commentBodyHash(postText(post))

/** The platform id a reply is sent under: the comment's, or the post's own when the reply answers the post. Null where there is nothing to answer. */
export function parentOf(target: { comment: Comment | null; post: Discussion | null }): { externalId: string } | null {
  if (target.comment) return { externalId: target.comment.externalId }
  if (target.post) return { externalId: target.post.externalId }
  return null
}

/** How the item is named in a list of things that wait for the owner. */
export function sourceWords(opp: Pick<Opportunity, 'kind' | 'source'>): string {
  if (opp.kind === 'standalone') return 'publication'
  switch (opp.source) {
    case 'new_post':
      return 'reply to a new post'
    case 'reply_to_me':
      return 'reply to a reply'
    case 'mention':
      return 'reply to a mention'
    default:
      return 'reply'
  }
}
