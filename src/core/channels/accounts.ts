// Accounts: one persistent browser identity per account, shareable by several channels and products (REQ-002).
// Passwords are typed by the person on the site's own page; nothing here reads, requests or stores credentials.

import { ApiError } from '../../shared/api'
import type { Account, AccountRole, BrowserChoice, BrowserState, Channel, PageReport } from '../../shared/types'
import { DEFAULT_CHANNEL_SETTINGS } from '../../shared/types'
import type { Core } from '../core'
import { TakeoverError, type BrowserService, type Connector, type ConnectorContext, type PageObserver } from '../ports'
import { BROWSER_BUSY, browserError, found, requireText } from './errors'
import { parseEmail } from './mailboxes'
import { loginOutcome } from './login'
import { connectorForPlatform, listPlatforms } from './platforms'
import { addressOnPlatform, expandHandle, hostMatches, presetFor } from './presets'
import { parseRole, sameRoleName } from './roles'
import { blankCapabilities } from './capabilities'
import { passwordKey } from '../vault'
import type { ChannelsStore } from './store'
import { parseBrowserUrl, publicAddress } from './urls'

const MAX_LABEL = 80
const ACCOUNT_CHANGED_DETAIL = 'The signed-in account changed; review before sending'

/** The name of an account: text, spaces folded, not longer than the limit. */
function parseLabel(value: unknown): string {
  const label = requireText(value, 'The account name').replace(/\s+/g, ' ')
  if (label.length > MAX_LABEL) throw new ApiError('invalid_input', `The account name is too long (limit ${MAX_LABEL} characters).`)
  return label
}

/** Implemented by the Electron browser service: wipes the stored session (cookies, storage) of a removed account. */
interface SessionForgetting {
  forgetAccount(account: Account): Promise<void>
}

const canForget = (service: BrowserService): service is BrowserService & SessionForgetting =>
  typeof (service as Partial<SessionForgetting>).forgetAccount === 'function'

/** Implemented by both browser services: the owner's windows of an account (the ones "Open browser" opens; there can be several, DEC-038). */
interface UserWindowAware {
  /** Whether the owner has at least one window of the account open. */
  hasUserWindow(account: Account): boolean
  /** Brings the owner's window used last to the front; false when none is open. */
  showUserWindow(account: Account): boolean
}

const hasOpenUserWindow = (service: BrowserService, account: Account): boolean => {
  const aware = service as Partial<UserWindowAware>
  return typeof aware.hasUserWindow === 'function' && aware.hasUserWindow(account)
}

const showUserWindow = (service: BrowserService, account: Account): boolean => {
  const aware = service as Partial<UserWindowAware>
  return typeof aware.showUserWindow === 'function' && aware.showUserWindow(account)
}

const observe = (service: BrowserService): Partial<PageObserver> => service as Partial<PageObserver>

export class AccountsService {
  /** Called when a check finds an account signed out, so a saved password can sign it in again (DEC-014). */
  onSignedOut: ((account: Account) => void) | null = null

  constructor(
    private readonly core: Core,
    private readonly store: ChannelsStore
  ) {
    core.browser.onUserWindowChange = (accountId, change) => this.userWindowChanged(accountId, change)
    core.browser.onPageNote = (accountId, note) => this.pageNote(accountId, note)
  }

  /** Every account: they are one library, shared by all products (DEC-015). */
  list(): Account[] {
    return this.core.repos.listAccounts()
  }

  account(id: unknown): Account {
    return found(() => this.core.repos.account(requireText(id, 'The account')), 'The account')
  }

