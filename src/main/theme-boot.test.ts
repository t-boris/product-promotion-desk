import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { THEME_IDS, animationStateOf, appearanceOf, applyThemeAttributes } from '../shared/themes'

/**
 * The script that puts the chosen theme on the page before the first paint (src/renderer/public/theme-boot.js, visual-system.md §33.5) is
 * plain JavaScript that cannot import the shared rules. This test holds it equal to them: whatever the stored hint is, it leaves the page with
 * the attributes `appearanceOf`, `animationStateOf` and `applyThemeAttributes` give.
 */

const SCRIPT_PATH = join(import.meta.dirname, '../renderer/public/theme-boot.js')
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8')
const INDEX_HTML = readFileSync(join(import.meta.dirname, '../renderer/index.html'), 'utf8')

type Attributes = Record<string, string>

class FakeRoot {
  readonly attributes = new Map<string, string>()
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
}

interface Page {
  /** What localStorage holds under the hint's key; `throws` plays storage that cannot be read. */
  stored: string | null | 'throws'
  reducedMotion: boolean
  /** Whether the page has window.matchMedia at all. */
  hasMatchMedia?: boolean
}

function runScript(page: Page): Attributes {
  const root = new FakeRoot()
  const localStorage = {
    getItem: (key: string): string | null => {
      if (key !== 'ppd-appearance') return null
      if (page.stored === 'throws') throw new Error('blocked')
      return page.stored
    }
  }
  const window = page.hasMatchMedia === false ? {} : { matchMedia: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' && page.reducedMotion }) }
  runInNewContext(SCRIPT, { document: { documentElement: root }, localStorage, window, JSON })
  return Object.fromEntries(root.attributes)
}

/** What the application's own rules put on the page for the same hint. */
function expected(page: Page): Attributes {
  let value: unknown
  try {
    if (page.stored === 'throws') throw new Error('blocked')
    value = page.stored ? JSON.parse(page.stored) : undefined
  } catch {
    value = undefined
  }
  const appearance = appearanceOf(value)
  const root = new FakeRoot()
  applyThemeAttributes(root, appearance.theme, animationStateOf(appearance.animatedBackground, page.reducedMotion))
  return Object.fromEntries(root.attributes)
}

describe('the boot script equals the application rules', () => {
  it('lists the same themes as the registry', () => {
    const list = /var THEMES = \[([^\]]*)\]/.exec(SCRIPT)
    expect(list).not.toBeNull()
    const ids = [...list![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    expect(ids).toEqual([...THEME_IDS])
  })

  it('sets the theme and the animation for every valid hint, and not the animation under Reduce motion', () => {
    for (const theme of ['system', ...THEME_IDS]) {
      for (const animatedBackground of [true, false]) {
        for (const reducedMotion of [true, false]) {
          const page: Page = { stored: JSON.stringify({ theme, animatedBackground }), reducedMotion }
          expect(runScript(page), JSON.stringify(page)).toEqual(expected(page))
        }
      }
    }
  })

  it('leaves the page alone for anything unreadable: no hint, a damaged one, unknown values, storage that throws, no matchMedia', () => {
    const stored: Page['stored'][] = [
      null,
      '',
      'null',
      '[]',
      '"midnight"',
      '42',
      '{',
      '{"theme":"neon"}',
      '{"theme":7,"animatedBackground":"true"}',
      '{"theme":"Midnight"}',
      '{"theme":"__proto__"}',
      '{"theme":"midnight","animatedBackground":"yes"}',
      '{"animatedBackground":1}',
      'throws'
    ]
    for (const value of stored) {
      for (const reducedMotion of [true, false]) {
        const page: Page = { stored: value, reducedMotion }
        expect(runScript(page), JSON.stringify(page)).toEqual(expected(page))
      }
    }
    expect(runScript({ stored: JSON.stringify({ theme: 'midnight', animatedBackground: true }), reducedMotion: false, hasMatchMedia: false })).toEqual({ 'data-theme': 'midnight', 'data-animated': 'on' })
  })

  it('never turns the animation on by default', () => {
    expect(runScript({ stored: null, reducedMotion: false })).toEqual({})
    expect(runScript({ stored: JSON.stringify({ theme: 'orchid' }), reducedMotion: false })).toEqual({ 'data-theme': 'orchid' })
  })
})

describe('the page loads the boot script before anything is painted', () => {
  it('is a classic script in <head>, before the module that starts the application, and from a path that works from a file and from a server', () => {
    const head = INDEX_HTML.slice(INDEX_HTML.indexOf('<head>'), INDEX_HTML.indexOf('</head>'))
    expect(head).toMatch(/<script src="\.\/theme-boot\.js"><\/script>/)
    expect(head).not.toMatch(/<script[^>]*type="module"[^>]*theme-boot/)
    // The application's own module is in the body, so the boot script runs first.
    expect(INDEX_HTML.indexOf('theme-boot.js')).toBeLessThan(INDEX_HTML.indexOf('/src/main.tsx'))
  })

  it('uses the key theme.ts stores the hint under', () => {
    const theme = readFileSync(join(import.meta.dirname, '../renderer/src/theme.ts'), 'utf8')
    expect(/const HINT_KEY = '([^']+)'/.exec(theme)?.[1]).toBe('ppd-appearance')
    expect(SCRIPT).toContain("localStorage.getItem('ppd-appearance')")
  })
})
