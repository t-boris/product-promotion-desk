// Where the headline goes on the template card (REQ-003, DEC-045): the wrapping of the words into lines, the largest type that still fits the
// card, and where each line sits, for each style. One pure module that takes `measure(text, font)`, so it is tested without a canvas; the
// drawing (`draw-card.ts`) and the canvas (`card-canvas.ts`) only follow what this decides, so the live preview and the PNG that is saved can
// never differ.

import { CARD_PIXELS, type CardShape, type CardStyle } from '../../../../../shared/quick-post'

/** The width in pixels of a text set in a CSS font. The canvas supplies the real one; a test supplies a plain rule. */
export type Measure = (text: string, font: string) => number

/** System fonts only: nothing is downloaded, and the card is the same on every Mac. */
const SANS = "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"
const SERIF = "ui-serif, Georgia, 'Times New Roman', serif"

interface StyleSpec {
  family: string
  weight: number
  italic: boolean
  align: 'left' | 'center'
  /** Where the block of lines sits in the room it has. */
  anchor: 'middle' | 'bottom'
  /** The largest and the smallest type, in pixels (every card is 1080 wide). */
  maxFont: number
  minFont: number
  lineHeight: number
  /** Sideways margin as a share of the card's width. */
  margin: number
  /** Room kept above the lines for the mark of the style (the quotation mark), as a share of the card's height (at most `MARK_SPACE_MAX` pixels). */
  markSpace: number
}

const MARK_SPACE_MAX = 110

export const STYLE_SPECS: Record<CardStyle, StyleSpec> = {
  bold: { family: SANS, weight: 800, italic: false, align: 'left', anchor: 'middle', maxFont: 150, minFont: 40, lineHeight: 1.08, margin: 0.09, markSpace: 0 },
  quote: { family: SERIF, weight: 600, italic: true, align: 'center', anchor: 'middle', maxFont: 96, minFont: 36, lineHeight: 1.25, margin: 0.12, markSpace: 0.14 },
  minimal: { family: SANS, weight: 500, italic: false, align: 'left', anchor: 'bottom', maxFont: 84, minFont: 32, lineHeight: 1.2, margin: 0.09, markSpace: 0 }
}

export const fontOf = (style: CardStyle, size: number): string => {
  const spec = STYLE_SPECS[style]
  return `${spec.italic ? 'italic ' : ''}${spec.weight} ${size}px ${spec.family}`
}

/** One line of the headline: its words and where it is drawn (the middle of the line, so the text sits the same in every font). */
export interface CardLine {
  text: string
  x: number
  y: number
}

export interface CardLayout {
  width: number
  height: number
  style: CardStyle
  font: string
  fontSize: number
  lineHeight: number
  align: 'left' | 'center'
  lines: CardLine[]
  /** The headline did not fit even at the smallest type and its end was cut. */
  truncated: boolean
  /** The big quotation mark of the quote style. */
  mark: { text: string; x: number; y: number; font: string } | null
  /** The short bar above the lines of the minimal style. */
  rule: { x: number; y: number; width: number; height: number } | null
}

const ELLIPSIS = '…'
const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The words of a text as lines no wider than `maxWidth`. A word is never split unless it alone is wider than a line; then it is broken by
 * letter (never inside a letter that is made of several code points, such as an emoji).
 */
export function wrapLines(text: string, maxWidth: number, font: string, measure: Measure): string[] {
  const words = collapse(text).split(' ').filter((w) => w !== '')
  const lines: string[] = []
  let line = ''
  const push = (): void => {
    if (line !== '') lines.push(line)
    line = ''
  }
  for (const word of words) {
    const joined = line === '' ? word : `${line} ${word}`
    if (measure(joined, font) <= maxWidth) {
      line = joined
      continue
    }
    push()
    if (measure(word, font) <= maxWidth) {
      line = word
      continue
    }
    // A word wider than a line: break it by letter.
    for (const letter of Array.from(word)) {
      if (line !== '' && measure(line + letter, font) > maxWidth) push()
      line += letter
    }
  }
  push()
  return lines
}

