// The SendGate (REQ-004): the single place that decides whether an outgoing action may happen.
//
// It re-checks everything at the moment of sending - approval vs. the CURRENT content, account and
// destination; availability and permissions; the live thread; the account's aggregate limits; and any earlier
// attempt - and only then issues a ticket. Connectors and the browser service refuse write actions without a
// ticket, so neither an AI instruction nor a buggy caller can publish around this gate.

import type { Account, Approval, Channel, Comment, Draft, Id, Opportunity } from '../../shared/types'
import type { Core } from '../core'
import { newId } from '../db/database'
import { TakeoverError, type Connector, type ConnectorContext, type PublishRequest, type RemoteDiscussion, type SendTicket } from '../ports'
import { attachmentProblem } from './attachments'
import { commentBodyHash, contentHash, hashedIdentity } from './hash'
import { autoCategoryOf, autoRuleId } from './modes'
import { buildPublishRequest, publishCapability } from './request'
import { OTHER_LOGIN_SPEAKS_REASON, type FlowStore } from './store'
import { errorMessage, normalizeIdentity } from './util'

/**
 * hold   - not allowed now; nothing changes (limits, pause, account trouble). The item stays where it is.
 * review - the approval no longer applies; the item goes back to the owner.
 * cancel - the reply is pointless now (the owner already replied, the thread is gone or locked).
 */
export type GateEffect = 'hold' | 'review' | 'cancel'

export interface GateBlock {
  allowed: false
  effect: GateEffect
  code: string
  reasons: string[]
  /** The thread as read from the platform, when the block is about a changed comment. */
  thread?: RemoteDiscussion
}

export interface GateGrant {
  allowed: true
  actionId: Id
  ticket: SendTicket
  opportunity: Opportunity
  channel: Channel
  account: Account
  draft: Draft
  approval: Approval
  request: PublishRequest
  contentHash: string
  authorizationBasis: string
}

export type GateDecision = GateGrant | GateBlock

export class SendBlockedError extends Error {
  constructor(readonly block: GateBlock) {
    super(block.reasons.join(' '))
    this.name = 'SendBlockedError'
  }
}

export interface GateRequest {
  opportunityId: Id
  /** Initiated by a rule or the scheduler rather than by an explicit click; automatic sends obey the global pause. */
  automatic: boolean
}

interface Snapshot {
  opp: Opportunity
  channel: Channel
  account: Account
  draft: Draft | null
  comment: Comment | null
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const block = (effect: GateEffect, code: string, ...reasons: string[]): GateBlock => ({ allowed: false, effect, code, reasons })

export class SendGate {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore
  ) {}

  async authorize(req: GateRequest): Promise<GateDecision> {
    const first = this.load(req.opportunityId)

    let pair: { connector: Connector; ctx: ConnectorContext }
    try {
      pair = this.core.connectorContext(first.channel.id)
    } catch (error) {
      return block('hold', 'connector_missing', errorMessage(error))
    }
    const { connector, ctx } = pair

    // Cheap local checks first, so the network is not touched for an item that cannot be sent anyway.
    const early = this.checkApproval(first, req) ?? this.checkSingleLogin(first) ?? this.checkAvailability(first, req, ctx) ?? this.checkOpenAction(first)
    if (early) return early

    // (c) content on disk and the live thread.
    const draft = first.draft as Draft
    const attachments = await attachmentProblem(draft.attachments)
    if (attachments) return block('review', 'attachment_changed', attachments)
    if (first.opp.kind === 'reply') {
      const thread = await this.checkThread(first, ctx, connector)
      if (thread) return thread
    }

    // The owner may have edited or withdrawn the item while the thread was being read: decide on fresh state.
    const now = this.load(req.opportunityId)
    const late = this.checkApproval(now, req) ?? this.checkSingleLogin(now) ?? this.checkAvailability(now, req, ctx) ?? this.checkLimits(now) ?? this.checkOpenAction(now)
    if (late) return late

    const { opp, channel, account, comment } = now
    const draftNow = now.draft as Draft
    const approval = this.core.repos.activeApproval(draftNow.id) as Approval
    const destination = this.store.resolveDestination(opp, channel)
    const hash = contentHash(draftNow, account, destination)
    const actionId = newId()
    const ticket = this.core.tickets.issue({ actionId, contentHash: hash, accountId: account.id, destination })
    return {
      allowed: true,
      actionId,
      ticket,
      opportunity: opp,
      channel,
      account,
      draft: draftNow,
      approval,
      request: buildPublishRequest(opp, draftNow, comment, destination),
      contentHash: hash,
      authorizationBasis: approval.approvedBy === 'user' ? `user approval ${approval.id}` : `auto rule ${approval.ruleId}`
    }
  }

