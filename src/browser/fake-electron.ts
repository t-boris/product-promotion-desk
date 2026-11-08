// Test-only stand-in for the parts of the 'electron' module the browser service uses. It lets the service's own
// logic (one session per account, control hand-over, window lifecycle) run in plain Node. It proves nothing
// about Electron itself: that is covered by the manual smoke test. Not imported by production code.

import { EventEmitter } from 'node:events'

export class FakeSession {
  userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) product-promotion-desk/0.1.0 Chrome/140.0.0.0 Electron/45.2.3 Safari/537.36'
  permissionRequest: ((contents: unknown, permission: string, callback: (granted: boolean) => void) => void) | null = null
  permissionCheck: (() => boolean) | null = null
  cleared = 0
  cacheCleared = 0
  downloadPrevented = false
  private readonly emitter = new EventEmitter()
  setPermissionRequestHandler(handler: FakeSession['permissionRequest']): void {
    this.permissionRequest = handler
  }
  setPermissionCheckHandler(handler: FakeSession['permissionCheck']): void {
    this.permissionCheck = handler
  }
  getUserAgent(): string {
    return this.userAgent
  }
  setUserAgent(ua: string): void {
    this.userAgent = ua
  }
  on(event: string, listener: (...args: unknown[]) => void): void {
    this.emitter.on(event, listener)
  }
  emitDownload(): void {
    this.emitter.emit('will-download', { preventDefault: () => (this.downloadPrevented = true) })
  }
  async clearStorageData(): Promise<void> {
    this.cleared += 1
  }
  async clearCache(): Promise<void> {
    this.cacheCleared += 1
  }
}

export class FakeWebContents extends EventEmitter {
  url = ''
  destroyed = false
  loading = false
  loaded: string[] = []
  scripts: string[] = []
  /** Results returned by successive executeJavaScript calls; the last one repeats. */
  results: unknown[] = []
  loadResult: Promise<void> | null = null
  stopped = 0
  reloaded = 0
  wentBack = 0
  canGoBack = false
  muted = false
  windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null
  debugger = { isAttached: () => false, attach: () => undefined, detach: () => undefined, sendCommand: async () => ({}) }
  navigationHistory = { canGoBack: () => this.canGoBack, goBack: () => void (this.wentBack += 1) }

  loadURL(url: string): Promise<void> {
    this.loaded.push(url)
    this.url = url
    return this.loadResult ?? Promise.resolve()
  }
  getURL(): string {
    return this.url
  }
  isLoading(): boolean {
    return this.loading
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  close(): void {
    this.destroyed = true
  }
  stop(): void {
    this.stopped += 1
  }
  reload(): void {
    this.reloaded += 1
  }
  setAudioMuted(muted: boolean): void {
    this.muted = muted
  }
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
    this.windowOpenHandler = handler
  }
  async executeJavaScript(script: string): Promise<unknown> {
    this.scripts.push(script)
    return this.results.length > 1 ? this.results.shift() : this.results[0]
  }
}

export const created = {
  windows: [] as BaseWindow[],
  views: [] as WebContentsView[],
  sessions: new Map<string, FakeSession>(),
  reset(): void {
    this.windows.length = 0
    this.views.length = 0
    this.sessions.clear()
  }
}

export class WebContentsView {
  readonly webContents = new FakeWebContents()
  bounds: unknown = null
  constructor(readonly options: { webPreferences?: Record<string, unknown> } = {}) {
    created.views.push(this)
  }
  setBounds(bounds: unknown): void {
    this.bounds = bounds
  }
}

/**
 * Only BaseWindow is provided: the service must not use BrowserWindow (the main process counts those to tell whether
 * the application window is open), and the mocked module throws if it is touched.
 */
export class BaseWindow extends EventEmitter {
  readonly children: WebContentsView[] = []
  readonly contentView = { addChildView: (view: WebContentsView) => void this.children.push(view) }
  get visible(): boolean {
    return this.options.show !== false
  }
  destroyed = false
  focused = 0
  title = ''
  constructor(readonly options: Record<string, unknown> = {}) {
    super()
    created.windows.push(this)
  }
  getContentBounds(): { width: number; height: number } {
    return { width: 1000, height: 800 }
  }
  isMinimized(): boolean {
    return false
  }
  restore(): void {}
  raised = 0
  moveTop(): void {
    this.raised += 1
  }
  focus(): void {
    this.focused += 1
  }
  setTitle(title: string): void {
    this.title = title
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  close(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('closed')
  }
  destroy(): void {
    this.close()
  }
}

export const session = {
  fromPartition(name: string): FakeSession {
    let s = created.sessions.get(name)
    if (!s) {
      s = new FakeSession()
      created.sessions.set(name, s)
    }
    return s
  }
}
