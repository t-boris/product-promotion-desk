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

import { ApiError } from '../../shared/api'
import type { Id, PostResultsView, SendAction } from '../../shared/types'
import { setCommentHidden } from './comment-hiding'
import { OwnSchedule } from './own-schedule'
import { PostResults } from './post-results'
import type { Core } from '../core'
import { TakeoverError, TicketError, type Connector, type ConnectorContext, type PublishOutcome, type PublishedRef } from '../ports'
import type { SendingService, StandingChange } from '../services'
import { SendBlockedError, type GateBlock, type GateGrant, type SendGate } from './gate'
import type { Ingestor } from './ingest'
import { isLoginError, type LoginWatch } from './login-watch'
import { AI_BROWSER_BASIS, MissionPublisher, type Executor, type MissionResult } from './mission-publisher'
import { buildPublishRequest } from './request'
import type { ReviewFlow } from './review'
import { StandingChecks } from './standing'
import { SEND_LOCKED_STATES, type FlowStore } from './store'
import { KeyedMutex, errorMessage } from './util'
import { scheduleGraceMs } from '../../shared/schedule'

/** An unknown result is declared failed only after the platform has been silent for this long. */
export const UNKNOWN_WAIT_MS = 10 * 60 * 1000
export const NOT_FOUND_REASON = 'not found on the platform after 10 minutes; safe to retry after review'
export const SCHEDULE_MISSED_REASON = 'The scheduled time passed while the app was not running; confirm to send'
export const OWNER_NOT_PUBLISHED_ERROR = 'Owner confirmed it was not published'

export interface SendOptions {
  /** Initiated by a rule or the scheduler instead of an explicit click: the global pause applies. */
  automatic?: boolean
}

/** `loginLike`: the failure is worded like "not signed in", which makes the session worth checking. */
type AttemptOutcome =
  | { kind: 'confirmed'; url: string; externalId: string }
  /** `hold`: nothing was submitted and the AI browser could not be used; the approval stays and the owner may press Send again. */
  | { kind: 'failed'; error: string; note?: string; loginLike?: boolean; hold?: boolean }
  | { kind: 'unknown'; error: string; note?: string; loginLike?: boolean }

type LoginProblem = 'login' | 'captcha'

function isHttpUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value).protocol)
  } catch {
    return false
  }
}

const isUniqueViolation = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'

