// Review and approval binding (REQ-004 criterion 1, REQ-001 invalidation).
//
// A draft is immutable: every edit inserts a NEW draft row and invalidates the approvals of the old content.
// An approval stores the hash of the exact content, account and destination it was given for; the SendGate
// recomputes that hash from the current records at send time.

import { ApiError, type DraftInput } from '../../shared/api'
import type { Approval, Draft, Id, Opportunity, OpportunityState } from '../../shared/types'
import { judgedForFit, noConnectorProblem, renderForPlatform } from '../../shared/post-format'
import type { PipelineHooks } from '../services'
import type { Core } from '../core'
import { attachmentProblem } from './attachments'
import { assertTopicFits, inheritPostType, normalizeDraftInput } from './draft-input'
import { contentHash, hashedIdentity } from './hash'
import { sendFitProblems, sendWays } from './send-ways'
import { OTHER_LOGIN_SPEAKS_REASON, SEND_LOCKED_STATES, SPEAKING_STATES, type FlowStore } from './store'

export const FACTS_CHANGED_REASON = 'Product facts changed; review again'

/** States from which the owner may approve the latest draft. */
const APPROVABLE: OpportunityState[] = ['draft', 'awaiting_approval', 'ready', 'deferred', 'needs_user', 'error', 'no_reply']
/**
 * States holding content that may be waiting for a send and therefore depends on product facts. 'analyzing' is
 * included because the AI call in flight reads the old facts: its result is dropped and the item is prepared again.
 */
const FACT_DEPENDENT: OpportunityState[] = ['analyzing', 'draft', 'awaiting_approval', 'ready', 'deferred']

export class ReviewFlow implements PipelineHooks {
  constructor(
    private readonly core: Core,
    private readonly store: FlowStore
  ) {}

  private assertEditable(opp: Opportunity, action: string): void {
    // Rejected and deleted are final: no edit, deferral or second rejection puts an item back in the queue.
    if (opp.state === 'cancelled') throw new ApiError('invalid_state', `Cannot ${action}: this item was rejected or deleted, and that cannot be undone.`)
    if (SEND_LOCKED_STATES.includes(opp.state)) {
      throw new ApiError('invalid_state', `Cannot ${action}: this item is ${opp.state === 'confirmed' ? 'already sent' : opp.state === 'sending' ? 'being sent' : 'waiting for its send result to be resolved'}.`)
    }
  }

  /** The content hash for the latest draft as it stands now (used when approving and by the SendGate). */
  currentHash(opp: Opportunity, draft: Draft): { hash: string; accountId: Id; identity: string | null; destination: string } {
    const channel = this.store.requireChannel(opp.channelId)
    const account = this.core.repos.account(channel.accountId)
    const destination = this.store.resolveDestination(opp, channel)
    return { hash: contentHash(draft, account, destination, channel.platform), accountId: account.id, identity: hashedIdentity(account.identity), destination }
  }

  /**
   * Stores the owner's edit as a new draft and invalidates every approval of the previous content.
   * The AI rationale and fact lineage are carried over, so a later change to those facts still forces re-review. `author` is 'ai' only for a
   * text the AI wrote for the owner to read (a post group's adaptation); the owner's own edit is 'user'. `expectDraftId`: the edit is refused
   * (`conflict`) unless that draft is still the latest.
   */
  async saveDraft(id: Id, input: DraftInput, options: { author?: 'user' | 'ai'; expectDraftId?: Id } = {}): Promise<Opportunity> {
    const opp = this.store.requireOpportunity(id)
    this.assertEditable(opp, 'edit the draft')
    const content = await normalizeDraftInput(input, { productId: opp.productId, media: this.core.services.media! })
    if (opp.kind === 'reply' && !content.text) throw new ApiError('invalid_input', 'A reply needs text.')
    const channel = this.store.requireChannel(opp.channelId)
    if (opp.kind === 'reply' && content.topicTag) throw new ApiError('invalid_input', 'A reply has no topic: only a post is filed under one.')
    assertTopicFits(channel.platform, content)

    this.core.db.transaction(() => {
      // Re-read inside the transaction: the state may have changed while attachments were being checked.
      const current = this.store.requireOpportunity(id)
      this.assertEditable(current, 'edit the draft')
      // The draft this one replaces is the latest one NOW, not the one that was there when the call began; and a caller that wrote its text from
      // a draft it read earlier (the AI's adaptation) says which, so that it never replaces what was written in the meantime.
      const previous = this.core.repos.latestDraft(id)
      if (options.expectDraftId !== undefined && previous?.id !== options.expectDraftId) throw new ApiError('conflict', 'The draft changed while this text was being written.')
      // A draft that is already in review keeps its place; one that is not must not start a second voice.
      if (!SPEAKING_STATES.includes(current.state) && this.store.otherLoginSpeakingFor(current)) throw new ApiError('invalid_state', OTHER_LOGIN_SPEAKS_REASON)
      this.store.insertDraft(id, inheritPostType(content, previous), {
        knowledgeVersionId: previous?.knowledgeVersionId ?? null,
        usedClaimLineageIds: previous?.usedClaimLineageIds ?? [],
        rationale: previous?.rationale ?? '',
        author: options.author ?? 'user'
      })
      const hadApproval = this.store.invalidateApprovals(id, 'The draft was edited after approval') > 0
      const wasInReview = current.state === 'awaiting_approval' || current.state === 'ready'
      const next = wasInReview ? this.store.reviewState(current, channel) : 'draft'
      this.store.updateOpportunity(id, {
        state: next,
        reason: hadApproval ? 'Draft edited; the previous approval no longer applies. Approve again to send.' : ''
      })
    })()
    this.store.notify()
    return this.store.requireOpportunity(id)
  }

