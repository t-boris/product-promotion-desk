// Posts a platform keeps and publishes at their time by itself (DEC-077): a Facebook Page takes a post up to 30 days ahead and puts it out with
// this Mac off. An approved post with a time the owner set is handed over ahead of time, through the same gate as any send; from then on the
// platform holds it, and this file keeps three promises:
//  - what the platform published is recorded as a sent post, with the address the platform gives it;
//  - what the owner no longer wants as it was handed over (edited, moved, taken back, deleted, automation paused) is taken back from the platform;
//  - nothing is sent by this application while the platform still holds the item: it is taken back first, or the send is refused in words.
// A kept post is not a send attempt: `send_actions` gets its row when the platform has published it.

import { platformLabel } from '../../shared/post-format'
import type { Id } from '../../shared/types'
import type { Core } from '../core'
import type { PublishOutcome, PublishRequest } from '../ports'
import { newId } from '../db/database'
import { SendBlockedError, type GateGrant, type SendGate } from './gate'
import type { ReviewFlow } from './review'
import { SEND_LOCKED_STATES, type FlowStore } from './store'
import { errorMessage, type KeyedMutex } from './util'

/** A post is handed over only when its time is at least this much further than the platform's own minimum: the hand-over itself takes time. */
export const HAND_OVER_MARGIN_MS = 5 * 60_000
/** A platform that refused to take a post is not asked again about it for this long; the post goes out at its time from this application. */
const ASK_AGAIN_MS = 60 * 60_000
/** A post the gate does not let through now (a limit at its time, an account in trouble) is tried again after this long. */
const GATE_AGAIN_MS = 10 * 60_000
/** A kept post still not published this long after its time is said to the owner. */
const LATE_MS = 15 * 60_000
/** The scheduler looks every few seconds; a platform is asked about one kept post no more often than this, and after a failed request this much later. */
const DUE_LOOK_MS = 60_000
const RETRY_MS = 5 * 60_000
/** A hand-over whose answer was lost is said to have made nothing only after the platform showed no such post for this long (as an unknown send). */
const LOST_ANSWER_WAIT_MS = 10 * 60_000

export const GONE_FROM_SCHEDULE_REASON =
  'The platform no longer has this post on its schedule, and no post with these words is on the page (it was deleted there, or refused at its time). Review it before sending again.'
export const keptNote = (platform: string): string =>
  `${platformLabel(platform)} keeps this post and publishes it at its time, even with this Mac off. Change or cancel it here and it is taken back first.`

interface Kept {
  opportunityId: Id
  channelId: Id
  accountId: Id
  draftId: Id
  approvalId: Id
  contentHash: string
  destination: string
  authorizationBasis: string
  knowledgeVersionId: Id | null
  request: PublishRequest
  externalId: string | null
  publishAt: string
  handedAt: string
  problem: string | null
}

interface Row {
  opportunity_id: string
  channel_id: string
  account_id: string
  draft_id: string
  approval_id: string
  content_hash: string
  destination: string
  authorization_basis: string
  knowledge_version_id: string | null
  request_json: string
  external_id: string | null
  publish_at: string
  handed_at: string
  problem: string | null
}

const map = (row: Row): Kept => ({
  opportunityId: row.opportunity_id,
  channelId: row.channel_id,
  accountId: row.account_id,
  draftId: row.draft_id,
  approvalId: row.approval_id,
  contentHash: row.content_hash,
  destination: row.destination,
  authorizationBasis: row.authorization_basis,
  knowledgeVersionId: row.knowledge_version_id,
  request: JSON.parse(row.request_json) as PublishRequest,
  externalId: row.external_id,
  publishAt: row.publish_at,
  handedAt: row.handed_at,
  problem: row.problem
})

export interface OwnScheduleDeps {
  core: Core
  store: FlowStore
  gate: SendGate
  review: ReviewFlow
  /** The sending flow's lock: one account does one thing at a time. */
  locks: KeyedMutex
  /** Whether the connector itself would carry this send (not the AI browser). */
  byConnector(grant: GateGrant): boolean
  /** A published post is the proof that the channel can publish. */
  markVerified(channelId: Id, standalone: boolean, reference: string): void
}

export class OwnSchedule {
  /** When a post may be offered to its platform again, by item. */
  private readonly askAgainAt = new Map<Id, number>()
  /** When a kept post is looked at again by the scheduler, by item. An owner's own send never waits for it. */
  private readonly quietUntil = new Map<Id, number>()

