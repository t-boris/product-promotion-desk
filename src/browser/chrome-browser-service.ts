// The browser service that works in the owner's installed Google Chrome (DEC-025), the same contract as the built-in one (REQ-002, REQ-004, DEC-038).
//
//  - one Chrome profile folder for each account, inside the application's data folder, and exactly one ControlledSession for each account, so
//    every channel and product sharing the account is serialized through the same object (as in the built-in service);
//  - the AI works in a page it opened itself, in a window of its own, through the application's tools only. The owner's windows are other
//    windows of the same Chrome profile (the same session): "Open browser" opens one more, any page the owner opens themselves is theirs, and
//    the AI never drives a page it did not create. Opening a window takes nothing from the AI and nobody waits. Only an explicit take-over of the
//    AI's own page stops it (ControlledSession);
//  - an owner page that goes to a sign-in, sign-out or account-switch address tells the session (`noteIdentityActivity`);
//  - Chrome is started when the account's page is first needed and ends when the application does (a pipe, no network port).
//
// Nothing here is Electron's: the page is a puppeteer page. The rules of the core (send ticket, takeover, hosts) are in the core.

import { mkdir, rm } from 'node:fs/promises'
import type { Browser, ConsoleMessage, HTTPRequest, Page, Target } from 'puppeteer-core'
import type { Account, PageReport } from '../shared/types'
import { ControlledSession } from '../core/browser-session'
import type { BrowserService, BrowserSession, OwnerPage, PageObserver, TicketVerifier } from '../core/ports'
import { isSessionAddress } from '../core/session-address'
import { ChromeRawPage, type ChromeHandle } from './chrome-page'
import { chromeArguments, findChrome, isProfileDir, launchChrome, profileDirFor, profilesRoot, type LaunchChrome } from './chrome-launcher'
import { pageReadingScript, type PageReading } from './page-scripts'
import { PageRecorder } from './page-recorder'
import { addressOf, forgetReports, saveReport, withoutQueries } from './page-report'
import { normalizeBrowserUrl } from './targets'

/** What a session says that was kept somewhere after its account was let go of. */
const RETIRED = 'The browser of this account was changed (or the account was removed), so this page is not used any more.'

/** The width of the picture kept in a report: the same as the built-in browser's. */
const REPORT_PICTURE_WIDTH = 1000

/** The kinds of request an owner's page makes in the background that can sign an account out or in (a fetch, a form post, a beacon). */
const BACKGROUND_KINDS = new Set(['xhr', 'ping', 'other', 'subFrame'])

/**
 * The one script that ever runs in an owner's tab (DEC-038): a fixed, read-only expression that asks whether the tab is showing and has the
 * keyboard focus. It runs only when the owner has more than one page open and presses "Use the page I'm on", and nothing of the page is read.
 */
