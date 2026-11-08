// Knowing whether the account is still signed in (REQ-005: login expiry must be noticed, not discovered at send time).
//
// Reading a public community works without a login, so a successful read says nothing about the session. Channels
// that can send therefore ask the connector about the login state now and then. The check runs through the
// connector (which takes browser control itself), is throttled per account, and the throttle lives in memory:
// after a restart one more check is simply made.

import type { AccountStatus, Channel, Id } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError, type Connector, type ConnectorContext } from '../ports'
import type { FlowStore } from './store'
import { errorMessage } from './util'

/** The login state of one account is checked at most this often by the monitor. */
export const LOGIN_CHECK_INTERVAL_MS = 15 * 60 * 1000

/**
 * ok        - signed in, no CAPTCHA;
 * login     - signed out;
 * captcha   - the site asks for a human check;
 * takeover  - the owner is controlling the browser, nothing could be checked;
 * unchecked - the check itself failed for another reason (says nothing about the login).
 */
export type LoginVerdict = 'ok' | 'login' | 'captcha' | 'takeover' | 'unchecked'

const LOGIN_ERROR_NAME = /login|auth|session|captcha/i
const LOGIN_ERROR_MESSAGE =
  /\b(?:not\s+(?:signed|logged)[- ]?in|signed[- ]out|logged[- ]out|(?:sign|log)[- ]?in\s+(?:is\s+)?required|login\s+(?:required|expired)|session\s+(?:has\s+)?(?:expired|ended|invalid)|unauthori[sz]ed|authentication\s+(?:failed|required)|captcha)\b/i

/** Whether an error (or a failure text from a connector) is the conventional way to say "not signed in". */
export function isLoginError(value: unknown): boolean {
  if (typeof value === 'string') return LOGIN_ERROR_MESSAGE.test(value)
  if (value instanceof Error) return LOGIN_ERROR_NAME.test(value.name) || LOGIN_ERROR_MESSAGE.test(value.message)
  return false
}

export class LoginWatch {
  private readonly lastChecked = new Map<Id, number>()

  constructor(
    private readonly core: Core,
    private readonly store: FlowStore
  ) {}

  /** Asks the connector for the login state, unless this account was checked recently. 'ok' also means "not due". */
  async checkIfDue(connector: Connector, ctx: ConnectorContext, accountId: Id): Promise<LoginVerdict> {
    const now = this.core.clock.now().getTime()
    const last = this.lastChecked.get(accountId)
    if (last !== undefined && now - last < LOGIN_CHECK_INTERVAL_MS) return 'ok'
    // Recorded before the call so the account's other channels do not all check at once.
    this.lastChecked.set(accountId, now)
    const verdict = await this.diagnose(connector, ctx)
    // A problem (or a failed check) is looked at again as soon as the owner has acted, not 15 minutes later.
    if (verdict !== 'ok') this.lastChecked.delete(accountId)
    return verdict
  }

  async diagnose(connector: Connector, ctx: ConnectorContext): Promise<LoginVerdict> {
    try {
      const state = await connector.checkLogin(ctx)
      if (state.captcha) return 'captcha'
      return state.loggedIn ? 'ok' : 'login'
    } catch (error) {
      if (error instanceof TakeoverError) return 'takeover'
      this.core.log.warn('login', `Could not check the login state: ${errorMessage(error)}`, ctx.channel.id)
      return 'unchecked'
    }
  }

  setAccountStatus(accountId: Id, status: AccountStatus): void {
    this.core.db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, accountId)
    this.core.events.changed('accounts', 'attention')
  }

  /** A send failed because the account is not signed in: suspend the account and tell the owner what to do. */
  suspendAfterFailedSend(channel: Channel, verdict: 'login' | 'captcha'): void {
    const account = this.core.repos.account(channel.accountId)
    const detail =
      verdict === 'captcha'
        ? `The site asks for a CAPTCHA on account "${account.label}": solve it to resume`
        : `Account "${account.label}" is signed out: sign in again to resume`
    this.setAccountStatus(account.id, verdict === 'captcha' ? 'captcha' : 'login_required')
    this.store.updateChannel(channel.id, { status: channel.status === 'setup' ? 'setup' : 'needs_user', statusDetail: detail })
    this.lastChecked.delete(account.id)
    this.core.events.changed('channels', 'attention')
  }
}