  constructor(private readonly deps: OwnScheduleDeps) {}

  private get db() {
    return this.deps.core.db
  }

  /** What a platform holds for this item, if anything. */
  kept(opportunityId: Id): Kept | null {
    const row = this.db.prepare('SELECT * FROM platform_schedules WHERE opportunity_id = ?').get(opportunityId) as Row | undefined
    return row ? map(row) : null
  }

  private forget(opportunityId: Id): void {
    this.db.prepare('DELETE FROM platform_schedules WHERE opportunity_id = ?').run(opportunityId)
  }

  /** Keeps what went wrong with a kept post, and says it once, not at every look: in the log, and on the item where the owner reads it. */
  private note(kept: Kept, problem: string): void {
    if (kept.problem === problem) return
    this.db.prepare('UPDATE platform_schedules SET problem = ? WHERE opportunity_id = ?').run(problem, kept.opportunityId)
    this.deps.core.log.error('send', problem, kept.channelId)
    try {
      if (!SEND_LOCKED_STATES.includes(this.deps.store.requireOpportunity(kept.opportunityId).state)) this.deps.store.updateOpportunity(kept.opportunityId, { reason: problem })
    } catch {
      // The item itself was deleted: the log line is what is left.
    }
    this.deps.store.notify()
  }

  private connector(channelId: Id) {
    return this.deps.core.connectorContext(channelId)
  }

  private label(channelId: Id): string {
    try {
      return platformLabel(this.deps.store.requireChannel(channelId).platform)
    } catch {
      return 'The platform'
    }
  }

  // ───────────── handing over ─────────────

  /**
   * Hands to their platforms the approved posts whose time is far enough ahead. Each passes the gate as a send would, with the limits counted
   * at the post's own time. A post the platform does not take stays with this application and goes out at its time as any other.
   */
  async handOver(): Promise<number> {
    const { core, store } = this.deps
    if (core.settings.getRaw('automation.paused', false)) return 0
    const nowMs = core.clock.now().getTime()
    const rows = this.db
      .prepare(
        `SELECT o.id, o.channel_id AS channel, o.scheduled_at AS at FROM opportunities o
          WHERE o.state = 'ready' AND o.kind = 'standalone' AND o.scheduled_at IS NOT NULL AND o.scheduled_at > ?
            AND NOT EXISTS (SELECT 1 FROM platform_schedules p WHERE p.opportunity_id = o.id)
          ORDER BY o.scheduled_at, o.rowid`
      )
      .all(store.now()) as { id: string; channel: string; at: string }[]
    let handed = 0
    for (const row of rows) {
      // Asked of the connector itself, without opening anything: most channels have no schedule of their own.
      const channel = store.requireChannel(row.channel)
      const window = channel.connectorId ? core.connectors.get(channel.connectorId)?.ownSchedule : undefined
      const accountId = channel.accountId
      const ahead = Date.parse(row.at) - nowMs
      if (!window || ahead < window.minAheadMs + HAND_OVER_MARGIN_MS || ahead > window.maxAheadMs) continue
      if (nowMs < (this.askAgainAt.get(row.id) ?? 0)) continue
      try {
        if (await this.deps.locks.run(accountId, () => this.handOne(row.id, row.at))) handed++
      } catch (error) {
        core.log.error('send', `Handing a scheduled post to its platform failed: ${errorMessage(error)}`, row.channel)
      }
    }
    return handed
  }

