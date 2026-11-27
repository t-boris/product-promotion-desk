import { describe, expect, it } from 'vitest'
import { installBackground, openedAtLogin } from './background'

/** The least of a core the module reads: settings, the schedule's answer, the clock and the log. */
function fakeCore(settings: Record<string, unknown>, awaited: { dueTimes: string[]; sending: boolean }, paused = false) {
  const lines: string[] = []
  const core = {
    settings: { app: () => settings, getRaw: (_key: string, fallback: boolean) => (paused ? true : fallback) },
    services: { sending: { awaited: () => awaited } },
    clock: { now: () => new Date('2026-12-01T10:00:00.000Z') },
    log: { info: (_s: string, m: string) => lines.push(m), warn: (_s: string, m: string) => lines.push(`warn: ${m}`) }
  }
  return { core: core as never, lines }
}

function fakePower() {
  const started = new Set<number>()
  let next = 1
  const calls: string[] = []
  return {
    calls,
    started,
    blocker: {
      start: (kind: string) => {
        calls.push(`start ${kind}`)
        started.add(next)
        return next++
      },
      stop: (id: number) => {
        calls.push('stop')
        return started.delete(id)
      },
      isStarted: (id: number) => started.has(id)
    }
  }
}

const fakeApp = (packaged = true, atLogin = false) => {
  const login: unknown[] = []
  return { login, app: { isPackaged: packaged, setLoginItemSettings: (s: unknown) => login.push(s), getLoginItemSettings: () => ({ wasOpenedAtLogin: atLogin }) } as never }
}

const settings = (patch: Record<string, unknown> = {}) => ({ startAtLogin: false, keepAwake: true, scheduleGraceHours: 6, ...patch })

describe('working in the background (DEC-054)', () => {
  it('holds the sleep blocker while an approved item is waited for, once, and releases it when nothing is', () => {
    const awaited = { dueTimes: ['2026-12-01T11:00:00.000Z'], sending: false }
    const { core, lines } = fakeCore(settings(), awaited)
    const power = fakePower()
    const background = installBackground({ app: fakeApp().app, core, powerMonitor: { isOnBatteryPower: () => false }, powerSaveBlocker: power.blocker, intervalMs: 3_600_000 })
    background.apply()
    expect(power.calls).toEqual(['start prevent-app-suspension'])
    expect(lines.join('\n')).toMatch(/kept awake for the item planned for 2026-12-01T11:00/)
    awaited.dueTimes = []
    background.apply()
    expect(power.calls).toEqual(['start prevent-app-suspension', 'stop'])
    expect(power.started.size).toBe(0)
    background.stop()
  })

  it('never holds it with the switch off, and lets go on stop', () => {
    const off = fakeCore(settings({ keepAwake: false }), { dueTimes: ['2026-12-01T10:05:00.000Z'], sending: true })
    const power = fakePower()
    installBackground({ app: fakeApp().app, core: off.core, powerMonitor: { isOnBatteryPower: () => false }, powerSaveBlocker: power.blocker, intervalMs: 3_600_000 }).stop()
    expect(power.calls).toEqual([])

    const on = fakeCore(settings(), { dueTimes: [], sending: true })
    const background = installBackground({ app: fakeApp().app, core: on.core, powerMonitor: { isOnBatteryPower: () => true }, powerSaveBlocker: power.blocker, intervalMs: 3_600_000 })
    expect(power.started.size).toBe(1)
    background.stop()
    expect(power.started.size).toBe(0)
  })

  it('registers the login item by the setting, once per change, and only for the installed application', () => {
    const state = settings({ startAtLogin: true })
    const { core } = fakeCore(state, { dueTimes: [], sending: false })
    const installed = fakeApp(true)
    const background = installBackground({ app: installed.app, core, powerMonitor: { isOnBatteryPower: () => false }, powerSaveBlocker: fakePower().blocker, intervalMs: 3_600_000 })
    background.apply()
    expect(installed.login).toEqual([{ openAtLogin: true }])
    state.startAtLogin = false
    background.apply()
    expect(installed.login).toEqual([{ openAtLogin: true }, { openAtLogin: false }])
    background.stop()

    const dev = fakeApp(false)
    installBackground({ app: dev.app, core, powerMonitor: { isOnBatteryPower: () => false }, powerSaveBlocker: fakePower().blocker, intervalMs: 3_600_000 }).stop()
    expect(dev.login).toEqual([])
  })

  it('knows a start made by the login item', () => {
    expect(openedAtLogin(fakeApp(true, true).app)).toBe(true)
    expect(openedAtLogin(fakeApp(true, false).app)).toBe(false)
  })
})
