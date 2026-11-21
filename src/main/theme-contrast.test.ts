import { describe, expect, it } from 'vitest'
import { contrast, luminance, mixSrgb, over, parseColor, ratioText, stack } from './theme-contrast'

const WHITE = parseColor('#ffffff')
const BLACK = parseColor('#000000')

describe('colours', () => {
  it('reads every form the token block uses', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#5856D6')).toEqual({ r: 88, g: 86, b: 214, a: 1 })
    expect(parseColor('rgb(88 86 214 / 12%)')).toEqual({ r: 88, g: 86, b: 214, a: 0.12 })
    expect(parseColor('rgb(0 0 0 / 0.5)').a).toBe(0.5)
    expect(parseColor('rgba(0, 0, 0, 0.25)')).toEqual({ r: 0, g: 0, b: 0, a: 0.25 })
    expect(parseColor('#00000080').a).toBeCloseTo(0.502, 3)
  })

  it('refuses a form it does not understand instead of skipping it', () => {
    for (const bad of ['red', 'hsl(0 0% 0%)', 'oklch(0.5 0.1 200)', '#12', 'var(--x)', '']) expect(() => parseColor(bad), bad).toThrow(/Not a colour/)
  })
})

describe('contrast', () => {
  it('is 21 for black on white and 1 for the same colour, whichever is the text', () => {
    expect(contrast(BLACK, WHITE)).toBeCloseTo(21, 5)
    expect(contrast(WHITE, BLACK)).toBeCloseTo(21, 5)
    expect(contrast(WHITE, WHITE)).toBe(1)
  })

  it('matches the figures WCAG tools give: #767676 on white is 4.54 and #777777 on white is 4.48', () => {
    expect(ratioText(contrast(parseColor('#767676'), WHITE))).toBe('4.54')
    expect(ratioText(contrast(parseColor('#777777'), WHITE))).toBe('4.48')
  })

  it('weighs green most and blue least', () => {
    expect(luminance(parseColor('#00ff00'))).toBeCloseTo(0.7152, 4)
    expect(luminance(parseColor('#ff0000'))).toBeCloseTo(0.2126, 4)
    expect(luminance(parseColor('#0000ff'))).toBeCloseTo(0.0722, 4)
  })

  it('composites translucent text over its background before measuring', () => {
    // 50% black over white is #808080-ish: far less than 21:1.
    const half = { ...BLACK, a: 0.5 }
    expect(contrast(half, WHITE)).toBeCloseTo(contrast(over(half, WHITE), WHITE), 10)
    expect(contrast(half, WHITE)).toBeLessThan(5)
  })

  it('needs an opaque background, so a stack is composited first', () => {
    expect(() => contrast(BLACK, { ...WHITE, a: 0.5 })).toThrow(/opaque/)
  })
})

describe('stacked fills', () => {
  it('paints each translucent fill over the one before it, in order', () => {
    const painted = stack([WHITE, { ...BLACK, a: 0.5 }, { ...BLACK, a: 0.5 }])
    // 50% black over white, then 50% black over that: 25% of white remains.
    expect(painted.r).toBeCloseTo(63.75, 5)
    expect(painted.a).toBe(1)
    // A different order of a different pair gives a different colour.
    const tint = { r: 255, g: 0, b: 0, a: 0.5 }
    expect(stack([WHITE, tint, { ...BLACK, a: 0.5 }]).r).not.toBeCloseTo(stack([WHITE, { ...BLACK, a: 0.5 }, tint]).r, 3)
  })

  it('is darker under a fill than without it: the reason a pair of tokens alone is not a measurement', () => {
    const track = { r: 0, g: 0, b: 0, a: 0.055 }
    const text = parseColor('#6c6c71')
    expect(contrast(text, stack([parseColor('#ffffff'), track]))).toBeLessThan(contrast(text, parseColor('#ffffff')))
  })

  it('refuses a translucent base and an empty stack', () => {
    expect(() => stack([{ ...BLACK, a: 0.5 }])).toThrow(/opaque/)
    expect(() => stack([])).toThrow(/base/)
  })
})

describe('color-mix in srgb', () => {
  it('interpolates the encoded channels, as the browser does', () => {
    expect(mixSrgb(WHITE, BLACK, 50)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
    expect(mixSrgb(WHITE, BLACK, 0)).toEqual(WHITE)
    expect(mixSrgb(WHITE, BLACK, 100)).toEqual(BLACK)
    expect(mixSrgb(WHITE, BLACK, 150)).toEqual(BLACK)
  })
})