  private async handOne(opportunityId: Id, at: string): Promise<boolean> {
    const { core, store, gate } = this.deps
    if (this.kept(opportunityId)) return false
    const decision = await gate.authorize({ opportunityId, automatic: true, publishAt: at })
    // Whatever stops it now is the due send's to say at the post's time; nothing is changed here.
    if (!decision.allowed) {
      this.askAgainAt.set(opportunityId, core.clock.now().getTime() + GATE_AGAIN_MS)
      return false
    }
    try {
      // The item may have moved while the gate looked: the time handed over is the time it has now.
      if (decision.opportunity.scheduledAt !== at || !this.deps.byConnector(decision)) return false
      const pair = this.connector(decision.channel.id)
      if (!pair.connector.ownSchedule) return false
      const request: PublishRequest = { ...decision.request, publishAt: at }
      // A post the platform is not given to keep goes out from this application at its time: it is not asked about again.
      if (pair.connector.ownSchedule.takes?.(request) === false) {
        this.askAgainAt.set(opportunityId, Date.parse(at))
        return false
      }
      // Written before anything leaves the machine: from here on no send of this item can start without asking the platform first.
      this.db
        .prepare(
          `INSERT INTO platform_schedules (opportunity_id, channel_id, account_id, draft_id, approval_id, content_hash, destination, authorization_basis, knowledge_version_id, request_json, external_id, publish_at, handed_at, problem)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`
        )
        .run(opportunityId, decision.channel.id, decision.account.id, decision.draft.id, decision.approval.id, decision.contentHash, request.destination, decision.authorizationBasis, decision.draft.knowledgeVersionId, JSON.stringify(request), at, store.now())
      let outcome: PublishOutcome
      try {
        outcome = await pair.connector.publish(pair.ctx, decision.ticket, request)
      } catch (error) {
        outcome = { status: 'unknown', error: errorMessage(error) }
      }
      const label = platformLabel(decision.channel.platform)
      if (outcome.status === 'scheduled' && outcome.externalId) {
        this.db.prepare('UPDATE platform_schedules SET external_id = ? WHERE opportunity_id = ?').run(outcome.externalId, opportunityId)
        store.updateOpportunity(opportunityId, { reason: keptNote(decision.channel.platform) })
        core.log.info('send', `Post handed to ${label}'s own schedule for ${at}: ${label} publishes it at that time by itself.`, decision.channel.id)
        store.notify()
        return true
      }
      if (outcome.status === 'confirmed') {
        // Asked to keep it, the platform published it: that is what happened, and it is recorded as such.
        this.recordPublished(this.kept(opportunityId) as Kept, outcome.url, outcome.externalId)
        return true
      }
      if (outcome.status === 'failed') {
        this.forget(opportunityId)
        this.askAgainAt.set(opportunityId, core.clock.now().getTime() + ASK_AGAIN_MS)
        core.log.warn('send', `${label} did not take the post on its own schedule (${outcome.error}). It goes out at its time from this application.`, decision.channel.id)
        return false
      }
      // No answer, or an answer that says nothing: the row stays without an id, and the next look asks the platform what it holds.
      const kept = this.kept(opportunityId)
      if (kept) this.note(kept, `It is not known whether ${label} took a post on its schedule: ${outcome.status === 'unknown' ? outcome.error : 'its answer was not understood'}`)
      return false
    } finally {
      core.tickets.revoke(decision.ticket)
    }
  }

  // ───────────── looking at what is kept ─────────────

  /** Whether the item is still what was handed over: the same approved version, at the same time, waiting to go out, with automation running. */
  private stillWanted(kept: Kept): boolean {
    const { core, store } = this.deps
    if (core.settings.getRaw('automation.paused', false)) return false
    let opp
    try {
      opp = store.requireOpportunity(kept.opportunityId)
    } catch {
      return false
    }
    if (opp.state !== 'ready' || opp.scheduledAt !== kept.publishAt) return false
    // A channel the owner paused sends nothing, by whichever way.
    if (store.requireChannel(kept.channelId).status === 'paused') return false
    const draft = core.repos.latestDraft(kept.opportunityId)
    return draft !== null && draft.id === kept.draftId && core.repos.activeApproval(draft.id)?.id === kept.approvalId
  }

  /**
   * One look at every post a platform holds: a post whose time has come is asked about and recorded when it went out; a post the owner no
   * longer wants as handed over is taken back. Runs with automation paused too: the pause takes the kept posts back.
   */
  async look(): Promise<void> {
    const rows = this.db.prepare('SELECT opportunity_id AS id, account_id AS account FROM platform_schedules ORDER BY publish_at').all() as { id: string; account: string }[]
    for (const row of rows) {
      try {
        await this.deps.locks.run(row.account, () => this.lookOne(row.id))
      } catch (error) {
        this.deps.core.log.error('send', `Looking at a post kept by its platform failed: ${errorMessage(error)}`)
      }
    }
  }

  private async lookOne(opportunityId: Id): Promise<void> {
    const kept = this.kept(opportunityId)
    if (!kept) {
      this.quietUntil.delete(opportunityId)
      return
    }
    const nowMs = this.deps.core.clock.now().getTime()
    if (nowMs < (this.quietUntil.get(opportunityId) ?? 0)) return
    const settled = await this.identify(kept)
    if (!settled) {
      if (this.kept(opportunityId)) this.quietUntil.set(opportunityId, nowMs + RETRY_MS)
      return
    }
    const due = Date.parse(settled.publishAt) <= nowMs
    if (due) {
      await this.collect(settled)
      const left = this.kept(opportunityId)
      if (left) this.quietUntil.set(opportunityId, nowMs + (left.problem === null ? DUE_LOOK_MS : RETRY_MS))
    } else if (!this.stillWanted(settled)) {
      if (!(await this.takeBack(settled))) this.quietUntil.set(opportunityId, nowMs + RETRY_MS)
    }
  }

