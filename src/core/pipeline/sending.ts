// Authorized sending and reconciliation (I-6, REQ-004, REQ-005 criterion 10).
//
// Invariants kept here:
//  - every send passes the SendGate and runs one account at a time (aggregate limits, no concurrent control);
//  - the attempt row is written in state 'sending' BEFORE the connector is called, and the database's unique
//    index on open attempts is the last line of defence against a duplicate;
//  - exactly ONE connector.publish call per attempt; any exception after the ticket was used means the result
//    is unknown, and an unknown result blocks every further attempt until it is reconciled with the platform;
//  - absence on the platform alone never causes a blind resend: a not-found result only marks the attempt
//    failed after a waiting period and returns the item to the owner for review.
//
// The connector takes browser control itself (ctx.session.withAgentControl); the session is not re-entrant, so
// this service must not hold control around the connector call.

import type { Id, SendAction } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError, TicketError, type PublishOutcome, type PublishedRef } from '../ports'
import type { SendingService } from '../services'
import { SendBlockedError, type GateBlock, type GateGrant, type SendGate } from './gate'
import type { Ingestor } from './ingest'
import { buildPublishRequest } from './request'
import type { ReviewFlow } from './review'
import { SEND_LOCKED_STATES, type FlowStore } from './store'
import { KeyedMutex, errorMessage } from './util'

/** An unknown result is declared failed only after the platform has been silent for this long. */
export const UNKNOWN_WAIT_MS = 10 * 60 * 1000
export const NOT_FOUND_REASON = 'not found on the platform after 10 minutes; safe to retry after review'

export interface SendOptions {
  /** Initiated by a rule or the scheduler instead of an explicit click: the global pause applies. */
  automatic?: boolean
}

type AttemptOutcome = { kind: 'confirmed'; url: string; externalId: string } | { kind: 'failed'; error: string } | { kind: 'unknown'; error: string }

const isUniqueViolation = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'

