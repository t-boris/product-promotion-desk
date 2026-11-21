import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  REDUCED_MOTION_REASON,
  SYSTEM_THEMES,
  THEMES,
  THEME_IDS,
  animationStateOf,
  appearanceOf,
  applyThemeAttributes,
  isThemeChoice,
  nativeThemeSourceOf,
  schemeOf,
  themeAttributeOf,
  themeChoiceOf
} from './themes'

class FakeRoot {
  readonly attributes = new Map<string, string>()
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
}

describe('the registry of themes', () => {
  it('has a label, a side and a character for every id, with at least two themes on each side', () => {
    for (const id of THEME_IDS) {
      expect(THEMES[id].label.length).toBeGreaterThan(0)
      expect(THEMES[id].character.length).toBeGreaterThan(10)
      expect(['light', 'dark']).toContain(THEMES[id].scheme)
    }
    expect(THEME_IDS.filter((id) => THEMES[id].scheme === 'light').length).toBeGreaterThanOrEqual(2)
    expect(THEME_IDS.filter((id) => THEMES[id].scheme === 'dark').length).toBeGreaterThanOrEqual(2)
    expect(new Set(THEME_IDS.map((id) => THEMES[id].label)).size).toBe(THEME_IDS.length)
  })

  it('shows macOS the look the application had before themes: the default is "Follow macOS"', () => {
    expect(DEFAULT_THEME).toBe('system')
    expect(SYSTEM_THEMES).toEqual({ light: 'daylight', dark: 'graphite' })
  })
})

describe('reading a choice', () => {
  it('accepts "system" and every theme id, and nothing else', () => {
    expect(isThemeChoice('system')).toBe(true)
    for (const id of THEME_IDS) expect(isThemeChoice(id)).toBe(true)
    for (const bad of ['', 'Daylight', 'dark', 'light', 'SYSTEM', 'constructor', '__proto__', null, undefined, 3, {}, []]) expect(isThemeChoice(bad), String(bad)).toBe(false)
  })

  it('reads an unknown or malformed stored value as "Follow macOS", so it can never blank the page', () => {
    expect(themeChoiceOf('midnight')).toBe('midnight')
    expect(themeChoiceOf('neon')).toBe('system')
    expect(themeChoiceOf(undefined)).toBe('system')
    expect(themeChoiceOf(42)).toBe('system')
  })

  it('reads the two settings as appearance: still, and following macOS, unless both are plainly set', () => {
    expect(appearanceOf(undefined)).toEqual({ theme: 'system', animatedBackground: false })
    expect(appearanceOf(null)).toEqual({ theme: 'system', animatedBackground: false })
    expect(appearanceOf({})).toEqual({ theme: 'system', animatedBackground: false })
    expect(appearanceOf({ theme: 'orchid', animatedBackground: true })).toEqual({ theme: 'orchid', animatedBackground: true })
    // Only a real true turns the animation on: a string or a number from a damaged row does not.
    for (const loose of ['true', 'on', 1, 'yes', {}, []]) expect(appearanceOf({ animatedBackground: loose }).animatedBackground, String(loose)).toBe(false)
  })
})

describe('which side the page is on', () => {
  it('follows macOS only for "system"', () => {
    expect(schemeOf('system', false)).toBe('light')
    expect(schemeOf('system', true)).toBe('dark')
    for (const id of THEME_IDS) {
      expect(schemeOf(id, false)).toBe(THEMES[id].scheme)
      expect(schemeOf(id, true)).toBe(THEMES[id].scheme)
    }
  })

  it('tells Electron to follow the theme\'s side, and to follow macOS for "system"', () => {
    expect(nativeThemeSourceOf('system')).toBe('system')
    expect(nativeThemeSourceOf('daylight')).toBe('light')
    expect(nativeThemeSourceOf('lagoon')).toBe('light')
    expect(nativeThemeSourceOf('orchid')).toBe('light')
    expect(nativeThemeSourceOf('graphite')).toBe('dark')
    expect(nativeThemeSourceOf('midnight')).toBe('dark')
    expect(nativeThemeSourceOf('aubergine')).toBe('dark')
  })

  it('sets no attribute for "system", so the stylesheet follows macOS by itself', () => {
    expect(themeAttributeOf('system')).toBeNull()
    for (const id of THEME_IDS) expect(themeAttributeOf(id)).toBe(id)
  })
})

describe('the animated background is off unless asked for and never runs under "Reduce motion"', () => {
  it('is off for a setting that is off, and on only for a setting that is on and motion that is allowed', () => {
    expect(animationStateOf(false, false)).toEqual({ running: false, locked: false, reason: null })
    expect(animationStateOf(true, false)).toEqual({ running: true, locked: false, reason: null })
  })

  it('does not run when macOS asks for less motion, whatever the setting says, and explains why the switch is locked', () => {
    for (const setting of [true, false]) {
      const state = animationStateOf(setting, true)
      expect(state.running).toBe(false)
      expect(state.locked).toBe(true)
      expect(state.reason).toBe(REDUCED_MOTION_REASON)
      expect(state.reason).toMatch(/Reduce motion/)
    }
  })

  it('treats anything but a real true as off', () => {
    for (const loose of [undefined, null, 0, 1, 'true', 'on']) expect(animationStateOf(loose as never, false).running, String(loose)).toBe(false)
  })
})

describe('applying a choice to the page', () => {
  it('sets data-theme for a theme and removes it for "system"', () => {
    const root = new FakeRoot()
    applyThemeAttributes(root, 'lagoon', animationStateOf(false, false))
    expect(root.attributes.get('data-theme')).toBe('lagoon')
    applyThemeAttributes(root, 'system', animationStateOf(false, false))
    expect(root.attributes.has('data-theme')).toBe(false)
  })

  it('sets data-animated only while the background runs, and takes it away when it stops', () => {
    const root = new FakeRoot()
    applyThemeAttributes(root, 'system', animationStateOf(true, false))
    expect(root.attributes.get('data-animated')).toBe('on')
    applyThemeAttributes(root, 'system', animationStateOf(true, true))
    expect(root.attributes.has('data-animated')).toBe(false)
    applyThemeAttributes(root, 'system', animationStateOf(true, false))
    expect(root.attributes.get('data-animated')).toBe('on')
    applyThemeAttributes(root, 'system', animationStateOf(false, false))
    expect(root.attributes.has('data-animated')).toBe(false)
  })

  it('never sets data-animated by default', () => {
    const root = new FakeRoot()
    applyThemeAttributes(root, DEFAULT_THEME, animationStateOf(appearanceOf(undefined).animatedBackground, false))
    expect([...root.attributes.keys()]).toEqual([])
  })
})
