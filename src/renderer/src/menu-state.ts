// Whether the main menu is shown. A per-viewer convenience, so it lives in browser storage and the app works without it:
// storage can be missing, blocked or full, and then the menu is simply shown.

const KEY = 'ppd.menu-open'

export interface MenuStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Shown unless the owner hid it. Anything unreadable counts as shown. */
export function readMenuOpen(storage: MenuStorage | undefined): boolean {
  try {
    return storage?.getItem(KEY) !== 'closed'
  } catch {
    return true
  }
}

export function saveMenuOpen(storage: MenuStorage | undefined, open: boolean): void {
  try {
    storage?.setItem(KEY, open ? 'open' : 'closed')
  } catch {
    // The choice is not remembered; nothing else depends on it.
  }
}