  /** The owner approves the latest draft exactly as it is now. */
  async approve(id: Id): Promise<Opportunity> {
    const opp = this.store.requireOpportunity(id)
    if (!APPROVABLE.includes(opp.state)) throw new ApiError('invalid_state', `This item cannot be approved while it is "${opp.state}".`)
    const draft = this.core.repos.latestDraft(id)
    if (!draft) throw new ApiError('no_draft', 'There is no draft to approve. Write or prepare one first.')
    if (opp.kind === 'reply' && !draft.text.trim()) throw new ApiError('invalid_input', 'The reply is empty.')
    const problem = await attachmentProblem(draft.attachments)
    if (problem) throw new ApiError('invalid_attachment', problem)
    // A post written in the post editor, and a quick post, is approved only when its platform can show it and this application can send it (DEC-030, DEC-044).
    if (judgedForFit(draft)) {
      const channel = this.store.requireChannel(opp.channelId)
      const platform = channel.platform
      const unfit = sendFitProblems(this.core, draft, platform, sendWays(this.core, undefined, channel))
      if (unfit.length > 0) throw new ApiError('post_does_not_fit', unfit.join(' '))
    } else {
      const channel = this.store.requireChannel(opp.channelId)
      // An older draft is judged by its connector, as before; the one thing the render says of it is that a link added to the end of the text
      // (a platform with no link field, DEC-036) took it over the limit, which did not count while the link was a part of its own.
      const overLimit = renderForPlatform(draft, channel.platform).problems
      if (overLimit.length > 0) throw new ApiError('post_does_not_fit', overLimit.join(' '))
      if (opp.kind === 'standalone') {
        // An older post (a suggestion of the AI, a mix draft) on a channel with no connector is carried by the AI browser or by nothing:
        // what stops that is said now, at the approval, and not as a connector's failure after the press.
        const stopped = noConnectorProblem(sendWays(this.core, undefined, channel))
        if (stopped) throw new ApiError('post_does_not_fit', stopped)
      }
    }

    this.core.db.transaction(() => {
      const current = this.store.requireOpportunity(id)
      if (!APPROVABLE.includes(current.state)) throw new ApiError('invalid_state', `This item cannot be approved while it is "${current.state}".`)
      if (this.store.otherLoginSpeakingFor(current)) throw new ApiError('invalid_state', OTHER_LOGIN_SPEAKS_REASON)
      const latest = this.core.repos.latestDraft(id)
      if (!latest || latest.id !== draft.id) throw new ApiError('conflict', 'The draft changed while you were approving. Review it again.')
      const { hash, accountId, identity, destination } = this.currentHash(current, latest)
      const existing = this.core.repos.activeApproval(latest.id)
      const reusable = existing && existing.approvedBy === 'user' && existing.contentHash === hash && existing.accountId === accountId && existing.destination === destination
      if (!reusable) {
        if (existing) this.store.invalidateApprovals(id, 'Superseded by a new approval')
        this.store.insertApproval({ draftId: latest.id, contentHash: hash, accountId, identity, destination, approvedBy: 'user', ruleId: null })
      }
      // Approving never publishes by itself. A publication whose planned time is already behind us is not picked
      // up by the scheduler either (it only sends what was approved before its time): the owner presses Send.
      const lateSchedule = current.scheduledAt !== null && Date.parse(current.scheduledAt) <= this.core.clock.now().getTime()
      this.store.updateOpportunity(id, { state: 'ready', reason: lateSchedule ? 'The scheduled time has already passed; press Send to publish it now.' : '' })
    })()
    this.store.notify()
    return this.store.requireOpportunity(id)
  }

  /**
   * Approval by an enabled automatic rule (restricted automatic replies). Same binding as a manual approval;
   * the rule id is recorded as the authorization basis. Only the drafting service calls this.
   */
  createAutoApproval(id: Id, draft: Draft, ruleId: string): Approval {
    return this.core.db.transaction(() => {
      const opp = this.store.requireOpportunity(id)
      const { hash, accountId, identity, destination } = this.currentHash(opp, draft)
      this.store.invalidateApprovals(id, 'Superseded by an automatic approval')
      const approval = this.store.insertApproval({ draftId: draft.id, contentHash: hash, accountId, identity, destination, approvedBy: 'auto_rule', ruleId })
      this.store.updateOpportunity(id, { state: 'ready', reason: `Approved automatically by rule ${ruleId}` })
      return approval
    })()
  }

