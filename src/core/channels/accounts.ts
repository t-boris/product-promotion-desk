// Accounts: one persistent browser identity per account, shareable by several channels and products (REQ-002).
// Passwords are typed by the person on the site's own page; nothing here reads, requests or stores credentials.

import { ApiError } from '../../shared/api'
import type { Account, AccountRole, Channel } from '../../shared/types'
import { DEFAULT_CHANNEL_SETTINGS } from '../../shared/types'
import type { Core } from '../core'
import type { BrowserService, Connector, ConnectorContext } from '../ports'
import { browserError, found, requireText } from './errors'
import { parseEmail } from './mailboxes'
import { loginOutcome } from './login'
import { connectorForPlatform, listPlatforms } from './platforms'
import { hostMatches, presetFor } from './presets'
import { parseRole, sameRoleName } from './roles'
import { blankCapabilities } from './capabilities'
import { passwordKey } from '../vault'
import type { ChannelsStore } from './store'
import { parseBrowserUrl } from './urls'

const MAX_LABEL = 80
const ACCOUNT_CHANGED_DETAIL = 'The signed-in account changed; review before sending'

/** Implemented by the Electron browser service: wipes the stored session (cookies, storage) of a removed account. */
interface SessionForgetting {
  forgetAccount(account: Account): Promise<void>
}

const canForget = (service: BrowserService): service is BrowserService & SessionForgetting =>
  typeof (service as Partial<SessionForgetting>).forgetAccount === 'function'

/** Implemented by the Electron browser service: whether the person's window for the account is open. */
interface UserWindowAware {
  hasUserWindow(account: Account): boolean
}

const hasOpenUserWindow = (service: BrowserService, account: Account): boolean => {
  const aware = service as Partial<UserWindowAware>
  return typeof aware.hasUserWindow === 'function' && aware.hasUserWindow(account)
}

export class AccountsService {
  /** Called when a check finds an account signed out, so a saved password can sign it in again (DEC-014). */
  onSignedOut: ((account: Account) => void) | null = null

  constructor(
    private readonly core: Core,
    private readonly store: ChannelsStore
  ) {}

  /** Every account: they are one library, shared by all products (DEC-015). */
  list(): Account[] {
    return this.core.repos.listAccounts()
  }

  account(id: unknown): Account {
    return found(() => this.core.repos.account(requireText(id, 'The account')), 'The account')
  }

  /** An account has its own login and browser session and is not tied to a product (DEC-015); `productId` only records what it was made for. */
  create(args: { productId?: string; platform: string; label: string; role?: AccountRole | null; email?: string | null; mailboxId?: string | null }): Account {
    const productId = args.productId === undefined || args.productId === null ? null : requireText(args.productId, 'The product')
    const product = productId ? found(() => this.core.repos.product(productId), 'The product') : null
    const platform = requireText(args.platform, 'The platform').toLowerCase()
    const label = requireText(args.label, 'The account name').replace(/\s+/g, ' ')
    if (label.length > MAX_LABEL) throw new ApiError('invalid_input', `The account name is too long (limit ${MAX_LABEL} characters).`)
    const known = listPlatforms(this.core.connectors).map((p) => p.platform)
    if (!known.includes(platform)) {
      throw new ApiError('invalid_input', `Unknown platform "${platform}". Available: ${known.join(', ') || 'none'}.`)
    }
    const role = parseRole(args.role)
    const email = args.email ? parseEmail(args.email) : null
    const mailboxId = email && args.mailboxId ? this.knownMailbox(args.mailboxId) : null
    const account = this.store.insertAccount(product?.id ?? null, platform, label, role, email, mailboxId)
    this.core.log.info('accounts', `Account created${product ? ` for "${product.name}"` : ''}: ${label} (${platform})${role ? `, role "${role.name}"` : ''}${email ? `, e-mail ${email}` : ''}. Sign in through the account browser.`)
    this.core.events.changed('accounts', 'attention')
    return account
  }

  private knownMailbox(id: string): string {
    if (!this.store.listMailboxes().some((m) => m.id === id)) throw new ApiError('not_found', 'The mailbox was not found.')
    return id
  }

  /** Sets, changes or clears (null) the e-mail address of an account (DEC-015). */
  setEmail(args: { accountId: string; email: string | null; mailboxId?: string | null }): Account {
    const account = this.account(args.accountId)
    const email = args.email === null || args.email === undefined || String(args.email).trim() === '' ? null : parseEmail(args.email)
    const mailboxId = email && args.mailboxId ? this.knownMailbox(args.mailboxId) : null
    if (email === account.email && mailboxId === account.mailboxId) return account
    const updated = this.store.setEmail(account.id, email, mailboxId)
    this.core.log.info('accounts', email ? `E-mail of ${account.label} set to ${email}.` : `E-mail of ${account.label} cleared.`)
    this.core.events.changed('accounts')
    return updated
  }

