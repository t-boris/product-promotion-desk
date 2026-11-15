// Turns what a connector read into stored discussions, comments and opportunities (I-4, REQ-003 criterion 1).
//
// Rules enforced here:
//  - discussions and comments are upserted by (channel_id, external_id); a rediscovered comment only updates its row;
//  - the first cycle of a channel (baseline) stores everything with baseline = 1 and creates no opportunities;
//  - a comment written by ANY login of the product (known identity, or the result of a confirmed send) is marked
//    is_own and never creates an opportunity, so neither the app nor a second login of the product can start a
//    reply chain with the product's own voices (DEC-010);
//  - a comment in a discussion where another login of the product already speaks gets no reply opportunity;
//  - a comment that changes after an opportunity exists sends that opportunity back to review (unless already sent);
//  - a post seen for the first time, by someone else, that names one of the channel's topics becomes an opportunity of its own (source `new_post`), never at
//    the baseline and never for a post of the product's own logins (DEC-039); an edited post sends its pending opportunity back to review;
//  - what the account's inbox lists (replies to it, mentions of it) is stored and queued by the same rules, once per comment (`ingestInbox`);
//  - a post the AI triage found worth a reply (DEC-040) is stored with its comments as BASELINE (nothing in them is ever queued) and becomes the same
//    `new_post` opportunity, under the same guards (`ingestTriagedPost`); every discussion keeps the time the post was written (`posted_at`).

import type { Account, Channel, Comment, Id, Opportunity, OpportunityState } from '../../shared/types'
import type { RemoteComment, RemoteDiscussion, RemoteInboxItem } from '../ports'
import type { Core } from '../core'
import { oneLine } from '../assist/kit'
import { newId } from '../db/database'
import { commentBodyHash } from './hash'
import { postHash } from './reply-target'
import type { ReviewFlow } from './review'
import { OTHER_LOGIN_SPEAKS_REASON, type FlowStore } from './store'
import { matchedTerm } from './topic-match'
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
export const POST_EDITED_REASON = 'The post was edited after the draft was prepared; review it again.'

export interface InboxIngestResult {
  /** Comments of the inbox stored for the first time. */
  stored: number
  newOpportunities: number
  /** Items of the inbox that a discussion read had already queued as plain comments, now named for what they are. */
  relabelled: number
}

/** What became of a post the AI triage found worth a reply (DEC-040). */
export interface TriagedPostResult {
  /** The `new_post` opportunity the post has now: the one this call opened, or the one it had already. Null when none could be opened. */
  opportunity: Opportunity | null
  /** True only when this call opened it. */
  opened: boolean
  /** Why no opportunity was opened, in words for the owner; null when there is one. */
  blocked: string | null
}

