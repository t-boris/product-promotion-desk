import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BrowserWindow, Menu, app, clipboard, ipcMain, nativeTheme, powerMonitor, safeStorage, shell } from 'electron'
import { ApiError, IPC_EVENT, IPC_INVOKE, type ApiEvent, type ApiMethod } from '../shared/api'
import { APP_NAME } from '../shared/app-name'
import { createEngines } from '../ai'
import { ChromeBrowserService } from '../browser/chrome-browser-service'
import { findChrome } from '../browser/chrome-launcher'
import { ElectronBrowserService } from '../browser/electron-browser-service'
import { RoutingBrowserService } from '../browser/routing-browser-service'
import { createConnectors } from '../connectors'
import { createCore } from '../core/core'
import { getAutomation, startAutomation } from '../core/pipeline'
import { appMenuTemplate } from './app-menu'
import { installLifecycle } from './lifecycle'
import { McpGateway } from './mcp-gateway'
import { ElectronImageShrinker } from './image-shrinker'
import { ElectronMediaTools } from './media-tools'
import { followTheme } from './native-theme'
import { createNotificationSink } from './notifications'
import { createTray } from './tray'
import { FileVault, TimedClipboard } from './vault'
import { WebModeController } from './web-mode'

app.setName(APP_NAME)

/** The hash route of the Settings page (src/renderer/src/pages), opened by the menu's "Settings…". */
const SETTINGS_HASH = '#/settings'

// PPD_DATA_DIR makes a clean, separate instance (a QA baseline, a test run). It must move the whole instance, not only the database: the
// single-instance lock and the browser profile (the sessions of the accounts) live in Electron's userData. Without this a second launch with
// another PPD_DATA_DIR found the lock held by the running app, quit silently after a second and left the new folder unused (BUG-001), and the
// sessions of a test run landed in the real profile. Without the variable the data folder is userData itself, as before.
if (process.env.PPD_DATA_DIR) app.setPath('userData', resolve(process.env.PPD_DATA_DIR))
const dataDir = app.getPath('userData')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void start()
}

