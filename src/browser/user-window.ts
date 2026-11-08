// The window the user gets for login hand-off and takeover: the account's site on top of its persistent session,
// under a slim toolbar. Nothing here reads the page: passwords are typed by the user on the site's own page and
// are never read, logged or stored by the application.

import { BaseWindow, WebContentsView, type WebContents } from 'electron'
import { normalizeBrowserUrl } from './targets'
import { initialToolbar, parseToolbarCommand, reduceToolbar, toolbarHtml, toolbarView, type ToolbarCommand, type ToolbarEvent, type ToolbarState, type UserControl } from './toolbar-state'

const TOOLBAR_HEIGHT = 46
/** Not persistent: the toolbar page shares no cookies or storage with any site. */
const TOOLBAR_PARTITION = 'ppd-toolbar'

export interface UserWindowOptions {
  account: { label: string; identity: string | null }
  /** Electron partition string ("persist:..."): the same session the agent uses. */
  partition: string
  url: string
  control: UserControl
  onClosed: () => void
}

export class UserBrowserWindow {
  private readonly win: BaseWindow
  private readonly site: WebContentsView
  private readonly bar: WebContentsView
  private state: ToolbarState
  private barReady = false
  private closed = false

  constructor(private readonly options: UserWindowOptions) {
    const url = normalizeBrowserUrl(options.url)
    this.state = initialToolbar(options.account, url)

    // BaseWindow, not BrowserWindow: the main process counts BrowserWindows to decide whether the app window is open.
    this.win = new BaseWindow({
      width: 1180,
      height: 840,
      minWidth: 720,
      minHeight: 480,
      title: `${options.account.label} — account browser`,
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#14161a'
    })
    this.site = new WebContentsView({
      webPreferences: { partition: options.partition, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.bar = new WebContentsView({
      webPreferences: { partition: TOOLBAR_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win.contentView.addChildView(this.site)
    this.win.contentView.addChildView(this.bar)
    this.layout()
    const relayout = (): void => this.layout()
    this.win.on('resize', relayout)
    this.win.on('maximize', relayout)
    this.win.on('unmaximize', relayout)
    this.win.on('enter-full-screen', relayout)
    this.win.on('leave-full-screen', relayout)

    this.wireSite(this.site.webContents)
    this.wireToolbar(this.bar.webContents)
    this.win.on('closed', () => this.afterClosed())

    void this.bar.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbarHtml())}`)
    void this.site.webContents.loadURL(url).catch(() => undefined) // a failed load is shown by the page itself
  }

  isClosed(): boolean {
    return this.closed
  }

  focus(): void {
    if (this.closed) return
    if (this.win.isMinimized()) this.win.restore()
    this.win.focus()
  }

  navigate(url: string): void {
    if (this.closed) return
    void this.site.webContents.loadURL(normalizeBrowserUrl(url)).catch(() => undefined)
  }

  private layout(): void {
    if (this.closed || this.win.isDestroyed()) return
    const { width, height } = this.win.getContentBounds()
    this.bar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT })
    this.site.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) })
  }

  private dispatch(event: ToolbarEvent): void {
    this.state = reduceToolbar(this.state, event)
    this.render()
  }

  private render(): void {
    if (!this.barReady || this.closed || this.bar.webContents.isDestroyed()) return
    void this.bar.webContents.executeJavaScript(`window.ppdUpdate(${JSON.stringify(toolbarView(this.state))})`).catch(() => undefined)
  }

  private wireSite(contents: WebContents): void {
    const navigated = (url: string): void => this.dispatch({ type: 'navigated', url, canGoBack: contents.navigationHistory.canGoBack() })
    contents.on('did-navigate', (_event, url) => navigated(url))
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) navigated(url)
    })
    contents.on('did-start-loading', () => this.dispatch({ type: 'loading', loading: true }))
    contents.on('did-stop-loading', () => this.dispatch({ type: 'loading', loading: false }))
    contents.on('page-title-updated', (_event, title) => {
      if (!this.closed) this.win.setTitle(`${this.options.account.label} — ${title}`)
    })
    // Sign-in flows sometimes open a popup: show it in the same view instead of an extra window.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void contents.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault()
    })
  }

  private wireToolbar(contents: WebContents): void {
    contents.on('did-finish-load', () => {
      this.barReady = true
      this.render()
    })
    // Toolbar buttons are links to a reserved host; they are intercepted here and never navigate anywhere.
    contents.setWindowOpenHandler(({ url }) => {
      const command = parseToolbarCommand(url)
      if (command) this.run(command)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event) => event.preventDefault())
  }

  private run(command: ToolbarCommand): void {
    const contents = this.site.webContents
    if (contents.isDestroyed()) return
    if (command === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    else if (command === 'reload') contents.reload()
    else if (command === 'release') this.release()
  }

  /** "Give control back to the app": the agent may use the account again, and this window closes. */
  release(): void {
    if (this.closed) return
    this.options.control.release()
    this.dispatch({ type: 'release' })
    this.win.close()
  }

  private afterClosed(): void {
    this.closed = true
    // Closing the window also gives control back (idempotent when the button was used).
    this.options.control.release()
    for (const view of [this.site, this.bar]) if (!view.webContents.isDestroyed()) view.webContents.close()
    this.options.onClosed()
  }

  /** Used when an account is removed: closes without a prompt. */
  destroy(): void {
    if (!this.closed && !this.win.isDestroyed()) this.win.close()
  }
}
