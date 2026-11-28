// A window the owner gets on an account's browser (DEC-038, DEC-099): the account's site on top of its persistent session, under a slim
// tabbed toolbar. It is one more window of the session, not a hand-over: the AI keeps its own hidden page, nothing waits, and nobody takes
// control. Inside the window, the owner can open multiple tabs (`+`, or site links opening new windows), switch between them, and close
// individual tabs. Nothing here runs a script in the page by itself: passwords are typed by the owner on the site's own page and are never
// read, logged or stored by the application. What the window reports is the addresses it goes to (`onAddress`), so the session can tell when
// a sign-in or sign-out page was used in it.

import { BaseWindow, WebContentsView, type WebContents } from 'electron'
import { normalizeBrowserUrl } from './targets'
import { initialToolbar, parseToolbarCommand, reduceToolbar, tabTitleFallback, toolbarHtml, toolbarView, type ToolbarCommand, type ToolbarEvent, type ToolbarState, type ToolbarTab } from './toolbar-state'

const TOOLBAR_HEIGHT = 78
/** Not persistent: the toolbar page shares no cookies or storage with any site. */
const TOOLBAR_PARTITION = 'ppd-toolbar'

interface TabEntry {
  id: string
  view: WebContentsView
  opened: string
  url: string
  title: string
  loading: boolean
}

export interface UserWindowOptions {
  account: { label: string; identity: string | null }
  /** Electron partition string ("persist:..."): the same session the agent uses. */
  partition: string
  url: string
  /** An address the window is going to or has reached (its page, not what the page loads in the background): the redirects on the way included. */
  onAddress: (url: string) => void
  /** Called for every tab's WebContents created in this window so the service can observe console errors across all tabs. */
  onTabCreated?: (contents: WebContents) => void
  /** The window came to the front: it is the one the owner uses now ("Use the page I'm on" reads this one). */
  onFocused: () => void
  onClosed: () => void
}

export class UserBrowserWindow {
  private readonly win: BaseWindow
  private readonly bar: WebContentsView
  private readonly tabs: TabEntry[] = []
  private activeId: string
  private nextTabNumber = 1
  private state: ToolbarState
  private barReady = false
  private closed = false

