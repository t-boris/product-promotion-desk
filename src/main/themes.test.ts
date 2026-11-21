import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SYSTEM_THEMES, THEMES, THEME_IDS, type ThemeChoice, type ThemeId } from '../shared/themes'
import { ratioText } from './theme-contrast'
import { contrastOf, environment, parseRules, rootValues, selectorsDeclaring, tokenColor, type Rule } from './theme-css'
import { PAIRS, PALETTE_TOKENS, SCHEME_TOKENS } from './theme-pairs'

/**
 * The themes as the stylesheet defines them (visual-system.md §33, DEC-036, DEC-047). `styles.css` is read as a browser reads it for the
 * root element: the real cascade, so a rule a theme should win but loses shows up here. The contract:
 *   - the registry and the stylesheet name the same themes, and "Follow macOS" is Daylight in light and Graphite in dark, token for token;
 *   - a theme sets only backgrounds, surfaces and the accent: every other colour (text, red, amber, green, blue, the neutral fills, shadows,
 *     the chart series) is the scheme's and is the same in every theme of one side;
 *   - a theme looks the same whatever macOS is set to, and nothing else in the renderer follows macOS instead of the theme;
 *   - every pair the design document names holds its contrast in every theme, with the fills stacked as the browser paints them;
 *   - the animated background is off unless asked for, never runs under "Reduce motion", takes no pointer events and moves by transform only.
 */

const RENDERER = join(import.meta.dirname, '../renderer/src')
const STYLES = readFileSync(join(RENDERER, 'styles.css'), 'utf8')

const PALETTE = new Set<string>(PALETTE_TOKENS.map((t) => `--${t}`))
const SCHEME = new Set<string>(SCHEME_TOKENS.map((t) => `--${t}`))

function valuesFor(choice: ThemeChoice, options: { systemDark?: boolean; css?: string } = {}): Map<string, string> {
  const attrs = choice === 'system' ? {} : { 'data-theme': choice }
  return rootValues(options.css ? parseRules(options.css) : parseRules(STYLES), environment({ attrs, dark: options.systemDark ?? false }))
}

/** What the page paints for the choice: for "Follow macOS", Daylight under a light appearance and Graphite under a dark one. */
const CHOICES: { name: string; values: (css?: string) => Map<string, string> }[] = [
  { name: 'macOS light', values: (css) => valuesFor('system', { css }) },
  { name: 'macOS dark', values: (css) => valuesFor('system', { systemDark: true, css }) },
  ...THEME_IDS.map((id) => ({ name: id, values: (css?: string) => valuesFor(id, { css }) }))
]

function tokensOf(values: Map<string, string>, names: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, values.get(`--${name}`)]))
}

const idsIn = (selectors: string[]): string[] => selectors.flatMap((s) => [...s.matchAll(/\[data-theme='([a-z]+)'\]/g)].map((m) => m[1]))
const mentionsSystem = (selectors: string[]): boolean => selectors.some((s) => s === ':root:not([data-theme])')

