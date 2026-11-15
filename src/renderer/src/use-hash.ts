import { useSyncExternalStore } from 'react'

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

/** The hash the window shows now; a screen that reads more of the address than the shell's page (a tab, the new-product form) follows it. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash)
}
