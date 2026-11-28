import { BaseWindow, session as electronSession, WebContentsView, type Session, type WebContents } from 'electron'
import type { Account, PageReport } from '../shared/types'
import { ControlledSession } from '../core/browser-session'
import type { BrowserService, BrowserSession, OwnerPage, PageObserver, TicketVerifier } from '../core/ports'
import { ElectronRawPage, type AgentSurface } from './agent-page'
import { pageReadingScript, type PageReading } from './page-scripts'
import { PageRecorder } from './page-recorder'
import { addressOf, forgetReports, saveReport } from './page-report'
import { isSessionAddress } from '../core/session-address'
import { cleanUserAgent, normalizeBrowserUrl, persistentPartition } from './targets'
import { UserBrowserWindow } from './user-window'

/** Size of the hidden agent window: sites lay out and test visibility against a real viewport, not 0 x 0. */
const AGENT_VIEWPORT = { width: 1280, height: 900 }

interface AccountBrowser {
  session: ControlledSession
  /** The AI's pages that are open now: one for each running task and each call, every one with a window of its own. They share the account's session. */
  agentPages: Set<ElectronRawPage>
  partition: string
  /** The owner's windows on the account's session (DEC-038): any number, none of them takes anything from the AI. */
  userWindows: Set<UserBrowserWindow>
  /** The one the owner used last: "Use the page I'm on" reads it. */
  lastUsed: UserBrowserWindow | null
  recorder: PageRecorder
}

/** What the network layer says about a request, as far as this service reads it. */
interface RequestDetails {
  url: string
  method: string
  resourceType?: string
  webContentsId?: number
}

/** The kinds of request an owner's window makes in the background that can sign an account out or in (a fetch, a form post, a beacon). */
const BACKGROUND_KINDS = new Set(['xhr', 'ping', 'other', 'subFrame'])

/**
 * The AI's page lives in a window of its own that the owner does not see until the AI is shown to them. A window that is not shown draws nothing, and a
 * page that draws on the client (Pinterest's sign-in page: no text and no redirect, for ever) never comes to life in it, so a check of the session
 * saw a blank page and called a signed-in account signed out. So the window is "shown" from the start but cannot be seen: fully transparent, passing
 * every mouse event through, taking no focus and out of Mission Control. A transparent window is not an occluded one: the page keeps drawing.
 */
function ghost(win: BaseWindow): void {
  win.setOpacity(0)
  win.setIgnoreMouseEvents(true)
  win.setFocusable(false)
  win.setHiddenInMissionControl(true)
  win.showInactive()
}

/** The window as the owner is meant to see it (the AI shown at work): opaque, in front of nothing it should not be in front of, and theirs to click. */
function seen(win: BaseWindow): void {
  win.setOpacity(1)
  win.setIgnoreMouseEvents(false)
  win.setFocusable(true)
  win.setHiddenInMissionControl(false)
  win.showInactive()
}

/**
 * Electron implementation of the browser service (REQ-002, REQ-004, DEC-038).
 *
 *  - one persistent session per account (`persist:` partition) and exactly one ControlledSession per account,
 *    so every channel and product sharing the account is serialized through the same object;
 *  - every call of the AI, and every mission, works in a WebContents of its own on that partition, in a window of its own that is closed when it is
 *    done; the owner gets as many separate windows on the same partition as they open, and none of them takes the browser from the AI (only an
 *    explicit take-over of the AI's own page does, in ControlledSession);
 *  - a window of the owner's that goes to a sign-in, sign-out or account-switch address tells the session (`noteIdentityActivity`), so a
 *    mission that checked who is signed in before knows that the check is out of date;
 *  - this is the only place besides src/main that imports Electron.
 */
export class ElectronBrowserService implements BrowserService, PageObserver {
  private readonly accounts = new Map<string, AccountBrowser>()
  private readonly configured = new Set<string>()
  /** Set by the core: the person's window for an account opened or closed. */
  onUserWindowChange?: (accountId: string, change: 'opened' | 'closed') => void
  /** Set by the core: a request of the page failed or was refused by the site. */
  onPageNote?: (accountId: string, note: string) => void
  private readonly recorders = new Map<string, PageRecorder>()
  /** The account of each partition, for the network layer, which knows a partition and a page, not an account. */
  private readonly owners = new Map<string, AccountBrowser>()