/** The last line cut so that it, and the ellipsis after it, fits the width. */
function withEllipsis(line: string, maxWidth: number, font: string, measure: Measure): string {
  const letters = Array.from(line)
  while (letters.length > 0 && measure(`${letters.join('').trimEnd()}${ELLIPSIS}`, font) > maxWidth) letters.pop()
  return `${letters.join('').trimEnd()}${ELLIPSIS}`
}

/**
 * Lays the headline out on a card of this shape in this style: the largest type (down to the style's smallest) at which the lines fit the card
 * in width and height; below that the end is cut with an ellipsis rather than drawn off the card. An empty headline has no lines.
 */
export function layoutCard(headline: string, style: CardStyle, shape: CardShape, measure: Measure): CardLayout {
  const spec = STYLE_SPECS[style]
  const { width, height } = CARD_PIXELS[shape]
  const marginX = Math.round(width * spec.margin)
  // A wide card has little height to spare: its margin above and below is the smaller of the sideways one and a seventh of its height.
  const marginY = Math.min(marginX, Math.round(height / 7))
  const boxWidth = width - 2 * marginX
  const markSpace = Math.min(MARK_SPACE_MAX, Math.round(height * spec.markSpace))
  const top = marginY + markSpace
  const boxHeight = height - marginY - top
  const x = spec.align === 'center' ? width / 2 : marginX
  const base: CardLayout = { width, height, style, font: fontOf(style, spec.maxFont), fontSize: spec.maxFont, lineHeight: Math.round(spec.maxFont * spec.lineHeight), align: spec.align, lines: [], truncated: false, mark: null, rule: null }
  const text = collapse(headline)
  if (text === '') return withMarks(base, { top: height / 2, marginX, marginY, markSpace })

  let size = spec.maxFont
  let lines = wrapLines(text, boxWidth, fontOf(style, size), measure)
  let lineHeight = Math.round(size * spec.lineHeight)
  while (lines.length * lineHeight > boxHeight && size > spec.minFont) {
    size = Math.max(spec.minFont, size - 2)
    lines = wrapLines(text, boxWidth, fontOf(style, size), measure)
    lineHeight = Math.round(size * spec.lineHeight)
  }
  const font = fontOf(style, size)
  let truncated = false
  const most = Math.max(1, Math.floor(boxHeight / lineHeight))
  if (lines.length > most) {
    truncated = true
    lines = lines.slice(0, most)
    lines[most - 1] = withEllipsis(lines[most - 1], boxWidth, font, measure)
  }
  const block = lines.length * lineHeight
  const first = spec.anchor === 'bottom' ? height - marginY - block : top + (boxHeight - block) / 2
  const placed = lines.map((line, index): CardLine => ({ text: line, x, y: Math.round(first + (index + 0.5) * lineHeight) }))
  return withMarks({ ...base, font, fontSize: size, lineHeight, lines: placed, truncated }, { top: first, marginX, marginY, markSpace })
}

/** The quotation mark is a little over twice the room it is given (a quotation mark fills the top of its box), so it stands above the lines and never over them. */
const MARK_SIZE_PER_SPACE = 2.6

/** The mark of the style, placed against the block of lines it belongs to: the quotation mark above a quote, the short bar above a minimal headline. */
function withMarks(layout: CardLayout, at: { top: number; marginX: number; marginY: number; markSpace: number }): CardLayout {
  if (layout.style === 'quote') {
    const size = Math.round(at.markSpace * MARK_SIZE_PER_SPACE)
    return { ...layout, mark: { text: '\u201C', x: layout.width / 2, y: at.marginY + Math.round(at.markSpace * 0.6), font: `700 ${size}px ${SERIF}` } }
  }
  if (layout.style === 'minimal' && layout.lines.length > 0) return { ...layout, rule: { x: at.marginX, y: Math.max(at.marginY, Math.round(at.top - 40)), width: 96, height: 8 } }
  return layout
}
