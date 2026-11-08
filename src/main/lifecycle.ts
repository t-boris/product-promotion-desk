import type { App } from 'electron'
import type { Core } from '../core/core'

export interface LifecycleOptions {
  app: App
  core: Core
  /** Opens (or focuses) the main window. */
  showWindow: () => void
  windowCount: () => number
}

/**
 * Background lifecycle (DEC-003): closing the last window keeps automation running; only an explicit Quit
 * stops it. Automatic startup at login is deliberately not configured.
 */
export function installLifecycle({ app, core, showWindow, windowCount }: LifecycleOptions): { quit: () => void } {
  let quitting = false

  const markBackground = (): void => {
    core.background = windowCount() === 0
    core.events.changed('settings')
  }

  app.on('window-all-closed', () => {
    // Do not quit: automation continues in the background.
    markBackground()
  })

  app.on('activate', () => {
    showWindow()
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void core.shutdown().finally(() => app.exit(0))
  })

  return {
    quit: () => app.quit()
  }
}
