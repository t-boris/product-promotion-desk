import { describe, expect, it } from 'vitest'
import { EventBus } from '../core/events'
import { SettingsStore } from '../core/settings'
import { openDatabase } from '../core/db/database'
import { THEME_IDS, THEMES, type ThemeChoice } from '../shared/themes'
import { followTheme, type NativeThemeLike } from './native-theme'

function world(): { native: NativeThemeLike & { writes: number }; settings: SettingsStore; events: EventBus } {
  const settings = new SettingsStore(openDatabase(':memory:'))
  const events = new EventBus()
  let source: NativeThemeLike['themeSource'] = 'system'
  const native = {
    writes: 0,
    get themeSource() {
      return source
    },
    set themeSource(value: NativeThemeLike['themeSource']) {
      this.writes++
      source = value
    }
  }
  return { native, settings, events }
}

describe('the application appearance follows the chosen theme (visual-system.md §33.4)', () => {
  it('follows macOS by default, and for "Follow macOS"', () => {
    const { native, settings, events } = world()
    followTheme(native, { settings, events })
    expect(native.themeSource).toBe('system')
  })

  it('is light or dark for a theme of that side at start-up, before any window is made', () => {
    for (const id of THEME_IDS) {
      const { native, settings, events } = world()
      settings.updateApp({ theme: id })
      followTheme(native, { settings, events })
      expect(native.themeSource, id).toBe(THEMES[id].scheme)
    }
  })

  it('changes with every change of the settings and goes back to the system', () => {
    const { native, settings, events } = world()
    followTheme(native, { settings, events })
    const choose = (theme: ThemeChoice): void => {
      settings.updateApp({ theme })
      events.changed('settings')
    }
    choose('midnight')
    expect(native.themeSource).toBe('dark')
    choose('lagoon')
    expect(native.themeSource).toBe('light')
    choose('system')
    expect(native.themeSource).toBe('system')
  })

  it('does not touch the appearance when nothing about it changed, and ignores other changes', () => {
    const { native, settings, events } = world()
    settings.updateApp({ theme: 'orchid' })
    followTheme(native, { settings, events })
    const writes = native.writes
    events.changed('settings')
    events.changed('products')
    expect(native.writes).toBe(writes)
  })

  it('stops following when asked', () => {
    const { native, settings, events } = world()
    const stop = followTheme(native, { settings, events })
    stop()
    settings.updateApp({ theme: 'graphite' })
    events.changed('settings')
    expect(native.themeSource).toBe('system')
  })
})