  private load(opportunityId: Id): Snapshot {
    const opp = this.store.requireOpportunity(opportunityId)
    const channel = this.store.requireChannel(opp.channelId)
    return {
      opp,
      channel,
      account: this.core.repos.account(channel.accountId),
      draft: this.core.repos.latestDraft(opp.id),
      comment: opp.commentId ? this.store.comment(opp.commentId) : null
    }
  }

  // ───────────── (a) approval vs. current content ─────────────

  private checkApproval(s: Snapshot, req: GateRequest): GateBlock | null {
    const { opp, channel, account, draft } = s
    // Only approved items are sent. Items already out or in flight fall through to the attempt check (e).
    if (!['ready', 'sending', 'unknown_result', 'confirmed'].includes(opp.state)) {
      return block('hold', 'not_ready', `This item is "${opp.state.replace('_', ' ')}" and cannot be sent. Only approved items can be sent.`)
    }
    if (!draft) return block('hold', 'no_draft', 'There is no draft to send.')
    if (opp.kind === 'reply' && !s.comment) return block('cancel', 'comment_gone', 'The comment this reply answers is no longer stored.')

    const approval = this.core.repos.activeApproval(draft.id)
    if (!approval) {
      return block(opp.state === 'ready' ? 'review' : 'hold', 'not_approved', 'The current draft has no valid approval. Approve it before sending.')
    }

    // The approval covers the exact content, account and destination; recompute all of it from the current records.
    const destination = this.store.resolveDestination(opp, channel)
    const hash = contentHash(draft, account, destination)
    if (approval.contentHash !== hash || approval.accountId !== account.id || approval.destination !== destination) {
      // Say WHY when the only difference is who is signed in: the owner approved a reply for another login.
      const approvedIdentity = this.store.approvalIdentity(approval.id)
      const sameAsApproved = approval.accountId === account.id && approval.destination === destination && approval.contentHash === contentHash(draft, { id: account.id, identity: approvedIdentity }, destination)
      if (sameAsApproved && hashedIdentity(approvedIdentity) !== hashedIdentity(account.identity)) {
        return block('review', 'identity_changed', 'Approval no longer applies: the signed-in identity changed; approve again.')
      }
      return block('review', 'approval_stale', 'The text, attachments, account or destination changed after approval. Review and approve again.')
    }

    if (approval.approvedBy === 'auto_rule') {
      if (opp.kind === 'standalone') return block('review', 'auto_rule_refused', 'Standalone publications always need your own approval; automatic approval is not allowed.')
      if (channel.mode !== 'auto') return block('review', 'auto_rule_refused', 'This channel is not in automatic mode, so an automatic approval is not valid.')
      const auto = autoCategoryOf(opp.category)
      if (!auto || approval.ruleId !== autoRuleId(auto) || !channel.settings.autoCategories.includes(auto)) {
        return block('review', 'auto_rule_refused', 'The automatic rule no longer allows this category of reply on this channel.')
      }
      const reply = channel.capabilities.find((c) => c.key === 'publish_reply')
      if (reply?.status !== 'verified') {
        return block('review', 'auto_rule_refused', 'Automatic replies need the reply capability to be verified by an approved manual reply first.')
      }
    } else if (req.automatic && opp.kind === 'reply') {
      // A reply is only ever sent without a click when an enabled rule approved it.
      return block('hold', 'not_automatic', 'This reply was approved by you, so it is sent only when you press Send.')
    }
    return null
  }

  // ───────────── one login speaks per discussion (DEC-010) ─────────────

  /**
   * At most one login of a product speaks in a discussion. This is decided from the records at the moment of
   * sending, so an approval given earlier (or automatically) cannot carry a second login into a discussion that
   * another login has meanwhile taken. It is not switchable. The approval is withdrawn: after the other login's
   * item is rejected or deferred, this one is approved again.
   */
  private checkSingleLogin(s: Snapshot): GateBlock | null {
    const other = this.store.otherLoginSpeakingFor(s.opp)
    return other ? block('review', 'other_login_speaks', OTHER_LOGIN_SPEAKS_REASON) : null
  }

  // ───────────── (b) availability and permissions ─────────────

  private checkAvailability(s: Snapshot, req: GateRequest, ctx: ConnectorContext): GateBlock | null {
    const { opp, channel, account } = s
    const reasons: string[] = []
    if (account.status !== 'ready') reasons.push(`Account "${account.label}" is not available (${account.status.replace('_', ' ')}).`)
    if (channel.status === 'paused') reasons.push('The channel is paused.')
    if (channel.status === 'setup') reasons.push('The channel has not been activated yet.')
    const capability = channel.capabilities.find((c) => c.key === publishCapability(opp))
    if (capability && (capability.status === 'unavailable' || capability.status === 'restricted' || capability.status === 'needs_user')) {
      reasons.push(`${capability.key.replace('_', ' ')} is ${capability.status.replace('_', ' ')} on this channel${capability.detail ? `: ${capability.detail}` : '.'}`)
    }
    if (req.automatic && this.core.settings.getRaw('automation.paused', false)) {
      reasons.push('Automation is paused, so automatic sends are suspended. Sending manually is still possible.')
    }
    if (ctx.session.control().holder === 'user') {
      reasons.push('The account browser is under your control. Hand it back so the application can send.')
    }
    return reasons.length > 0 ? block('hold', 'unavailable', ...reasons) : null
  }

