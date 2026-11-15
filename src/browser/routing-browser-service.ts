// Which browser serves which account (DEC-026): the core sees one browser service; each account is served by the internal browser or by the
// owner's installed Chrome, as the account says (`Account.browser`, internal by default). The choice is read at every call, so it takes effect
// the moment the owner changes it; the browser the account leaves is let go by `releaseAccount` first (the core does that), so an account has
// one live browser at a time. Everything the core asks goes to the browser that serves the account.

import type { Account, PageReport } from '../shared/types'
import type { BrowserService, BrowserSession, OwnerPage, PageObserver } from '../core/ports'
import { chooseBrowser } from './browser-choice'

/** What a browser service of this application offers: the contract, and the optional parts of it every one of them has. */
export interface FullBrowserService extends BrowserService, PageObserver {
  showAgentBrowser(account: Account, focus?: boolean): void
  hasUserWindow(account: Account): boolean
  showUserWindow(account: Account): boolean
  closeUserWindow(account: Account): void
  forgetAccount(account: Account): Promise<void>
  releaseAccount?(account: Account): Promise<void>
  ownerPage?(account: Account): Promise<OwnerPage | null>
}

export class RoutingBrowserService implements FullBrowserService {
  private listener: ((accountId: string, change: 'opened' | 'closed') => void) | undefined
  private noter: ((accountId: string, note: string) => void) | undefined

  constructor(
    private readonly internal: FullBrowserService,
    private readonly chrome: FullBrowserService,
    private readonly options: { chromeFound: () => boolean; env?: NodeJS.ProcessEnv }
  ) {}

  /** Set by the core: what both services report goes to the same place. */
  set onUserWindowChange(listener: ((accountId: string, change: 'opened' | 'closed') => void) | undefined) {
    this.listener = listener
    this.internal.onUserWindowChange = listener
    this.chrome.onUserWindowChange = listener
  }
  get onUserWindowChange(): ((accountId: string, change: 'opened' | 'closed') => void) | undefined {
    return this.listener
  }

  set onPageNote(noter: ((accountId: string, note: string) => void) | undefined) {
    this.noter = noter
    this.internal.onPageNote = noter
    this.chrome.onPageNote = noter
  }
  get onPageNote(): ((accountId: string, note: string) => void) | undefined {
    return this.noter
  }

  /** The service for an account: the one its setting names (or PPD_BROWSER forces). */
  private serving(account: Account): FullBrowserService {
    return chooseBrowser(account.browser, (this.options.env ?? process.env).PPD_BROWSER) === 'chrome' ? this.chrome : this.internal
  }

  chromeFound(): boolean {
    return this.options.chromeFound()
  }

  session(account: Account): BrowserSession {
    return this.serving(account).session(account)
  }
  openForUser(account: Account, url?: string): Promise<{ tabId: string }> {
    return this.serving(account).openForUser(account, url)
  }
  showAgentBrowser(account: Account, focus?: boolean): void {
    this.serving(account).showAgentBrowser(account, focus)
  }
  hasUserWindow(account: Account): boolean {
    return this.serving(account).hasUserWindow(account)
  }
  showUserWindow(account: Account): boolean {
    return this.serving(account).showUserWindow(account)
  }
  closeUserWindow(account: Account): void {
    this.serving(account).closeUserWindow(account)
  }
  pageReport(account: Account): Promise<PageReport | null> {
    return this.serving(account).pageReport(account)
  }
  async ownerPage(account: Account): Promise<OwnerPage | null> {
    return (await this.serving(account).ownerPage?.(account)) ?? null
  }

  /** The account is about to move to the other browser: `account` is still the one with the old setting, so this lets go of the browser it leaves. */
  async releaseAccount(account: Account): Promise<void> {
    await this.serving(account).releaseAccount?.(account)
  }

  /** The account is deleted: its sessions are wiped wherever they are. The other browser may hold an old one from before a switch, so both are asked. */
  async forgetAccount(account: Account): Promise<void> {
    const serving = this.serving(account)
    const other = serving === this.chrome ? this.internal : this.chrome
    // Both are tried whatever happens to the first, and a failure is passed on: the account is kept so that the owner can retry, rather than
    // deleted with a profile (cookies) left on disk that nothing points to any more.
    const failures: unknown[] = []
    for (const service of [serving, other]) {
      try {
        await service.forgetAccount(account)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw failures[0]
  }
}
