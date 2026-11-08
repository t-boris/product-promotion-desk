// Explicit selection of older discussions (SRC-001 section 3, step 8): comments that existed during the first
// cycle are only a baseline and never trigger replies, unless the owner selects their discussion.

import { ApiError } from '../../shared/api'
import type { Discussion, Id } from '../../shared/types'
import type { Core } from '../core'
import { mapComment, mapDiscussion } from '../repos'
import type { FlowStore } from './store'
import { normalizeIdentity } from './util'

type Row = Record<string, unknown>

export function listDiscussions(core: Core, channelId: Id): Discussion[] {
  const rows = core.db.prepare('SELECT * FROM discussions WHERE channel_id = ? ORDER BY last_seen_at DESC, first_seen_at DESC, rowid DESC LIMIT 300').all(channelId) as Row[]
  return rows.map(mapDiscussion)
}

/**
 * Sets or clears the selection. Selecting turns the discussion's non-own baseline comments into 'discovered'
 * opportunities (once per comment); deselecting withdraws the ones nobody has worked on yet.
 */
export function selectOlder(core: Core, store: FlowStore, channelId: Id, discussionIds: Id[], selected: boolean): Discussion[] {
  const channel = store.requireChannel(channelId)
  const account = core.repos.account(channel.accountId)
  if (selected && normalizeIdentity(account.identity) === '') {
    throw new ApiError('identity_unknown', 'Sign in with the account first, so your own comments can be recognised and skipped.')
  }

  core.db.transaction(() => {
    for (const id of discussionIds) {
      const row = core.db.prepare('SELECT * FROM discussions WHERE id = ? AND channel_id = ?').get(id, channelId) as Row | undefined
      if (!row) throw new ApiError('not_found', `Discussion not found in this channel: ${id}`)
      core.db.prepare('UPDATE discussions SET selected = ? WHERE id = ?').run(selected ? 1 : 0, id)

      if (selected) {
        const comments = core.db.prepare('SELECT * FROM comments WHERE discussion_id = ? AND baseline = 1 AND is_own = 0 ORDER BY COALESCE(posted_at, first_seen_at), rowid').all(id) as Row[]
        for (const c of comments) {
          const comment = mapComment(c)
          if (!store.opportunityForComment(comment.id)) store.createReplyOpportunity(channel, comment)
        }
      } else {
        core.db
          .prepare(
            `DELETE FROM opportunities
             WHERE state = 'discovered'
               AND comment_id IN (SELECT id FROM comments WHERE discussion_id = ? AND baseline = 1)
               AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.opportunity_id = opportunities.id)`
          )
          .run(id)
      }
    }
  })()
  store.notify()
  return listDiscussions(core, channelId)
}
