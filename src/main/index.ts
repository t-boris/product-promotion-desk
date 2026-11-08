import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow, app, clipboard, ipcMain, powerMonitor, safeStorage, shell } from 'electron'
import { ApiError, IPC_EVENT, IPC_INVOKE, type ApiMethod } from '../shared/api'
import { createEngines } from '../ai'
import { ElectronBrowserService } from '../browser/electron-browser-service'
import { createConnectors } from '../connectors'
import { createCore } from '../core/core'
import { getAutomation, startAutomation } from '../core/pipeline'
import { installLifecycle } from './lifecycle'
import { McpGateway } from './mcp-gateway'
import { createNotificationSink } from './notifications'
import { createTray } from './tray'
import { FileVault, TimedClipboard } from './vault'
import { WebModeController } from './web-mode'

app.setName('Product Promotion Desk')

const dataDir = process.env.PPD_DATA_DIR || app.getPath('userData')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void start()
}

async function start(): Promise<void> {
  await app.whenReady()

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
    browser: (tickets) => new ElectronBrowserService(tickets, { diagnosticsDir: join(dataDir, 'diagnostics') }),
    connectors: createConnectors(),
    agentBridge: gateway,
    // Passwords: encrypted by the system keychain, in a file of their own next to the database (DEC-014).
    secrets: new FileVault(join(dataDir, 'vault.bin'), safeStorage),
    clipboard: new TimedClipboard({ writeText: (text) => clipboard.writeText(text), readText: () => clipboard.readText() }),
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

  const webMode = new WebModeController(core, join(app.getAppPath(), 'out', 'renderer'))
  await webMode.reconcile()

  const showWindow = (): void => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
    } else {
      createWindow()
    }
    core.background = false
    core.events.changed('settings')
  }

  function createWindow(): void {
    const win = new BrowserWindow({
      width: 1320,
      height: 880,
      minWidth: 980,
      minHeight: 640,
      title: 'Product Promotion Desk',
      titleBarStyle: 'hiddenInset',
      backgroundColor: '#14161a',
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
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  // Background operation (DEC-003): menu-bar status/pause/Quit, sleep and wake, notifications. Automation itself
  // starts only after the window is up, because its startup recovery may take a while.
  const automation = getAutomation(core)
  const lifecycle = installLifecycle({ app, core, showWindow, windowCount: () => BrowserWindow.getAllWindows().length, automation, powerMonitor })
  createTray({ core, automation, showWindow, quit: lifecycle.quit })
  app.on('second-instance', showWindow)
  core.log.info('app', `Product Promotion Desk ${app.getVersion()} started`)
  showWindow()
  startAutomation(core, { notifier: createNotificationSink(showWindow) }).catch((error: unknown) => {
    core.log.error('lifecycle', `Automation could not start: ${error instanceof Error ? error.message : String(error)}`)
  })
}
