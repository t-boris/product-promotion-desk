// Hiding what somebody wrote under the account's post, on the owner's press (DEC-089): other readers stop seeing it on the platform, nothing is
// deleted, and it can be shown again. Only the owner's press does it; no rule and no AI ever hides anything.

import { ApiError } from '../../shared/api'
import { platformLabel } from '../../shared/post-format'
import type { Channel, Comment, CommentHiding, Discussion, Id } from '../../shared/types'
import type { Core } from '../core'
import type { FlowStore } from './store'
import { errorMessage } from './util'

/**
 * How the channel's platform lets the account hide this comment, or null when it does not: somebody else's comment, on a channel whose
 * connector hides comments. Where the platform hides only a comment that answers the post itself, with everything under it (Threads), one
 * that answers another comment is not offered.
 */
export function commentHiding(core: Core, channel: Channel, comment: Comment | null, discussion: Discussion | null): CommentHiding | null {
  if (!comment || comment.isOwn || !channel.connectorId) return null
  const connector = core.connectors.get(channel.connectorId)
  if (!connector?.hideComment) return null
  if (!connector.hidesTopLevelOnly) return 'alone'
  return discussion !== null && comment.parentExternalId === discussion.externalId ? 'with_replies' : null
}

/** The discussion a comment is under; null when it is no longer kept. */
function discussionOf(core: Core, comment: Comment): Discussion | null {
  try {
    return core.repos.discussion(comment.discussionId)
  } catch {
    return null
  }
}

/** Hides the comment the item answers, or shows it again. The caller holds the account's lock. A refusal of the platform is said in its words. */
export async function setCommentHidden(core: Core, store: FlowStore, opportunityId: Id, hidden: boolean): Promise<void> {
  const opp = store.requireOpportunity(opportunityId)
  const channel = store.requireChannel(opp.channelId)
  const comment = opp.commentId ? store.comment(opp.commentId) : null
  if (!comment || commentHiding(core, channel, comment, discussionOf(core, comment)) === null) {
    throw new ApiError('invalid_state', 'This comment cannot be hidden from here. Hide it on the site itself.')
  }
  const label = platformLabel(channel.platform)
  const { connector, ctx } = core.connectorContext(channel.id)
  if (!connector.hideComment) throw new ApiError('invalid_state', 'This comment cannot be hidden from here. Hide it on the site itself.')
  try {
    await connector.hideComment(ctx, comment.externalId, hidden)
  } catch (error) {
    throw new ApiError('read_failed', `${errorMessage(error)} The comment is as it was on ${label}.`)
  }
  core.db.prepare('UPDATE comments SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, comment.id)
  core.log.info('send', hidden ? `The comment by ${comment.author} was hidden on ${label} on the owner's press.` : `The comment by ${comment.author} is shown again on ${label} on the owner's press.`, channel.id)
  store.notify()
}
