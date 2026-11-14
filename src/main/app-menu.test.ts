import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { appMenuTemplate } from './app-menu'

const build = (isPackaged: boolean, openSettings: () => void = () => undefined): MenuItemConstructorOptions[] =>
  appMenuTemplate({ appName: 'Product Promotion Desk', isPackaged, openSettings })

const submenuOf = (template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] =>
  (template.find((menu) => menu.label === label)?.submenu ?? []) as MenuItemConstructorOptions[]

/** Every role used anywhere in the template, whatever the depth. */
const allRoles = (items: MenuItemConstructorOptions[]): string[] =>
  items.flatMap((item) => [...(item.role ? [item.role] : []), ...allRoles((item.submenu ?? []) as MenuItemConstructorOptions[])])

describe('the native menu written for the app (BUG-048)', () => {
  it('has the app menu, Edit, View and Window, and no File and no Help menu', () => {
    const template = build(true)
    expect(template.map((menu) => menu.label ?? menu.role)).toEqual(['Product Promotion Desk', 'editMenu', 'View', 'Window'])
    expect(template.find((menu) => menu.label === 'File' || menu.role === 'fileMenu')).toBeUndefined()
    expect(template.find((menu) => menu.label === 'Help' || menu.role === 'help')).toBeUndefined()
  })

  it('names the first menu after the app and holds About, Settings, Services, Hide, Hide Others, Show All and Quit', () => {
    const appMenu = submenuOf(build(true), 'Product Promotion Desk')
    for (const role of ['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit'] as const) {
      expect(appMenu.some((item) => item.role === role)).toBe(true)
    }
    const labels = appMenu.map((item) => item.label).filter(Boolean)
    expect(labels).toEqual(['Settings…'])
  })

  it('puts Settings… on Command+, and opens Settings when it is clicked', () => {
    const openSettings = vi.fn()
    const settings = submenuOf(build(true, openSettings), 'Product Promotion Desk').find((item) => item.label === 'Settings…')
    expect(settings?.accelerator).toBe('Command+,')
    expect(openSettings).not.toHaveBeenCalled()
    settings?.click?.(undefined as never, undefined, undefined as never)
    expect(openSettings).toHaveBeenCalledTimes(1)
  })

  it('keeps the Edit menu, so copy and paste still work in the fields', () => {
    expect(build(true).some((menu) => menu.role === 'editMenu')).toBe(true)
    expect(build(false).some((menu) => menu.role === 'editMenu')).toBe(true)
  })

  it('offers full screen and zoom in View, and no reload or developer tools in the packaged app', () => {
    const packaged = build(true)
    expect(submenuOf(packaged, 'View').flatMap((item) => (item.role ? [item.role] : []))).toEqual(['togglefullscreen', 'resetZoom', 'zoomIn', 'zoomOut'])
    const roles = allRoles(packaged)
    for (const role of ['reload', 'forceReload', 'toggleDevTools']) expect(roles).not.toContain(role)
  })

  it('adds reload and developer tools to View only when the app is not packaged', () => {
    const roles = submenuOf(build(false), 'View').map((item) => item.role)
    for (const role of ['reload', 'forceReload', 'toggleDevTools', 'togglefullscreen', 'resetZoom', 'zoomIn', 'zoomOut']) expect(roles).toContain(role)
  })

  it('closes the window with Command+W and keeps Minimize, Zoom and Bring All to Front in Window', () => {
    const window = submenuOf(build(true), 'Window')
    expect(window.find((item) => item.role === 'close')?.accelerator).toBe('Command+W')
    for (const role of ['minimize', 'zoom', 'front'] as const) expect(window.some((item) => item.role === role)).toBe(true)
  })
})