export class SendingFlow implements SendingService {
  private readonly locks = new KeyedMutex()
  /** Attempts being executed by this process right now; any other 'sending' row is a leftover of a stopped process. */
  private readonly inFlight = new Set<string>()
  private readonly reconciling = new Set<string>()
  private readonly lastHold = new Map<string, string>()

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly gate: SendGate,
    private readonly review: ReviewFlow,
    private readonly ingestor: Ingestor
  ) {}

  // ───────────── sending ─────────────

  async send(opportunityId: Id, options: SendOptions = {}): Promise<SendAction> {
    const opp = this.store.requireOpportunity(opportunityId)
    const channel = this.store.requireChannel(opp.channelId)
    return this.locks.run(channel.accountId, () => this.sendLocked(opportunityId, options.automatic ?? false))
  }

  private async sendLocked(opportunityId: Id, automatic: boolean): Promise<SendAction> {
    const decision = await this.gate.authorize({ opportunityId, automatic })
    if (!decision.allowed) {
      this.applyBlock(opportunityId, decision)
      throw new SendBlockedError(decision)
    }
    try {
      const action = this.reserve(decision)
      this.lastHold.delete(opportunityId)
      return await this.attempt(decision, action)
    } finally {
      // The ticket is single-purpose: it must not outlive the attempt, whatever happened.
      this.core.tickets.revoke(decision.ticket)
    }
  }

  /** Writes the attempt as 'sending' and marks the opportunity, atomically, before anything leaves the machine. */
  private reserve(grant: GateGrant): SendAction {
    const oppId = grant.opportunity.id
    return this.core.db.transaction(() => {
      if (this.store.openAction(oppId)) throw new SendBlockedError({ allowed: false, effect: 'hold', code: 'in_flight', reasons: ['A send for this item is already in progress or finished.'] })
      try {
        this.core.db
          .prepare(
            `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, completed_at, result_url, result_external_id, authorization_basis, knowledge_version_id, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?, NULL, NULL, NULL, ?, ?, NULL)`
          )
          .run(grant.actionId, oppId, grant.draft.id, grant.approval.id, grant.contentHash, grant.account.id, grant.request.destination, this.store.now(), grant.authorizationBasis, grant.draft.knowledgeVersionId)
      } catch (error) {
        if (isUniqueViolation(error)) throw new SendBlockedError({ allowed: false, effect: 'hold', code: 'in_flight', reasons: ['A send for this item is already in progress or finished.'] })
        throw error
      }
      this.store.updateOpportunity(oppId, { state: 'sending', reason: '' })
      return this.core.repos.action(grant.actionId)
    })()
  }

  private async attempt(grant: GateGrant, action: SendAction): Promise<SendAction> {
    this.inFlight.add(action.id)
    this.store.notify()
    let settled = action
    try {
      await this.core.runs.track('send', { channelId: grant.channel.id, productId: grant.opportunity.productId }, async () => {
        const outcome = await this.publish(grant)
        settled = this.settle(grant, outcome)
        return { status: outcome.kind === 'confirmed' ? ('ok' as const) : ('failed' as const), summary: this.describe(grant, outcome) }
      })
    } finally {
      this.inFlight.delete(action.id)
      this.store.notify()
    }
    return settled
  }

  /** The single connector call. Never throws: every way it can end is mapped to confirmed, failed or unknown. */
  private async publish(grant: GateGrant): Promise<AttemptOutcome> {
    let pair
    try {
      pair = this.core.connectorContext(grant.channel.id)
    } catch (error) {
      return { kind: 'failed', error: errorMessage(error) } // nothing was submitted
    }
    try {
      const outcome: PublishOutcome = await pair.connector.publish(pair.ctx, grant.ticket, grant.request)
      return this.normalize(outcome)
    } catch (error) {
      // A rejected ticket stops the connector before any write action: definitely not sent.
      if (error instanceof TicketError) return { kind: 'failed', error: `The send authorization was rejected: ${error.message}` }
      // Anything else may have happened after the content was submitted (including losing the browser to the user).
      const takeover = error instanceof TakeoverError ? ' You took control of the browser during the send.' : ''
      return { kind: 'unknown', error: `The connector stopped with an error, so it is not known whether the content was published: ${errorMessage(error)}.${takeover}` }
    }
  }

  private normalize(outcome: PublishOutcome): AttemptOutcome {
    const o = outcome as { status?: unknown; url?: unknown; externalId?: unknown; error?: unknown }
    const text = (value: unknown): string => (typeof value === 'string' ? value : '')
    if (o?.status === 'confirmed') {
      const url = text(o.url)
      const externalId = text(o.externalId)
      if (url || externalId) return { kind: 'confirmed', url, externalId }
      return { kind: 'unknown', error: 'The connector reported success without a link or an id, so the result cannot be trusted.' }
    }
    if (o?.status === 'failed') return { kind: 'failed', error: text(o.error) || 'The platform rejected the publication.' }
    if (o?.status === 'unknown') return { kind: 'unknown', error: text(o.error) || 'The result could not be confirmed.' }
    return { kind: 'unknown', error: 'The connector returned an unrecognised result.' }
  }

  private settle(grant: GateGrant, outcome: AttemptOutcome): SendAction {
    const oppId = grant.opportunity.id
    const now = this.store.now()
    this.core.db.transaction(() => {
      if (outcome.kind === 'confirmed') {
        this.core.db
          .prepare("UPDATE send_actions SET state = 'confirmed', completed_at = ?, result_url = ?, result_external_id = ?, error = NULL WHERE id = ?")
          .run(now, outcome.url || null, outcome.externalId || null, grant.actionId)
        this.store.updateOpportunity(oppId, { state: 'confirmed', reason: '' })
      } else if (outcome.kind === 'failed') {
        this.core.db.prepare("UPDATE send_actions SET state = 'failed', completed_at = ?, error = ? WHERE id = ?").run(now, outcome.error, grant.actionId)
        this.review.returnToReview(oppId, `Sending failed: ${outcome.error} Review it before trying again.`, { settlingAttempt: true })
      } else {
        this.core.db.prepare("UPDATE send_actions SET state = 'unknown', completed_at = NULL, error = ? WHERE id = ?").run(outcome.error, grant.actionId)
        this.store.updateOpportunity(oppId, { state: 'unknown_result', reason: `${outcome.error} No new attempt is possible until this is reconciled with the platform.` })
      }
    })()
    if (outcome.kind === 'confirmed') this.markVerified(grant.channel.id, grant.opportunity.kind === 'standalone', outcome.url || outcome.externalId)
    const level = outcome.kind === 'confirmed' ? 'info' : 'warn'
    this.core.log.log(level, 'send', this.describe(grant, outcome), grant.channel.id)
    return this.core.repos.action(grant.actionId)
  }

  private describe(grant: GateGrant, outcome: AttemptOutcome): string {
    const what = grant.opportunity.kind === 'standalone' ? 'Post' : 'Reply'
    if (outcome.kind === 'confirmed') return `${what} sent to ${grant.request.destination}${outcome.url ? ` (${outcome.url})` : ''}`
    if (outcome.kind === 'failed') return `${what} not sent: ${outcome.error}`
    return `${what} result unknown: ${outcome.error}`
  }

  /** A confirmed send is the first real proof that the channel can publish and that results can be verified. */
  private markVerified(channelId: Id, standalone: boolean, reference: string): void {
    const channels = this.core.services.channels
    if (!channels) return
    const date = this.core.clock.now().toISOString().slice(0, 10)
    try {
      channels.markCapabilityVerified(channelId, standalone ? 'publish_post' : 'publish_reply', `Verified by an approved ${standalone ? 'post' : 'reply'} on ${date}`)
      channels.markCapabilityVerified(channelId, 'verify_send', `The publication was found on the platform on ${date} (${reference})`)
    } catch (error) {
      this.core.log.warn('send', `Could not record the verified capability: ${errorMessage(error)}`, channelId)
    }
  }

  /** Applies what a blocked gate decision means for the item. 'hold' leaves it untouched. */
  private applyBlock(opportunityId: Id, decision: GateBlock): void {
    const reason = decision.reasons.join(' ')
    const opp = this.store.requireOpportunity(opportunityId)
    if (decision.effect === 'hold') {
      if (this.lastHold.get(opportunityId) !== decision.code) {
        this.lastHold.set(opportunityId, decision.code)
        this.core.log.info('send', `Send not allowed (${decision.code}): ${reason}`, opp.channelId)
      }
      return
    }
    if (SEND_LOCKED_STATES.includes(opp.state)) return
    if (decision.effect === 'review') {
      if (decision.thread) this.refreshThread(opp.channelId, decision.thread)
      this.review.returnToReview(opportunityId, reason)
    } else {
      this.core.db.transaction(() => {
        this.store.invalidateApprovals(opportunityId, reason)
        this.store.updateOpportunity(opportunityId, { state: 'cancelled', reason })
      })()
    }
    this.core.log.warn('send', `Send stopped (${decision.code}): ${reason}`, opp.channelId)
    this.store.notify()
  }

  /** The thread changed since the draft: store the new text so the owner reviews the reply against it. */
  private refreshThread(channelId: Id, thread: NonNullable<GateBlock['thread']>): void {
    try {
      const channel = this.store.requireChannel(channelId)
      this.ingestor.refreshThread(channel, this.core.repos.account(channel.accountId), thread)
    } catch (error) {
      this.core.log.warn('send', `Could not store the changed thread: ${errorMessage(error)}`, channelId)
    }
  }

  // ───────────── reconciliation ─────────────

  /** Attempts left 'sending' by a process that stopped are unknown outcomes, not failures. */
  private recoverInterrupted(): void {
    for (const action of this.store.sendingActions()) {
      if (this.inFlight.has(action.id)) continue
      this.core.db.transaction(() => {
        const info = this.core.db
          .prepare("UPDATE send_actions SET state = 'unknown', error = ? WHERE id = ? AND state = 'sending'")
          .run('The application stopped while this was being sent, so the result is not known.', action.id)
        if (info.changes === 1) {
          this.store.updateOpportunity(action.opportunityId, {
            state: 'unknown_result',
            reason: 'The application stopped while this was being sent. No new attempt is possible until it is reconciled with the platform.'
          })
        }
      })()
      this.core.log.warn('send', `Recovered an interrupted send ${action.id}: marked as unknown`)
    }
    this.store.notify()
  }

  async reconcile(opportunityId: Id): Promise<SendAction | null> {
    this.recoverInterrupted()
    const action = this.store.unknownActions().find((a) => a.opportunityId === opportunityId)
    if (!action) return null
    if (this.reconciling.has(action.id)) return action
    this.reconciling.add(action.id)
    try {
      let result = action
      const opp = this.store.requireOpportunity(opportunityId)
      await this.core.runs.track('reconcile', { channelId: opp.channelId, productId: opp.productId }, async () => {
        const checked = await this.checkPlatform(action)
        result = checked.action
        return { status: checked.status, summary: checked.summary }
      })
      return result
    } finally {
      this.reconciling.delete(action.id)
      this.store.notify()
    }
  }

  private async checkPlatform(action: SendAction): Promise<{ action: SendAction; status: 'ok' | 'failed' | 'suspended'; summary: string }> {
    const opp = this.store.requireOpportunity(action.opportunityId)
    const draft = this.core.repos.draft(action.draftId)
    const comment = opp.commentId ? this.store.comment(opp.commentId) : null
    const request = buildPublishRequest(opp, draft, comment, action.destination)

    let ref: PublishedRef | null
    try {
      const { connector, ctx } = this.core.connectorContext(opp.channelId)
      ref = await connector.findPublished(ctx, request)
    } catch (error) {
      const detail = `Could not check the platform: ${errorMessage(error)}`
      this.core.log.warn('reconcile', detail, opp.channelId)
      this.store.updateOpportunity(opp.id, { reason: `${detail} The result is still unknown; no new attempt is possible until it is resolved.` })
      return { action, status: error instanceof TakeoverError ? 'suspended' : 'failed', summary: detail }
    }

    const now = this.store.now()
    if (ref) {
      this.core.db.transaction(() => {
        this.core.db
          .prepare("UPDATE send_actions SET state = 'confirmed', completed_at = ?, result_url = ?, result_external_id = ?, error = NULL WHERE id = ? AND state = 'unknown'")
          .run(now, ref.url || null, ref.externalId || null, action.id)
        this.store.updateOpportunity(opp.id, { state: 'confirmed', reason: '' })
      })()
      this.markVerified(opp.channelId, opp.kind === 'standalone', ref.url || ref.externalId)
      this.core.log.info('reconcile', `Found the publication on the platform: ${ref.url}`, opp.channelId)
      return { action: this.core.repos.action(action.id), status: 'ok', summary: `Found on the platform: ${ref.url}` }
    }

    const waitedMs = this.core.clock.now().getTime() - Date.parse(action.attemptedAt)
    if (waitedMs < UNKNOWN_WAIT_MS) {
      const minutes = Math.ceil((UNKNOWN_WAIT_MS - waitedMs) / 60_000)
      const summary = `Not found on the platform yet; it stays unknown and can be checked again in about ${minutes} minute(s)`
      this.store.updateOpportunity(opp.id, { reason: `${summary}. No new attempt is possible until it is resolved.` })
      return { action, status: 'ok', summary }
    }

    // Absence alone never triggers a resend: the attempt is closed as failed and the owner decides.
    this.core.db.transaction(() => {
      this.core.db.prepare("UPDATE send_actions SET state = 'failed', completed_at = ?, error = ? WHERE id = ? AND state = 'unknown'").run(now, NOT_FOUND_REASON, action.id)
      this.review.returnToReview(opp.id, `The earlier attempt was ${NOT_FOUND_REASON}.`, { settlingAttempt: true })
    })()
    this.core.log.warn('reconcile', `Attempt ${action.id} ${NOT_FOUND_REASON}`, opp.channelId)
    return { action: this.core.repos.action(action.id), status: 'ok', summary: `Not found after 10 minutes; marked failed and returned to review` }
  }

  async reconcileAllUnknown(): Promise<number> {
    this.recoverInterrupted()
    let resolved = 0
    for (const action of this.store.unknownActions()) {
      try {
        const after = await this.reconcile(action.opportunityId)
        if (after && after.state !== 'unknown') resolved++
      } catch (error) {
        this.core.log.error('reconcile', `Reconciling ${action.id} failed: ${errorMessage(error)}`)
      }
    }
    return resolved
  }

  // ───────────── scheduled standalone publications ─────────────

  async sendDuePublications(): Promise<number> {
    // Scheduled publications go out without a click, so the global pause applies to them.
    if (this.core.settings.getRaw('automation.paused', false)) return 0
    const due = this.core.db
      .prepare("SELECT id FROM opportunities WHERE kind = 'standalone' AND state = 'ready' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at, rowid")
      .all(this.store.now()) as { id: string }[]
    let attempted = 0
    for (const { id } of due) {
      try {
        await this.send(id, { automatic: true })
        attempted++
      } catch (error) {
        if (!(error instanceof SendBlockedError)) this.core.log.error('send', `Scheduled publication ${id} failed: ${errorMessage(error)}`)
      }
    }
    return attempted
  }
}