  /** A hand-over whose answer was lost: the platform is asked what it holds. Null when that is still not known, or when it holds nothing (the row is gone). */
  private async identify(kept: Kept): Promise<(Kept & { externalId: string }) | null> {
    if (kept.externalId !== null) return kept as Kept & { externalId: string }
    const label = this.label(kept.channelId)
    try {
      const pair = this.connector(kept.channelId)
      if (!pair.connector.findScheduled) throw new Error('this platform cannot be asked')
      const found = await pair.connector.findScheduled(pair.ctx, kept.request)
      if (found === null) {
        // The platform may list a post a little after it took it: too early to say it took nothing, and to offer the post again.
        if (this.deps.core.clock.now().getTime() - Date.parse(kept.handedAt) < LOST_ANSWER_WAIT_MS) return null
        this.forget(kept.opportunityId)
        this.deps.core.log.info('send', `${label} holds no post from the hand-over whose answer was lost: it goes out at its time from this application.`, kept.channelId)
        this.deps.store.notify()
        return null
      }
      this.db.prepare('UPDATE platform_schedules SET external_id = ?, problem = NULL WHERE opportunity_id = ?').run(found, kept.opportunityId)
      if (this.stillWanted(kept)) this.deps.store.updateOpportunity(kept.opportunityId, { reason: keptNote(this.deps.store.requireChannel(kept.channelId).platform) })
      return { ...kept, externalId: found, problem: null }
    } catch (error) {
      this.note(kept, `It is still not known whether ${label} took a post on its schedule for ${kept.publishAt}: ${errorMessage(error)}. Look at ${label}'s scheduled posts.`)
      return null
    }
  }

  /** The time of a kept post has come: what the platform did with it. */
  private async collect(kept: Kept & { externalId: string }): Promise<void> {
    const { core, store } = this.deps
    const label = this.label(kept.channelId)
    let reading
    try {
      const pair = this.connector(kept.channelId)
      if (!pair.connector.readScheduled) throw new Error('this platform cannot be asked')
      reading = await pair.connector.readScheduled(pair.ctx, kept.externalId)
    } catch (error) {
      this.note(kept, `${label} could not be asked whether it published the post kept for ${kept.publishAt}: ${errorMessage(error)}`)
      return
    }
    if (reading.state === 'published') return this.recordPublished(kept, reading.url, reading.externalId)
    if (reading.state === 'waiting') {
      // The platform publishes a little after the minute; a post that changed meanwhile is taken back before it does.
      if (!this.stillWanted(kept)) {
        await this.takeBack(kept)
        return
      }
      if (core.clock.now().getTime() - Date.parse(kept.publishAt) > LATE_MS) this.note(kept, `${label} still keeps a post whose time (${kept.publishAt}) has passed and has not published it. Look at ${label}'s scheduled posts.`)
      return
    }
    // The platform does not know the kept post any more. It may have given the published post another id: the page is looked through for a
    // post with the same words made since the hand-over before anything is said to be unpublished.
    try {
      const pair = this.connector(kept.channelId)
      const found = await pair.connector.findPublished(pair.ctx, { ...kept.request, publishAt: undefined, attemptedAt: kept.handedAt })
      if (found) return this.recordPublished(kept, found.url, found.externalId)
    } catch (error) {
      this.note(kept, `${label} no longer shows the post it kept for ${kept.publishAt}, and its page could not be looked through for it: ${errorMessage(error)}`)
      return
    }
    this.forget(kept.opportunityId)
    core.log.warn('send', `${label} no longer has the post it kept for ${kept.publishAt}, and no post with its words is on the page.`, kept.channelId)
    if (this.stillWanted(kept)) this.deps.review.returnToReview(kept.opportunityId, GONE_FROM_SCHEDULE_REASON)
    store.notify()
  }

