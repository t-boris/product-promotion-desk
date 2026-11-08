import { join } from 'node:path'
import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { ApiError, IPC_EVENT, IPC_INVOKE, type ApiMethod } from '../shared/api'
import { createEngines } from '../ai'
import { ElectronBrowserService } from '../browser/electron-browser-service'
import { createConnectors } from '../connectors'
import { createCore } from '../core/core'
import { installLifecycle } from './lifecycle'
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

  const core = createCore({
    dbPath: join(dataDir, 'ppd.sqlite'),
    dataDir,
    appVersion: app.getVersion(),
    engines: createEngines(),
    browser: (tickets) => new ElectronBrowserService(tickets),
    connectors: createConnectors(),
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

  installLifecycle({ app, core, showWindow, windowCount: () => BrowserWindow.getAllWindows().length })
  app.on('second-instance', showWindow)
  core.log.info('app', `Product Promotion Desk ${app.getVersion()} started`)
  showWindow()
}
