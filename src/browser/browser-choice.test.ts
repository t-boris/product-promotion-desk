import { describe, expect, it } from 'vitest'
import { CHROME_PLATFORMS, chooseBrowser } from './browser-choice'

describe('which browser an account works in', () => {
  it('uses Chrome for Facebook, and the built-in browser for everything else', () => {
    expect(chooseBrowser('facebook', undefined, true)).toEqual({ kind: 'chrome', note: null })
    expect(chooseBrowser('Facebook', undefined, true).kind).toBe('chrome')
    for (const platform of ['reddit', 'instagram', 'x', 'linkedin', 'facebookish', '']) {
      expect(chooseBrowser(platform, undefined, true), platform).toEqual({ kind: 'app', note: null })
    }
    expect(CHROME_PLATFORMS).toEqual(['facebook'])
  })

  it('falls back to the built-in browser, and says so, when Chrome is wanted and not there', () => {
    const choice = chooseBrowser('facebook', undefined, false)
    expect(choice.kind).toBe('app')
    expect(choice.note).toContain('Google Chrome was not found')
    // A platform that never wanted Chrome says nothing about it.
    expect(chooseBrowser('reddit', undefined, false)).toEqual({ kind: 'app', note: null })
  })

  it('lets PPD_BROWSER pick for every platform, and ignores any other value', () => {
    expect(chooseBrowser('reddit', 'chrome', true)).toEqual({ kind: 'chrome', note: null })
    expect(chooseBrowser('facebook', 'app', true)).toEqual({ kind: 'app', note: null })
    expect(chooseBrowser('reddit', 'chrome', false).kind).toBe('app')
    expect(chooseBrowser('facebook', 'firefox', true).kind).toBe('chrome')
    expect(chooseBrowser('reddit', 'CHROME', true).kind).toBe('app')
    expect(chooseBrowser('facebook', '', true).kind).toBe('chrome')
  })
})