export const IDENTITY_UNKNOWN_REASON = 'The account identity is unknown, so nothing is queued: sign in so your own comments can be recognised.'
export const OWN_POST_REASON = 'The post was written by one of your own logins'
export const LOCKED_POST_REASON = 'The post is locked or archived, so it cannot be answered'
export const POST_SET_ASIDE_REASON = 'A reply to this post was set aside before'
/** Starts the reason of an opportunity the AI triage opened, so the owner sees where it came from. */
export const AI_FOUND_PREFIX = 'AI found it relevant: '

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
    // A thread read again for the gate is not a new post, even for a discussion this channel did not store before.
    const result = this.core.db.transaction(() => this.apply(channel, account, [discussion], false, false))()
    this.store.notify()
    return result
  }

  /** Every login of the product writes as the product, and so does every confirmed send of it: what they wrote is our own, whichever login wrote it (DEC-010). */
  private ownMarks(channel: Channel, account: Account): { identities: Set<string>; resultIds: Set<string> } {
    const identities = new Set(this.store.productAccounts(channel.productId, account.id).map((a) => normalizeIdentity(a.identity)))
    identities.delete('')
    return { identities, resultIds: new Set([...this.store.confirmedExternalIds(account.id), ...this.store.productConfirmedExternalIds(channel)]) }
  }

  private apply(channel: Channel, account: Account, discussions: RemoteDiscussion[], baseline: boolean, newPosts = true): IngestResult {
    const now = this.store.now()
    const identity = normalizeIdentity(account.identity)
    // Every login of the product writes as the product, so a comment by any of them is our own, not only the
    // comments of the login this channel uses.
    const { identities: ownIdentities, resultIds: ownResultIds } = this.ownMarks(channel, account)
    const result: IngestResult = {
      discussions: 0,
      comments: 0,
      newComments: 0,
      newOpportunities: 0,
      changedComments: 0,
      identityUnknown: identity === ''
    }

    for (const remote of discussions) {
      const seen = this.upsertDiscussion(channel.id, remote, now)
      const discussionId = seen.id
      result.discussions++
      if (seen.created) {
        // A post first seen after the baseline, by someone else, that names a topic of the channel (never when our own comments cannot be told apart).
        if (newPosts && !baseline && identity !== '' && !ownIdentities.has(normalizeIdentity(remote.author)) && !ownResultIds.has(remote.externalId) && remote.locked !== true && remote.archived !== true) {
          if (this.queueNewPost(channel, discussionId, remote)) result.newOpportunities++
        }
      } else if (seen.changed) {
        this.reactToPostChange(discussionId, remote.url)
      }
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

  /** `created`: first time this channel sees the post. `changed`: its title, text or address is not what was stored. */
  private upsertDiscussion(channelId: Id, d: RemoteDiscussion, now: string): { id: Id; created: boolean; changed: boolean } {
    const row = this.core.db.prepare('SELECT id, url, title, body FROM discussions WHERE channel_id = ? AND external_id = ?').get(channelId, d.externalId) as
      | { id: string; url: string; title: string; body: string }
      | undefined
    if (row) {
      this.core.db.prepare('UPDATE discussions SET url = ?, title = ?, author = ?, body = ?, last_seen_at = ? WHERE id = ?').run(d.url, d.title, d.author, d.body, now, row.id)
      return { id: row.id, created: false, changed: row.url !== d.url || postHash(row) !== postHash(d) }
    }
    return { id: this.insertDiscussion(channelId, d, now), created: true, changed: false }
  }

  /** `posted_at` is kept for every discussion that is stored from now on (DEC-040); a row stored before keeps none. */
  private insertDiscussion(channelId: Id, d: Pick<RemoteDiscussion, 'externalId' | 'url' | 'title' | 'author' | 'body' | 'postedAt'>, now: string): Id {
    const id = newId()
    this.core.db
      .prepare('INSERT INTO discussions (id, channel_id, external_id, url, title, author, body, posted_at, selected, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .run(id, channelId, d.externalId, d.url, d.title, d.author, d.body, d.postedAt, now, now)
    return id
  }

  /** Queues the reply to a new post when it is about one of the channel's topics or queries. Returns whether a reply opportunity was opened. */
  private queueNewPost(channel: Channel, discussionId: Id, remote: RemoteDiscussion): boolean {
    const term = matchedTerm({ title: remote.title, body: remote.body }, { topics: channel.settings.topics, queries: channel.settings.queries })
    if (term === null || this.store.opportunityForPost(discussionId)) return false
    const post = this.core.repos.discussion(discussionId)
    return !this.store.openPostOpportunity(channel, post, `New post that matches "${term}"`).blocked
  }

  /** The post changed after its reply was prepared: pending work goes back to review, as it does for an edited comment. */
  private reactToPostChange(discussionId: Id, newUrl: string): void {
    const opp = this.store.opportunityForPost(discussionId)
    if (opp) this.reactToChange(opp, newUrl, POST_EDITED_REASON)
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
  private reactToChange(opp: Opportunity, newUrl: string, why = COMMENT_EDITED_REASON): void {
    if (opp.destination !== newUrl) this.store.updateOpportunity(opp.id, { destination: newUrl })
    switch (opp.state) {
      case 'draft':
      case 'awaiting_approval':
      case 'ready':
      case 'deferred':
      case 'needs_user':
      case 'no_reply':
      case 'error':
        this.review.returnToReview(opp.id, why)
        break
      default:
        // discovered/analyzing: the context is read when drafting; cancelled/sending/unknown/confirmed: leave as is.
        break
    }
  }

  // ───────────── the account's inbox (DEC-039) ─────────────

  /**
   * Stores what the account's inbox listed and queues it, once per comment: a reply to the account becomes an opportunity of source `reply_to_me`, a mention
   * `mention`. The same rules as for any comment: the first read of the inbox (`baseline`) stores and queues nothing; what any login of the product wrote is
   * our own and queues nothing; a discussion where another login of the product already speaks gets none (DEC-010); a comment read again changes nothing.
   *
   * `threads` holds the whole discussion of an item when the monitor could read it: it gives the AI the post and the comments around the item. Its comments
   * are stored as baseline, so nothing in them is queued but the item itself. The discussion of an item that is already stored is never overwritten.
   */
  ingestInbox(channel: Channel, account: Account, items: RemoteInboxItem[], options: { baseline: boolean; threads?: Map<string, RemoteDiscussion> }): InboxIngestResult {
    const result = this.core.db.transaction(() => {
      const out = this.applyInbox(channel, account, items, options.baseline, options.threads ?? new Map())
      if (options.baseline) this.store.markInboxBaselineDone(channel.id)
      return out
    })()
    this.store.notify()
    return result
  }

  private applyInbox(channel: Channel, account: Account, items: RemoteInboxItem[], baseline: boolean, threads: Map<string, RemoteDiscussion>): InboxIngestResult {
    const now = this.store.now()
    const identity = normalizeIdentity(account.identity)
    const { identities: ownIdentities, resultIds: ownResultIds } = this.ownMarks(channel, account)
    const result: InboxIngestResult = { stored: 0, newOpportunities: 0, relabelled: 0 }

    for (const item of items) {
      const c = item.comment
      const existing = this.store.commentByExternalId(channel.id, c.externalId)
      if (existing) {
        // Read again: nothing is stored twice. A comment that the discussion read queued as a plain comment is named for what it is.
        const opp = existing.isOwn ? null : this.store.opportunityForComment(existing.id)
        if (opp && opp.kind === 'reply' && opp.source === 'comment') {
          this.store.updateOpportunity(opp.id, { source: item.kind })
          result.relabelled++
        }
        continue
      }
      const isOwn = ownIdentities.has(normalizeIdentity(c.author)) || ownResultIds.has(c.externalId)
      const discussionId = this.inboxDiscussion(channel, item, threads.get(item.discussionExternalId), ownIdentities, ownResultIds, now)
      const stored = this.insertComment(channel.id, discussionId, c, baseline, isOwn, now)
      result.stored++
      // Never queue work when we cannot recognise our own comments: a reply chain with ourselves would be possible.
      if (!baseline && !isOwn && identity !== '' && !this.store.opportunityForComment(stored.id)) {
        if (!this.store.openReplyOpportunity(channel, stored, item.kind).blocked) result.newOpportunities++
      }
    }
    return result
  }

  /** The stored discussion of an inbox item: the one already stored, else the thread as read, else a bare one made from what the item says. */
  private inboxDiscussion(
    channel: Channel,
    item: RemoteInboxItem,
    thread: RemoteDiscussion | undefined,
    ownIdentities: Set<string>,
    ownResultIds: Set<string>,
    now: string
  ): Id {
    const known = this.store.discussionByExternalId(channel.id, item.discussionExternalId)
    if (known) return known.id
    if (!thread) return this.insertDiscussion(channel.id, { externalId: item.discussionExternalId, url: item.discussionUrl, title: item.discussionTitle, author: '', body: '', postedAt: null }, now)
    const id = this.insertDiscussion(channel.id, { externalId: item.discussionExternalId, url: thread.url || item.discussionUrl, title: thread.title || item.discussionTitle, author: thread.author, body: thread.body, postedAt: thread.postedAt }, now)
    for (const other of thread.comments) {
      if (other.externalId === item.comment.externalId || this.store.commentByExternalId(channel.id, other.externalId)) continue
      const isOwn = ownIdentities.has(normalizeIdentity(other.author)) || ownResultIds.has(other.externalId)
      this.insertComment(channel.id, id, other, true, isOwn, now)
    }
    return id
  }

  // ───────────── a post the AI triage found worth a reply (DEC-040) ─────────────

  /**
   * Says whether a post was written by any login of the product or is one the app itself published. The triage never judges what is ours. Built once for
   * a whole listing: it reads the logins and the confirmed sends a single time.
   */
  ownPostTest(channel: Channel, account: Account): (post: Pick<RemoteDiscussion, 'author' | 'externalId'>) => boolean {
    const { identities, resultIds } = this.ownMarks(channel, account)
    return (post) => identities.has(normalizeIdentity(post.author)) || resultIds.has(post.externalId)
  }

  /**
   * Opens the ordinary `new_post` opportunity (DEC-039) for a post the AI read and found worth a reply, and stores the post for it. Everything that guards
   * a new post found by topic holds here too, and none of it is the AI's to decide:
   *  - the account identity must be known (without it our own posts cannot be told apart);
   *  - never a post of any login of the product, never a locked or archived one;
   *  - one voice per discussion (DEC-010): when another login of the product speaks there, the opportunity is recorded as cancelled and the post is `blocked`;
   *  - one `new_post` opportunity per discussion: when the monitor already queued the post by topic, that one is returned, no second one is made, and one the
   *    owner had set aside is not opened again;
   *  - the comments under the post are stored as BASELINE, so nothing in them is queued and no reply is ever prepared for an old comment.
   * The opportunity is only `discovered`: the draft, the owner's Approve and the send gate all still stand between it and the platform (automatic mode
   * never answers a new post, DEC-039). A post already stored keeps its row as it is.
   */
  ingestTriagedPost(channel: Channel, account: Account, post: RemoteDiscussion, relation: string): TriagedPostResult {
    const result = this.core.db.transaction(() => this.applyTriagedPost(channel, account, post, relation))()
    this.store.notify()
    return result
  }

  private applyTriagedPost(channel: Channel, account: Account, post: RemoteDiscussion, relation: string): TriagedPostResult {
    const blocked = (reason: string): TriagedPostResult => ({ opportunity: null, opened: false, blocked: reason })
    if (normalizeIdentity(account.identity) === '') return blocked(IDENTITY_UNKNOWN_REASON)
    const { identities: ownIdentities, resultIds: ownResultIds } = this.ownMarks(channel, account)
    if (ownIdentities.has(normalizeIdentity(post.author)) || ownResultIds.has(post.externalId)) return blocked(OWN_POST_REASON)
    if (post.locked === true || post.archived === true) return blocked(LOCKED_POST_REASON)

    let discussion = this.store.discussionByExternalId(channel.id, post.externalId)
    if (!discussion) {
      const now = this.store.now()
      const id = this.insertDiscussion(channel.id, post, now)
      for (const c of post.comments) {
        if (this.store.commentByExternalId(channel.id, c.externalId)) continue
        const isOwn = ownIdentities.has(normalizeIdentity(c.author)) || ownResultIds.has(c.externalId)
        this.insertComment(channel.id, id, c, true, isOwn, now)
      }
      discussion = this.core.repos.discussion(id)
    }

    const existing = this.store.opportunityForPost(discussion.id)
    if (existing) return existing.state === 'cancelled' ? blocked(existing.reason || POST_SET_ASIDE_REASON) : { opportunity: existing, opened: false, blocked: null }

    const opened = this.store.openPostOpportunity(channel, discussion, `${AI_FOUND_PREFIX}${oneLine(relation, 200)}`)
    return opened.blocked ? blocked(OTHER_LOGIN_SPEAKS_REASON) : { opportunity: opened.opportunity, opened: true, blocked: null }
  }
}