  /** `options.diagnosticsDir`: where page reports are saved (DEC-016); without it they are only returned. */
  constructor(
    private readonly tickets: TicketVerifier,
    private readonly options: { diagnosticsDir?: string } = {}
  ) {}

  session(account: Account): BrowserSession {
    return this.entry(account).session
  }

  private entry(account: Account): AccountBrowser {
    const existing = this.accounts.get(account.id)
    if (existing) return existing
    const partition = persistentPartition(account.partition)
    const entry: AccountBrowser = {
      partition,
      agentPages: new Set(),
      userWindows: new Set(),
      lastUsed: null,
      recorder: new PageRecorder(
        () => Date.now(),
        () => this.pageHost(entry),
        (note) => this.onPageNote?.(account.id, note)
      ),
      session: new ControlledSession(account.id, async () => this.newAgentPage(entry, account.label), this.tickets)
    }
    this.recorders.set(partition, entry.recorder)
    this.owners.set(partition, entry)
    this.accounts.set(account.id, entry)
    return entry
  }

  /** A page for one call or one mission of the AI: its window is made when the page is first used and closed with it. */
  private newAgentPage(entry: AccountBrowser, label: string): ElectronRawPage {
    const page: ElectronRawPage = new ElectronRawPage(
      () => this.createAgentSurface(entry.partition, label),
      () => entry.agentPages.delete(page)
    )
    entry.agentPages.add(page)
    return page
  }

  /** The AI page that was made last and still has a window: where the AI is looking now. */
  private latestAgent(entry: AccountBrowser): ElectronRawPage | null {
    return [...entry.agentPages].reverse().find((page) => page.existingContents() !== null) ?? null
  }

  /**
   * The AI works in the account's own browser and the owner watches (DEC-018): brings the windows of the AI's open tasks to the front, for the
   * moment the owner has to act in the page the AI is waiting on (a CAPTCHA). A window opens by itself without taking the focus (`task.show`).
   */
  showAgentBrowser(account: Account, focus = false): void {
    void this.entry(account).session.revealTasks(focus)
  }

  /**
   * One more window of the account's session for the owner (DEC-038). A window that already shows exactly this address is brought to the front
   * instead; the AI's page is not touched, nothing is taken from it, and nobody waits. The core is told when the first window opens.
   */
  async openForUser(account: Account, url?: string): Promise<{ tabId: string }> {
    const entry = this.entry(account)
    const target = normalizeBrowserUrl(url ?? this.latestAgent(entry)?.currentUrl() ?? '')
    const tabId = `account-${account.id}`

    const same = [...entry.userWindows].find((window) => window.focusAddress(target))
    if (same) {
      entry.lastUsed = same
      return { tabId }
    }

    this.configureSession(entry.partition)
    const first = this.openWindows(entry) === 0
    const window: UserBrowserWindow = new UserBrowserWindow({
      account: { label: account.label, identity: account.identity },
      partition: entry.partition,
      url: target,
      onAddress: (address) => this.ownerAddress(entry, address, 'page'),
      onTabCreated: (contents) => this.watchConsole(contents, entry.recorder),
      onFocused: () => void (entry.lastUsed = window),
      onClosed: () => {
        entry.userWindows.delete(window)
        if (entry.lastUsed === window) entry.lastUsed = null
        if (this.openWindows(entry) === 0 && this.accounts.get(account.id) === entry) this.onUserWindowChange?.(account.id, 'closed')
      }
    })
    entry.userWindows.add(window)
    entry.lastUsed = window
    this.owners.set(entry.partition, entry)
    if (first) this.onUserWindowChange?.(account.id, 'opened')
    return { tabId }
  }

  private openWindows(entry: AccountBrowser): number {
    return [...entry.userWindows].filter((window) => !window.isClosed()).length
  }

  /**
   * An address one of the owner's windows went to or asked for. The AI's own page never reports here: only the owner's windows can sign the
   * session in, out or over to another account behind a mission's back, and the mission must not be refused for what the AI itself does.
   */
  private ownerAddress(entry: AccountBrowser, address: string, use: 'page' | 'request'): void {
    if (isSessionAddress(address, use)) entry.session.noteIdentityActivity()
  }