  constructor(private readonly options: UserWindowOptions) {
    const url = normalizeBrowserUrl(options.url)
    const firstId = `t${this.nextTabNumber++}`
    this.activeId = firstId
    this.state = initialToolbar(options.account, url, firstId)

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
    const firstTab = this.createTab(firstId, url)
    this.bar = new WebContentsView({
      webPreferences: { partition: TOOLBAR_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    this.win.contentView.addChildView(firstTab.view)
    this.win.contentView.addChildView(this.bar)
    this.layout()
    const relayout = (): void => this.layout()
    this.win.on('resize', relayout)
    this.win.on('maximize', relayout)
    this.win.on('unmaximize', relayout)
    this.win.on('enter-full-screen', relayout)
    this.win.on('leave-full-screen', relayout)

    this.wireToolbar(this.bar.webContents)
    this.win.on('focus', () => this.options.onFocused())
    this.win.on('closed', () => this.afterClosed())

    void this.bar.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(toolbarHtml())}`)
    options.onAddress(url)
    void firstTab.view.webContents.loadURL(url).catch(() => undefined) // a failed load is shown by the page itself
  }

  private createTab(id: string, url: string): TabEntry {
    const view = new WebContentsView({
      webPreferences: { partition: this.options.partition, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    const entry: TabEntry = { id, view, opened: url, url, title: tabTitleFallback(url), loading: true }
    this.tabs.push(entry)
    this.wireSite(entry)
    this.options.onTabCreated?.(view.webContents)
    return entry
  }

  private activeTab(): TabEntry {
    return this.tabs.find((tab) => tab.id === this.activeId) ?? (this.tabs[0] as TabEntry)
  }

  isClosed(): boolean {
    return this.closed
  }

  /** Number of open tabs in this window. */
  tabCount(): number {
    return this.tabs.length
  }

  /** The active tab's contents, for the service to listen to and, when the owner asks, to read (DEC-016). Nothing here runs a script. */
  siteContents(): WebContents {
    return this.activeTab().view.webContents
  }

  /** The address the active tab shows, or is loading: what it was opened on until it has loaded something. */
  address(): string {
    const tab = this.activeTab()
    if (this.closed || !tab || tab.view.webContents.isDestroyed()) return ''
    return tab.view.webContents.getURL() || tab.opened
  }

  /** If any open tab in this window currently shows `url`, switches to it, focuses the window, and returns true. */
  focusAddress(url: string): boolean {
    if (this.closed) return false
    const match = this.tabs.find((tab) => !tab.view.webContents.isDestroyed() && (tab.view.webContents.getURL() || tab.opened) === url)
    if (!match) return false
    if (match.id !== this.activeId) this.selectTab(match.id)
    this.focus()
    return true
  }

  /** Opens a new tab in this window on the account's session and switches to it (DEC-099). */
  openTab(rawUrl: string): string {
    if (this.closed || this.win.isDestroyed()) return ''
    const url = normalizeBrowserUrl(rawUrl)
    const id = `t${this.nextTabNumber++}`
    const tab = this.createTab(id, url)
    this.selectTab(id)
    this.options.onAddress(url)
    void tab.view.webContents.loadURL(url).catch(() => undefined)
    return id
  }

  /** Switches the active tab in this window. */
  selectTab(id: string): void {
    if (this.closed || this.win.isDestroyed()) return
    const next = this.tabs.find((tab) => tab.id === id)
    if (!next) return
    const prev = this.tabs.find((tab) => tab.id === this.activeId)
    if (prev && prev.id !== next.id) {
      this.win.contentView.removeChildView(prev.view)
    }
    this.activeId = next.id
    // Keep [activeView, bar] order so the toolbar stays on top and inactive tabs are detached from the contentView.
    this.win.contentView.removeChildView(this.bar)
    this.win.contentView.addChildView(next.view)
    this.win.contentView.addChildView(this.bar)
    this.layout()
    if (!next.view.webContents.isDestroyed()) {
      const pageTitle = next.view.webContents.getTitle() || next.title
      this.win.setTitle(`${this.options.account.label} — ${pageTitle}`)
    }
    this.syncTabs()
  }

  /** Closes one tab; closing the last remaining tab closes the window. */
  closeTab(id: string): void {
    if (this.closed) return
    const index = this.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return
    if (this.tabs.length === 1) {
      this.destroy()
      return
    }
    const [removed] = this.tabs.splice(index, 1) as [TabEntry]
    const wasActive = removed.id === this.activeId
    if (wasActive) {
      this.win.contentView.removeChildView(removed.view)
    }
    if (!removed.view.webContents.isDestroyed()) removed.view.webContents.close()
    if (wasActive) {
      const fallback = this.tabs[Math.min(index, this.tabs.length - 1)] as TabEntry
      this.selectTab(fallback.id)
    } else {
      this.syncTabs()
    }
  }

  /** Brings the window above the application's own window, which is usually in front of it and hides it. */
  focus(): void {
    if (this.closed) return
    if (this.win.isMinimized()) this.win.restore()
    this.win.moveTop()
    this.win.focus()
  }

  private layout(): void {
    if (this.closed || this.win.isDestroyed()) return
    const { width, height } = this.win.getContentBounds()
    this.bar.setBounds({ x: 0, y: 0, width, height: TOOLBAR_HEIGHT })
    const tab = this.activeTab()
    if (tab) tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) })
  }

  private syncTabs(): void {
    const active = this.activeTab()
    const contents = active.view.webContents
    const url = !contents.isDestroyed() ? contents.getURL() || active.opened : active.url
    const canGoBack = !contents.isDestroyed() && contents.navigationHistory.canGoBack()
    const tabs: ToolbarTab[] = this.tabs.map((tab) => ({ id: tab.id, title: tab.title, url: tab.url, loading: tab.loading }))
    this.dispatch({ type: 'tabs', tabs, activeTabId: active.id, url, canGoBack, loading: active.loading })
  }

  private dispatch(event: ToolbarEvent): void {
    this.state = reduceToolbar(this.state, event)
    this.render()
  }

  private render(): void {
    if (!this.barReady || this.closed || this.bar.webContents.isDestroyed()) return
    void this.bar.webContents.executeJavaScript(`window.ppdUpdate(${JSON.stringify(toolbarView(this.state))})`).catch(() => undefined)
  }

  private wireSite(tab: TabEntry): void {
    const contents = tab.view.webContents
    const navigated = (url: string): void => {
      tab.url = url
      this.options.onAddress(url)
      this.dispatch({ type: 'navigated', tabId: tab.id, url, canGoBack: contents.navigationHistory.canGoBack() })
    }
    // The page the window goes to, and every hop of a redirect on the way (a sign-out that redirects to the sign-in page is both).
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame) this.options.onAddress(details.url)
    })
    contents.on('did-redirect-navigation', (details) => {
      if (details.isMainFrame) this.options.onAddress(details.url)
    })
    contents.on('did-navigate', (_event, url) => navigated(url))
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) navigated(url)
    })
    contents.on('did-start-loading', () => {
      tab.loading = true
      this.dispatch({ type: 'loading', tabId: tab.id, loading: true })
    })
    contents.on('did-stop-loading', () => {
      tab.loading = false
      this.dispatch({ type: 'loading', tabId: tab.id, loading: false })
    })
    contents.on('page-title-updated', (_event, title) => {
      const clean = title.trim()
      if (clean) tab.title = clean
      this.dispatch({ type: 'title', tabId: tab.id, title })
      if (!this.closed && tab.id === this.activeId) this.win.setTitle(`${this.options.account.label} — ${title}`)
    })
    // Links that ask for a new window/tab open as a new tab inside this same account browser window (DEC-099).
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) this.openTab(url)
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

  private newTabUrl(): string {
    const current = this.address()
    try {
      const parsed = new URL(current)
      return `${parsed.origin}/`
    } catch {
      return this.options.url
    }
  }

  private run(command: ToolbarCommand): void {
    if (typeof command === 'object') {
      if (command.type === 'select-tab') this.selectTab(command.id)
      else if (command.type === 'close-tab') this.closeTab(command.id)
      return
    }
    if (command === 'close') {
      this.destroy()
      return
    }
    if (command === 'new-tab') {
      this.openTab(this.newTabUrl())
      return
    }
    const contents = this.siteContents()
    if (contents.isDestroyed()) return
    if (command === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    else if (command === 'reload') contents.reload()
  }

  private afterClosed(): void {
    this.closed = true
    for (const tab of this.tabs) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    if (!this.bar.webContents.isDestroyed()) this.bar.webContents.close()
    this.options.onClosed()
  }

  /** Used when an account is removed: closes without a prompt. */
  destroy(): void {
    if (!this.closed && !this.win.isDestroyed()) this.win.close()
  }
}