describe('the themes the stylesheet defines', () => {
  it('names exactly the themes of the registry, each with a palette', () => {
    const rules = parseRules(STYLES)
    const named = new Set(rules.flatMap((rule) => idsIn(rule.selectors)))
    expect([...named].sort()).toEqual([...THEME_IDS].sort())
    for (const id of THEME_IDS) {
      const palette = rules.filter((rule) => idsIn(rule.selectors).includes(id) && rule.declarations.some(([p]) => PALETTE.has(p)))
      expect(palette.length, `${id} has a palette rule`).toBeGreaterThan(0)
    }
  })

  it('offers at least two dark and two light themes with a palette of their own', () => {
    const light = THEME_IDS.filter((id) => THEMES[id].scheme === 'light')
    const dark = THEME_IDS.filter((id) => THEMES[id].scheme === 'dark')
    expect(light.length).toBeGreaterThanOrEqual(2)
    expect(dark.length).toBeGreaterThanOrEqual(2)
    // Distinct: no two themes share a page colour or an accent.
    const pages = THEME_IDS.map((id) => valuesFor(id).get('--surface-0'))
    const accents = THEME_IDS.map((id) => valuesFor(id).get('--accent'))
    expect(new Set(pages).size).toBe(THEME_IDS.length)
    expect(new Set(accents).size).toBe(THEME_IDS.length)
  })

  it('defines every token of the palette and the scheme in every theme and under both macOS appearances', () => {
    for (const choice of CHOICES) {
      const values = choice.values()
      for (const name of [...PALETTE_TOKENS, ...SCHEME_TOKENS]) expect(values.has(`--${name}`), `${choice.name} defines --${name}`).toBe(true)
    }
  })

  it('"Follow macOS" is Daylight in a light appearance and Graphite in a dark one, token for token', () => {
    const all = [...PALETTE_TOKENS, ...SCHEME_TOKENS]
    expect(tokensOf(valuesFor('system'), all)).toEqual(tokensOf(valuesFor(SYSTEM_THEMES.light), all))
    expect(tokensOf(valuesFor('system', { systemDark: true }), all)).toEqual(tokensOf(valuesFor(SYSTEM_THEMES.dark), all))
    expect(THEMES[SYSTEM_THEMES.light].scheme).toBe('light')
    expect(THEMES[SYSTEM_THEMES.dark].scheme).toBe('dark')
  })

  it('keeps the system look of 0.23: the values Daylight and Graphite hold are the ones the application shipped with', () => {
    const light = valuesFor('daylight')
    const dark = valuesFor('graphite')
    expect(tokensOf(light, ['surface-0', 'surface-1', 'surface-2', 'surface-3', 'sidebar-solid', 'field', 'field-border', 'bezel', 'line', 'line-strong', 'accent', 'accent-tint', 'accent-on-tint', 'focus', 'segment-thumb'])).toEqual({
      'surface-0': '#f5f5f7',
      'surface-1': '#ffffff',
      'surface-2': '#f0f0f2',
      'surface-3': '#ffffff',
      'sidebar-solid': '#e8e8ed',
      field: '#ffffff',
      'field-border': '#a8a8ae',
      bezel: '#ffffff',
      line: '#e3e3e8',
      'line-strong': '#c7c7cc',
      accent: '#5856d6',
      'accent-tint': 'rgb(88 86 214 / 12%)',
      'accent-on-tint': '#4e4cc8',
      focus: '#5856d6',
      'segment-thumb': '#ffffff'
    })
    expect(tokensOf(dark, ['surface-0', 'surface-1', 'surface-2', 'surface-3', 'sidebar-solid', 'field', 'field-border', 'bezel', 'line', 'line-strong', 'accent', 'accent-tint', 'accent-on-tint', 'focus', 'segment-thumb'])).toEqual({
      'surface-0': '#1e1e20',
      'surface-1': '#28282b',
      'surface-2': '#313135',
      'surface-3': '#2c2c2f',
      'sidebar-solid': '#252528',
      field: '#323236',
      'field-border': '#636369',
      bezel: '#3a3a3e',
      line: '#38383c',
      'line-strong': '#4b4b50',
      accent: '#5e5ce6',
      'accent-tint': 'rgb(94 92 230 / 26%)',
      'accent-on-tint': '#a5a3ff',
      focus: '#a5a3ff',
      'segment-thumb': '#545458'
    })
  })

  it('looks the same whatever macOS is set to once a theme is chosen', () => {
    for (const id of THEME_IDS) {
      const underLight = valuesFor(id, { systemDark: false })
      const underDark = valuesFor(id, { systemDark: true })
      expect([...underDark].sort(), `${id} does not change with macOS`).toEqual([...underLight].sort())
    }
  })

  it('tells the page which side a theme is on, so native controls and scrollbars follow the theme', () => {
    for (const id of THEME_IDS) expect(valuesFor(id).get('color-scheme'), id).toBe(THEMES[id].scheme)
    expect(valuesFor('system').get('color-scheme')).toBe('light dark')
  })
})

