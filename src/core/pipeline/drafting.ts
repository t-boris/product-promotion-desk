// Draft preparation and channel modes (I-5, REQ-003 criteria 2-5).
//
// For each 'discovered' reply opportunity the AI is asked (without tools) for a classification and a reply.
// Its answer is validated by hand and checked locally before anything is saved. Then the channel mode decides:
//   observe  - nothing happens, the event stays 'discovered';
//   draft    - the draft is saved (state 'draft');
//   approval - the draft joins the approval queue (state 'awaiting_approval');
//   auto     - only simple, enabled, fully supported categories get an automatic approval and go through the
//              very same SendGate as a manual send; everything else is queued for the owner.

import { ApiError } from '../../shared/api'
import type { Channel, Id, Opportunity, OpportunityState } from '../../shared/types'
import type { Core } from '../core'
import { AiError } from '../ports'
import type { DraftingService } from '../services'
import { buildReplyContext, type ReplyContext } from './context'
import { buildReplyPrompt, parseReplyProposal, REPLY_LABEL, REPLY_SYSTEM, type ReplyProposal } from './draft-prompt'
import { SendBlockedError } from './gate'
import { autoEligibility } from './modes'
import type { ReviewFlow } from './review'
import { allowedHostsFor, checkDraftSafety } from './safety'
import type { SendingFlow } from './sending'
import type { FlowStore } from './store'
import { errorMessage } from './util'

export const NO_KNOWLEDGE_REASON = 'no approved product knowledge'

/** Opportunities handled per batch, and per call; the rest waits for the next check. */
const BATCH_SIZE = 5
const MAX_PER_PASS = 20
const AI_TIMEOUT_MS = 180_000
/** An automatic reply that has been waiting this long (limits, pause) is no longer sent without a fresh look. */
const AUTO_HOLD_MAX_MS = 24 * 60 * 60 * 1000

export type PrepareOutcome = 'prepared' | 'auto_sent' | 'needs_user' | 'no_reply' | 'skipped'

/** States from which the owner may ask the AI to (re)prepare a draft. */
const REDRAFTABLE: OpportunityState[] = ['discovered', 'needs_user', 'no_reply', 'error', 'deferred', 'draft', 'awaiting_approval']

