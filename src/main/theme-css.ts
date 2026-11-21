/**
 * Reads the token block of `styles.css` the way a browser would for the root element, so the theme tests judge what the page really
 * paints and not a copy of it (visual-system.md §33). Pure functions over the stylesheet text: no DOM, no file access.
 *
 * What it understands is deliberately small. A rule counts when every selector in its list is one the root element can match (`html`,
 * `:root`, attribute tests on it, `:not([attr])`); a rule with a class or a descendant is a component's, not a token's, and is left
 * alone. The cascade is real: specificity first, then source order, so a theme that loses to a rule it should beat shows up here.
 */
import { contrast, mixSrgb, parseColor, stack, type Rgba } from './theme-contrast'

export interface Rule {
  selectors: string[]
  /** The `@media` / `@container` preludes it sits in, outermost first. */
  conditions: string[]
  declarations: [property: string, value: string][]
  order: number
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Index of the character that closes the block opened at `open` (the index of a `{`), skipping strings and nested blocks. */
function closingBrace(css: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < css.length; i++) {
    const ch = css[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  throw new Error('Unbalanced braces in the stylesheet')
}

/** Splits at `separator` outside quotes and brackets. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

function declarationsOf(body: string): [string, string][] {
  const out: [string, string][] = []
  for (const part of splitTop(body, ';')) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const property = part.slice(0, colon).trim()
    if (property) out.push([property, part.slice(colon + 1).trim()])
  }
  return out
}

/** Every style rule of the stylesheet, `@media` and `@container` blocks flattened with their conditions; `@keyframes` and other at-rules are skipped. */
export function parseRules(css: string): Rule[] {
  const rules: Rule[] = []
  const walk = (text: string, conditions: string[]): void => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      const semicolon = text.indexOf(';', i)
      if (open < 0) break
      if (semicolon >= 0 && semicolon < open && text.slice(i, semicolon).trim().startsWith('@')) {
        i = semicolon + 1
        continue
      }
      const prelude = text.slice(i, open).trim()
      const close = closingBrace(text, open)
      const body = text.slice(open + 1, close)
      if (prelude.startsWith('@media') || prelude.startsWith('@container') || prelude.startsWith('@supports')) walk(body, [...conditions, prelude])
      else if (!prelude.startsWith('@')) {
        rules.push({ selectors: splitTop(prelude, ',').map((s) => s.trim().replace(/\s+/g, ' ')), conditions, declarations: declarationsOf(body), order: rules.length })
      }
      i = close + 1
    }
  }
  walk(stripComments(css), [])
  return rules
}

// ───────────── What the root element is, and which rules reach it ─────────────

export interface Environment {
  /** Attributes on `html`: `data-theme`, `data-chrome`, `data-animated`. */
  attrs: Record<string, string | undefined>
  dark: boolean
  reducedMotion: boolean
  reducedTransparency: boolean
}

export function environment(overrides: Partial<Environment> = {}): Environment {
  return { attrs: {}, dark: false, reducedMotion: false, reducedTransparency: false, ...overrides }
}

function mediaMatches(prelude: string, env: Environment): boolean {
  if (!prelude.startsWith('@media')) return false
  return prelude
    .slice('@media'.length)
    .split(/\band\b/)
    .every((part) => {
      const feature = /\(\s*([a-z-]+)\s*:\s*([a-z-]+)\s*\)/.exec(part)
      if (!feature) return false
      const [, name, value] = feature
      if (name === 'prefers-color-scheme') return (value === 'dark') === env.dark
      if (name === 'prefers-reduced-motion') return value === 'reduce' && env.reducedMotion
      if (name === 'prefers-reduced-transparency') return value === 'reduce' && env.reducedTransparency
      return false
    })
}

interface Matched {
  /** a, b, c of the specificity. */
  specificity: [number, number, number]
}

const ATTRIBUTE = /^\[([a-z-]+)(?:=(?:'([^']*)'|"([^"]*)"))?\]/
const SIMPLE_TOKEN = /^(?:html|:root)/

/** Matches a compound selector against the root element; null when the selector is not about the root element at all. */
function matchRoot(selector: string, env: Environment): Matched | null {
  let rest = selector.trim()
  const specificity: [number, number, number] = [0, 0, 0]
  let matches = true
  let any = false
  while (rest.length > 0) {
    any = true
    const simple = SIMPLE_TOKEN.exec(rest)
    if (simple) {
      if (simple[0] === 'html') specificity[2]++
      else specificity[1]++
      rest = rest.slice(simple[0].length)
      continue
    }
    const attribute = ATTRIBUTE.exec(rest)
    if (attribute) {
      const [whole, name, single, double] = attribute
      const wanted = single ?? double
      const actual = env.attrs[name]
      if (wanted === undefined ? actual === undefined : actual !== wanted) matches = false
      specificity[1]++
      rest = rest.slice(whole.length)
      continue
    }
    if (rest.startsWith(':not(')) {
      const end = rest.indexOf(')')
      const inner = /^:not\(\s*(\[[^\]]*\])\s*\)/.exec(rest)
      const attributeInner = inner ? ATTRIBUTE.exec(inner[1]) : null
      if (end < 0 || !inner || !attributeInner) return null
      const [, name, single, double] = attributeInner
      const wanted = single ?? double
      const actual = env.attrs[name]
      if (wanted === undefined ? actual !== undefined : actual === wanted) matches = false
      specificity[1]++
      rest = rest.slice(inner[0].length)
      continue
    }
    return null
  }
  if (!any) return null
  return matches ? { specificity } : { specificity: [-1, -1, -1] }
}

