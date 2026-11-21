/**
 * The application's own appearance follows the theme the owner chose (visual-system.md §33.4). The window's material (the vibrancy of the
 * sidebar), the traffic-light buttons, the menus and the pop-up lists are drawn by macOS in the appearance of the application, and the page
 * is drawn in the colours of the theme: a dark theme on a Mac in a light appearance would put light text on a light material. So
 * `nativeTheme.themeSource` is `light` or `dark` for a theme of that side and `system` for "Follow macOS".
 *
 * Electron's `nativeTheme` is global, so it also decides `prefers-color-scheme` for the browser windows of the accounts: a site that
 * answers that query shows its dark or light version to match the chosen theme. Pure over small interfaces so it is tested without Electron.
 */
import { nativeThemeSourceOf, type ThemeChoice } from '../shared/themes'

export interface NativeThemeLike {
  themeSource: 'system' | 'light' | 'dark'
}

export interface ThemeSource {
  settings: { app(): { theme: ThemeChoice } }
  events: { subscribe(listener: (event: { type: string; scope?: string }) => void): () => void }
}

/** Sets the application's appearance now and again on every change of the settings; returns the function that stops following. */
export function followTheme(native: NativeThemeLike, core: ThemeSource): () => void {
  const apply = (): void => {
    const next = nativeThemeSourceOf(core.settings.app().theme)
    // Setting it to the same value would still make macOS redraw every window.
    if (native.themeSource !== next) native.themeSource = next
  }
  apply()
  return core.events.subscribe((event) => {
    if (event.type === 'changed' && event.scope === 'settings') apply()
  })
}
