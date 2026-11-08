import { BaseWindow, session as electronSession, WebContentsView, type Session } from 'electron'
import type { Account } from '../shared/types'
import { ControlledSession } from '../core/browser-session'
import type { BrowserService, BrowserSession, TicketVerifier } from '../core/ports'
import { ElectronRawPage, type AgentSurface } from './agent-page'
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
export class ElectronBrowserService implements BrowserService {
  private readonly accounts = new Map<string, AccountBrowser>()
  private readonly configured = new Set<string>()

  constructor(private readonly tickets: TicketVerifier) {}

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
      session: new ControlledSession(account.id, async () => agent, this.tickets)
    }
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
        }
      })
    } catch (error) {
      control.release()
      throw error
    }
    return { tabId }
  }

  /** Called when an account is deleted: closes its windows and wipes the stored session (cookies, storage). */
  async forgetAccount(account: Account): Promise<void> {
    const entry = this.accounts.get(account.id)
    const partition = entry?.partition ?? persistentPartition(account.partition)
    entry?.userWindow?.destroy()
    entry?.session.takeControl() // nothing may start on a session that is being erased
    entry?.agent.dispose()
    this.accounts.delete(account.id)
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
  }
}
