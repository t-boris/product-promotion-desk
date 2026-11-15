// The browser service that works in the owner's installed Google Chrome (DEC-025), the same contract as the built-in one (REQ-002, REQ-004).
//
//  - one Chrome profile folder for each account, inside the application's data folder, and exactly one ControlledSession for each account, so
//    every channel and product sharing the account is serialized through the same object (as in the built-in service);
//  - the AI works in the account's Chrome window through the application's tools only; the owner sees the same window and can type in it. Taking
//    control stops the AI at once (ControlledSession), "give it back" returns control;
//  - Chrome is started when the account's page is first needed and ends when the application does (a pipe, no network port).
//
// Nothing here is Electron's: the page is a puppeteer page. The rules of the core (send ticket, takeover, hosts) are in the core.

import { mkdir, rm } from 'node:fs/promises'
import type { Browser, ConsoleMessage, HTTPRequest, Page } from 'puppeteer-core'
import type { Account, PageReport } from '../shared/types'
import { ControlledSession } from '../core/browser-session'
import type { BrowserService, BrowserSession, PageObserver, TicketVerifier } from '../core/ports'
import { ChromeRawPage, type ChromeHandle } from './chrome-page'
import { chromeArguments, findChrome, isProfileDir, launchChrome, profileDirFor, profilesRoot, type LaunchChrome } from './chrome-launcher'
import { pageReadingScript, type PageReading } from './page-scripts'
import { PageRecorder } from './page-recorder'
import { addressOf, forgetReports, saveReport } from './page-report'
import { normalizeBrowserUrl } from './targets'
import { UserControl } from './toolbar-state'

/** The width of the picture kept in a report: the same as the built-in browser's. */
const REPORT_PICTURE_WIDTH = 1000

export interface ChromeServiceOptions {
  /** The application's data folder: the profiles of the accounts live in `chrome-profiles` inside it. */
  dataDir: string
  /** Where page reports are saved (DEC-016); without it they are only returned. */
  diagnosticsDir?: string
  /** For tests: where Chrome is, and how it is started. */
  find?: () => string | null
  launch?: LaunchChrome
  env?: NodeJS.ProcessEnv
}

interface AccountChrome {
  session: ControlledSession
  agent: ChromeRawPage
  recorder: PageRecorder
  profileDir: string
  browser: Browser | null
  /** Set while the owner holds the browser (they asked to open it); released by "give it back" or by closing the window. */
  control: UserControl | null
}

/** What a request is, in the words the page recorder knows. Pure: a document is the page itself or a frame in it. */
export function requestKind(resourceType: string, inMainFrame: boolean): string {
  if (resourceType === 'document') return inMainFrame ? 'mainFrame' : 'subFrame'
  return resourceType === 'fetch' ? 'xhr' : resourceType
}

/** Chrome says "warn" where the recorder knows "warning". */
export function consoleLevel(type: string): string {
  return type === 'warn' ? 'warning' : type
}

export class ChromeBrowserService implements BrowserService, PageObserver {
  private readonly accounts = new Map<string, AccountChrome>()
  /** Set by the core: the person's window for an account opened or closed. */
  onUserWindowChange?: (accountId: string, change: 'opened' | 'closed') => void
  /** Set by the core: a request of the page failed or was refused by the site. */
  onPageNote?: (accountId: string, note: string) => void
  private readonly find: () => string | null
  private readonly launch: LaunchChrome
  private readonly env: NodeJS.ProcessEnv

  constructor(
    private readonly tickets: TicketVerifier,
    private readonly options: ChromeServiceOptions
  ) {
    this.env = options.env ?? process.env
    this.find = options.find ?? (() => findChrome(this.env))
    this.launch = options.launch ?? launchChrome
  }

  session(account: Account): BrowserSession {
    return this.entry(account).session
  }

  private entry(account: Account): AccountChrome {
    const existing = this.accounts.get(account.id)
    if (existing) return existing
    const agent = new ChromeRawPage(() => this.openPage(account, entry))
    const entry: AccountChrome = {
      agent,
      profileDir: profileDirFor(this.options.dataDir, account.partition),
      browser: null,
      control: null,
      recorder: new PageRecorder(
        () => Date.now(),
        () => this.pageHost(entry),
        (note) => this.onPageNote?.(account.id, note)
      ),
      session: new ControlledSession(account.id, async () => agent, this.tickets)
    }
    this.accounts.set(account.id, entry)
    return entry
  }

