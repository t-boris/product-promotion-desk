// Turns what a connector read into stored discussions, comments and opportunities (I-4, REQ-003 criterion 1).
//
// Rules enforced here:
//  - discussions and comments are upserted by (channel_id, external_id); a rediscovered comment only updates its row;
//  - the first cycle of a channel (baseline) stores everything with baseline = 1 and creates no opportunities;
//  - a comment written by ANY login of the product (known identity, or the result of a confirmed send) is marked
//    is_own and never creates an opportunity, so neither the app nor a second login of the product can start a
//    reply chain with the product's own voices (DEC-010);
//  - a comment in a discussion where another login of the product already speaks gets no reply opportunity;
//  - a comment that changes after an opportunity exists sends that opportunity back to review (unless already sent).

import type { Account, Channel, Comment, Id, Opportunity, OpportunityState } from '../../shared/types'
import type { RemoteComment, RemoteDiscussion } from '../ports'
import type { Core } from '../core'
import { newId } from '../db/database'
import { commentBodyHash } from './hash'
import type { ReviewFlow } from './review'
import type { FlowStore } from './store'
import { normalizeIdentity } from './util'

export interface IngestResult {
  discussions: number
  comments: number
  newComments: number
  newOpportunities: number
  changedComments: number
  /** True when the account has no known identity, so own comments cannot be told apart and nothing was queued. */
  identityUnknown: boolean
}

export const COMMENT_EDITED_REASON = 'The comment was edited after the draft was prepared; review it again.'

/** Opportunities that have not been sent and can still be withdrawn when the comment turns out to be our own. */
const WITHDRAWABLE: OpportunityState[] = ['discovered', 'analyzing', 'needs_user', 'no_reply', 'draft', 'awaiting_approval', 'ready', 'deferred', 'error']

export class Ingestor {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly review: ReviewFlow
  ) {}

  /** Stores one connector batch atomically. The first batch of a channel becomes its baseline. */
  ingest(channel: Channel, account: Account, discussions: RemoteDiscussion[]): IngestResult {
    const baseline = channel.baselineDoneAt === null
    const result = this.core.db.transaction(() => {
      const result = this.apply(channel, account, discussions, baseline)
      if (baseline) this.store.updateChannel(channel.id, { baselineDoneAt: this.store.now() })
      return result
    })()
    this.store.notify()
    return result
  }

  /** Applies a freshly read thread (used when the SendGate finds the thread changed) with normal, non-baseline rules. */
  refreshThread(channel: Channel, account: Account, discussion: RemoteDiscussion): IngestResult {
    const result = this.core.db.transaction(() => this.apply(channel, account, [discussion], false))()
    this.store.notify()
    return result
  }

  private apply(channel: Channel, account: Account, discussions: RemoteDiscussion[], baseline: boolean): IngestResult {
    const now = this.store.now()
    const identity = normalizeIdentity(account.identity)
    // Every login of the product writes as the product, so a comment by any of them is our own, not only the
    // comments of the login this channel uses.
    const ownIdentities = new Set(this.store.productAccounts(channel.productId, account.id).map((a) => normalizeIdentity(a.identity)))
    ownIdentities.delete('')
    const ownResultIds = new Set([...this.store.confirmedExternalIds(account.id), ...this.store.productConfirmedExternalIds(channel)])
    const result: IngestResult = {
      discussions: 0,
      comments: 0,
      newComments: 0,
      newOpportunities: 0,
      changedComments: 0,
      identityUnknown: identity === ''
    }

    for (const remote of discussions) {
      const discussionId = this.upsertDiscussion(channel.id, remote, now)
      result.discussions++
      for (const c of remote.comments) {
        result.comments++
        const isOwn = ownIdentities.has(normalizeIdentity(c.author)) || ownResultIds.has(c.externalId)
        const existing = this.store.commentByExternalId(channel.id, c.externalId)
        if (!existing) {
          const stored = this.insertComment(channel.id, discussionId, c, baseline, isOwn, now)
          result.newComments++
          // Never queue work when we cannot recognise our own comments: a reply chain with ourselves would be possible.
          if (!baseline && !isOwn && identity !== '' && !this.store.opportunityForComment(stored.id)) {
            if (!this.store.openReplyOpportunity(channel, stored).blocked) result.newOpportunities++
          }
          continue
        }
        if (this.updateExisting(existing, c, isOwn, now)) result.changedComments++
      }
    }
    return result
  }

  private upsertDiscussion(channelId: Id, d: RemoteDiscussion, now: string): Id {
    const row = this.core.db.prepare('SELECT id FROM discussions WHERE channel_id = ? AND external_id = ?').get(channelId, d.externalId) as { id: string } | undefined
    if (row) {
      this.core.db.prepare('UPDATE discussions SET url = ?, title = ?, author = ?, body = ?, last_seen_at = ? WHERE id = ?').run(d.url, d.title, d.author, d.body, now, row.id)
      return row.id
    }
    const id = newId()
    this.core.db
      .prepare('INSERT INTO discussions (id, channel_id, external_id, url, title, author, body, selected, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .run(id, channelId, d.externalId, d.url, d.title, d.author, d.body, now, now)
    return id
  }

  private insertComment(channelId: Id, discussionId: Id, c: RemoteComment, baseline: boolean, isOwn: boolean, now: string): Comment {
    const id = newId()
    this.core.db
      .prepare(
        `INSERT INTO comments (id, discussion_id, channel_id, external_id, parent_external_id, author, body, url, posted_at, baseline, is_own, content_hash, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, discussionId, channelId, c.externalId, c.parentExternalId, c.author, c.body, c.url, c.postedAt, baseline ? 1 : 0, isOwn ? 1 : 0, commentBodyHash(c.body), now, now)
    return this.core.repos.comment(id)
  }

  /** Updates a rediscovered comment in place. Returns true when its body changed. */
  private updateExisting(existing: Comment, c: RemoteComment, isOwn: boolean, now: string): boolean {
    const hash = commentBodyHash(c.body)
    const changed = hash !== existing.contentHash || c.url !== existing.url
    this.core.db
      .prepare('UPDATE comments SET last_seen_at = ?, body = ?, content_hash = ?, url = ?, is_own = ? WHERE id = ?')
      .run(now, c.body, hash, c.url, existing.isOwn || isOwn ? 1 : 0, existing.id)

    const opp = this.store.opportunityForComment(existing.id)
    if (!opp) return changed
    if (!existing.isOwn && isOwn) this.withdrawOwn(opp)
    else if (changed) this.reactToChange(opp, c.url)
    return changed
  }

  /** The comment turned out to be written by our own account (identity learned late): it must not get a reply. */
  private withdrawOwn(opp: Opportunity): void {
    if (!WITHDRAWABLE.includes(opp.state)) return
    this.store.invalidateApprovals(opp.id, 'The comment was written by your own account')
    this.store.updateOpportunity(opp.id, { state: 'cancelled', reason: 'The comment was written by your own account' })
  }

  /** Thread changes before sending must be honored: pending work goes back to review with an explanation. */
  private reactToChange(opp: Opportunity, newUrl: string): void {
    if (opp.destination !== newUrl) this.store.updateOpportunity(opp.id, { destination: newUrl })
    switch (opp.state) {
      case 'draft':
      case 'awaiting_approval':
      case 'ready':
      case 'deferred':
      case 'needs_user':
      case 'no_reply':
      case 'error':
        this.review.returnToReview(opp.id, COMMENT_EDITED_REASON)
        break
      default:
        // discovered/analyzing: the context is read when drafting; cancelled/sending/unknown/confirmed: leave as is.
        break
    }
  }
}
