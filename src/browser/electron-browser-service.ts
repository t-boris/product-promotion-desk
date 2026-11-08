import { BaseWindow, session as electronSession, WebContentsView, type Session, type WebContents } from 'electron'
import type { Account, PageReport } from '../shared/types'
import { ControlledSession } from '../core/browser-session'
import type { BrowserService, BrowserSession, PageObserver, TicketVerifier } from '../core/ports'
import { ElectronRawPage, type AgentSurface } from './agent-page'
import { pageReadingScript, type PageReading } from './page-scripts'
import { PageRecorder } from './page-recorder'
import { addressOf, forgetReports, saveReport } from './page-report'
import { cleanUserAgent, normalizeBrowserUrl, persistentPartition } from './targets'
import { UserControl } from './toolbar-state'
import { UserBrowserWindow } from './user-window'

/** Size of the hidden agent window: sites lay out and test visibility against a real viewport, not 0 x 0. */
const AGENT_VIEWPORT = { width: 1280, height: 900 }

interface AccountBrowser {
  session: ControlledSession
  agent: ElectronRawPage
  partition: string
  userWindow: UserBrowserWindow | null
  recorder: PageRecorder
}

/**
 * Electron implementation of the browser service (REQ-002, REQ-004).
 *
 *  - one persistent session per account (`persist:` partition) and exactly one ControlledSession per account,
 *    so every channel and product sharing the account is serialized through the same object;
 *  - the agent works in a hidden WebContents of that partition; the user gets a separate window on the same
 *    partition and taking it stops the agent at once (ControlledSession);
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
    const agent = new ElectronRawPage(() => this.createAgentSurface(partition))
    const entry: AccountBrowser = {
      partition,
      agent,
      userWindow: null,
      recorder: new PageRecorder(
        () => Date.now(),
        () => this.pageHost(entry),
        (note) => this.onPageNote?.(account.id, note)
      ),
      session: new ControlledSession(account.id, async () => agent, this.tickets)
    }
    this.recorders.set(partition, entry.recorder)
    this.accounts.set(account.id, entry)
    return entry
  }

  async openForUser(account: Account, url?: string): Promise<{ tabId: string }> {
    const entry = this.entry(account)
    const target = normalizeBrowserUrl(url ?? entry.agent.currentUrl() ?? '')
    const tabId = `account-${account.id}`

    if (entry.userWindow && !entry.userWindow.isClosed()) {
      entry.userWindow.navigate(target)
      entry.userWindow.focus()
      return { tabId }
    }

    this.configureSession(entry.partition)
    // The agent stops interacting the moment the user takes the browser, before the window is even shown.
    const control = new UserControl(entry.session)
    control.begin()
    try {
      entry.userWindow = new UserBrowserWindow({
        account: { label: account.label, identity: account.identity },
        partition: entry.partition,
        url: target,
        control,
        onClosed: () => {
          entry.userWindow = null
          this.onUserWindowChange?.(account.id, 'closed')
        }
      })
    } catch (error) {
      control.release()
      throw error
    }
    this.watchConsole(entry.userWindow.siteContents(), entry.recorder)
    this.onUserWindowChange?.(account.id, 'opened')
    return { tabId }
  }

  /** The page the account is on now: the owner's window while it is open, else the page the app works in. */
  private livePage(entry: AccountBrowser): { contents: WebContents; where: PageReport['where'] } | null {
    const window = entry.userWindow
    if (window && !window.isClosed() && !window.siteContents().isDestroyed()) return { contents: window.siteContents(), where: 'owner_window' }
    const contents = entry.agent.existingContents()
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

  /** True while the person's window for this account is open (the toolbar there shows who holds the browser). */
  hasUserWindow(account: Account): boolean {
    const window = this.accounts.get(account.id)?.userWindow
    return window !== null && window !== undefined && !window.isClosed()
  }

  /** Brings the person's window for this account to the front. False when it is not open. */
  showUserWindow(account: Account): boolean {
    const window = this.accounts.get(account.id)?.userWindow
    if (!window || window.isClosed()) return false
    window.focus()
    return true
  }

  /** Closes the person's window without a prompt; closing it gives the browser back (UserControl releases once). */
  closeUserWindow(account: Account): void {
    this.accounts.get(account.id)?.userWindow?.destroy()
  }

  /** Called when an account is deleted: closes its windows and wipes the stored session (cookies, storage). */
  async forgetAccount(account: Account): Promise<void> {
    const entry = this.accounts.get(account.id)
    const partition = entry?.partition ?? persistentPartition(account.partition)
    entry?.userWindow?.destroy()
    entry?.session.takeControl() // nothing may start on a session that is being erased
    entry?.agent.dispose()
    this.accounts.delete(account.id)
    this.recorders.delete(partition)
    if (this.options.diagnosticsDir) await forgetReports(this.options.diagnosticsDir, account.id)
    const ses = electronSession.fromPartition(partition)
    await ses.clearStorageData()
    await ses.clearCache()
  }

  /**
   * A hidden page in a hidden BaseWindow. BaseWindow (not BrowserWindow) keeps it out of
   * BrowserWindow.getAllWindows(), which the main process uses to tell whether an application window is open.
   */
  private createAgentSurface(partition: string): AgentSurface {
    this.configureSession(partition)
    const win = new BaseWindow({ show: false, ...AGENT_VIEWPORT })
    const view = new WebContentsView({
      webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false }
    })
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, ...AGENT_VIEWPORT })

    const contents = view.webContents
    const dispose = (): void => {
      if (!contents.isDestroyed()) contents.close()
      if (!win.isDestroyed()) win.destroy()
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
    return { contents, dispose }
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
  }
}