export class DraftingFlow implements DraftingService {
  private readonly processing = new Set<string>()
  private readonly analyzing = new Set<string>()

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly review: ReviewFlow,
    private readonly sending: SendingFlow
  ) {}

  async processChannel(channelId: Id): Promise<{ prepared: number; autoSent: number; needsUser: number }> {
    const summary = { prepared: 0, autoSent: 0, needsUser: 0 }
    if (this.processing.has(channelId)) return summary
    let channel: Channel
    try {
      channel = this.core.repos.channel(channelId)
    } catch {
      return summary
    }
    if (channel.status === 'paused') return summary

    this.processing.add(channelId)
    try {
      this.resetStale(channelId)
      await this.settleAutoApprovals(channel, summary)
      // Observation mode only shows events: no AI work and no drafts.
      if (channel.mode === 'observe') return summary

      const seen = new Set<string>()
      while (seen.size < MAX_PER_PASS) {
        const batch = this.store
          .list({ channelId, kind: 'reply', states: ['discovered'], limit: 500 })
          .reverse()
          .filter((o) => !seen.has(o.id))
          .slice(0, Math.min(BATCH_SIZE, MAX_PER_PASS - seen.size))
        if (batch.length === 0) break
        for (const opp of batch) {
          seen.add(opp.id)
          const outcome = await this.prepareOne(opp.id, { explicit: false })
          if (outcome === 'prepared') summary.prepared++
          if (outcome === 'needs_user') summary.needsUser++
          if (outcome === 'auto_sent') {
            summary.prepared++
            summary.autoSent++
          }
        }
      }
      return summary
    } finally {
      this.processing.delete(channelId)
    }
  }

  /** Items left 'analyzing' by a stopped process would never be picked up again. */
  private resetStale(channelId: Id): void {
    for (const opp of this.store.list({ channelId, states: ['analyzing'], limit: 500 })) {
      if (this.analyzing.has(opp.id)) continue
      this.store.transition(opp.id, ['analyzing'], 'discovered', 'Drafting was interrupted; it will be prepared again.')
    }
  }

  /**
   * Automatic approvals that could not be used yet (limits, pause) are retried while they are fresh; ones that
   * no longer match the channel mode, or waited too long, go back to the owner.
   */
  private async settleAutoApprovals(channel: Channel, summary: { autoSent: number }): Promise<void> {
    for (const opp of this.store.list({ channelId: channel.id, kind: 'reply', states: ['ready'], limit: 200 })) {
      const draft = this.core.repos.latestDraft(opp.id)
      const approval = draft ? this.core.repos.activeApproval(draft.id) : null
      if (!approval || approval.approvedBy !== 'auto_rule') continue
      if (channel.mode !== 'auto') {
        this.review.returnToReview(opp.id, 'The channel is no longer in automatic mode; review this reply.')
        continue
      }
      if (this.core.clock.now().getTime() - Date.parse(approval.approvedAt) > AUTO_HOLD_MAX_MS) {
        this.review.returnToReview(opp.id, 'The automatic reply waited too long to be sent; review it again.')
        continue
      }
      if ((await this.autoSend(opp.id)) === 'auto_sent') summary.autoSent++
    }
    this.store.notify()
  }

  /**
   * Prepares the draft for one reply opportunity. `explicit` is the owner asking for it: then it never sends
   * anything and can restart from most states.
   */
  async prepareOne(id: Id, options: { explicit: boolean }): Promise<PrepareOutcome> {
    const opp = this.store.requireOpportunity(id)
    if (opp.kind !== 'reply') throw new ApiError('invalid_state', 'Only replies are prepared from comments; standalone posts are suggested per channel.')
    const from: OpportunityState[] = options.explicit ? REDRAFTABLE : ['discovered']
    if (!this.store.transition(id, from, 'analyzing')) {
      if (options.explicit) throw new ApiError('invalid_state', `A draft cannot be prepared while the item is "${opp.state.replace('_', ' ')}".`)
      return 'skipped'
    }
    this.analyzing.add(id)
    this.store.notify()
    try {
      return await this.analyze(id, options.explicit)
    } catch (error) {
      this.core.log.error('drafting', `Unexpected drafting error: ${errorMessage(error)}`, opp.channelId)
      this.toNeedsUser(id, `Drafting failed unexpectedly: ${errorMessage(error)}`)
      return 'needs_user'
    } finally {
      this.analyzing.delete(id)
      this.store.notify()
    }
  }

  private toNeedsUser(id: Id, reason: string): PrepareOutcome {
    this.store.transition(id, ['analyzing'], 'needs_user', reason)
    return 'needs_user'
  }

  private async analyze(id: Id, explicit: boolean): Promise<PrepareOutcome> {
    const opp = this.store.requireOpportunity(id)
    const channel = this.store.requireChannel(opp.channelId)

    let ctx: ReplyContext
    try {
      ctx = buildReplyContext(this.core, this.store, opp)
    } catch (error) {
      return this.toNeedsUser(id, `The conversation is not available: ${errorMessage(error)}`)
    }
    if (ctx.knowledge.approved.length === 0) return this.toNeedsUser(id, NO_KNOWLEDGE_REASON)

    let raw: string
    try {
      raw = await this.core.engines.require().run({ label: REPLY_LABEL, system: REPLY_SYSTEM, prompt: buildReplyPrompt(ctx), timeoutMs: AI_TIMEOUT_MS })
    } catch (error) {
      const why = error instanceof AiError ? `${error.kind}: ${error.message}` : errorMessage(error)
      return this.toNeedsUser(id, `AI drafting is not available (${why}). Write the reply yourself or try again later.`)
    }

    let proposal: ReplyProposal
    try {
      proposal = parseReplyProposal(raw)
    } catch (error) {
      return this.toNeedsUser(id, `The AI returned an unusable answer (${errorMessage(error)}). Write the reply yourself or try again.`)
    }

    // The thread may have changed while the AI was working: a draft for the old text must not be saved.
    const current = this.store.comment(ctx.comment.id)
    if (!current || current.contentHash !== ctx.comment.contentHash) {
      this.store.transition(id, ['analyzing'], 'discovered', 'The comment changed while the draft was being prepared; it will be prepared again.')
      return 'skipped'
    }

    this.store.updateOpportunity(id, { category: proposal.category, decision: proposal.decision })
    switch (proposal.decision) {
      case 'ignore': {
        this.store.transition(id, ['analyzing'], 'no_reply', proposal.rationale || 'The AI found that no reply is needed.')
        return 'no_reply'
      }
      case 'ask_user':
        return this.toNeedsUser(id, `The AI needs your input: ${proposal.rationale || 'the available facts are not enough to answer.'}`)
      case 'handoff':
        return this.toNeedsUser(id, `Handed over to you without a draft: ${proposal.rationale || 'this needs your own answer.'}`)
      default:
        return this.applyReply(opp, channel, ctx, proposal, explicit)
    }
  }

  private async applyReply(opp: Opportunity, channel: Channel, ctx: ReplyContext, proposal: ReplyProposal, explicit: boolean): Promise<PrepareOutcome> {
    const { knowledge } = ctx
    const report = checkDraftSafety({
      text: proposal.reply,
      usedClaimIds: proposal.usedClaimIds,
      approved: knowledge.approved,
      prohibited: knowledge.prohibited,
      allowedHosts: allowedHostsFor(ctx.product.website, knowledge.approved)
    })
    const violations = [...report.violations]
    if ((proposal.category === 'product_question' || proposal.category === 'purchase_interest') && report.usedClaims.length === 0) {
      violations.push('an answer about the product must cite at least one approved claim')
    }
    if (violations.length > 0) return this.toNeedsUser(opp.id, `The draft was blocked by the safety checks: ${violations.join('; ')}.`)

    const eligibility =
      channel.mode === 'auto' && !explicit
        ? autoEligibility({ channel, category: proposal.category, decision: proposal.decision, commentBody: ctx.comment.body, reply: proposal.reply, usedClaimIds: proposal.usedClaimIds, approved: knowledge.approved })
        : null
    // Safe defaults: a draft in 'draft' mode stays a draft; everything else waits for approval.
    const mode = explicit ? (channel.mode === 'draft' || channel.mode === 'observe' ? 'draft' : 'approval') : channel.mode
    const target: OpportunityState = mode === 'draft' ? 'draft' : 'awaiting_approval'
    const reason = eligibility && !eligibility.eligible ? `Waiting for your approval, not sent automatically: ${eligibility.why}.` : ''

    const saved = this.core.db.transaction(() => {
      if (!this.store.transition(opp.id, ['analyzing'], target, reason)) return null // the owner acted meanwhile
      this.store.invalidateApprovals(opp.id, 'A new draft was prepared')
      return this.store.insertDraft(
        opp.id,
        { title: null, text: proposal.reply, link: null, attachments: [] },
        {
          knowledgeVersionId: knowledge.versionId,
          usedClaimLineageIds: [...new Set(report.usedClaims.map((c) => c.lineageId))],
          rationale: proposal.rationale,
          author: 'ai'
        }
      )
    })()
    if (!saved) return 'skipped'

    if (eligibility?.eligible) {
      this.review.createAutoApproval(opp.id, saved, eligibility.ruleId)
      return (await this.autoSend(opp.id)) === 'auto_sent' ? 'auto_sent' : 'prepared'
    }
    return 'prepared'
  }

  /** Sends an automatically approved reply through the same path and gate as a manual send. */
  private async autoSend(opportunityId: Id): Promise<'auto_sent' | 'held'> {
    try {
      await this.sending.send(opportunityId, { automatic: true })
      return 'auto_sent'
    } catch (error) {
      if (error instanceof SendBlockedError) {
        // 'hold': stays approved and is retried on the next pass. 'review'/'cancel' were applied by the sender.
        if (error.block.effect === 'hold') {
          const current = this.store.requireOpportunity(opportunityId)
          if (current.state === 'ready') this.store.updateOpportunity(opportunityId, { reason: `Automatic reply waiting: ${error.message}` })
        }
        return 'held'
      }
      this.core.log.error('drafting', `Automatic send failed unexpectedly: ${errorMessage(error)}`)
      this.review.returnToReview(opportunityId, `The automatic send failed unexpectedly: ${errorMessage(error)}`)
      return 'held'
    }
  }
}

