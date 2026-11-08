// Builds what the review UI needs about one opportunity or publication.

import type { Comment, Opportunity, OpportunityCard } from '../../shared/types'
import type { Core } from '../core'
import { mapComment } from '../repos'
import type { FlowStore } from './store'

const MAX_CHILDREN = 5
const MAX_ANCESTORS = 8

export function buildCard(core: Core, store: FlowStore, opp: Opportunity): OpportunityCard {
  const channel = store.requireChannel(opp.channelId)
  const account = core.repos.account(channel.accountId)
  const draft = core.repos.latestDraft(opp.id)
  const comment = opp.commentId ? store.comment(opp.commentId) : null

  let discussion = null
  const discussionId = comment?.discussionId ?? opp.discussionId
  if (discussionId) {
    try {
      discussion = core.repos.discussion(discussionId)
    } catch {
      discussion = null
    }
  }

  return {
    opportunity: opp,
    channelTarget: channel.target,
    accountLabel: account.identity ? `${account.label} (${account.identity})` : account.label,
    comment,
    discussion,
    thread: comment ? threadAround(core, store, comment) : [],
    draft,
    approval: draft ? core.repos.activeApproval(draft.id) : null,
    lastAction: core.repos.lastAction(opp.id)
  }
}

/** The parent chain (oldest first) followed by a few direct replies under the comment, such as the account's own. */
function threadAround(core: Core, store: FlowStore, comment: Comment): Comment[] {
  const ancestors: Comment[] = []
  const seen = new Set<string>([comment.externalId])
  let parentId = comment.parentExternalId
  while (parentId && ancestors.length < MAX_ANCESTORS && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = store.commentByExternalId(comment.channelId, parentId)
    if (!parent) break
    ancestors.unshift(parent)
    parentId = parent.parentExternalId
  }
  const children = (
    core.db
      .prepare('SELECT * FROM comments WHERE channel_id = ? AND parent_external_id = ? ORDER BY COALESCE(posted_at, first_seen_at), rowid LIMIT ?')
      .all(comment.channelId, comment.externalId, MAX_CHILDREN) as Record<string, unknown>[]
  ).map(mapComment)
  return [...ancestors, ...children]
}