  /**
   * The AI works in the account's own Chrome and the owner watches (DEC-018): shows the window without taking control. `focus` brings it
   * in front of the owner's windows, for the moment the owner has to act in the page the AI is waiting on (a CAPTCHA, a code).
   */
  showAgentBrowser(account: Account, focus = false): void {
    const entry = this.entry(account)
    entry.agent.reveal(focus).catch((error: unknown) => this.onPageNote?.(account.id, `Chrome could not be shown: ${error instanceof Error ? error.message : String(error)}`))
  }

  async openForUser(account: Account, url?: string): Promise<{ tabId: string }> {
    const entry = this.entry(account)
    const target = normalizeBrowserUrl(url ?? entry.agent.currentUrl() ?? '')
    const tabId = `account-${account.id}`
    const already = entry.control?.holdsControl === true
    if (!already) {
      // The agent stops interacting the moment the owner takes the browser, before the window is shown.
      const control = new UserControl(entry.session)
      control.begin()
      entry.control = control
    }
    try {
      await entry.agent.reveal(true)
    } catch (error) {
      // The window never opened, so nobody is told it closed: only the control that was taken is returned.
      this.giveBack(account.id, entry, false)
      throw error
    }
    if (entry.agent.currentUrl() !== target) {
      // A page that is slow to load is not a failure to open: the owner sees it in the window.
      await entry.agent.goto(target).catch((error: unknown) => this.onPageNote?.(account.id, `Chrome could not load the page: ${error instanceof Error ? error.message : String(error)}`))
    }
    if (!already) this.onUserWindowChange?.(account.id, 'opened')
    return { tabId }
  }

  /** True while the owner holds this account's browser. */
  hasUserWindow(account: Account): boolean {
    return this.accounts.get(account.id)?.control?.holdsControl === true
  }

  /** Brings the account's Chrome window to the front. False when the owner does not hold it. */
  showUserWindow(account: Account): boolean {
    const entry = this.accounts.get(account.id)
    if (!entry?.control?.holdsControl) return false
    entry.agent.reveal(true).catch(() => undefined)
    return true
  }

  /** Gives the browser back (the owner is done): control returns to the app and the screen follows. The Chrome window stays. */
  closeUserWindow(account: Account): void {
    const entry = this.accounts.get(account.id)
    if (entry) this.giveBack(account.id, entry)
  }

  /** Returns control once; true only for the call that did. `announce` is false when the window was never opened. */
  private giveBack(accountId: string, entry: AccountChrome, announce = true): boolean {
    const control = entry.control
    entry.control = null
    const released = control?.release() ?? false
    if (released && announce) this.onUserWindowChange?.(accountId, 'closed')
    return released
  }

  private pageHost(entry: AccountChrome): string {
    try {
      return new URL(entry.agent.currentUrl() ?? '').host
    } catch {
      return ''
    }
  }

  /**
   * What the account's page shows and did (DEC-016), taken when the owner asks: the readable text and the messages the site shows, a
   * screenshot, and the requests and console errors the page produced. Read-only: nothing is clicked or typed, and the value of a form
   * field is never read.
   */
  async pageReport(account: Account): Promise<PageReport | null> {
    const entry = this.accounts.get(account.id)
    const handle = entry?.agent.existing()
    if (!entry || !handle) return null
    const reading = await entry.agent.read<PageReading>(pageReadingScript()).catch(() => null)
    const png = await this.picture(entry, handle.page, undefined)
    const small = png ? await this.picture(entry, handle.page, REPORT_PICTURE_WIDTH) : null
    const report: PageReport = {
      takenAt: new Date().toISOString(),
      where: entry.control?.holdsControl ? 'owner_window' : 'app_page',
      address: addressOf(handle.page.url()),
      title: reading?.title ?? '',
      alerts: reading?.alerts ?? [],
      text: reading?.text ?? '',
      requests: entry.recorder.recentRequests(),
      consoleErrors: entry.recorder.consoleErrors(),
      screenshot: small ? `data:image/png;base64,${small.toString('base64')}` : null,
      savedAs: null
    }
    if (this.options.diagnosticsDir) report.savedAs = await saveReport(this.options.diagnosticsDir, account.id, report, png)
    return report
  }