  /** The window of the owner's that was used last and is still open. */
  private ownerWindow(entry: AccountBrowser | undefined): UserBrowserWindow | null {
    if (!entry) return null
    const open = [...entry.userWindows].filter((window) => !window.isClosed() && !window.siteContents().isDestroyed())
    if (entry.lastUsed && open.includes(entry.lastUsed)) return entry.lastUsed
    return open.at(-1) ?? null
  }

  /** The page the account is on now: the owner's window used last while one is open, else the page the AI works in (none when it is idle). */
  private livePage(entry: AccountBrowser): { contents: WebContents; where: PageReport['where'] } | null {
    const window = this.ownerWindow(entry)
    if (window) return { contents: window.siteContents(), where: 'owner_window' }
    const contents = this.latestAgent(entry)?.existingContents()
    return contents ? { contents, where: 'app_page' } : null
  }

  private pageHost(entry: AccountBrowser): string {
    try {
      return new URL(this.livePage(entry)?.contents.getURL() ?? '').host
    } catch {
      return ''
    }
  }

  private watchConsole(contents: WebContents, recorder: PageRecorder): void {
    contents.on('console-message', (event) => recorder.logged(String(event.level), event.message))
  }

  /**
   * What the account's page shows and did (DEC-016), taken when the owner asks: the readable text and the messages the site shows,
   * a screenshot, and the requests and console errors the page produced. Read-only: nothing is clicked or typed, and the value of a
   * form field is never read.
   */
  async pageReport(account: Account): Promise<PageReport | null> {
    const entry = this.accounts.get(account.id)
    const page = entry ? this.livePage(entry) : null
    if (!entry || !page) return null
    const { contents, where } = page
    const reading = (await contents.executeJavaScript(pageReadingScript()).catch(() => null)) as PageReading | null
    const image = await contents.capturePage().catch(() => null)
    const png = image && !image.isEmpty() ? image.toPNG() : null
    const report: PageReport = {
      takenAt: new Date().toISOString(),
      where,
      address: addressOf(contents.getURL()),
      title: reading?.title ?? '',
      alerts: reading?.alerts ?? [],
      text: reading?.text ?? '',
      requests: entry.recorder.recentRequests(),
      consoleErrors: entry.recorder.consoleErrors(),
      screenshot: png && image ? image.resize({ width: Math.min(image.getSize().width, 1000) }).toDataURL() : null,
      savedAs: null
    }
    if (this.options.diagnosticsDir) report.savedAs = await saveReport(this.options.diagnosticsDir, account.id, report, png)
    return report
  }

  /**
   * The address and title of the page in the owner's window used last (DEC-028, DEC-038): what the window itself reports, nothing is read from
   * the page. Null when no window is open. Windows are tracked by focus, so there is always one page the owner is on, and `tabs` stays unset.
   */
  async ownerPage(account: Account): Promise<OwnerPage | null> {
    const window = this.ownerWindow(this.accounts.get(account.id))
    if (!window) return null
    const contents = window.siteContents()
    return { url: contents.getURL(), title: contents.getTitle() }
  }

  /** True while at least one window of the owner's on this account is open. */
  hasUserWindow(account: Account): boolean {
    const entry = this.accounts.get(account.id)
    return entry !== undefined && this.openWindows(entry) > 0
  }

  /** Brings the owner's window used last to the front. False when none is open. */
  showUserWindow(account: Account): boolean {
    const window = this.ownerWindow(this.accounts.get(account.id))
    if (!window) return false
    window.focus()
    return true
  }

  /** Closes every window of the owner's on the account, without a prompt. */
  closeUserWindow(account: Account): void {
    for (const window of [...(this.accounts.get(account.id)?.userWindows ?? [])]) window.destroy()
  }

  /** Lets go of the account's windows and the AI's pages without erasing its session (the account moves to the other browser, DEC-026). */
  async releaseAccount(account: Account): Promise<void> {
    const entry = this.accounts.get(account.id)
    if (!entry) return
    this.closeUserWindow(account)
    this.disposeAgentPages(entry)
    this.accounts.delete(account.id)
    this.owners.delete(entry.partition)
  }

