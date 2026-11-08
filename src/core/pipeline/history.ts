// Action history (REQ-006): what was sent, where, when and on what basis, newest first. Built from send_actions
// joined with the opportunity, draft, channel and account they refer to, so every row explains itself.

import type { HistoryEntry } from '../../shared/types'
import type { Core } from '../core'
import { mapAction } from '../repos'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export function listHistory(core: Core, limit?: number): HistoryEntry[] {
  const size = Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const rows = core.db.prepare('SELECT * FROM send_actions ORDER BY attempted_at DESC, rowid DESC LIMIT ?').all(size) as Record<string, unknown>[]
  const entries: HistoryEntry[] = []
  for (const row of rows) {
    const action = mapAction(row)
    try {
      const opportunity = core.repos.opportunity(action.opportunityId)
      const draft = core.repos.draft(action.draftId)
      const channel = core.repos.channel(opportunity.channelId)
      let accountLabel = '(removed account)'
      try {
        accountLabel = core.repos.account(action.accountId).label
      } catch {
        // The account was removed after the send; the row stays as evidence.
      }
      entries.push({ action, opportunity, draft, channelTarget: channel.target, accountLabel })
    } catch (error) {
      core.log.warn('history', `Skipped action ${action.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return entries
}