  reject(id: Id, reason?: string): Opportunity {
    const opp = this.store.requireOpportunity(id)
    this.assertEditable(opp, 'reject')
    this.core.db.transaction(() => {
      this.store.invalidateApprovals(id, 'Rejected by the owner')
      this.store.updateOpportunity(id, { state: 'cancelled', reason: reason?.trim() || 'Rejected by the owner' })
    })()
    this.store.notify()
    return this.store.requireOpportunity(id)
  }

  /**
   * Deletes a deleted post for good (owner 2026-11-21: "Can't delete deleted posts"). Only a post of the owner's that was deleted and never went out:
   * a reply that was rejected, or a post a send was started for (it may be on a site, and its record is what says so), stays. Its drafts, approvals
   * and attempts that did not go out go with it; the notes it was written from are free again; a group left with no version goes too.
   */
  purge(id: Id): void {
    const opp = this.store.requireOpportunity(id)
    if (opp.kind !== 'standalone') throw new ApiError('invalid_state', 'Only a post of yours can be deleted for good. A rejected reply stays as the record of it.')
    if (opp.state !== 'cancelled') throw new ApiError('invalid_state', 'Delete the post first: only a deleted post can be deleted for good.')
    const db = this.core.db
    const started = db.prepare("SELECT COUNT(*) AS n FROM send_actions WHERE opportunity_id = ? AND state IN ('sending', 'unknown', 'confirmed')").get(id) as { n: number }
    if (started.n > 0) throw new ApiError('invalid_state', 'A send of this post was started, so the record of it stays.')
    db.transaction(() => {
      const group = db.prepare('SELECT group_id FROM opportunities WHERE id = ?').get(id) as { group_id: string | null } | undefined
      // The attempts that failed first: they hold the draft and the approval, which go with the post.
      db.prepare('DELETE FROM send_actions WHERE opportunity_id = ?').run(id)
      db.prepare('UPDATE product_updates SET used_in_opportunity_id = NULL WHERE used_in_opportunity_id = ?').run(id)
      db.prepare('DELETE FROM opportunities WHERE id = ?').run(id)
      if (group?.group_id) db.prepare('DELETE FROM post_groups WHERE id = ? AND NOT EXISTS (SELECT 1 FROM opportunities WHERE group_id = ?)').run(group.group_id, group.group_id)
    })()
    this.core.log.info('pipeline', 'A deleted post was deleted for good, with its drafts and approvals. Nothing of it had gone out.', opp.channelId)
    this.store.notify()
  }

  defer(id: Id): Opportunity {
    const opp = this.store.requireOpportunity(id)
    this.assertEditable(opp, 'defer')
    this.core.db.transaction(() => {
      // Deferring withdraws readiness: coming back to the item means approving it again.
      this.store.invalidateApprovals(id, 'Deferred by the owner')
      this.store.updateOpportunity(id, { state: 'deferred', reason: 'Deferred by the owner' })
    })()
    this.store.notify()
    return this.store.requireOpportunity(id)
  }

  /**
   * Sends an item back to the owner: approvals are invalidated and it returns to the review queue (or to
   * 'discovered' when there is no draft to review yet). Items already out or in flight are never touched,
   * except by the sending service itself while it settles a failed attempt (`settlingAttempt`).
   */
  returnToReview(id: Id, reason: string, options: { settlingAttempt?: boolean } = {}): void {
    this.core.db.transaction(() => {
      const opp = this.store.requireOpportunity(id)
      if (SEND_LOCKED_STATES.includes(opp.state) && !options.settlingAttempt) return
      const channel = this.store.requireChannel(opp.channelId)
      this.store.invalidateApprovals(id, reason)
      const hasDraft = this.core.repos.latestDraft(id) !== null
      const state: OpportunityState = hasDraft ? this.store.reviewState(opp, channel) : opp.kind === 'reply' ? 'discovered' : 'draft'
      this.store.updateOpportunity(id, { state, reason })
    })()
  }

  /** PipelineHooks: product facts changed, so pending content built on them must be reviewed again. */
  invalidateForChangedFacts(productId: Id, changedLineageIds: Id[]): number {
    if (changedLineageIds.length === 0) return 0
    const changed = new Set(changedLineageIds)
    const affected = this.core.db.transaction(() => {
      let count = 0
      for (const opp of this.store.list({ states: FACT_DEPENDENT, limit: 10_000 })) {
        if (opp.productId !== productId) continue
        // The lineage of what an in-flight draft will cite is not known yet, so every analysis of the product restarts.
        if (opp.state !== 'analyzing') {
          const draft = this.core.repos.latestDraft(opp.id)
          if (!draft || !draft.usedClaimLineageIds.some((lineage) => changed.has(lineage))) continue
        }
        this.returnToReview(opp.id, FACTS_CHANGED_REASON)
        count++
      }
      return count
    })()
    if (affected > 0) {
      this.core.log.info('pipeline', `Product facts changed: ${affected} pending item(s) returned to review`)
      this.store.notify()
    }
    return affected
  }
}