export class SendingFlow implements SendingService {
  private readonly locks = new KeyedMutex()
  /** Attempts being executed by this process right now; any other 'sending' row is a leftover of a stopped process. */
  private readonly inFlight = new Set<string>()
  private readonly reconciling = new Set<string>()
  private readonly lastHold = new Map<string, string>()
  private readonly missions: MissionPublisher
  private readonly standings: StandingChecks
  private readonly results: PostResults
  private readonly ownSchedule: OwnSchedule

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly gate: SendGate,
    private readonly review: ReviewFlow,
    private readonly ingestor: Ingestor,
    private readonly watch: LoginWatch
  ) {
    this.missions = new MissionPublisher(core, gate, store)
    this.standings = new StandingChecks(core, store)
    this.results = new PostResults(core, store)
    this.ownSchedule = new OwnSchedule({
      core,
      store,
      gate,
      review,
      locks: this.locks,
      byConnector: (grant) => this.missions.executorFor(grant, true) === 'connector',
      markVerified: (channelId, standalone, reference) => this.markVerified(channelId, standalone, reference)
    })
  }

  readPostNumbers(stop?: () => boolean): Promise<number> {
    return this.results.readDue(stop)
  }

  postResults(channelId: Id): PostResultsView {
    return this.results.view(channelId)
  }

  /** The owner hides the comment an item answers from other readers, or shows it again: one request, under the account's lock. */
  setCommentHidden(opportunityId: Id, hidden: boolean): Promise<void> {
    const channel = this.store.requireChannel(this.store.requireOpportunity(opportunityId).channelId)
    return this.locks.run(channel.accountId, () => setCommentHidden(this.core, this.store, opportunityId, hidden))
  }

  readPostResultsNow(channelId: Id): Promise<PostResultsView> {
    return this.results.readNow(channelId)
  }

  /** Looks again at the confirmed posts that are due: a site may have removed one since it was published (see standing.ts). */
  checkStandings(stop?: () => boolean): Promise<StandingChange[]> {
    return this.standings.checkDue(stop)
  }

  // ───────────── sending ─────────────

  async send(opportunityId: Id, options: SendOptions = {}): Promise<SendAction> {
    const opp = this.store.requireOpportunity(opportunityId)
    const channel = this.store.requireChannel(opp.channelId)
    return this.locks.run(channel.accountId, () => this.sendLocked(opportunityId, options.automatic ?? false))
  }

  private async sendLocked(opportunityId: Id, automatic: boolean): Promise<SendAction> {
    // A post its platform holds for a time is taken back before this application sends it (DEC-077): never both.
    await this.ownSchedule.release(opportunityId)
    const decision = await this.gate.authorize({ opportunityId, automatic })
    if (!decision.allowed) {
      this.applyBlock(opportunityId, decision)
      throw new SendBlockedError(decision)
    }
    // Who carries it out is decided before the attempt is written, so the audit row says how it was published.
    const executor = this.missions.executorFor(decision, automatic)
    try {
      const action = this.reserve(decision, executor === 'ai_browser' ? `${decision.authorizationBasis}; ${AI_BROWSER_BASIS}` : decision.authorizationBasis)
      this.lastHold.delete(opportunityId)
      return await this.attempt(decision, action, executor, automatic)
    } finally {
      // The ticket is single-purpose: it must not outlive the attempt, whatever happened.
      this.core.tickets.revoke(decision.ticket)
    }
  }

  /** Writes the attempt as 'sending' and marks the opportunity, atomically, before anything leaves the machine. */
  private reserve(grant: GateGrant, authorizationBasis: string): SendAction {
    const oppId = grant.opportunity.id
    return this.core.db.transaction(() => {
      if (this.store.openAction(oppId)) throw new SendBlockedError({ allowed: false, effect: 'hold', code: 'in_flight', reasons: ['A send for this item is already in progress or finished.'] })
      try {
        this.core.db
          .prepare(
            `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, completed_at, result_url, result_external_id, authorization_basis, knowledge_version_id, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', ?, NULL, NULL, NULL, ?, ?, NULL)`
          )
          .run(grant.actionId, oppId, grant.draft.id, grant.approval.id, grant.contentHash, grant.account.id, grant.request.destination, this.store.now(), authorizationBasis, grant.draft.knowledgeVersionId)
      } catch (error) {
        if (isUniqueViolation(error)) throw new SendBlockedError({ allowed: false, effect: 'hold', code: 'in_flight', reasons: ['A send for this item is already in progress or finished.'] })
        throw error
      }
      this.store.updateOpportunity(oppId, { state: 'sending', reason: '' })
      return this.core.repos.action(grant.actionId)
    })()
  }

  private async attempt(grant: GateGrant, action: SendAction, executor: Executor, automatic: boolean): Promise<SendAction> {
    this.inFlight.add(action.id)
    this.store.notify()
    let settled = action
    try {
      await this.core.runs.track('send', { channelId: grant.channel.id, productId: grant.opportunity.productId }, async () => {
        const outcome = await this.publish(grant, action, executor, automatic)
        const problem = await this.loginProblem(grant, outcome)
        settled = this.settle(grant, outcome, problem)
        return { status: outcome.kind === 'confirmed' ? ('ok' as const) : ('failed' as const), summary: this.describe(grant, outcome) }
      })
    } finally {
      this.inFlight.delete(action.id)
      this.store.notify()
    }
    return settled
  }

  /** The single connector call (or the single AI browser mission). Never throws: every way it can end is mapped to confirmed, failed or unknown. */
  private async publish(grant: GateGrant, action: SendAction, executor: Executor, automatic: boolean): Promise<AttemptOutcome> {
    let pair
    try {
      pair = this.core.connectorContext(grant.channel.id)
    } catch (error) {
      return { kind: 'failed', error: errorMessage(error) } // nothing was submitted
    }
    if (executor === 'ai_browser') return this.publishWithAi(pair, grant, action, automatic)
    try {
      const outcome: PublishOutcome = await pair.connector.publish(pair.ctx, grant.ticket, grant.request)
      return this.normalize(outcome)
    } catch (error) {
      // A rejected ticket stops the connector before any write action: definitely not sent.
      if (error instanceof TicketError) return { kind: 'failed', error: `The send authorization was rejected: ${error.message}` }
      // Anything else may have happened after the content was submitted (including losing the browser to the user).
      const takeover = error instanceof TakeoverError ? ' You took control of the browser during the send.' : ''
      return {
        kind: 'unknown',
        error: `The connector stopped with an error, so it is not known whether the content was published: ${errorMessage(error)}.${takeover}`,
        loginLike: isLoginError(error)
      }
    }
  }

  /**
   * One mission of the AI in the account's browser instead of the connector's call. The ticket `authorize` gave is for the connector's one
   * call and is revoked here, unused: the mission asks the gate for its own single-use ticket at the moment it submits. What the page shows
   * afterwards is read by the application (`findPublished`); the AI's report never confirms anything.
   */
  private async publishWithAi(pair: { connector: Connector; ctx: ConnectorContext }, grant: GateGrant, action: SendAction, automatic: boolean): Promise<AttemptOutcome> {
    this.core.tickets.revoke(grant.ticket)
    let result: MissionResult
    try {
      result = await this.missions.publish(pair, grant, action.attemptedAt, automatic)
    } catch (error) {
      // Not even the mission's own bookkeeping may leave the result open to a guess: it may have been published.
      return { kind: 'unknown', error: `The AI browser stopped with an error, so it is not known whether the content was published: ${errorMessage(error)}` }
    }
    switch (result.status) {
      case 'confirmed':
        return this.normalize({ status: 'confirmed', url: result.url, externalId: result.externalId })
      case 'failed':
        return { kind: 'failed', error: result.error, note: result.note, loginLike: result.auth !== undefined }
      case 'unknown':
        return { kind: 'unknown', error: result.error, note: result.note }
      case 'not_started':
        return { kind: 'failed', error: result.error, hold: true }
    }
  }

  /**
   * A send that failed like "not signed in" must not go back to review every tick: the session is checked and, if
   * it really is gone, the account is suspended so nothing is tried until the owner signs in. A check that says the
   * account is fine means the failure was something else.
   */
  private async loginProblem(grant: GateGrant, outcome: AttemptOutcome): Promise<LoginProblem | null> {
    if (outcome.kind === 'confirmed' || !outcome.loginLike) return null
    let verdict
    try {
      const { connector, ctx } = this.core.connectorContext(grant.channel.id)
      verdict = await this.watch.diagnose(connector, ctx)
    } catch (error) {
      this.core.log.warn('send', `Could not check the login after a failed send: ${errorMessage(error)}`, grant.channel.id)
      return null
    }
    if (verdict === 'login' || verdict === 'captcha') return verdict
    // The connector itself said "not signed in" but the check could not run: believe the connector.
    if (verdict === 'unchecked') return /captcha/i.test(outcome.error) ? 'captcha' : 'login'
    return null
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
    if (o?.status === 'failed') {
      const error = text(o.error) || 'The platform rejected the publication.'
      return { kind: 'failed', error, loginLike: isLoginError(error) }
    }
    if (o?.status === 'unknown') {
      const error = text(o.error) || 'The result could not be confirmed.'
      return { kind: 'unknown', error, loginLike: isLoginError(error) }
    }
    return { kind: 'unknown', error: 'The connector returned an unrecognised result.' }
  }

  private settle(grant: GateGrant, outcome: AttemptOutcome, problem: LoginProblem | null): SendAction {
    const oppId = grant.opportunity.id
    const now = this.store.now()
    // What the owner reads: the application's wording, then what the AI or the site said (bounded, see MissionResult). The log gets the wording only.
    const shown = outcome.kind === 'confirmed' ? '' : outcome.note ? `${outcome.error} ${outcome.note}` : outcome.error
    this.core.db.transaction(() => {
      if (outcome.kind === 'confirmed') {
        this.core.db
          .prepare("UPDATE send_actions SET state = 'confirmed', completed_at = ?, result_url = ?, result_external_id = ?, error = NULL WHERE id = ?")
          .run(now, outcome.url || null, outcome.externalId || null, grant.actionId)
        this.store.updateOpportunity(oppId, { state: 'confirmed', reason: '' })
      } else if (outcome.kind === 'failed') {
        this.core.db.prepare("UPDATE send_actions SET state = 'failed', completed_at = ?, error = ? WHERE id = ?").run(now, shown, grant.actionId)
        if (problem) {
          // Nothing was submitted and the content is unchanged, so the approval stays; the account is what needs the owner.
          const what = problem === 'captcha' ? 'is waiting for a CAPTCHA' : 'is signed out'
          this.store.updateOpportunity(oppId, { state: 'ready', reason: `Sending is paused: account "${grant.account.label}" ${what}. Fix it, then press Send.` })
        } else if (outcome.hold) {
          // Nothing was submitted and the content is unchanged: the approval stays, the owner may press Send again.
          this.store.updateOpportunity(oppId, { state: 'ready', reason: `Not sent: ${shown} The approval is kept; press Send to try again.` })
        } else {
          this.review.returnToReview(oppId, `Sending failed: ${shown} Review it before trying again.`, { settlingAttempt: true })
        }
      } else {
        this.core.db.prepare("UPDATE send_actions SET state = 'unknown', completed_at = NULL, error = ? WHERE id = ?").run(shown, grant.actionId)
        this.store.updateOpportunity(oppId, { state: 'unknown_result', reason: `${shown} No new attempt is possible until this is reconciled with the platform.` })
      }
    })()
    if (outcome.kind === 'confirmed') this.markVerified(grant.channel.id, grant.opportunity.kind === 'standalone', outcome.url || outcome.externalId)
    if (problem) this.watch.suspendAfterFailedSend(grant.channel, problem)
    const level = outcome.kind === 'confirmed' ? 'info' : 'warn'
    this.core.log.log(level, 'send', this.describe(grant, outcome), grant.channel.id)
    return this.core.repos.action(grant.actionId)
  }

  /** The line for the log and the run list: the application's wording only, never the free text of `note`. */
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
    // The owner's own answer from a post of the Feed was made on a page the application cannot read: nothing here can find it, so it stays unknown until the
    // owner looks at the page and says (resolveUnknown). The wait of ten minutes never turns "cannot look" into "not published".
    if (opp.findingId !== null) {
      const summary = 'This answer was made on a page the application cannot read, so it cannot be looked for. Look at the post and say whether it is there.'
      this.store.updateOpportunity(opp.id, { reason: `${summary} No new attempt is possible until it is resolved.` })
      return { action, status: 'ok', summary }
    }
    const draft = this.core.repos.draft(action.draftId)
    // The comment the reply answers, or the post itself for a reply to a new post (DEC-039): both are what the platform shows it under.
    const parent = this.store.replyParentOf(opp)
    // The connector must only match what was created at or after this attempt: an older, identical reply or post
    // is not evidence that this one went out.
    const request = { ...buildPublishRequest(opp, draft, parent, action.destination, this.store.requireChannel(opp.channelId).platform), attemptedAt: action.attemptedAt }

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

    // A reference that already belongs to another confirmed send of this account is that other publication, not
    // this attempt; treating it as a match would confirm something that may never have been published.
    if (ref?.externalId && this.store.externalIdUsed(ref.externalId, action.accountId, action.id)) {
      this.core.log.warn('reconcile', `Ignored a platform match (${ref.externalId}) that belongs to another confirmed send`, opp.channelId)
      ref = null
    }

    const now = this.store.now()
    if (ref) {
      this.core.db.transaction(() => {
        this.core.db
          .prepare("UPDATE send_actions SET state = 'confirmed', completed_at = ?, result_url = ?, result_external_id = ?, error = NULL WHERE id = ? AND state = 'unknown'")
          .run(now, ref.url || null, ref.externalId || null, action.id)
        this.store.updateOpportunity(opp.id, { state: 'confirmed', reason: '' })
      })()
      // Capabilities are proven by a direct confirmed send. A reconciled match only counts when the connector
      // pointed at one specific, previously unused platform object.
      if (ref.externalId) this.markVerified(opp.channelId, opp.kind === 'standalone', ref.url || ref.externalId)
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

  // ───────────── the owner settles an unknown result ─────────────

  /**
   * The owner looked at the platform themselves. Without this an unreachable platform check (login expired, site
   * down) would lock the item forever. 'published' records the send as confirmed by the owner; 'not_published'
   * closes the attempt as failed and returns the item to review: a new attempt needs a fresh approval.
   */
  async resolveUnknown(opportunityId: Id, outcome: 'published' | 'not_published', url?: string): Promise<SendAction> {
    const opp = this.store.requireOpportunity(opportunityId)
    const channel = this.store.requireChannel(opp.channelId)
    const link = url?.trim() || null
    if (outcome !== 'published' && outcome !== 'not_published') throw new ApiError('invalid_input', 'The outcome must be "published" or "not_published".')
    if (link && !isHttpUrl(link)) throw new ApiError('invalid_input', 'The link must be a full http(s) address.')

    return this.locks.run(channel.accountId, async () => {
      this.recoverInterrupted()
      const action = this.store.unknownActions().find((a) => a.opportunityId === opportunityId)
      if (!action) throw new ApiError('invalid_state', 'Only an item whose last send has an unknown result can be settled this way.')
      const now = this.store.now()
      this.core.db.transaction(() => {
        if (outcome === 'published') {
          const info = this.core.db
            .prepare("UPDATE send_actions SET state = 'confirmed', completed_at = ?, result_url = ?, result_external_id = NULL, authorization_basis = ?, error = NULL WHERE id = ? AND state = 'unknown'")
            .run(now, link, `${action.authorizationBasis}; resolved by owner`, action.id)
          if (info.changes !== 1) throw new ApiError('conflict', 'The result of this send was settled in the meantime.')
          this.store.updateOpportunity(opportunityId, { state: 'confirmed', reason: '' })
        } else {
          const info = this.core.db.prepare("UPDATE send_actions SET state = 'failed', completed_at = ?, error = ? WHERE id = ? AND state = 'unknown'").run(now, OWNER_NOT_PUBLISHED_ERROR, action.id)
          if (info.changes !== 1) throw new ApiError('conflict', 'The result of this send was settled in the meantime.')
          this.review.returnToReview(opportunityId, 'You confirmed that the earlier attempt was not published. Review it and approve again to send.', { settlingAttempt: true })
        }
      })()
      this.core.log.info(
        'send',
        outcome === 'published' ? `Owner confirmed that the unknown send ${action.id} was published${link ? ` (${link})` : ''}` : `Owner confirmed that the unknown send ${action.id} was not published`,
        opp.channelId
      )
      this.store.notify()
      return this.core.repos.action(action.id)
    })
  }

  // ───────────── scheduled standalone publications ─────────────

  /**
   * The posts a platform publishes at their time by itself (DEC-077): what it holds is looked at (published ones are recorded, changed ones are
   * taken back), then the approved posts far enough ahead are handed over. The look runs with automation paused too: the pause takes them back.
   */
  async keepOwnSchedules(): Promise<number> {
    await this.ownSchedule.look()
    return this.ownSchedule.handOver()
  }

  /** What the schedule is waiting for: the planned times of the approved items that will go out by themselves, and whether something is being sent now (DEC-054). */
  awaited(): { dueTimes: string[]; sending: boolean } {
    const dueTimes = (this.core.db.prepare("SELECT scheduled_at AS at FROM opportunities WHERE state = 'ready' AND scheduled_at IS NOT NULL ORDER BY scheduled_at").all() as { at: string }[]).map((row) => row.at)
    const sending = (this.core.db.prepare("SELECT COUNT(*) AS n FROM opportunities WHERE state = 'sending'").get() as { n: number }).n > 0
    return { dueTimes, sending }
  }

  /**
   * Sends, without a click, the approved posts and replies whose planned time has come: a time the owner set is the owner's press made ahead of time, on
   * exactly the content they approved (the gate and `sendWays` let those through, an automatic rule's approval never; DEC-049, DEC-053). Two
   * guards keep that safe:
   *  - only what was approved BEFORE its planned time is picked up: approving something whose time already passed
   *    is the owner looking at it, and sending it is then the owner's Send, never an immediate side effect;
   *  - one later than the owner's limit (`scheduleGraceHours`; the app was not running) goes back to review instead of going out stale.
   */
  async sendDuePublications(): Promise<number> {
    // Scheduled publications go out without a click, so the global pause applies to them.
    if (this.core.settings.getRaw('automation.paused', false)) return 0
    const nowMs = this.core.clock.now().getTime()
    const due = this.core.db
      .prepare(
        `SELECT id, scheduled_at AS at, finding_id AS finding FROM opportunities
          WHERE state = 'ready' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
          ORDER BY scheduled_at, rowid`
      )
      .all(this.store.now()) as { id: string; at: string; finding: string | null }[]
    // How late an item may still go out by itself is the owner's setting (DEC-053).
    const graceMs = scheduleGraceMs(this.core.settings.app().scheduleGraceHours)
    let attempted = 0
    for (const { id, at, finding } of due) {
      try {
        // A post its platform holds is the platform's to publish; `keepOwnSchedules` asks what became of it.
        if (this.ownSchedule.kept(id)) continue
        const draft = this.core.repos.latestDraft(id)
        const approval = draft ? this.core.repos.activeApproval(draft.id) : null
        if (!approval) continue
        const plannedMs = Date.parse(at)
        if (Date.parse(approval.approvedAt) > plannedMs) continue
        if (nowMs - plannedMs > graceMs) {
          this.review.returnToReview(id, SCHEDULE_MISSED_REASON)
          // An answer from the Feed is shown in its window as "Scheduled for ...": with the approval gone that line would be a lie.
          if (finding !== null) this.store.updateOpportunity(id, { scheduledAt: null })
          this.core.log.warn('send', `Scheduled publication ${id} was ${Math.round((nowMs - plannedMs) / 60_000)} minutes late; returned to review`)
          this.store.notify()
          continue
        }
        await this.send(id, { automatic: true })
        attempted++
      } catch (error) {
        if (!(error instanceof SendBlockedError)) this.core.log.error('send', `Scheduled publication ${id} failed: ${errorMessage(error)}`)
      }
    }
    return attempted
  }
}
