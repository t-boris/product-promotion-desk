import type { App, PowerMonitor, PowerSaveBlocker } from 'electron'
import type { Core } from '../core/core'
import { awakeDecision } from '../shared/keep-awake'
import { scheduleGraceMs } from '../shared/schedule'

export interface BackgroundOptions {
  app: Pick<App, 'setLoginItemSettings' | 'getLoginItemSettings' | 'isPackaged'>
  core: Core
  powerMonitor: Pick<PowerMonitor, 'isOnBatteryPower'>
  powerSaveBlocker: Pick<PowerSaveBlocker, 'start' | 'stop' | 'isStarted'>
  /** How often the schedule is asked what it waits for. */
  intervalMs?: number
}

const CHECK_INTERVAL_MS = 60_000

/**
 * Working while the owner is away (DEC-054, changing DEC-003):
 *  - "Start at login" registers the application as a login item; a start made by it opens no window (`openedAtLogin`), the application is in the menu bar;
 *  - "Keep the Mac awake for scheduled posts" holds the system's idle-sleep blocker while the schedule waits for an approved item or sends one
 *    (`awakeDecision`). It cannot wake a Mac that already sleeps and does not stop the sleep of a closed lid.
 * Both follow the settings: they are applied at start, on every change of the settings, and the blocker once a minute.
 */
export function installBackground({ app, core, powerMonitor, powerSaveBlocker, intervalMs = CHECK_INTERVAL_MS }: BackgroundOptions): { apply: () => void; stop: () => void } {
  let blocker: number | null = null
  let registered: boolean | null = null

  const applyLogin = (): void => {
    const wanted = core.settings.app().startAtLogin
    if (registered === wanted) return
    const first = registered === null
    registered = wanted
    // An unpackaged build would register the bare Electron binary: only the installed application is a login item.
    if (!app.isPackaged) return
    // At a start the system already has what an earlier run set: the login item is changed, and the change is logged, only when the two differ.
    if (first && loginItemNow(app) === wanted) return
    try {
      app.setLoginItemSettings({ openAtLogin: wanted })
      core.log.info('lifecycle', wanted ? 'The application now starts at login, in the menu bar' : 'The application no longer starts at login')
    } catch (error) {
      core.log.warn('lifecycle', `The login item could not be changed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const release = (): void => {
    if (blocker !== null && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
    if (blocker !== null) core.log.info('lifecycle', 'The Mac may sleep again: the schedule waits for nothing')
    blocker = null
  }

  const applyAwake = (): void => {
    const settings = core.settings.app()
    const awaited = core.services.sending?.awaited() ?? { dueTimes: [], sending: false }
    const decision = awakeDecision({
      enabled: settings.keepAwake,
      paused: core.settings.getRaw('automation.paused', false),
      onBattery: powerMonitor.isOnBatteryPower(),
      sending: awaited.sending,
      dueTimes: awaited.dueTimes,
      graceMs: scheduleGraceMs(settings.scheduleGraceHours),
      nowMs: core.clock.now().getTime()
    })
    if (!decision.hold) return release()
    if (blocker !== null && powerSaveBlocker.isStarted(blocker)) return
    blocker = powerSaveBlocker.start('prevent-app-suspension')
    core.log.info('lifecycle', decision.forMs === null ? 'The Mac is kept awake while something is being sent' : `The Mac is kept awake for the item planned for ${new Date(decision.forMs).toISOString()}`)
  }

  const apply = (): void => {
    applyLogin()
    try {
      applyAwake()
    } catch (error) {
      core.log.warn('lifecycle', `The schedule could not be asked what it waits for: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  apply()
  const timer = setInterval(apply, intervalMs)
  timer.unref?.()
  return {
    apply,
    stop: () => {
      clearInterval(timer)
      release()
    }
  }
}

/** Whether this start was made by the login item: the application then stays in the menu bar and opens no window. */
/** Whether the system has the application as a login item now; null when it cannot say. */
function loginItemNow(app: Pick<App, 'getLoginItemSettings'>): boolean | null {
  try {
    return app.getLoginItemSettings().openAtLogin === true
  } catch {
    return null
  }
}

export function openedAtLogin(app: Pick<App, 'getLoginItemSettings'>): boolean {
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin === true
  } catch {
    return false
  }
}