  /** An account has its own login and browser session and is not tied to a product (DEC-015); `productId` only records what it was made for. */
  create(args: { productId?: string; platform: string; label: string; role?: AccountRole | null; email?: string | null; mailboxId?: string | null; profileId?: string | null; signsInVia?: string | null }): Account {
    const productId = args.productId === undefined || args.productId === null ? null : requireText(args.productId, 'The product')
    const product = productId ? found(() => this.core.repos.product(productId), 'The product') : null
    const platform = requireText(args.platform, 'The platform').toLowerCase()
    const label = parseLabel(args.label)
    const known = listPlatforms(this.core.connectors).map((p) => p.platform)
    if (!known.includes(platform)) {
      throw new ApiError('invalid_input', `Unknown platform "${platform}". Available: ${known.join(', ') || 'none'}.`)
    }
    const role = parseRole(args.role)
    const email = args.email ? parseEmail(args.email) : null
    const mailboxId = email && args.mailboxId ? this.knownMailbox(args.mailboxId) : null
    const profileId = args.profileId ? this.profileFor(args.profileId, platform, null) : null
    const via = this.signInThrough(platform, args.signsInVia, profileId)
    const account = this.store.insertAccount(product?.id ?? null, platform, label, role, email, mailboxId, profileId, via)
    this.core.log.info('accounts', `Account created${product ? ` for "${product.name}"` : ''}: ${label} (${platform})${role ? `, role "${role.name}"` : ''}${email ? `, e-mail ${email}` : ''}${via ? `, signs in through ${this.account(via).label}` : ''}. Sign in through the account browser.`)
    this.core.events.changed('accounts', 'attention')
    return account
  }

  /**
   * The account a login of this platform signs in through (DEC-027), checked: a platform that signs in with another (Threads with Instagram)
   * is made only with an existing account of that platform, and any other platform takes none. Returns its id, or null.
   */
  private signInThrough(platform: string, viaId: string | null | undefined, profileId: string | null): string | null {
    const preset = presetFor(platform)
    const needs = preset?.signsInWith ?? null
    if (!needs) {
      if (viaId) throw new ApiError('invalid_input', `${preset?.label ?? platform} accounts have their own credentials; they do not sign in through another account.`)
      return null
    }
    const wanted = presetFor(needs)?.label ?? needs
    if (!viaId) throw new ApiError('needs_login_account', `${preset?.label ?? platform} signs in with a ${wanted} account. Add the ${wanted} account first, then add this one.`)
    const via = found(() => this.core.repos.account(requireText(viaId, `The ${wanted} account`)), `The ${wanted} account`)
    if (via.platform !== needs) throw new ApiError('invalid_input', `${preset?.label ?? platform} signs in with a ${wanted} account, but ${via.label} is on ${via.platform}.`)
    if (profileId && via.profileId && via.profileId !== profileId) {
      throw new ApiError('invalid_input', `${via.label} belongs to another profile. A login signs in through an account of its own profile.`)
    }
    return via.id
  }

  /** Changes the name of an account (the one the owner reads in lists and headers); the same rules as when it is made. */
  rename(args: { accountId: string; label: string }): Account {
    const account = this.account(args.accountId)
    const label = parseLabel(args.label)
    if (label === account.label) return account
    const updated = this.store.renameAccount(account.id, label)
    this.core.log.info('accounts', `Account ${account.label} renamed to ${label}.`)
    this.core.events.changed('accounts', 'attention')
    return updated
  }

  /** Changes the account this one signs in through (DEC-027). */
  setSignInVia(args: { accountId: string; viaAccountId: string }): Account {
    const account = this.account(args.accountId)
    if (!presetFor(account.platform)?.signsInWith) throw new ApiError('invalid_input', `${account.label} has its own credentials; it does not sign in through another account.`)
    const via = this.signInThrough(account.platform, args.viaAccountId, account.profileId)
    if (via === account.signsInVia) return account
    // A sign-in that is running has already taken the password of the account it was started with.
    if (this.core.services.agent?.working(account.id)) throw new ApiError('agent_running', `The AI is working on ${account.label}. Change the account it signs in through when it is done.`)
    const updated = this.store.setAccountVia(account.id, via)
    this.core.log.info('accounts', `${account.label} now signs in through ${via ? this.account(via).label : 'no account'}.`)
    this.core.events.changed('accounts', 'attention')
    return updated
  }

