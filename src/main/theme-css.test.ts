import { describe, expect, it } from 'vitest'
import { colorOfValue, contrastOf, environment, parseRules, rootValues, substituteVars, tokenColor } from './theme-css'

const values = (css: string, env = environment()): Map<string, string> => rootValues(parseRules(css), env)

describe('reading a stylesheet', () => {
  it('flattens media blocks with their conditions and skips keyframes and comments', () => {
    const rules = parseRules(`
      /* a { color: red } */
      :root { --a: 1; }
      @media (prefers-color-scheme: dark) { :root { --a: 2; } }
      @keyframes spin { from { transform: none } to { transform: rotate(1turn) } }
      @media (prefers-reduced-motion: reduce) { html[data-x='on'] .y::before { animation: none; } }
    `)
    expect(rules.map((r) => [r.selectors, r.conditions.length])).toEqual([
      [[':root'], 0],
      [[':root'], 1],
      [["html[data-x='on'] .y::before"], 1]
    ])
  })

  it('keeps a url() value with semicolons and quotes whole', () => {
    const [rule] = parseRules(`:root { --g: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><path d='M1 1'/></svg>"); --b: 1; }`)
    expect(rule.declarations.map(([p]) => p)).toEqual(['--g', '--b'])
    expect(rule.declarations[0][1]).toContain("d='M1 1'")
  })
})

describe('the cascade for the root element', () => {
  it('lets a more specific selector win over a later less specific one, and the later of two equal ones', () => {
    const css = `
      :root:not([data-theme]) { --x: system; }
      [data-theme='a'] { --x: a; }
      :root { --x: base; }
    `
    expect(values(css).get('--x')).toBe('system')
    expect(values(css, environment({ attrs: { 'data-theme': 'a' } })).get('--x')).toBe('base')
    // Two selectors of one specificity: the later rule wins.
    expect(values(`[data-theme='a'] { --x: 1; } [data-theme='a'] { --x: 2; }`, environment({ attrs: { 'data-theme': 'a' } })).get('--x')).toBe('2')
  })

  it('honours media conditions from the environment, and ignores a rule for something that is not the root element', () => {
    const css = `
      :root { --x: light; }
      @media (prefers-color-scheme: dark) { :root { --x: dark; } }
      .card { --x: card; }
      html[data-chrome='native'] .main { --x: main; }
    `
    expect(values(css).get('--x')).toBe('light')
    expect(values(css, environment({ dark: true })).get('--x')).toBe('dark')
    expect(values(css, environment({ attrs: { 'data-chrome': 'native' } })).get('--x')).toBe('light')
  })

  it('reads the reduced-transparency and reduced-motion conditions too', () => {
    const css = `
      html[data-chrome='native'] { --s: transparent; }
      @media (prefers-reduced-transparency: reduce) { html[data-chrome='native'] { --s: solid; } }
    `
    const native = { 'data-chrome': 'native' }
    expect(values(css, environment({ attrs: native })).get('--s')).toBe('transparent')
    expect(values(css, environment({ attrs: native, reducedTransparency: true })).get('--s')).toBe('solid')
  })

  it('matches [attr] and :not([attr]) on the root element and nothing else', () => {
    const css = `[data-theme] { --has: yes; } :root:not([data-theme]) { --none: yes; }`
    expect(values(css).has('--none')).toBe(true)
    expect(values(css).has('--has')).toBe(false)
    const themed = values(css, environment({ attrs: { 'data-theme': 'x' } }))
    expect(themed.has('--has')).toBe(true)
    expect(themed.has('--none')).toBe(false)
  })
})

describe('values', () => {
  const tokens = new Map([
    ['--base', '#ffffff'],
    ['--ink', '#000000'],
    ['--alias', 'var(--base)'],
    ['--face', 'color-mix(in srgb, var(--base), var(--ink) 10%)'],
    ['--face2', 'color-mix(in srgb, var(--base) 90%, rgb(0 0 0))'],
    ['--clear', 'transparent']
  ])

  it('follows var() through aliases and uses a fallback for a missing token', () => {
    expect(substituteVars('var(--alias)', tokens)).toBe('#ffffff')
    expect(substituteVars('var(--missing, #123456)', tokens)).toBe('#123456')
    expect(() => substituteVars('var(--missing)', tokens)).toThrow(/not declared/)
    expect(() => substituteVars('var(--a)', new Map([['--a', 'var(--b)'], ['--b', 'var(--a)']]))).toThrow(/Circular/)
  })

  it('mixes with an explicit share for either colour', () => {
    expect(tokenColor(tokens, 'face')).toEqual({ r: 229.5, g: 229.5, b: 229.5, a: 1 })
    expect(tokenColor(tokens, 'face2')).toEqual({ r: 229.5, g: 229.5, b: 229.5, a: 1 })
    expect(colorOfValue('color-mix(in srgb, #ffffff, #000000)').r).toBeCloseTo(127.5, 5)
    expect(() => colorOfValue('color-mix(in oklab, #fff, #000)')).toThrow(/srgb/)
  })

  it('reads transparent as no colour, and measures a pair over a stack of tokens', () => {
    expect(tokenColor(tokens, 'clear').a).toBe(0)
    const t = new Map([
      ['--page', '#ffffff'],
      ['--veil', 'rgb(0 0 0 / 50%)'],
      ['--ink', '#000000']
    ])
    expect(contrastOf(t, 'ink', ['page'])).toBeCloseTo(21, 5)
    expect(contrastOf(t, 'ink', ['page', 'veil'])).toBeLessThan(contrastOf(t, 'ink', ['page']))
  })
})
