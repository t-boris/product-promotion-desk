import { describe, expect, it } from 'vitest'
import { chooseBrowser } from './browser-choice'

describe('chooseBrowser', () => {
  it('is the internal browser unless the account says Chrome', () => {
    expect(chooseBrowser(undefined, undefined)).toBe('internal')
    expect(chooseBrowser('internal', undefined)).toBe('internal')
    expect(chooseBrowser('chrome', undefined)).toBe('chrome')
  })

  it('lets PPD_BROWSER force one browser for every account, either way', () => {
    expect(chooseBrowser('internal', 'chrome')).toBe('chrome')
    expect(chooseBrowser('chrome', 'internal')).toBe('internal')
    expect(chooseBrowser(undefined, 'chrome')).toBe('chrome')
  })

  it('ignores a PPD_BROWSER it does not know', () => {
    expect(chooseBrowser('chrome', 'firefox')).toBe('chrome')
    expect(chooseBrowser('internal', '')).toBe('internal')
    expect(chooseBrowser('internal', 'app')).toBe('internal')
  })
})