function compareSpecificity(x: [number, number, number], y: [number, number, number]): number {
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

/** The declared values of the root element for one environment: custom properties and `color-scheme`, after the cascade. */
export function rootValues(rules: Rule[], env: Environment, wanted: (property: string) => boolean = (p) => p.startsWith('--') || p === 'color-scheme'): Map<string, string> {
  const winners = new Map<string, { specificity: [number, number, number]; order: number; value: string }>()
  for (const rule of rules) {
    if (!rule.conditions.every((c) => mediaMatches(c, env))) continue
    for (const selector of rule.selectors) {
      const matched = matchRoot(selector, env)
      if (!matched || matched.specificity[0] < 0) continue
      for (const [property, value] of rule.declarations) {
        if (!wanted(property)) continue
        const current = winners.get(property)
        const better = !current || compareSpecificity(matched.specificity, current.specificity) > 0 || (compareSpecificity(matched.specificity, current.specificity) === 0 && rule.order >= current.order)
        if (better) winners.set(property, { specificity: matched.specificity, order: rule.order, value })
      }
    }
  }
  return new Map([...winners].map(([property, entry]) => [property, entry.value]))
}

/** Every selector of the stylesheet that a rule declaring one of `properties` is written for, with its conditions. */
export function selectorsDeclaring(rules: Rule[], properties: (property: string) => boolean): { selector: string; conditions: string[]; property: string }[] {
  const out: { selector: string; conditions: string[]; property: string }[] = []
  for (const rule of rules) {
    for (const [property] of rule.declarations) {
      if (!properties(property)) continue
      for (const selector of rule.selectors) out.push({ selector, conditions: rule.conditions, property })
    }
  }
  return out
}

// ───────────── Values: var(), color-mix(), colours ─────────────

function argumentsOf(call: string, name: string): string[] {
  return splitTop(call.slice(name.length + 1, call.lastIndexOf(')')), ',').map((a) => a.trim())
}

/** Substitutes `var(--x)` (with its fallback) until nothing is left to substitute. */
export function substituteVars(value: string, values: Map<string, string>, seen: string[] = []): string {
  let out = ''
  let i = 0
  while (i < value.length) {
    if (value.startsWith('var(', i)) {
      let depth = 0
      let j = i + 3
      for (; j < value.length; j++) {
        if (value[j] === '(') depth++
        else if (value[j] === ')' && --depth === 0) break
      }
      const [name, ...fallback] = argumentsOf(value.slice(i, j + 1), 'var')
      if (seen.includes(name)) throw new Error(`Circular token reference: ${[...seen, name].join(' -> ')}`)
      const replacement = values.get(name) ?? (fallback.length ? fallback.join(',') : undefined)
      if (replacement === undefined) throw new Error(`Token ${name} is used but not declared`)
      out += substituteVars(replacement, values, [...seen, name])
      i = j + 1
    } else {
      out += value[i]
      i++
    }
  }
  return out
}

/** A colour value as a colour: literals, `transparent`, and `color-mix(in srgb, A [p%], B [p%])` of those. */
export function colorOfValue(value: string): Rgba {
  const text = value.trim()
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (text.startsWith('color-mix(')) {
    const [space, first, second] = argumentsOf(text, 'color-mix')
    if (space !== 'in srgb') throw new Error(`Only color-mix in srgb is understood, not "${space}"`)
    const share = (part: string): { colour: string; percent: number | null } => {
      const match = /^(.*?)\s+(\d+(?:\.\d+)?)%$/.exec(part)
      return match ? { colour: match[1], percent: parseFloat(match[2]) } : { colour: part, percent: null }
    }
    const a = share(first)
    const b = share(second)
    const secondPercent = b.percent ?? (a.percent === null ? 50 : 100 - a.percent)
    const firstPercent = a.percent ?? 100 - secondPercent
    const total = firstPercent + secondPercent
    return mixSrgb(colorOfValue(a.colour), colorOfValue(b.colour), (secondPercent / total) * 100)
  }
  return parseColor(text)
}

/** The colour of a token (`surface-0`, not `--surface-0`) in a resolved set of root values. */
export function tokenColor(values: Map<string, string>, token: string): Rgba {
  const raw = values.get(`--${token}`)
  if (raw === undefined) throw new Error(`Token --${token} is not declared`)
  return colorOfValue(substituteVars(raw, values, [`--${token}`]))
}

/** A stack of tokens as the browser paints it: the first is the opaque base, each next one a fill laid over the one before. */
export function stackOf(values: Map<string, string>, tokens: string[]): Rgba {
  return stack(tokens.map((token) => tokenColor(values, token)))
}

export function contrastOf(values: Map<string, string>, foreground: string, background: string[]): number {
  return contrast(tokenColor(values, foreground), stackOf(values, background))
}