  // ───────────── (c) the live thread ─────────────

  private async checkThread(s: Snapshot, ctx: ConnectorContext, connector: Connector): Promise<GateBlock | null> {
    const comment = s.comment as Comment
    const discussion = this.core.repos.discussion(comment.discussionId)

    let remote: RemoteDiscussion | null
    try {
      remote = await connector.fetchThread(ctx, discussion.externalId)
    } catch (error) {
      if (error instanceof TakeoverError) return block('hold', 'unavailable', 'The account browser is under your control. Hand it back so the application can send.')
      // If the thread cannot be read, its state cannot be verified, so nothing is sent.
      return block('hold', 'thread_unreadable', `The current thread could not be read, so the reply was not sent: ${errorMessage(error)}`)
    }
    if (!remote) return block('cancel', 'thread_unavailable', 'The discussion is no longer available on the platform.')
    if (remote.locked === true || remote.archived === true) {
      return block('cancel', 'thread_locked', `The discussion is ${remote.locked ? 'locked' : 'archived'}; new replies are not possible.`)
    }

    const target = remote.comments.find((c) => c.externalId === comment.externalId)

    // A reply by this account under the comment - including one the owner typed by hand - means the job is done.
    // Evidence of a reply is conclusive even in a partial snapshot; only the ABSENCE of one is not.
    const identity = normalizeIdentity(s.account.identity)
    const remoteReply = identity !== '' && remote.comments.some((c) => c.parentExternalId === comment.externalId && normalizeIdentity(c.author) === identity)
    if (remoteReply || this.store.ownReplyUnder(s.channel.id, comment.externalId)) {
      return block('cancel', 'already_replied', 'You already replied to this comment (found under it on the platform), so the application did not send another reply.')
    }

    // The connector could not read the whole thread (collapsed "load more" parts): "no reply found" proves nothing.
    if (remote.incomplete === true) {
      return block('hold', 'thread_incomplete', 'The thread is too large to check for an existing reply, so the reply was not sent. Check the thread yourself and send it manually if no reply exists.')
    }
    if (!target) return block('cancel', 'comment_gone', 'The comment you are replying to was removed from the discussion.')

    if (commentBodyHash(target.body) !== comment.contentHash) {
      return { ...block('review', 'comment_changed', 'The comment changed after the draft was prepared. Review the reply against the new text.'), thread: remote }
    }
    return null
  }

  // ───────────── (d) limits, aggregated per account ─────────────

  /**
   * A channel's perHour/perDay is the budget of the ACCOUNT it posts with, not of the channel alone: this
   * channel's limit is compared with the number of sends made by the account across ALL its channels. Channels
   * that share an account therefore share one budget, and each channel's own limit is the ceiling it is
   * measured against. That keeps one real login within the platform's tolerance.
   */
  private checkLimits(s: Snapshot): GateBlock | null {
    const { channel, account } = s
    const now = this.core.clock.now().getTime()
    const { perHour, perDay } = channel.settings.limits
    const windows = [
      { label: 'hourly', code: 'limit_hour', ms: HOUR_MS, max: perHour },
      { label: 'daily', code: 'limit_day', ms: DAY_MS, max: perDay }
    ]
    for (const w of windows) {
      const { count, oldest } = this.store.countActions(account.id, new Date(now - w.ms).toISOString())
      if (count >= w.max) {
        // All of the account's channels share one allowance: count what was sent anywhere with this account.
        const next = oldest ? new Date(new Date(oldest).getTime() + w.ms).toISOString() : null
        return block(
          'hold',
          w.code,
          `The ${w.label} limit of ${w.max} is reached for account "${account.label}" (${count} send(s) across all its channels).${next ? ` Try again after ${next}.` : ''}`
        )
      }
    }
    return null
  }

  // ───────────── (e) earlier attempts ─────────────

  private checkOpenAction(s: Snapshot): GateBlock | null {
    const open = this.store.openAction(s.opp.id)
    if (!open) return null
    if (open.state === 'confirmed') return block('hold', 'already_sent', 'This item was already sent.')
    if (open.state === 'unknown') {
      return block('hold', 'unknown_pending', 'An earlier attempt has an unknown result. It must be reconciled with the platform before anything can be sent again.')
    }
    return block('hold', 'in_flight', 'A send for this item is already in progress.')
  }
}