  /** Called when an account is deleted: closes its windows and wipes the stored session (cookies, storage). */
  async forgetAccount(account: Account): Promise<void> {
    const entry = this.accounts.get(account.id)
    const partition = entry?.partition ?? persistentPartition(account.partition)
    if (entry) this.closeUserWindow(account)
    entry?.session.takeControl() // nothing may start on a session that is being erased
    if (entry) this.disposeAgentPages(entry)
    this.accounts.delete(account.id)
    this.owners.delete(partition)
    this.recorders.delete(partition)
    if (this.options.diagnosticsDir) await forgetReports(this.options.diagnosticsDir, account.id)
    const ses = electronSession.fromPartition(partition)
    await ses.clearStorageData()
    await ses.clearCache()
  }

  private disposeAgentPages(entry: AccountBrowser): void {
    for (const page of [...entry.agentPages]) page.dispose()
  }

  /**
   * A page in a window of its own that starts out of sight (`ghost`). BaseWindow (not BrowserWindow) keeps it out of
   * BrowserWindow.getAllWindows(), which the main process uses to tell whether an application window is open.
   */
  private createAgentSurface(partition: string, label: string): AgentSurface {
    this.configureSession(partition)
    const win = new BaseWindow({ show: false, title: `${label} — account browser`, ...AGENT_VIEWPORT })
    const view = new WebContentsView({
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false }
    })
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, ...AGENT_VIEWPORT })
    ghost(win)

    const contents = view.webContents
    const dispose = (): void => {
      if (!contents.isDestroyed()) contents.close()
      if (!win.isDestroyed()) win.destroy()
    }
    // The owner may close the window they watch the AI in: it only goes out of sight (it keeps drawing), the page and the AI's work go on.
    win.on('close', (event: { preventDefault(): void }) => {
      event.preventDefault()
      ghost(win)
    })
    const reveal = (focus: boolean, title?: string): void => {
      if (win.isDestroyed()) return
      win.setTitle(`${label} — ${title ?? 'the AI is working here'}`)
      seen(win)
      if (focus) {
        win.moveTop()
        win.focus()
        if (!contents.isDestroyed()) contents.focus()
      }
    }
    contents.setAudioMuted(true)
    const recorder = this.recorders.get(partition)
    if (recorder) this.watchConsole(contents, recorder)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//.test(url)) event.preventDefault()
    })
    // A crashed page is dropped; the next operation creates a fresh one.
    contents.on('render-process-gone', dispose)
    return { contents, dispose, reveal }
  }

  /** Applied once per partition: no permission prompts, no downloads, and a plain-Chromium user agent. */
  private configureSession(partition: string): void {
    if (this.configured.has(partition)) return
    this.configured.add(partition)
    const ses: Session = electronSession.fromPartition(partition)
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    ses.on('will-download', (event) => event.preventDefault())
    ses.setUserAgent(cleanUserAgent(ses.getUserAgent()))
    // Notifications only: they change nothing about a request. What the page asked for and what the site answered (DEC-016).
    ses.webRequest.onCompleted((details) => this.recorders.get(partition)?.completed(details))
    ses.webRequest.onErrorOccurred((details) => this.recorders.get(partition)?.failed(details))
    // Also a notification (it cannot change a request): what the owner's windows ask the site for in the background, so a sign-out or an
    // account switch that is a request and not a page is seen as well (DEC-038). The AI's own page is not listened to.
    ses.webRequest.onSendHeaders((details: RequestDetails) => this.ownerRequest(partition, details))
  }

  private ownerRequest(partition: string, details: RequestDetails): void {
    const entry = this.owners.get(partition)
    if (!entry || details.webContentsId === undefined || !BACKGROUND_KINDS.has(details.resourceType ?? '')) return
    const ownerWindow = [...entry.userWindows].some((window) => !window.isClosed() && !window.siteContents().isDestroyed() && window.siteContents().id === details.webContentsId)
    if (ownerWindow) this.ownerAddress(entry, details.url, 'request')
  }
}