  /**
   * Chooses the browser an account works in (DEC-026). The session of the account stays in the browser it was made in, so the account is
   * signed out here until it signs in again in the new one; the old browser's page and window are let go (Chrome is closed, its profile
   * kept). Not while the AI works on the account, while the owner took control of it, or while a window of the owner's is open (the switch would
   * close it), and not for Chrome when Chrome is not installed.
   */
  async setBrowser(args: { accountId: string; browser: BrowserChoice }): Promise<Account> {
    const account = this.account(args.accountId)
    if (args.browser !== 'internal' && args.browser !== 'chrome') throw new ApiError('invalid_input', 'The browser is Internal or Chrome.')
    if (args.browser === account.browser) return account
    if (args.browser === 'chrome' && this.core.browser.chromeFound?.() === false) {
      throw new ApiError('chrome_missing', 'Google Chrome was not found on this Mac. Install it, or keep the internal browser.')
    }
    if (this.core.services.agent?.working(account.id)) throw new ApiError('agent_running', `The AI is working on ${account.label}. Change its browser when it is done.`)
    if (this.core.browser.session(account).control().holder === 'user') {
      throw new ApiError('browser_busy', `${BROWSER_BUSY} The browser of an account is changed when nobody uses it.`)
    }
    // Switching lets go of the old browser, windows included: closing a window of the owner's behind their back is not done.
    if (hasOpenUserWindow(this.core.browser, account)) {
      throw new ApiError('browser_busy', 'A browser window of this account is open. Close it, then change the browser: the change would close it.')
    }
    // The new setting is stored first: from here every call routes to the new browser, so nothing can start a page in the one that is being let go of.
    this.store.setAccountBrowser(account.id, args.browser)
    // Nothing is known about the sign-in in the new browser until it is looked at there; the last identity is kept to notice another person.
    const updated = this.store.setLogin(account.id, 'login_required', null)
    try {
      // `account` still carries the old setting, which is how the old browser is told apart from the new one.
      await this.core.browser.releaseAccount?.(account)
    } catch (error) {
      // A page that would not close must not hold the owner's choice back; the old browser ends with the application.
      this.core.log.warn('accounts', `The old browser of ${account.label} did not let go cleanly: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.core.log.info('accounts', `${account.label} now works in the ${args.browser === 'chrome' ? 'Chrome' : 'internal'} browser. Its sign-in has to be made there; the one in the other browser stays where it is.`)
    this.core.events.changed('accounts', 'attention')
    return updated
  }

  /** The profile a login may belong to: it exists, and has no other login on this platform (one login per platform for a profile). */
  private profileFor(profileId: string, platform: string, exceptAccountId: string | null): string {
    const profile = this.store.profile(requireText(profileId, 'The profile'))?.profile
    if (!profile) throw new ApiError('not_found', 'The profile was not found.')
    const taken = this.store.accountsOfProfile(profile.id).find((a) => a.platform === platform && a.id !== exceptAccountId)
    if (taken) throw new ApiError('profile_has_account', `The profile "${profile.label}" already has an account on ${platform}: ${taken.label}. A profile has one account per platform; for another account make another profile.`)
    return profile.id
  }

  /** Puts a login into a profile (the person it is), or takes it out (null). */
  setProfile(args: { accountId: string; profileId: string | null }): Account {
    const account = this.account(args.accountId)
    const profileId = args.profileId ? this.profileFor(args.profileId, account.platform, account.id) : null
    if (profileId === account.profileId) return account
    const updated = this.store.setAccountProfile(account.id, profileId)
    this.core.log.info('accounts', profileId ? `${account.label} now belongs to the profile "${this.store.profile(profileId)?.profile.label}".` : `${account.label} no longer belongs to a profile.`)
    this.core.events.changed('accounts')
    return updated
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
    if (account.profileId) throw new ApiError('role_from_profile', `${account.label} speaks as its profile does. Change the role in the profile.`)
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
    const dependents = this.store.accountsSigningInVia(account.id)
    if (dependents.length > 0) {
      throw new ApiError('in_use', `${dependents.map((a) => a.label).join(', ')} ${dependents.length === 1 ? 'signs' : 'sign'} in through ${account.label}. Remove ${dependents.length === 1 ? 'that account' : 'those accounts'} first.`)
    }
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

  /** Where the browser agent starts to register an account and the hosts it may work on. A platform with no web registration says where its accounts are made. */
  signUpTarget(account: Account): { url: string; hosts: string[] } {
    const preset = presetFor(account.platform)
    if (preset && preset.signupUrl === '') throw new ApiError('no_web_signup', preset.signupNote ?? `${preset.label} accounts are not made on the web.`)
    const target = this.signInTarget(account)
    return { url: preset ? parseBrowserUrl(preset.signupUrl) : target.url, hosts: target.hosts }
  }

  async openBrowser(args: { accountId: string; url?: string }): Promise<{ tabId: string }> {
    const account = this.account(args.accountId)
    const url = args.url !== undefined && args.url.trim() ? parseBrowserUrl(args.url) : parseBrowserUrl(this.defaultUrl(account))
    try {
      const result = await this.core.browser.openForUser(account, url)
      this.core.log.info('accounts', `A browser window of ${account.label} was opened on ${new URL(url).host}. It is one more window of the account's session: the AI keeps its own page, and the app never clicks or types in your window.`)
      this.core.events.changed('accounts')
      return result
    } catch (error) {
      throw browserError(error, { code: 'open_failed', message: (reason) => `Could not open the browser: ${reason}` })
    }
  }

  /**
   * "Open browser" from a place where a channel is chosen or shown (DEC-028): the typed address when it reads as a channel of the account's
   * platform, else the page of the platform where channels are found. The owner looks around there, signed in as the account.
   */
  async browseChannels(args: { accountId: string; address?: string }): Promise<{ tabId: string }> {
    const account = this.account(args.accountId)
    return this.openBrowser({ accountId: account.id, url: this.browseTarget(account, args.address) })
  }

  private browseTarget(account: Account, address: string | undefined): string {
    const typed = address?.trim() ?? ''
    const preset = presetFor(account.platform)
    const connector = this.connectorFor(account)
    if (typed && connector) {
      try {
        const normalized = connector.normalizeTarget(preset ? expandHandle(preset, typed) : typed)
        if (normalized.url && (!preset || addressOnPlatform(preset, normalized.url))) return normalized.url
      } catch {
        // Not an address of this platform: the page where channels are found is opened instead.
      }
    }
    const browse = preset?.browseUrl || connector?.channelGuide?.().browseUrl || ''
    if (browse) return browse
    throw new ApiError(
      'no_browse_url',
      typed
        ? `"${typed}" is not an address of a page. Type the full address of the site, for example https://forum.example.com/c/general.`
        : 'Type the address of the site first: this kind of account has no page of its own where channels are found.'
    )
  }

  /**
   * The address of the page the owner was last on in their windows of the account, for "Use the page I'm on" (DEC-028, DEC-038). Only while
   * the owner has a window open, and only the address (no query, no fragment) and the title: the page itself is not read, and nothing is stored.
   * Null when no window is open; refused when the browser cannot tell which of several pages the owner is on.
   */
  async currentPage(accountId: unknown): Promise<{ url: string; title: string; trimmed: boolean } | null> {
    const account = this.account(accountId)
    if (!hasOpenUserWindow(this.core.browser, account) || typeof this.core.browser.ownerPage !== 'function') return null
    const page = await this.core.browser.ownerPage(account).catch((error: unknown) => {
      // The reason may carry an address: only that it failed is written down.
      this.core.log.warn('accounts', `The address of the page open in the browser of ${account.label} could not be read (${error instanceof Error ? error.name : 'error'}).`)
      throw new ApiError('read_failed', 'The address of the page could not be read. Try again in a moment.')
    })
    if (!page) return null
    if ((page.tabs ?? 1) > 1) {
      throw new ApiError('several_tabs', 'Several tabs are open in this browser and the app cannot tell which one you are on. Close the others, keep the page you want, and try again.')
    }
    const url = publicAddress(page.url)
    if (!url) throw new ApiError('not_a_page', 'The page open now is not a web page (a web address starts with http or https). Open the page of the channel and try again.')
    this.core.log.info('accounts', `The address of the page open in the browser of ${account.label} was taken (${new URL(url).host}) because you asked for it.`)
    return { url, title: page.title.slice(0, 200), trimmed: new URL(page.url).href !== url }
  }

  /**
   * The owner takes the AI's OWN page to finish something in it (a CAPTCHA, a question of the AI): the AI stops using it until control is given
   * back, and the page is shown in front. This is the only thing that stops the AI; opening a window of the owner's does not (DEC-038).
   */
  takeControl(accountId: unknown): void {
    const account = this.account(accountId)
    this.core.browser.session(account).takeControl()
    this.core.browser.showAgentBrowser?.(account, true)
    this.core.log.info('accounts', `You took control of the AI's page of ${account.label}; the AI stopped using it.`)
    this.core.events.changed('accounts')
  }

  /** Gives the AI's page back to the app. Windows the owner opened are theirs and stay open. */
  releaseControl(accountId: unknown): void {
    const account = this.account(accountId)
    this.core.browser.session(account).releaseControl()
    this.core.log.info('accounts', `Control of the AI's page of ${account.label} returned to the app.`)
    this.core.events.changed('accounts')
  }

  /** Whether the owner took control of the AI's page (`holder` is "user" then), and whether a window of the owner's is open. */
  browserState(accountId: unknown): BrowserState {
    const account = this.account(accountId)
    return { holder: this.core.browser.session(account).control().holder, windowOpen: hasOpenUserWindow(this.core.browser, account), chromeFound: this.core.browser.chromeFound?.() ?? false }
  }

  /** What the page of the account shows and did, taken now because the owner asked (DEC-016). `null`: nothing is open. */
  async pageReport(accountId: unknown): Promise<PageReport | null> {
    const account = this.account(accountId)
    const observer = observe(this.core.browser)
    if (typeof observer.pageReport !== 'function') return null
    try {
      const report = await observer.pageReport(account)
      if (report) this.core.log.info('accounts', `Page report of ${account.label} (${report.address}): ${report.alerts.length} message(s) on the page, ${report.requests.length} request(s) noted, ${report.consoleErrors.length} console error(s).${report.savedAs ? ` Saved as ${report.savedAs}.` : ''}`)
      return report
    } catch (error) {
      throw browserError(error, { code: 'page_report_failed', message: (reason) => `Could not read the page: ${reason}` })
    }
  }

  /** A request of the account's page failed or was refused: one short line, so a silent refusal by a site shows up in the log. */
  private pageNote(accountId: string, note: string): void {
    let label = accountId
    try {
      label = this.account(accountId).label
    } catch {
      // The account is gone; the note still helps.
    }
    this.core.log.info('accounts', `Page of ${label}: ${note}`)
  }

  /** Brings the open window to the front (the main window is usually on top of it and hides it). */
  showBrowser(accountId: unknown): { shown: boolean } {
    return { shown: showUserWindow(this.core.browser, this.account(accountId)) }
  }

  /** The owner's first window opened or their last one closed: the screen follows, and a closed last window means the owner is done on the site. */
  private userWindowChanged(accountId: string, change: 'opened' | 'closed'): void {
    this.core.events.changed('accounts')
    if (change === 'closed') void this.checkAfterWindow(accountId)
  }

  /**
   * The owner closed their last window of the account: the sign-in is checked once, so nobody has to press "Check sign-in". Only a look: a saved
   * password is not tried here, the owner may just have closed the window on purpose. Not while the AI works on the account: the check goes
   * through the AI's own page and would take it away from the form the AI is filling in (DEC-038); a mission that is refused after the owner
   * used a sign-in page reads the sign-in itself when it ends.
   */
  private async checkAfterWindow(accountId: string): Promise<void> {
    try {
      const account = this.account(accountId)
      const connector = this.connectorFor(account)
      if (!connector) return
      if (this.core.services.agent?.working(account.id)) return
      this.applyLogin(account, await connector.checkLogin(this.probeContext(account, connector)), { signInAgain: false })
    } catch (error) {
      // The account may have been removed with its window open, or the app may be busy with it: nothing to report.
      if (!(error instanceof ApiError) && !(error instanceof TakeoverError)) {
        this.core.log.warn('accounts', `Could not check the sign-in after the browser window was closed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
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
      lookedBackAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      nextCheckAt: null,
      plan: null,
      reads: true,
      createdAt: this.core.clock.now().toISOString()
    }
  }

  /** Checks whether the account is signed in and records status and confirmed identity. */
  /** `signInAgain: false`: a check that is part of something else (an AI mission) must not start the automatic sign-in on its own. */
  async checkLogin(accountId: unknown, options: { signInAgain?: boolean } = {}): Promise<Account> {
    const account = this.account(accountId)
    const connector = this.connectorFor(account)
    if (!connector) throw new ApiError('no_connector', `No connector is available for ${account.platform}.`)
    const ctx = this.probeContext(account, connector)
    try {
      const state = await connector.checkLogin(ctx)
      return this.applyLogin(account, state, options)
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
  applyLogin(account: Account, state: Parameters<typeof loginOutcome>[0], options: { signInAgain?: boolean } = {}): Account {
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
    if (updated.status === 'login_required' && options.signInAgain !== false) this.onSignedOut?.(updated)
    return updated
  }
}