  /** A picture of the visible part of the page, scaled to `width` when it is wider; null when it cannot be taken. */
  private async picture(entry: AccountChrome, page: Page, width: number | undefined): Promise<Buffer | null> {
    try {
      if (width !== undefined) {
        const [innerWidth, innerHeight] = await entry.agent.read<[number, number]>('[window.innerWidth, window.innerHeight]')
        if (innerWidth <= width) return await this.picture(entry, page, undefined)
        const bytes = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: innerWidth, height: innerHeight, scale: width / innerWidth } })
        return Buffer.from(bytes)
      }
      return Buffer.from(await page.screenshot({ type: 'png' }))
    } catch {
      return null
    }
  }

  /**
   * Called when an account is deleted: closes its Chrome and removes its profile folder (cookies, storage). Only a folder that is a profile
   * folder of this application is ever removed.
   */
  async forgetAccount(account: Account): Promise<void> {
    this.accounts.get(account.id)?.session.takeControl() // nothing may start on a session that is being erased
    await this.releaseAccount(account)
    if (this.options.diagnosticsDir) await forgetReports(this.options.diagnosticsDir, account.id)
    const dir = profileDirFor(this.options.dataDir, account.partition)
    if (isProfileDir(this.options.dataDir, dir)) await rm(dir, { recursive: true, force: true })
  }

  /** Whether Google Chrome is installed: what the account screen needs to offer it. */
  chromeFound(): boolean {
    return this.find() !== null
  }

  /** Lets go of the account's page and closes its Chrome, keeping the profile folder (the account moves to the other browser, or is being erased). */
  async releaseAccount(account: Account): Promise<void> {
    const entry = this.accounts.get(account.id)
    if (!entry) return
    entry.control = null
    this.accounts.delete(account.id)
    await entry.agent.dispose()
    await entry.browser?.close().catch(() => undefined)
    entry.browser = null
  }

  /** Opens the page of an account: starts Chrome when it is not running, otherwise opens a page in the running one. */
  private async openPage(account: Account, entry: AccountChrome): Promise<ChromeHandle> {
    const browser = await this.running(account, entry)
    const page = (await browser.pages()).find((candidate) => !candidate.isClosed()) ?? (await browser.newPage())
    const cdp = await page.createCDPSession()
    this.watch(account, entry, page)
    const windowId = async (): Promise<number> => ((await cdp.send('Browser.getWindowForTarget')) as { windowId: number }).windowId
    const handle: ChromeHandle = {
      page,
      cdp,
      isAlive: () => !page.isClosed() && browser.connected,
      dispose: async () => {
        if (!page.isClosed()) await page.close().catch(() => undefined)
      },
      showWindow: async (focus) => {
        await cdp.send('Browser.setWindowBounds', { windowId: await windowId(), bounds: { windowState: 'normal' } })
        if (focus) await page.bringToFront()
      },
      ensureShown: async () => {
        const id = await windowId()
        const { bounds } = (await cdp.send('Browser.getWindowBounds', { windowId: id })) as { bounds: { windowState?: string } }
        if (bounds.windowState === 'minimized') await cdp.send('Browser.setWindowBounds', { windowId: id, bounds: { windowState: 'normal' } })
      }
    }
    return handle
  }

  private async running(account: Account, entry: AccountChrome): Promise<Browser> {
    if (entry.browser?.connected) return entry.browser
    const executable = this.find()
    if (!executable) throw new Error('Google Chrome was not found on this Mac.')
    await mkdir(profilesRoot(this.options.dataDir), { recursive: true })
    const browser = await this.launch(executable, chromeArguments(entry.profileDir, this.env))
    entry.browser = browser
    browser.on('disconnected', () => {
      // The owner quit Chrome (or it crashed): whoever held the browser is done, and the next use starts a new one.
      if (entry.browser === browser) entry.browser = null
      this.giveBack(account.id, entry)
    })
    return browser
  }

  /** Feeds what the page did to the recorder (DEC-016); closing the page is the owner closing the window. */
  private watch(account: Account, entry: AccountChrome, page: Page): void {
    page.on('response', (response) => {
      const request = response.request()
      entry.recorder.completed({ method: request.method(), resourceType: this.kindOf(page, request), url: response.url(), statusCode: response.status() })
    })
    page.on('requestfailed', (request) => {
      entry.recorder.failed({ method: request.method(), resourceType: this.kindOf(page, request), url: request.url(), error: request.failure()?.errorText })
    })
    page.on('console', (message: ConsoleMessage) => entry.recorder.logged(consoleLevel(message.type()), message.text()))
    page.on('close', () => {
      // The owner closed the window they were working in: they are done.
      this.giveBack(account.id, entry)
    })
  }

  private kindOf(page: Page, request: HTTPRequest): string {
    return requestKind(request.resourceType(), request.frame() === page.mainFrame())
  }
}