describe('a theme changes only backgrounds, surfaces and the accent (DEC-047)', () => {
  it('shares every other colour with the themes of its own side: text, red, amber, green, blue, fills, shadows and chart series', () => {
    const light = valuesFor('daylight')
    const dark = valuesFor('graphite')
    for (const id of THEME_IDS) {
      const reference = THEMES[id].scheme === 'light' ? light : dark
      expect(tokensOf(valuesFor(id), SCHEME_TOKENS), `${id} keeps the scheme's tokens`).toEqual(tokensOf(reference, SCHEME_TOKENS))
    }
  })

  it('keeps red, amber and green the same in every theme, in both schemes', () => {
    for (const side of ['light', 'dark'] as const) {
      const themes = THEME_IDS.filter((id) => THEMES[id].scheme === side)
      const values = themes.map((id) => tokensOf(valuesFor(id), ['error', 'error-bg', 'on-error', 'attention', 'attention-bg', 'on-attention', 'success', 'success-bg', 'info', 'info-bg']))
      for (const v of values) expect(v).toEqual(values[0])
    }
  })

  it('declares a palette token only in the rule of one theme, and a scheme token only for a whole side at once', () => {
    const rules = parseRules(STYLES)
    const light = new Set(THEME_IDS.filter((id) => THEMES[id].scheme === 'light'))
    const dark = new Set(THEME_IDS.filter((id) => THEMES[id].scheme === 'dark'))
    const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x))
    for (const rule of rules) {
      const themes = new Set(idsIn(rule.selectors))
      const system = mentionsSystem(rule.selectors)
      const inDarkMedia = rule.conditions.some((c) => c.includes('prefers-color-scheme: dark'))
      for (const [property] of rule.declarations) {
        const where = `${rule.selectors.join(', ')} declares ${property}`
        // The base :root rule holds what no theme changes, and the default of the sidebar material and of color-scheme (macOS decides).
        const base = rule.selectors.length === 1 && rule.selectors[0] === ':root' && rule.conditions.length === 0
        if (base) {
          expect(PALETTE.has(property) && property !== '--sidebar-native', `${where}: the base rule holds no palette colour`).toBe(false)
          expect(SCHEME.has(property), `${where}: the base rule holds no scheme colour`).toBe(false)
        } else if (SCHEME.has(property) || property === 'color-scheme') {
          const wholeSide = sameSet(themes, light) || sameSet(themes, dark) || (themes.size === 0 && system && inDarkMedia)
          expect(wholeSide, `${where}: a scheme token belongs to every theme of a side, not to one theme`).toBe(true)
          if (system && !inDarkMedia) expect(sameSet(themes, light), `${where}: macOS light is the light side`).toBe(true)
        } else if (PALETTE.has(property)) {
          if (themes.size === 0 && !system) {
            expect(property, `${where}: only the default of the sidebar material lives outside a theme`).toBe('--sidebar-native')
          } else {
            const one = themes.size === 1 && !system
            const lightDefault = system && !inDarkMedia && sameSet(themes, new Set([SYSTEM_THEMES.light]))
            const darkDefault = system && inDarkMedia && themes.size === 0
            expect(one || lightDefault || darkDefault, `${where}: a palette belongs to one theme (or to the one "Follow macOS" shows)`).toBe(true)
          }
        } else if (themes.size > 0 || system) {
          expect.fail(`${where}: a theme rule may set only backgrounds, surfaces and the accent`)
        }
      }
    }
  })

  it('never lets a theme replace the sidebar material unless it names its own colour for it', () => {
    for (const id of THEME_IDS) {
      const own = valuesFor(id).get('--sidebar-native')
      if (id === SYSTEM_THEMES.light || id === SYSTEM_THEMES.dark) expect(own, `${id} shows the window's material`).toBe('transparent')
      else expect(own, `${id} paints its own sidebar`).toBe('var(--sidebar-solid)')
    }
    const native = environment({ attrs: { 'data-chrome': 'native' } })
    const reduced = environment({ attrs: { 'data-chrome': 'native' }, reducedTransparency: true })
    const rules = parseRules(STYLES)
    expect(rootValues(rules, native).get('--sidebar')).toBe('var(--sidebar-native)')
    expect(rootValues(rules, reduced).get('--sidebar')).toBe('var(--sidebar-solid)')
    expect(rootValues(rules, environment()).get('--sidebar')).toBe('var(--sidebar-solid)')
  })

  it('draws the pop-up chevron in the colour of secondary text of the theme\'s side', () => {
    for (const choice of CHOICES) {
      const values = choice.values()
      const stroke = /stroke='%23([0-9a-f]{6})'/.exec(values.get('--glyph-updown') ?? '')
      expect(stroke, `${choice.name} has a chevron`).not.toBeNull()
      expect(`#${stroke![1]}`, `${choice.name} chevron`).toBe(values.get('--text-2'))
    }
  })

  it('leaves the accent where the design system put it: no stylesheet outside the token block sets or mixes a theme colour of its own', () => {
    const files = readdirSync(RENDERER, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.css'))
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) {
      if (file === 'styles.css') continue
      const rules = parseRules(readFileSync(join(RENDERER, file), 'utf8'))
      const declared = selectorsDeclaring(rules, (p) => PALETTE.has(p) || SCHEME.has(p))
      expect(declared, `${file} does not declare a theme or scheme token`).toEqual([])
      expect(readFileSync(join(RENDERER, file), 'utf8'), `${file} follows the theme, not macOS`).not.toMatch(/prefers-color-scheme/)
    }
    // And styles.css itself asks macOS for its appearance in exactly one place: the system default of the token block.
    const asked = parseRules(STYLES).filter((rule) => rule.conditions.some((c) => c.includes('prefers-color-scheme')))
    expect(asked.every((rule) => rule.selectors.every((s) => s === ':root:not([data-theme])'))).toBe(true)
  })
})

