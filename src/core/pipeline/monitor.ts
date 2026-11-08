// Discussion collection for one channel (I-4, REQ-003 criterion 1, REQ-005).
//
// `runChannel` never throws for platform problems: it returns an outcome and records the channel state, so one
// failing channel cannot stop the others. The connector acquires the browser itself through
// `ctx.session.withAgentControl` (the session is not re-entrant), so this service must not wrap the call.

import type { Account, AccountStatus, Channel } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError, type Connector, type ConnectorContext } from '../ports'
import type { MonitorOutcome, MonitorService } from '../services'
import type { Ingestor } from './ingest'
import type { LoginWatch } from './login-watch'
import type { FlowStore } from './store'
import { errorMessage, minutesFrom } from './util'

/** How many recent discussions a cycle reads. */
const DISCUSSION_LIMIT = 25
/** After a failure the next try comes sooner than the regular interval, but never more often than this. */
const FAILURE_RETRY_MIN = 10

type Problem = 'takeover' | 'login' | 'captcha' | 'failed'

export class MonitorFlow implements MonitorService {
  private readonly running = new Set<string>()

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore,
    private readonly ingestor: Ingestor,
    private readonly watch: LoginWatch
  ) {}

  async runChannel(channelId: string): Promise<MonitorOutcome> {
    if (this.running.has(channelId)) return { status: 'skipped', summary: 'A check of this channel is already running', newOpportunities: 0 }
    this.running.add(channelId)
    try {
      return await this.cycle(channelId)
    } catch (error) {
      // Last line of defence: an unexpected bug in one channel must never escape into the scheduler.
      this.core.log.error('monitor', `Unexpected error: ${errorMessage(error)}`, channelId)
      return { status: 'failed', summary: `Unexpected error: ${errorMessage(error)}`, newOpportunities: 0 }
    } finally {
      this.running.delete(channelId)
    }
  }

  private async cycle(channelId: string): Promise<MonitorOutcome> {
    let channel: Channel
    let account: Account
    try {
      channel = this.core.repos.channel(channelId)
      account = this.core.repos.account(channel.accountId)
    } catch (error) {
      return { status: 'failed', summary: errorMessage(error), newOpportunities: 0 }
    }
    if (channel.status === 'paused') return { status: 'skipped', summary: 'Channel is paused', newOpportunities: 0 }

    if (account.status !== 'ready') {
      // The account state is already recorded by whoever set it; only the channel is suspended here.
      return this.suspend(channel, account.status === 'captcha' ? `Account "${account.label}" is waiting for a CAPTCHA to be solved` : `Account "${account.label}" is not available (${account.status}); sign in again to resume`)
    }

    let connector: Connector
    let ctx: ConnectorContext
    try {
      ;({ connector, ctx } = this.core.connectorContext(channelId))
    } catch (error) {
      return this.fail(channel, errorMessage(error))
    }

    // Reading works without a login, so an expired session would only show up when a reply is about to go out.
    // Channels that can send therefore check the login now and then (throttled per account).
    if (channel.mode === 'approval' || channel.mode === 'auto') {
      const verdict = await this.watch.checkIfDue(connector, ctx, account.id)
      if (verdict === 'takeover') return this.suspend(channel, 'You are controlling the browser; the check resumes when you hand it back')
      if (verdict === 'login') return this.suspend(channel, `Account "${account.label}" is signed out: sign in again to resume`, 'login_required')
      if (verdict === 'captcha') return this.suspend(channel, `The site asks for a CAPTCHA on account "${account.label}": solve it to resume`, 'captcha')
    }

    let discussions
    try {
      discussions = (await connector.fetchActivity(ctx, { limit: DISCUSSION_LIMIT })).discussions
    } catch (error) {
      return this.handleReadError(channel, account, connector, ctx, error)
    }

    try {
      const baseline = channel.baselineDoneAt === null
      const result = this.ingestor.ingest(channel, account, discussions)
      return this.succeed(channel, baseline, result.discussions, result.newComments, result.newOpportunities, result.identityUnknown)
    } catch (error) {
      return this.fail(channel, `Could not store the collected data: ${errorMessage(error)}`)
    }
  }

  // ───────────── outcomes ─────────────

  private succeed(channel: Channel, baseline: boolean, discussions: number, newComments: number, newOpportunities: number, identityUnknown: boolean): MonitorOutcome {
    const now = this.core.clock.now()
    const wasTroubled = channel.status === 'needs_user' || channel.status === 'error'
    this.store.updateChannel(channel.id, {
      lastRunAt: now.toISOString(),
      lastSuccessAt: now.toISOString(),
      nextCheckAt: minutesFrom(now, channel.settings.checkIntervalMin),
      ...(wasTroubled ? { status: 'active' as const, statusDetail: '' } : {}),
      ...(identityUnknown ? { statusDetail: 'The account identity is unknown, so nothing is queued: sign in so your own comments can be recognised.' } : {})
    })
    const summary = baseline
      ? `Baseline stored: ${discussions} discussion(s), ${newComments} existing comment(s); no replies will be prepared for them`
      : identityUnknown
        ? `${discussions} discussion(s) read, ${newComments} new comment(s) stored; nothing queued because the account identity is unknown`
        : `${discussions} discussion(s) read, ${newComments} new comment(s), ${newOpportunities} new opportunity(ies)`
    this.core.events.changed('channels', 'attention')
    return { status: 'ok', summary, newOpportunities }
  }

  private fail(channel: Channel, detail: string): MonitorOutcome {
    const now = this.core.clock.now()
    this.core.log.warn('monitor', `Check failed: ${detail}`, channel.id)
    this.store.updateChannel(channel.id, {
      status: channel.status === 'setup' ? 'setup' : 'error',
      statusDetail: detail,
      lastRunAt: now.toISOString(),
      nextCheckAt: minutesFrom(now, Math.min(channel.settings.checkIntervalMin, FAILURE_RETRY_MIN))
    })
    this.core.events.changed('attention')
    return { status: 'failed', summary: detail, newOpportunities: 0 }
  }

  /** Login expired, CAPTCHA or the user took the browser: affected work is suspended until the user acts (REQ-005). */
  private suspend(channel: Channel, detail: string, accountStatus?: AccountStatus): MonitorOutcome {
    const now = this.core.clock.now()
    this.core.log.warn('monitor', `Suspended: ${detail}`, channel.id)
    this.store.updateChannel(channel.id, {
      status: channel.status === 'setup' ? 'setup' : 'needs_user',
      statusDetail: detail,
      lastRunAt: now.toISOString(),
      nextCheckAt: minutesFrom(now, channel.settings.checkIntervalMin)
    })
    if (accountStatus) this.watch.setAccountStatus(channel.accountId, accountStatus)
    this.core.events.changed('attention')
    return { status: 'suspended', summary: detail, newOpportunities: 0 }
  }


  // ───────────── error classification ─────────────

  private async handleReadError(channel: Channel, account: Account, connector: Connector, ctx: ConnectorContext, error: unknown): Promise<MonitorOutcome> {
    const problem = await this.classify(connector, ctx, error)
    switch (problem) {
      case 'takeover':
        return this.suspend(channel, 'You are controlling the browser; the check resumes when you hand it back')
      case 'login':
        return this.suspend(channel, `Account "${account.label}" is signed out: sign in again to resume`, 'login_required')
      case 'captcha':
        return this.suspend(channel, `The site asks for a CAPTCHA on account "${account.label}": solve it to resume`, 'captcha')
      default:
        return this.fail(channel, `Reading the channel failed: ${errorMessage(error)}`)
    }
  }

  /**
   * Connectors report session trouble in different ways, so the error is classified by type, then by the
   * conventional error names, and finally by asking the connector for the current login state.
   */
  private async classify(connector: Connector, ctx: ConnectorContext, error: unknown): Promise<Problem> {
    if (error instanceof TakeoverError) return 'takeover'
    const name = error instanceof Error ? error.name : ''
    if (/captcha/i.test(name)) return 'captcha'
    if (/login|auth|session/i.test(name)) return 'login'
    try {
      const state = await connector.checkLogin(ctx)
      if (state.captcha) return 'captcha'
      if (!state.loggedIn) return 'login'
    } catch (diagnosis) {
      if (diagnosis instanceof TakeoverError) return 'takeover'
    }
    return 'failed'
  }
}