  /** Sets, changes or removes (null) the role of a login (DEC-010). The role belongs to the account, whichever product uses it. */
  setRole(args: { accountId: string; role: AccountRole | null }): Account {
    const account = this.account(args.accountId)
    const role = parseRole(args.role)
    if (role) {
      // Two logins of one product on one platform may not play the same role: checked for every product that already uses this account.
      for (const productId of new Set(this.store.channelsOfAccount(account.id).map((c) => c.productId))) {
        const clash = this.roleClash(productId, account.platform, account.id, role.name)
        if (clash) throw new ApiError('role_exists', `${clash.label}, another login of the same product on the same platform, already has the role "${clash.role?.name}". Give this login a different role name.`)
      }
    }
    if (role?.name === account.role?.name && role?.voice === account.role?.voice) return account
    const updated = this.store.setRole(account.id, role)
    this.core.log.info('accounts', role ? `Role of ${account.label} set to "${role.name}".` : `Role of ${account.label} removed.`)
    this.core.events.changed('accounts')
    return updated
  }

  /**
   * Another login that already plays `name` for this product on this platform, if there is one (compared without regard to
   * case). A product's logins are the accounts its channels use; the same role name may exist for different products.
   */
  roleClash(productId: string, platform: string, exceptAccountId: string, name: string): Account | undefined {
    const used = new Set(this.core.repos.listChannels().filter((c) => c.productId === productId && c.platform === platform).map((c) => c.accountId))
    return this.core.repos.listAccounts().find((a) => a.id !== exceptAccountId && used.has(a.id) && a.role !== null && sameRoleName(a.role.name, name))
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
    // The password goes with the account: a removed account leaves nothing in the vault.
    this.core.secrets.delete(passwordKey(account.id))
    this.core.log.info('accounts', `Account removed: ${account.label}. Its stored browser session was erased.`)
    this.core.events.changed('accounts', 'attention')
  }

  // ───────────── browser hand-off ─────────────

  /** The connector responsible for the account's platform. */
  private connectorFor(account: Account): Connector | undefined {
    return connectorForPlatform(this.core.connectors, account.platform)
  }

  private defaultUrl(account: Account): string {
    const login = presetFor(account.platform)?.loginUrl ?? this.connectorFor(account)?.loginUrl() ?? ''
    if (login) return login
    const channel = this.store.channelsOfAccount(account.id)[0]
    if (channel) return channel.url
    throw new ApiError('invalid_input', 'Enter the address of the site to open: this kind of account has no standard sign-in page.')
  }

  /** The page to sign in on and the hosts it may be on: a password is only ever put on a page of the account's own platform. */
  signInTarget(account: Account): { url: string; hosts: string[] } {
    const url = parseBrowserUrl(this.defaultUrl(account))
    const preset = presetFor(account.platform)
    const own = new URL(url).hostname.replace(/^www\./, '')
    const hosts = preset ? [...preset.hosts] : [own]
    if (!hostMatches(own, hosts)) hosts.push(own)
    return { url, hosts }
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
    // The window and its toolbar still tell the person they are in control; handing the browser to the agent behind
    // it would let the app act on a page the person is looking at. The window's own button does both at once.
    if (hasOpenUserWindow(this.core.browser, account)) {
      throw new ApiError('user_window_open', 'Close the account window or press "Give control back to the app" in it first.')
    }
    this.core.browser.session(account).releaseControl()
    this.core.log.info('accounts', `Control of the browser of ${account.label} returned to the app.`)
    this.core.events.changed('accounts')
  }

  // ───────────── login ─────────────

  /** A connector context for an account-level check: a real channel of the account, else a placeholder for its sign-in page. */
  private probeContext(account: Account, connector: Connector): ConnectorContext {
    const channel = this.store.channelsOfAccount(account.id)[0] ?? this.placeholderChannel(account, connector)
    return {
      channel,
      account,
      session: this.core.browser.session(account),
      // Only the verifier, exactly as core.connectorContext() hands it out: issuing tickets stays with the SendGate.
      tickets: { assertValid: (ticket, expect) => this.core.tickets.assertValid(ticket, expect) },
      clock: this.core.clock
    }
  }

  private placeholderChannel(account: Account, connector: Connector): Channel {
    const url = presetFor(account.platform)?.loginUrl ?? connector.loginUrl()
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
      plan: null,
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

  /**
   * Another person's account is signed in where the confirmed one used to be: everything this account does on the
   * person's behalf waits for a look. (Approvals bound to the old identity are invalidated separately, by the hash.)
   */
  private holdChannelsForReview(account: Account): void {
    for (const channel of this.store.channelsOfAccount(account.id)) {
      this.store.updateChannel(channel.id, { status: 'needs_user', statusDetail: ACCOUNT_CHANGED_DETAIL })
    }
  }

  /** Records a login state seen by any check; emits the changes that put the account on the attention list. */
  applyLogin(account: Account, state: Parameters<typeof loginOutcome>[0]): Account {
    const outcome = loginOutcome(state)
    // The account that is expected to be signed in: the last one seen, which survives a logout in between.
    const expected = this.store.lastIdentity(account.id) ?? account.identity
    const updated = this.store.setLogin(account.id, outcome.status, outcome.identity)
    const switched = Boolean(expected && outcome.identity && expected !== outcome.identity)
    if (switched) {
      this.core.log.warn('accounts', `${account.label} is now signed in as ${outcome.identity} (it was ${expected}).`)
      this.holdChannelsForReview(account)
    }
    if (account.status !== updated.status || account.identity !== updated.identity) {
      this.core.log.info('accounts', `${account.label}: ${outcome.detail}`)
    }
    if (switched) this.core.events.changed('channels')
    this.core.events.changed('accounts', 'attention')
    if (updated.status === 'login_required') this.onSignedOut?.(updated)
    return updated
  }
}
