import type { MenuItemConstructorOptions } from 'electron'

export interface AppMenuOptions {
  /** The first menu is named after the app (macOS shows the app's name there). */
  appName: string
  /** Reload and developer tools are for a development build only: a reload drops every open form (BUG-048). */
  isPackaged: boolean
  /** "Settings…" (Command+,) opens the Settings page, in a new window when none is open. */
  openSettings: () => void
}

/**
 * The application menu written for this app (BUG-048), instead of Electron's default one. Pure and free of Electron's runtime so it is
 * tested without it; src/main/index.ts builds and installs it. There is no File menu (Close is under Window, Command+W, because closing the
 * last window keeps the app running) and no Help menu (there is nothing to link to).
 */
export function appMenuTemplate({ appName, isPackaged, openSettings }: AppMenuOptions): MenuItemConstructorOptions[] {
  const developerItems: MenuItemConstructorOptions[] = isPackaged ? [] : [{ type: 'separator' }, { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }]
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Command+,', click: openSettings },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    // Electron's own Edit menu: without its roles Command+C and Command+V stop working in the fields.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        ...developerItems
      ]
    },
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close', accelerator: 'Command+W' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]
}
