/**
 * WCAG 2 contrast arithmetic for the theme tests (visual-system.md §5, §12 and §33). Pure functions, no DOM: a colour is what a
 * stylesheet can say (`#rrggbb`, `#rgb`, `#rrggbbaa`, `rgb(r g b / a%)`), a text node sits on a STACK of fills (an opaque base with
 * translucent fills composited over it, as the browser paints them), and the ratio is taken against the composited colour. A figure for
 * a token pair alone is not enough (lesson 114): the neutral tag over a striped table row is darker than either fill on its own.
 */

/** Channels 0-255, alpha 0-1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

function channel(text: string): number {
  const trimmed = text.trim()
  return trimmed.endsWith('%') ? (parseFloat(trimmed) / 100) * 255 : parseFloat(trimmed)
}

function alphaOf(text: string | undefined): number {
  if (text === undefined) return 1
  const trimmed = text.trim()
  return clamp(trimmed.endsWith('%') ? parseFloat(trimmed) / 100 : parseFloat(trimmed), 0, 1)
}

/** Reads the colour forms the token block uses; anything else is an error, so a new form is never silently skipped. */
export function parseColor(input: string): Rgba {
  const text = input.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)
  if (hex) {
    let digits = hex[1]
    if (digits.length === 3) digits = [...digits].map((d) => d + d).join('')
    const n = (i: number): number => parseInt(digits.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 }
  }
  const fn = /^rgba?\(\s*([^)]*)\)$/.exec(text)
  if (fn) {
    const [rgb, alpha] = fn[1].split('/')
    const parts = rgb.split(/[\s,]+/).filter((part) => part.length > 0)
    if (parts.length === 4 && alpha === undefined) return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alphaOf(parts[3]) }
    if (parts.length === 3) return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alphaOf(alpha) }
  }
  throw new Error(`Not a colour the token block uses: "${input}"`)
}

/** `top` painted over `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a)
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mixed = (t: number, b: number): number => (t * top.a + b * bottom.a * (1 - top.a)) / a
  return { r: mixed(top.r, bottom.r), g: mixed(top.g, bottom.g), b: mixed(top.b, bottom.b), a }
}

/** `color-mix(in srgb, first, second <percent>%)` for opaque colours: the browser interpolates the gamma-encoded channels. */
export function mixSrgb(first: Rgba, second: Rgba, secondPercent: number): Rgba {
  const w = clamp(secondPercent, 0, 100) / 100
  const mix = (x: number, y: number): number => x * (1 - w) + y * w
  return { r: mix(first.r, second.r), g: mix(first.g, second.g), b: mix(first.b, second.b), a: mix(first.a, second.a) }
}

function linear(value: number): number {
  const s = clamp(value, 0, 255) / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

export function luminance(color: Rgba): number {
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

/** The stack as painted: the first colour is the opaque base, each next one is a translucent fill laid over the one before. */
export function stack(layers: Rgba[]): Rgba {
  if (layers.length === 0) throw new Error('A stack needs a base colour')
  let painted = layers[0]
  if (painted.a !== 1) throw new Error('The base of a stack must be opaque')
  for (const layer of layers.slice(1)) painted = over(layer, painted)
  return painted
}

/** WCAG contrast ratio of `foreground` (composited over `background` when it is translucent) against an opaque `background`. */
export function contrast(foreground: Rgba, background: Rgba): number {
  if (background.a !== 1) throw new Error('The background of a contrast figure must be opaque (composite the stack first)')
  const text = foreground.a === 1 ? foreground : over(foreground, background)
  const [light, dark] = [luminance(text), luminance(background)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Two decimals, as the design document writes them. */
export function ratioText(ratio: number): string {
  return ratio.toFixed(2)
}