/** The looks the application shipped with: their pointer-over states were 4.29:1 to 4.8:1 before themes and stay as they are (§33.6). */
const SHIPPED = new Set(['macOS light', 'macOS dark', 'daylight', 'graphite'])
/** The least a pair may have in a look: the document's limit, and 4.5:1 for the pointer-over states of every theme that is new. */
const leastFor = (look: string, pair: { kind: string; min: number }): number => (pair.kind === 'hover' && !SHIPPED.has(look) ? 4.5 : pair.min)

describe('contrast in every theme (visual-system.md §5, §12, §33)', () => {
  it('holds every pair the design document names, with the fills stacked as they are painted', () => {
    const failures: string[] = []
    for (const choice of CHOICES) {
      const values = choice.values()
      for (const pair of PAIRS) {
        const ratio = contrastOf(values, pair.foreground, pair.background)
        const least = leastFor(choice.name, pair)
        if (ratio < least) failures.push(`${choice.name}: ${pair.id} = ${ratioText(ratio)} < ${least} (${pair.use})`)
      }
    }
    expect(failures).toEqual([])
  })

  it('holds a pointer-over state of a new theme to 4.5:1, not only the 4.0:1 the shipped looks have', () => {
    const hover = PAIRS.filter((pair) => pair.kind === 'hover')
    expect(hover.length).toBeGreaterThanOrEqual(4)
    for (const id of ['lagoon', 'orchid', 'midnight', 'aubergine'] as const) {
      const values = valuesFor(id)
      for (const pair of hover) expect(contrastOf(values, pair.foreground, pair.background), `${id}: ${pair.id}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('measures what it claims: the neutral tag over a striped row of the dark system theme is the document\'s 4.78:1', () => {
    const values = valuesFor('graphite')
    expect(ratioText(contrastOf(values, 'text-2', ['surface-1', 'hover-fill', 'segment-track']))).toBe('4.78')
    expect(ratioText(contrastOf(valuesFor('daylight'), 'text-3', ['surface-2']))).toBe('4.59')
    expect(ratioText(contrastOf(valuesFor('daylight'), 'on-accent', ['accent']))).toBe('5.65')
    expect(ratioText(contrastOf(valuesFor('graphite'), 'on-accent', ['accent']))).toBe('5.06')
  })

  it('breaks the build when a theme fails: a darker page, a paler accent text and a lighter dark surface each fail a pair', () => {
    const failing = (css: string, choice: string): string[] => {
      const values = CHOICES.find((c) => c.name === choice)!.values(css)
      return PAIRS.filter((pair) => contrastOf(values, pair.foreground, pair.background) < leastFor(choice, pair)).map((pair) => pair.id)
    }
    expect(failing(STYLES, 'lagoon')).toEqual([])
    expect(failing(STYLES.replace('--surface-2: #e9f3f4;', '--surface-2: #cfe3e5;'), 'lagoon')).toContain('text-3 on surface-2')
    expect(failing(STYLES.replace('--accent-on-tint: #6d1fb4;', '--accent-on-tint: #b58be0;'), 'orchid')).toContain('accent-on-tint on surface-1')
    expect(failing(STYLES.replace('--surface-2: #1d2944;', '--surface-2: #4a5f8f;'), 'midnight')).toContain('text-3 on surface-2')
    expect(failing(STYLES.replace('--accent: #a21caf;', '--accent: #d946ef;'), 'aubergine')).toContain('on-accent on accent')
    // A pointer-over state of a new theme is held to 4.5:1: Midnight with its first bezel (4.31:1 for red text on it under the pointer) fails.
    expect(failing(STYLES.replace('--bezel: #263453;', '--bezel: #2a3a5c;'), 'midnight')).toContain('error on bezel-hover')
  })

  it('catches a theme that borrows a status colour or slips a theme rule into the wrong side', () => {
    const css = STYLES.replace("[data-theme='lagoon'] {\n  --surface-0", "[data-theme='lagoon'] {\n  --error: #ff0000;\n  --surface-0")
    expect(css).not.toBe(STYLES)
    const rules = parseRules(css)
    const lagoon = rules.find((rule) => rule.selectors.length === 1 && rule.selectors[0] === "[data-theme='lagoon']" && rule.declarations.some(([p]) => p === '--surface-0'))!
    expect(lagoon.declarations.map(([p]) => p)).toContain('--error')
    expect(valuesFor('lagoon', { css }).get('--error')).toBe('#ff0000')
    expect(valuesFor('daylight', { css }).get('--error')).toBe('#b42318')
  })

  it('keeps text readable on the page while the animated background glows behind it, in each theme', () => {
    const thresholds = new Map<ThemeId, number>()
    for (const id of THEME_IDS) {
      const values = valuesFor(id)
      const worst = Math.min(...PAIRS.filter((p) => p.use === 'page under the animated background' && p.foreground === 'text-3').map((p) => contrastOf(values, p.foreground, p.background)))
      thresholds.set(id, worst)
      expect(worst, `${id}: placeholder text over the glow`).toBeGreaterThanOrEqual(4.5)
    }
    // A glow that is too strong is caught: Daylight with a dark indigo wash fails the page.
    const heavy = STYLES.replace('--drift-b: rgb(236 238 255 / 70%);', '--drift-b: rgb(88 86 214 / 40%);')
    const values = valuesFor('daylight', { css: heavy })
    expect(PAIRS.filter((p) => p.use === 'page under the animated background').some((p) => contrastOf(values, p.foreground, p.background) < p.min)).toBe(true)
  })

  it('keeps every accent away in hue from the colours that carry a meaning, as far as the shipped indigo is from the information blue', () => {
    // The shipped indigo sits 19.9 degrees from the information blue; no theme's accent (or its text on a tint) may be closer than that to
    // red, amber, green or blue, so a button in a theme never reads as a failure, a decision, a success or a note.
    const FLOOR = 19
    const hueOf = ({ r, g, b }: { r: number; g: number; b: number }): number => {
      const [x, y, z] = [r / 255, g / 255, b / 255]
      const max = Math.max(x, y, z)
      const d = max - Math.min(x, y, z)
      const h = max === x ? ((y - z) / d) % 6 : max === y ? (z - x) / d + 2 : (x - y) / d + 4
      return (h * 60 + 360) % 360
    }
    const apart = (a: number, b: number): number => Math.min(Math.abs(a - b) % 360, 360 - (Math.abs(a - b) % 360))
    for (const id of THEME_IDS) {
      const values = valuesFor(id)
      for (const token of ['accent', 'accent-on-tint'] as const) {
        for (const status of ['error', 'attention', 'success', 'info'] as const) {
          const away = apart(hueOf(tokenColor(values, token)), hueOf(tokenColor(values, status)))
          expect(away, `${id} ${token} against ${status}`).toBeGreaterThanOrEqual(FLOOR)
        }
      }
    }
  })
})

describe('the animated background (visual-system.md §33.3)', () => {
  const rules: Rule[] = parseRules(STYLES)
  const animating = (rule: Rule): boolean => rule.declarations.some(([p, v]) => p === 'animation' && v !== 'none')

  it('is off by default: nothing draws or moves without data-animated="on"', () => {
    const layer = rules.filter((rule) => rule.selectors.some((s) => s.includes('::before') && s.includes('.main')))
    expect(layer.length).toBeGreaterThan(0)
    for (const rule of layer) for (const selector of rule.selectors) expect(selector.startsWith("html[data-animated='on']"), selector).toBe(true)
    // The drift animation is started by no other rule.
    for (const rule of rules.filter(animating)) {
      if (rule.declarations.some(([, v]) => v.includes('ppd-drift'))) expect(rule.selectors.every((s) => s.startsWith("html[data-animated='on']"))).toBe(true)
    }
    // The name is the layer's animation and the keyframes it plays: the check above is not satisfied by a rule that does not exist.
    expect(rules.some((rule) => rule.declarations.some(([p, v]) => p === 'animation' && v.includes('ppd-drift')))).toBe(true)
    expect(STYLES).toMatch(/@keyframes ppd-drift\s*\{/)
  })

  it('stops under Reduce motion even if the attribute were set', () => {
    const stopped = rules.filter((rule) => rule.conditions.some((c) => c.includes('prefers-reduced-motion: reduce')) && rule.selectors.some((s) => s.includes('.main::before')))
    expect(stopped.length).toBe(1)
    const declared = Object.fromEntries(stopped[0].declarations)
    expect(declared.animation).toBe('none')
    expect(declared.display).toBe('none')
  })

  it('is a layer of its own that never takes the pointer, never holds content and is told to the compositor only while it runs', () => {
    const layer = rules.find((rule) => rule.selectors.includes("html[data-animated='on'] .main::before") && rule.conditions.length === 0)!
    const declared = Object.fromEntries(layer.declarations)
    expect(declared['pointer-events']).toBe('none')
    expect(declared.position).toBe('absolute')
    expect(declared['z-index']).toBe('-1')
    expect(declared.content).toBe("''")
    expect(declared['will-change']).toBe('transform')
    const willChange = rules.filter((rule) => rule.declarations.some(([p, v]) => p === 'will-change' && v !== 'auto'))
    expect(willChange.every((rule) => rule.selectors.every((s) => s.startsWith("html[data-animated='on']")))).toBe(true)
  })

  it('moves by transform only and slowly', () => {
    const keyframes = /@keyframes ppd-drift\s*\{([\s\S]*?)\n\}/.exec(STYLES)
    expect(keyframes).not.toBeNull()
    const properties = [...keyframes![1].matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])
    expect(new Set(properties)).toEqual(new Set(['transform']))
    const layer = rules.find((rule) => rule.selectors.includes("html[data-animated='on'] .main::before") && rule.conditions.length === 0)!
    const animation = Object.fromEntries(layer.declarations).animation as string
    const seconds = /\s(\d+(?:\.\d+)?)s\s/.exec(animation)
    expect(Number(seconds?.[1])).toBeGreaterThanOrEqual(30)
    expect(animation).toContain('infinite')
  })

  it('paints its glow from the theme\'s two drift colours and nothing else', () => {
    const layer = rules.find((rule) => rule.selectors.includes("html[data-animated='on'] .main::before") && rule.conditions.length === 0)!
    const background = Object.fromEntries(layer.declarations).background as string
    expect(background).toContain('var(--drift-a)')
    expect(background).toContain('var(--drift-b)')
    expect(background).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i)
  })
})