async function start(): Promise<void> {
  await app.whenReady()

  // Chromium builds the accessibility tree of a page only after an assistive client asks for it. A client that does not ask (a UI test or
  // automation tool reading the macOS accessibility tree) saw an empty window with the three traffic-light buttons and nothing else (BUG-002),
  // although the page is marked up with real links, headings and buttons. So the tree is exposed from the start. It must be called after ready.
  app.setAccessibilitySupportEnabled(true)

  // The tools the AI uses in an account's browser reach it through a socket and a small program the engine starts (DEC-018).
  const gateway = new McpGateway({
    socketPath: join(tmpdir(), `ppd-mcp-${process.pid}.sock`),
    command: process.execPath,
    shimPath: join(import.meta.dirname, 'mcp-shim.js')
  })
  await gateway.start()
  app.on('quit', () => gateway.stop())

  const core = createCore({
    dbPath: join(dataDir, 'ppd.sqlite'),
    dataDir,
    appVersion: app.getVersion(),
    engines: createEngines(),
    // Facebook accounts work in the owner's installed Chrome, every other platform in the built-in browser (DEC-025).
    browser: (tickets) =>
      new RoutingBrowserService(
        new ElectronBrowserService(tickets, { diagnosticsDir: join(dataDir, 'diagnostics') }),
        new ChromeBrowserService(tickets, { dataDir, diagnosticsDir: join(dataDir, 'diagnostics') }),
        { chromeFound: () => findChrome() !== null }
      ),
    connectors: createConnectors(),
    agentBridge: gateway,
    imageShrinker: new ElectronImageShrinker(),
    mediaTools: new ElectronMediaTools(),
    // Passwords: encrypted by the system keychain, in a file of their own next to the database (DEC-014).
    secrets: new FileVault(join(dataDir, 'vault.bin'), safeStorage),
    clipboard: new TimedClipboard({ writeText: (text) => clipboard.writeText(text), readText: () => clipboard.readText() }),
    // Channels are checked a few minutes earlier or later than their interval says, so they never start together (DEC-040).
    scheduleJitter: true,
    echoLogs: !app.isPackaged
  })

  // The same handlers serve Electron IPC and the loopback web mode.
  ipcMain.handle(IPC_INVOKE, async (_event, payload: { method: ApiMethod; args: unknown }) => {
    try {
      return { ok: true, result: (await core.router.call(payload.method, payload.args as never)) ?? null }
    } catch (error) {
      const e = error instanceof ApiError ? error : new ApiError('internal', error instanceof Error ? error.message : String(error))
      return { ok: false, error: { code: e.code, message: e.message } }
    }
  })

  core.events.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC_EVENT, event)
    }
  })

  // The application's appearance (the window material, the menus, the pop-up lists) follows the theme the owner chose, from before the first
  // window is made (visual-system.md §33.4).
  followTheme(nativeTheme, core)

  const webMode = new WebModeController(core, join(app.getAppPath(), 'out', 'renderer'))
  await webMode.reconcile()

  // Opens (or focuses) the main window. `hash` is the page to show: a window created now loads it, one that exists is sent a navigate event (to
  // its own web contents only, never through the core's events, so the web mode is not driven by the desktop menu).
  const openWindow = (hash?: string): void => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      if (hash) {
        // A window that is still loading (just opened, or reloading) has no listener for the event yet: it loads the page at that hash instead.
        if (existing.webContents.isLoading()) loadPage(existing, hash)
        else existing.webContents.send(IPC_EVENT, { type: 'navigate', hash } satisfies ApiEvent)
      }
    } else {
      createWindow(hash)
    }
    core.background = false
    core.events.changed('settings')
  }
  // The callbacks of the tray, the notifications and the lifecycle are called with arguments of their own (a menu item, an event), so they get a function that takes none.
  const showWindow = (): void => openWindow()

  function createWindow(hash?: string): void {
    const win = new BrowserWindow({
      width: 1320,
      height: 880,
      minWidth: 980,
      minHeight: 640,
      title: APP_NAME,
      titleBarStyle: 'hiddenInset',
      // The window buttons sit on the centre line of the 52px toolbar band (--toolbar-h), 20px from the edge: the red button's
      // centre is 26px from the top (visual-system.md §4.1, V-02).
      trafficLightPosition: { x: 20, y: 19 },
      // The sidebar is the window's own material; the page paints everything else itself (.main is always --surface-0), so
      // the window colour stays transparent and nothing flashes: the page background is the first thing the web view paints.
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) event.preventDefault()
    })
    loadPage(win, hash)
  }

  /** Loads the page into a window; the renderer reads `hash` (the page to show) when it starts. */
  function loadPage(win: BrowserWindow, hash?: string): void {
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + (hash ?? ''))
    else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }

  // The application menu written for this app (BUG-048). It is installed here, not right after whenReady(), because "Settings…" opens a window and
  // that needs the core and the window code above; the window itself only appears at the end of this function, so the default menu is never in use.
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate({ appName: APP_NAME, isPackaged: app.isPackaged, openSettings: () => openWindow(SETTINGS_HASH) })))

  // Background operation (DEC-003): menu-bar status/pause/Quit, sleep and wake, notifications. Automation itself
  // starts only after the window is up, because its startup recovery may take a while.
  const automation = getAutomation(core)
  const lifecycle = installLifecycle({ app, core, showWindow, windowCount: () => BrowserWindow.getAllWindows().length, automation, powerMonitor })
  createTray({ core, automation, showWindow, quit: lifecycle.quit })
  app.on('second-instance', showWindow)
  core.log.info('app', `${APP_NAME} ${app.getVersion()} started`)
  showWindow()
  // Every AI help needs an engine: with none chosen yet, the first ready one is used (it can be changed in Settings).
  core.engines
    .autoSelect()
    .then((engine) => {
      if (!engine) return
      core.log.info('engines', `AI engine selected automatically: ${engine.label}. Change it in Settings.`)
      core.events.changed('settings')
    })
    .catch((error: unknown) => core.log.warn('engines', `No AI engine was selected automatically: ${error instanceof Error ? error.message : String(error)}`))
  startAutomation(core, { notifier: createNotificationSink(showWindow) }).catch((error: unknown) => {
    core.log.error('lifecycle', `Automation could not start: ${error instanceof Error ? error.message : String(error)}`)
  })
}