export const OWNER_TAB_PROBE = '({ visible: document.visibilityState === "visible", focused: document.hasFocus() })'

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
  /** The AI's pages that are open now: one for each running task and each call. Each is a window of its own in the account's Chrome. */
  agentRaw: Set<ChromeRawPage>
  recorder: PageRecorder
  profileDir: string
  browser: Browser | null
  /** Chrome being started now: two callers that arrive together share the one start (a second Chrome on the same profile would hand over to the first and exit). */
  starting: Promise<Browser> | null
  /** The AI's own pages: the one it opened, and the pop-ups that page opened. The AI drives these and nothing else. */
  agentPages: Set<Page>
  /** The owner's pages: the windows opened for them, the tabs they opened, and the pop-ups of those. The AI never drives these. */
  ownerPages: Set<Page>
  /** The last owner page opened for them or brought to the front for them. */
  lastOwnerPage: Page | null
  /** The page Chrome started with: the first of the AI and the owner to need a page takes it, the other opens a window of its own. */
  initial: Page | null
  /** How many pages this service is creating just now: a page that appears meanwhile is registered by its creator, not guessed at. */
  creating: number
  watched: WeakSet<Page>
  /** Set when the account was let go of (it moved to the other browser, or was erased): a session that is still held somewhere never starts Chrome again. */
  retired: boolean
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
    const entry: AccountChrome = {
      agentRaw: new Set(),
      profileDir: profileDirFor(this.options.dataDir, account.partition),
      browser: null,
      starting: null,
      agentPages: new Set(),
      ownerPages: new Set(),
      lastOwnerPage: null,
      initial: null,
      creating: 0,
      watched: new WeakSet(),
      retired: false,
      recorder: new PageRecorder(
        () => Date.now(),
        () => this.pageHost(entry),
        (note) => this.onPageNote?.(account.id, note)
      ),
      session: new ControlledSession(account.id, async () => this.newAgentPage(account, entry), this.tickets)
    }
    this.accounts.set(account.id, entry)
    return entry
  }

  /** A page for one call or one mission of the AI: Chrome opens its window when the page is first used, and the window is closed with it. */
  private newAgentPage(account: Account, entry: AccountChrome): ChromeRawPage {
    const page: ChromeRawPage = new ChromeRawPage(
      () => this.openPage(account, entry),
      () => entry.agentRaw.delete(page)
    )
    entry.agentRaw.add(page)
    return page
  }

  /** The AI page that was made last and is open: where the AI is looking now. */
  private latestAgent(entry: AccountChrome): ChromeRawPage | null {
    return [...entry.agentRaw].reverse().find((page) => page.existing() !== null) ?? null
  }

  /**
   * The AI works in the account's own Chrome and the owner watches (DEC-018): brings the windows of the AI's open tasks to the front, for the
   * moment the owner has to act in the page the AI is waiting on (a CAPTCHA, a code). A window opens by itself behind the owner's (`task.show`).
   */
  showAgentBrowser(account: Account, focus = false): void {
    this.entry(account)
      .session.revealTasks(focus)
      .catch((error: unknown) => this.onPageNote?.(account.id, `Chrome could not be shown: ${withoutQueries(error instanceof Error ? error.message : String(error))}`))
  }

  /**
   * One more window of the account's Chrome profile for the owner (DEC-038). A window that already shows exactly this address is brought to the
   * front instead. The AI's page is not touched and nothing waits. The core is told when the first window opens.
   */
  async openForUser(account: Account, url?: string): Promise<{ tabId: string }> {
    const entry = this.entry(account)
    const target = normalizeBrowserUrl(url ?? this.latestAgent(entry)?.currentUrl() ?? '')
    const tabId = `account-${account.id}`

    const same = this.openOwnerPages(entry).find((page) => page.url() === target)
    if (same) {
      entry.lastOwnerPage = same
      await same.bringToFront().catch(() => undefined)
      return { tabId }
    }

    const browser = await this.running(account, entry)
    const first = this.openOwnerPages(entry).length === 0
    entry.creating += 1
    let page: Page
    try {
      page = this.takeInitial(entry) ?? (await browser.newPage({ type: 'window' }))
      this.adoptOwner(account, entry, page)
    } finally {
      entry.creating -= 1
    }
    entry.lastOwnerPage = page
    // The address counts from the moment the owner asked for it, before the page has loaded anything.
    this.ownerAddress(entry, target, 'page')
    // A page that is slow to load is not a failure to open: the owner sees it in the window.
    await page.goto(target).catch((error: unknown) => this.onPageNote?.(account.id, `Chrome could not load the page: ${withoutQueries(error instanceof Error ? error.message : String(error))}`))
    await page.bringToFront().catch(() => undefined)
    if (first) this.onUserWindowChange?.(account.id, 'opened')
    return { tabId }
  }

  /** The page Chrome started with, when nobody has taken it and it is still open. */
  private takeInitial(entry: AccountChrome): Page | null {
    const page = entry.initial
    entry.initial = null
    return page && !page.isClosed() ? page : null
  }

  /** The owner's pages that are open. */
  private openOwnerPages(entry: AccountChrome): Page[] {
    return [...entry.ownerPages].filter((page) => !page.isClosed())
  }

  /** An address one of the owner's pages went to or asked for; the AI's own page never reports here. */
  private ownerAddress(entry: AccountChrome, address: string, use: 'page' | 'request'): void {
    if (isSessionAddress(address, use)) entry.session.noteIdentityActivity()
  }

  /** Makes `page` one of the owner's: listens to where it goes, and tells the core when the last of them is closed. */
  private adoptOwner(account: Account, entry: AccountChrome, page: Page): void {
    if (entry.ownerPages.has(page) || entry.agentPages.has(page)) return
    entry.ownerPages.add(page)
    if (entry.lastOwnerPage === null) entry.lastOwnerPage = page
    if (!entry.watched.has(page)) {
      entry.watched.add(page)
      this.record(entry, page)
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) this.ownerAddress(entry, frame.url(), 'page')
      })
      page.on('request', (request) => {
        if (BACKGROUND_KINDS.has(this.kindOf(page, request))) this.ownerAddress(entry, request.url(), 'request')
      })
      // A page the owner's page opened is the owner's too.
      page.on('popup', (popup) => {
        if (popup) this.adoptOwner(account, entry, popup)
      })
      page.on('close', () => this.ownerPageClosed(account, entry, page))
    }
    // Where the page is now counts too: a page adopted after it was already on a sign-in address.
    this.ownerAddress(entry, page.url(), 'page')
  }

  private ownerPageClosed(account: Account, entry: AccountChrome, page: Page): void {
    if (!entry.ownerPages.delete(page)) return
    if (entry.lastOwnerPage === page) entry.lastOwnerPage = this.openOwnerPages(entry).at(-1) ?? null
    if (entry.ownerPages.size === 0 && !entry.retired) this.onUserWindowChange?.(account.id, 'closed')
  }

  /**
   * Whether a page that appeared is the AI's (a pop-up of its page) or the owner's (everything else: a window opened for them, a tab they opened
   * themselves, a pop-up of those). The page Chrome started with is not decided here: whoever needs a page first takes it.
   */
  private async classify(account: Account, entry: AccountChrome, target: Target): Promise<void> {
    if (target.type() !== 'page' || entry.retired) return
    const page = await target.page().catch(() => null)
    if (!page || page.isClosed() || entry.agentPages.has(page) || entry.ownerPages.has(page) || page === entry.initial) return
    const opener = target.opener()
    const openerPage = opener ? await opener.page().catch(() => null) : null
    if (openerPage && entry.agentPages.has(openerPage)) {
      entry.agentPages.add(page)
      return
    }
    this.adoptOwner(account, entry, page)
  }

  /** Looks at every page of the browser once, for the ones that appeared while this service was creating a page itself. */
  private async reconcile(account: Account, entry: AccountChrome): Promise<void> {
    const browser = entry.browser
    if (!browser?.connected) return
    for (const page of await browser.pages()) {
      if (!page.isClosed()) await this.classify(account, entry, page.target())
    }
  }

  /**
   * The address and title of the page the owner is on, from the browser's own record of the tab (DEC-028, DEC-038). With one owner page there is
   * no doubt. With several, one fixed read-only expression (OWNER_TAB_PROBE) asks each whether it is showing and has the keyboard focus; the
   * answer is used when exactly one is showing, or exactly one has the focus. Otherwise nobody can tell which one the owner is on: `tabs`
   * says how many, and the core refuses to guess.
   */
  async ownerPage(account: Account): Promise<OwnerPage | null> {
    const entry = this.accounts.get(account.id)
    if (!entry) return null
    await this.reconcile(account, entry).catch(() => undefined)
    const pages = this.openOwnerPages(entry)
    if (pages.length === 0) return null
    const chosen = pages.length === 1 ? pages[0] : await this.pickOwnerPage(pages)
    if (!chosen) return { url: '', title: '', tabs: pages.length }
    return { url: chosen.url(), title: (await this.titleOf(chosen)) ?? '' }
  }

  /** The page of several that the owner is on, or null when the browser cannot say. */
  private async pickOwnerPage(pages: Page[]): Promise<Page | null> {
    const seen: Array<{ page: Page; visible: boolean; focused: boolean }> = []
    for (const page of pages) {
      const answer = await this.evaluateOn(page, OWNER_TAB_PROBE).catch(() => null)
      const { visible, focused } = (answer ?? {}) as { visible?: unknown; focused?: unknown }
      seen.push({ page, visible: visible === true, focused: focused === true })
    }
    return chooseOwnerPage(seen)
  }

  /** Runs a script in a page through a DevTools session of its own, as the page's own code and not as a user's gesture; the session is closed again. */
  private async evaluateOn(page: Page, expression: string): Promise<unknown> {
    const cdp = await page.createCDPSession()
    try {
      const reply = (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: false })) as { result?: { value?: unknown }; exceptionDetails?: unknown }
      if (reply.exceptionDetails) throw new Error('The page script failed')
      return reply.result?.value
    } finally {
      await cdp.detach().catch(() => undefined)
    }
  }

  /** The title Chrome records for the tab: no script runs in the page. */
  private async titleOf(page: Page): Promise<string | null> {
    const cdp = await page.createCDPSession().catch(() => null)
    if (!cdp) return null
    try {
      const info = (await cdp.send('Target.getTargetInfo')) as { targetInfo?: { title?: string } }
      return info.targetInfo?.title ?? null
    } catch {
      return null
    } finally {
      await cdp.detach().catch(() => undefined)
    }
  }

  /** True while the owner has a window or a tab of this account's Chrome open. */
  hasUserWindow(account: Account): boolean {
    const entry = this.accounts.get(account.id)
    return entry !== undefined && this.openOwnerPages(entry).length > 0
  }

  /** Brings the owner's page last used to the front. False when the owner has none open. */
  showUserWindow(account: Account): boolean {
    const entry = this.accounts.get(account.id)
    if (!entry) return false
    const open = this.openOwnerPages(entry)
    const page = entry.lastOwnerPage && !entry.lastOwnerPage.isClosed() ? entry.lastOwnerPage : open.at(-1)
    if (!page) return false
    page.bringToFront().catch(() => undefined)
    return true
  }

  /** Closes every page of the owner's on the account (the AI's page stays). */
  closeUserWindow(account: Account): void {
    const entry = this.accounts.get(account.id)
    for (const page of entry ? this.openOwnerPages(entry) : []) void page.close().catch(() => undefined)
  }

  private pageHost(entry: AccountChrome): string {
    try {
      const owner = entry.lastOwnerPage && !entry.lastOwnerPage.isClosed() ? entry.lastOwnerPage.url() : null
      return new URL(owner ?? this.latestAgent(entry)?.currentUrl() ?? '').host
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
    if (!entry) return null
    const owners = this.openOwnerPages(entry)
    let page: Page | null
    let where: PageReport['where']
    if (owners.length > 0) {
      // The owner's window is what they are looking at; among several, the one they are on when that can be told, else the last one opened for them.
      page = owners.length === 1 ? (owners[0] ?? null) : ((await this.pickOwnerPage(owners)) ?? entry.lastOwnerPage ?? owners.at(-1) ?? null)
      where = 'owner_window'
    } else {
      page = this.latestAgent(entry)?.existing()?.page ?? null
      where = 'app_page'
    }
    if (!page) return null
    const shown = page
    const agent = where === 'owner_window' ? null : this.latestAgent(entry)
    const read = <T>(script: string): Promise<T> => (agent ? agent.read<T>(script) : (this.evaluateOn(shown, script) as Promise<T>))
    const reading = await read<PageReading>(pageReadingScript()).catch(() => null)
    const png = await this.picture(read, shown, undefined)
    const small = png ? await this.picture(read, shown, REPORT_PICTURE_WIDTH) : null
    const report: PageReport = {
      takenAt: new Date().toISOString(),
      where,
      address: addressOf(shown.url()),
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
  private async picture(read: <T>(script: string) => Promise<T>, page: Page, width: number | undefined): Promise<Buffer | null> {
    try {
      if (width !== undefined) {
        const [innerWidth, innerHeight] = await read<[number, number]>('[window.innerWidth, window.innerHeight]')
        if (innerWidth <= width) return await this.picture(read, page, undefined)
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
    entry.retired = true
    entry.ownerPages.clear()
    entry.agentPages.clear()
    entry.lastOwnerPage = null
    this.accounts.delete(account.id)
    await Promise.all([...entry.agentRaw].map((page) => page.dispose()))
    await entry.browser?.close().catch(() => undefined)
    entry.browser = null
  }

  /**
   * Opens the AI's own page: in a window of its own, behind the owner's (nothing is brought to the front), and never one of the owner's pages.
   * Starts Chrome when it is not running; the page Chrome started with is the AI's when the owner has not taken it.
   */
  private async openPage(account: Account, entry: AccountChrome): Promise<ChromeHandle> {
    const browser = await this.running(account, entry)
    entry.creating += 1
    let page: Page
    try {
      page = this.takeInitial(entry) ?? (await browser.newPage({ type: 'window', background: true }))
      entry.agentPages.add(page)
    } finally {
      entry.creating -= 1
    }
    // A page the AI's page opens (a sign-in pop-up) is the AI's own, to be driven by it.
    page.on('popup', (popup) => {
      if (popup) entry.agentPages.add(popup)
    })
    const cdp = await page.createCDPSession()
    this.record(entry, page)
    const windowId = async (): Promise<number> => ((await cdp.send('Browser.getWindowForTarget')) as { windowId: number }).windowId
    const handle: ChromeHandle = {
      page,
      cdp,
      isAlive: () => !page.isClosed() && browser.connected,
      dispose: async () => {
        entry.agentPages.delete(page)
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

  private running(account: Account, entry: AccountChrome): Promise<Browser> {
    if (entry.retired) return Promise.reject(new Error(RETIRED))
    if (entry.browser?.connected) return Promise.resolve(entry.browser)
    entry.starting ??= this.start(account, entry).finally(() => {
      entry.starting = null
    })
    return entry.starting
  }

  private async start(account: Account, entry: AccountChrome): Promise<Browser> {
    const executable = this.find()
    if (!executable) throw new Error('Google Chrome was not found on this Mac.')
    await mkdir(profilesRoot(this.options.dataDir), { recursive: true })
    const browser = await this.launch(executable, chromeArguments(entry.profileDir, this.env))
    if (entry.retired) {
      // The account was let go of while Chrome was starting: this Chrome is nobody's.
      await browser.close().catch(() => undefined)
      throw new Error(RETIRED)
    }
    entry.browser = browser
    entry.initial = (await browser.pages().catch(() => [])).find((page) => !page.isClosed()) ?? null
    // A page that appears without this service creating it: the owner opened a tab (or a page of theirs opened one), or the AI's page opened a pop-up.
    browser.on('targetcreated', (target) => {
      if (entry.creating === 0) void this.classify(account, entry, target)
    })
    browser.on('disconnected', () => {
      // The owner quit Chrome (or it crashed): every window of theirs is gone with it, and the next use starts a new one.
      if (entry.browser === browser) entry.browser = null
      const had = entry.ownerPages.size > 0
      entry.ownerPages.clear()
      entry.agentPages.clear()
      entry.lastOwnerPage = null
      entry.initial = null
      if (had && !entry.retired) this.onUserWindowChange?.(account.id, 'closed')
    })
    return browser
  }

  /** Feeds what a page did to the recorder (DEC-016). */
  private record(entry: AccountChrome, page: Page): void {
    page.on('response', (response) => {
      const request = response.request()
      entry.recorder.completed({ method: request.method(), resourceType: this.kindOf(page, request), url: response.url(), statusCode: response.status() })
    })
    page.on('requestfailed', (request) => {
      entry.recorder.failed({ method: request.method(), resourceType: this.kindOf(page, request), url: request.url(), error: request.failure()?.errorText })
    })
    page.on('console', (message: ConsoleMessage) => entry.recorder.logged(consoleLevel(message.type()), message.text()))
  }

  private kindOf(page: Page, request: HTTPRequest): string {
    return requestKind(request.resourceType(), request.frame() === page.mainFrame())
  }
}

/**
 * The owner's page among several that were each asked whether they are showing and have the keyboard focus (DEC-038), or null when that does
 * not settle it: exactly one is showing, else exactly one has the focus. Pure.
 */
export function chooseOwnerPage<T>(seen: Array<{ page: T; visible: boolean; focused: boolean }>): T | null {
  const showing = seen.filter((candidate) => candidate.visible)
  if (showing.length === 1) return showing[0]?.page ?? null
  const focused = seen.filter((candidate) => candidate.focused)
  return focused.length === 1 ? (focused[0]?.page ?? null) : null
}
