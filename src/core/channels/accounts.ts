// Accounts: one persistent browser identity per account, shareable by several channels and products (REQ-002).
// Passwords are typed by the person on the site's own page; nothing here reads, requests or stores credentials.

import { ApiError } from '../../shared/api'
import type { Account, Channel } from '../../shared/types'
import { DEFAULT_CHANNEL_SETTINGS } from '../../shared/types'
import type { Core } from '../core'
import type { BrowserService, Connector, ConnectorContext } from '../ports'
import { browserError, found, requireText } from './errors'
import { loginOutcome } from './login'
import { blankCapabilities } from './capabilities'
import type { ChannelsStore } from './store'
import { parseBrowserUrl } from './urls'

const MAX_LABEL = 80

/** Implemented by the Electron browser service: wipes the stored session (cookies, storage) of a removed account. */
interface SessionForgetting {
  forgetAccount(account: Account): Promise<void>
}

const canForget = (service: BrowserService): service is BrowserService & SessionForgetting =>
  typeof (service as Partial<SessionForgetting>).forgetAccount === 'function'

export class AccountsService {
  constructor(
    private readonly core: Core,
    private readonly store: ChannelsStore
  ) {}

  list(): Account[] {
    return this.core.repos.listAccounts()
  }

  account(id: unknown): Account {
    return found(() => this.core.repos.account(requireText(id, 'The account')), 'The account')
  }

  create(args: { platform: string; label: string }): Account {
    const platform = requireText(args.platform, 'The platform').toLowerCase()
    const label = requireText(args.label, 'The account name').replace(/\s+/g, ' ')
    if (label.length > MAX_LABEL) throw new ApiError('invalid_input', `The account name is too long (limit ${MAX_LABEL} characters).`)
    const known = [...new Set(this.core.connectors.list().map((c) => c.platform))]
    if (!known.includes(platform)) {
      throw new ApiError('invalid_input', `Unknown platform "${platform}". Available: ${known.join(', ') || 'none'}.`)
    }
    const account = this.store.insertAccount(platform, label)
    this.core.log.info('accounts', `Account created: ${label} (${platform}). Sign in through the account browser.`)
    this.core.events.changed('accounts', 'attention')
    return account
  }

  async remove(id: unknown): Promise<void> {
    const account = this.account(id)
    const channels = this.store.channelsOfAccount(account.id)
    if (channels.length > 0) {
      const names = channels.map((c) => c.target).join(', ')
      throw new ApiError('in_use', `${account.label} is used by ${channels.length} channel${channels.length === 1 ? '' : 's'} (${names}). Remove them first.`)
    }
    if (canForget(this.core.browser)) {
      try {
        await this.core.browser.forgetAccount(account)
      } catch (error) {
        // Leaving the account in place lets the person retry; silently keeping their cookies on disk would not.
        throw new ApiError('session_wipe_failed', `Could not erase the stored sign-in of ${account.label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    this.store.deleteAccount(account.id)
    this.core.log.info('accounts', `Account removed: ${account.label}. Its stored browser session was erased.`)
    this.core.events.changed('accounts', 'attention')
  }

  // ───────────── browser hand-off ─────────────

  /** The connector responsible for the account's platform. */
  private connectorFor(account: Account): Connector | undefined {
    return this.core.connectors.list().find((c) => c.platform === account.platform)
  }

  private defaultUrl(account: Account): string {
    const login = this.connectorFor(account)?.loginUrl() ?? ''
    if (login) return login
    const channel = this.store.channelsOfAccount(account.id)[0]
    if (channel) return channel.url
    throw new ApiError('invalid_input', 'Enter the address of the site to open: this kind of account has no standard sign-in page.')
  }

  async openBrowser(args: { accountId: string; url?: string }): Promise<{ tabId: string }> {
    const account = this.account(args.accountId)
    const url = args.url !== undefined && args.url.trim() ? parseBrowserUrl(args.url) : parseBrowserUrl(this.defaultUrl(account))
    try {
      const result = await this.core.browser.openForUser(account, url)
      this.core.log.info('accounts', `Browser opened for ${account.label} on ${new URL(url).host}. The app does not touch the page while you have control.`)
      this.core.events.changed('accounts')
      return result
    } catch (error) {
      throw browserError(error, { code: 'open_failed', message: (reason) => `Could not open the browser: ${reason}` })
    }
  }

  takeControl(accountId: unknown): void {
    const account = this.account(accountId)
    this.core.browser.session(account).takeControl()
    this.core.log.info('accounts', `You took control of the browser of ${account.label}; automation stopped using it.`)
    this.core.events.changed('accounts')
  }

  releaseControl(accountId: unknown): void {
    const account = this.account(accountId)
    this.core.browser.session(account).releaseControl()
    this.core.log.info('accounts', `Control of the browser of ${account.label} returned to the app.`)
    this.core.events.changed('accounts')
  }

  // ───────────── login ─────────────

  /** A connector context for an account-level check: a real channel of the account, else a placeholder for its sign-in page. */
  private probeContext(account: Account, connector: Connector): ConnectorContext {
    const channel = this.store.channelsOfAccount(account.id)[0] ?? this.placeholderChannel(account, connector)
    return { channel, account, session: this.core.browser.session(account), tickets: this.core.tickets, clock: this.core.clock }
  }

  private placeholderChannel(account: Account, connector: Connector): Channel {
    const url = connector.loginUrl()
    if (!url) {
      throw new ApiError('invalid_input', 'Connect a channel on this site first: the app needs to know which site to check the sign-in on.')
    }
    return {
      id: `probe:${account.id}`,
      productId: '',
      accountId: account.id,
      platform: account.platform,
      connectorId: connector.id,
      target: '',
      url,
      mode: 'observe',
      settings: structuredClone(DEFAULT_CHANNEL_SETTINGS),
      capabilities: blankCapabilities(),
      status: 'setup',
      statusDetail: '',
      baselineDoneAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      nextCheckAt: null,
      createdAt: this.core.clock.now().toISOString()
    }
  }

  /** Checks whether the account is signed in and records status and confirmed identity. */
  async checkLogin(accountId: unknown): Promise<Account> {
    const account = this.account(accountId)
    const connector = this.connectorFor(account)
    if (!connector) throw new ApiError('no_connector', `No connector is available for ${account.platform}.`)
    const ctx = this.probeContext(account, connector)
    try {
      const state = await connector.checkLogin(ctx)
      return this.applyLogin(account, state)
    } catch (error) {
      const failure = browserError(error, { code: 'login_check_failed', message: (reason) => `Could not check the sign-in: ${reason}` })
      if (failure.code !== 'browser_busy') this.core.log.warn('accounts', failure.message)
      throw failure
    }
  }

  /** Records a login state seen by any check; emits the changes that put the account on the attention list. */
  applyLogin(account: Account, state: Parameters<typeof loginOutcome>[0]): Account {
    const outcome = loginOutcome(state)
    const updated = this.store.setLogin(account.id, outcome.status, outcome.identity)
    if (account.identity && outcome.identity && account.identity !== outcome.identity) {
      this.core.log.warn('accounts', `${account.label} is now signed in as ${outcome.identity} (it was ${account.identity}).`)
    }
    if (account.status !== updated.status || account.identity !== updated.identity) {
      this.core.log.info('accounts', `${account.label}: ${outcome.detail}`)
    }
    this.core.events.changed('accounts', 'attention')
    return updated
  }
}
