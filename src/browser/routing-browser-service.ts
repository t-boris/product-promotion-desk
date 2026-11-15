// Which browser serves which account (DEC-025): the core sees one browser service; each account is served by the built-in browser or by the
// owner's installed Chrome, by its platform (browser-choice.ts). The choice is made once for an account while the application runs, so an
// account is never served by two browsers at the same time, and everything the core asks goes to the one that serves it.

import type { Account, PageReport } from '../shared/types'
import type { BrowserService, BrowserSession, PageObserver } from '../core/ports'
import { chooseBrowser, type BrowserKind } from './browser-choice'

/** What a browser service of this application offers: the contract, and the optional parts of it every one of them has. */
export interface FullBrowserService extends BrowserService, PageObserver {
  showAgentBrowser(account: Account, focus?: boolean): void
  hasUserWindow(account: Account): boolean
  showUserWindow(account: Account): boolean
  closeUserWindow(account: Account): void
  forgetAccount(account: Account): Promise<void>
}

export class RoutingBrowserService implements FullBrowserService {
  private readonly chosen = new Map<string, BrowserKind>()
  private listener: ((accountId: string, change: 'opened' | 'closed') => void) | undefined
  private noter: ((accountId: string, note: string) => void) | undefined

  constructor(
    private readonly app: FullBrowserService,
    private readonly chrome: FullBrowserService,
    private readonly options: { chromeFound: () => boolean; env?: NodeJS.ProcessEnv }
  ) {}

  /** Set by the core: what both services report goes to the same place. */
  set onUserWindowChange(listener: ((accountId: string, change: 'opened' | 'closed') => void) | undefined) {
    this.listener = listener
    this.app.onUserWindowChange = listener
    this.chrome.onUserWindowChange = listener
  }
  get onUserWindowChange(): ((accountId: string, change: 'opened' | 'closed') => void) | undefined {
    return this.listener
  }

  set onPageNote(noter: ((accountId: string, note: string) => void) | undefined) {
    this.noter = noter
    this.app.onPageNote = noter
    this.chrome.onPageNote = noter
  }
  get onPageNote(): ((accountId: string, note: string) => void) | undefined {
    return this.noter
  }

  /** The service for an account, chosen on first use; a choice that is not what the platform asks for is said once. */
  private serving(account: Account): FullBrowserService {
    let kind = this.chosen.get(account.id)
    if (kind === undefined) {
      const choice = chooseBrowser(account.platform, (this.options.env ?? process.env).PPD_BROWSER, this.options.chromeFound())
      kind = choice.kind
      this.chosen.set(account.id, kind)
      if (choice.note) this.noter?.(account.id, choice.note)
    }
    return kind === 'chrome' ? this.chrome : this.app
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

  /** The account is deleted: its sessions are wiped wherever they are. The other browser has none, so a failure there is not one. */
  async forgetAccount(account: Account): Promise<void> {
    const serving = this.serving(account)
    const other = serving === this.chrome ? this.app : this.chrome
    await serving.forgetAccount(account)
    await other.forgetAccount(account).catch(() => undefined)
    this.chosen.delete(account.id)
  }
}