  /** Takes a kept post back from its platform. True when the platform no longer holds it to publish; false when that could not be done (said in the log and on the item). */
  private async takeBack(kept: Kept & { externalId: string }): Promise<boolean> {
    const { core, store } = this.deps
    const label = this.label(kept.channelId)
    let answer: 'withdrawn' | 'published'
    try {
      const pair = this.connector(kept.channelId)
      if (!pair.connector.withdrawScheduled) throw new Error('this platform cannot be asked')
      answer = await pair.connector.withdrawScheduled(pair.ctx, kept.externalId)
    } catch (error) {
      const problem = `${label} still keeps an earlier version of a post for ${kept.publishAt} and it could not be taken back: ${errorMessage(error)}. Delete it among ${label}'s scheduled posts.`
      this.note(kept, problem)
      return false
    }
    if (answer === 'published') {
      // Too late: it went out as it was handed over, and that is recorded as what happened.
      let url = ''
      try {
        const pair = this.connector(kept.channelId)
        const reading = await pair.connector.readScheduled?.(pair.ctx, kept.externalId)
        if (reading?.state === 'published') url = reading.url
      } catch {
        // Published all the same: it is recorded without its address.
      }
      this.recordPublished(kept, url, kept.externalId, `${label} had already published this post as it was approved for ${kept.publishAt}; what was changed after that was not published.`)
      return true
    }
    const said = this.kept(kept.opportunityId)?.problem ?? null
    this.forget(kept.opportunityId)
    try {
      // The words this file put on the item are no longer true; the owner's own reason (an edit, a deferral) stays.
      const opp = store.requireOpportunity(kept.opportunityId)
      if (opp.reason === keptNote(store.requireChannel(kept.channelId).platform) || opp.reason === said) store.updateOpportunity(kept.opportunityId, { reason: '' })
    } catch {
      // Deleted item: nothing to clear.
    }
    core.log.info('send', `The post ${label} kept for ${kept.publishAt} was taken back: it is no longer what was approved for that time.`, kept.channelId)
    store.notify()
    return true
  }

  /** Writes the send the platform made: a confirmed attempt at the post's own time, and the item as published. */
  private recordPublished(kept: Kept, url: string, externalId: string, reason = ''): void {
    const { core, store } = this.deps
    const label = this.label(kept.channelId)
    let recorded = false
    try {
      core.db.transaction(() => {
        core.db
          .prepare(
            `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, completed_at, result_url, result_external_id, authorization_basis, knowledge_version_id, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, NULL)`
          )
          .run(newId(), kept.opportunityId, kept.draftId, kept.approvalId, kept.contentHash, kept.accountId, kept.destination, kept.publishAt, store.now(), url || null, externalId || null, `${kept.authorizationBasis}; published by ${label} at the time it was given`, kept.knowledgeVersionId)
        store.updateOpportunity(kept.opportunityId, { state: 'confirmed', reason })
        this.forget(kept.opportunityId)
      })()
      recorded = true
    } catch (error) {
      // The item was deleted here after the platform took it, or already has a send of its own: the platform published it all the same.
      this.forget(kept.opportunityId)
      core.log.error('send', `${label} published a post it kept for ${kept.publishAt}${url ? ` (${url})` : ''}, and it could not be recorded as sent: ${errorMessage(error)}`, kept.channelId)
    }
    if (recorded) {
      this.deps.markVerified(kept.channelId, true, url || externalId)
      core.log.info('send', `Post published by ${label} at its time${url ? ` (${url})` : ''}`, kept.channelId)
    }
    store.notify()
  }

  // ───────────── before a send by this application ─────────────

  /**
   * Called under the account's lock before any send of the item by this application: a post the platform holds is taken back first. It throws
   * (the send does not start) when the platform already published it, or when it cannot be taken back or asked.
   */
  async release(opportunityId: Id): Promise<void> {
    const kept = this.kept(opportunityId)
    if (!kept) return
    const label = this.label(kept.channelId)
    const refuse = (reason: string): never => {
      throw new SendBlockedError({ allowed: false, effect: 'hold', code: 'kept_by_platform', reasons: [reason] })
    }
    const settled = await this.identify(kept)
    if (!settled) {
      if (this.kept(opportunityId)) refuse(`It is not known whether ${label} took this post on its schedule. Look at ${label}'s scheduled posts; nothing was sent.`)
      return
    }
    const gone = await this.takeBack(settled)
    if (!gone) refuse(`${label} still keeps this post for ${kept.publishAt} and it could not be taken back, so sending it now could publish it twice. Delete it among ${label}'s scheduled posts, then send. Nothing was sent.`)
    if (this.deps.store.requireOpportunity(opportunityId).state === 'confirmed') refuse(`${label} had already published this post at its time.`)
  }
}
