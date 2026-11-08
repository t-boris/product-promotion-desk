import type { App, PowerMonitor } from 'electron'
import type { Core } from '../core/core'

/** The part of the core's automation the main process drives from operating-system events. */
export interface PowerAware {
  onSuspend(): void
  onResume(): void
}

export interface LifecycleOptions {
  app: App
  core: Core
  /** Opens (or focuses) the main window. */
  showWindow: () => void
  windowCount: () => number
  automation: PowerAware
  powerMonitor: PowerMonitor
}

/** Orderly shutdown must never keep the process alive forever (a hung hook would otherwise block Quit). */
const SHUTDOWN_DEADLINE_MS = 15_000

/**
 * Background lifecycle (DEC-003, REQ-005):
 *  - closing the last window keeps automation running (nothing quits on 'window-all-closed');
 *  - only an explicit Quit (menu-bar item, Cmd+Q, system shutdown/logout) stops it, via the core's shutdown hooks;
 *  - sleep and wake are forwarded to the scheduler, which starts nothing during sleep and spreads overdue work on wake;
 *  - automatic startup at login is deliberately NOT configured (no setLoginItemSettings anywhere): after a restart
 *    or login the user launches the application by hand.
 */
export function installLifecycle({ app, core, showWindow, windowCount, automation, powerMonitor }: LifecycleOptions): { quit: () => void } {
  let quitting = false

  const markBackground = (): void => {
    core.background = windowCount() === 0
    core.events.changed('settings')
  }

  app.on('window-all-closed', () => {
    // Do not quit: automation continues in the background and stays reachable from the menu bar.
    markBackground()
  })

  app.on('activate', () => {
    showWindow()
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DEADLINE_MS))
    void Promise.race([core.shutdown(), deadline]).finally(() => app.exit(0))
  })

  powerMonitor.on('suspend', () => {
    core.log.info('lifecycle', 'System is going to sleep; scheduled work pauses')
    automation.onSuspend()
  })
  powerMonitor.on('resume', () => {
    core.log.info('lifecycle', 'System woke up; resuming scheduled work')
    automation.onResume()
  })
  // Logout or shutdown: leave in an orderly way so progress is persisted and the shutdown is recorded as clean.
  // Electron passes an event whose preventDefault() delays the shutdown until we have exited, but its typings
  // declare the listener without parameters, hence the assertion.
  powerMonitor.on('shutdown', ((event: { preventDefault: () => void }) => {
    event.preventDefault()
    app.quit()
  }) as () => void)

  return {
    quit: () => app.quit()
  }
}
