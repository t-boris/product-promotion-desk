// How a post written in the post editor (DEC-030) looks on each platform. One pure module serves the preview on the screen, the request the
// application sends and the check before approval, so what the owner saw is what is sent.
//
// A post is written in a small Markdown subset: emphasis, headings, lists, quotes, code, links and pictures placed in the text as
// `![alt](media:<id>)`. Platforms have no typefaces; Reddit shows Markdown, the others show plain text. A draft that is not `markdown` (every
// older draft, every reply, every text the AI wrote) is sent exactly as it is written.

import type { PostType } from './quick-post'
import { isVideoMime, type Attachment, type PostMarkup } from './types'

/**
 * The version of what a markdown post becomes on a platform. It is part of the approval hash of a markdown post: change a rule of the
 * renderer or a limit of a platform in a way that changes what is sent, and raise this number, so that every approval given under the old
 * rule stops matching and the owner approves what the new rule sends. (A draft that is not markdown is never rendered by these rules, except for where its link goes, which `linkPlacementOf` binds apart.)
 * Version 2: strikethrough, superscript, spoilers and tables are marks of the post (before, they were sent as the characters they are written with).
 */
export const RENDER_VERSION = 2

/** One measure of length for the limits, the counter on the screen and the approval: characters, so an emoji is one. */
export const characterCount = (text: string): number => [...text].length

// ───────────────────────────── the parsed text ─────────────────────────────

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'code'; v: string }
  /** `~~words~~`: crossed out. */
  | { t: 'strike'; c: Inline[] }
  /** `^word` or `^(some words)`: raised (Reddit's way of writing it). */
  | { t: 'sup'; c: Inline[] }
  /** `>!words!<`: hidden until the reader presses it (Reddit's way of writing it). */
  | { t: 'spoiler'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'image'; alt: string; id: string }
  /** A line break inside a paragraph. `hard`: the line ended with two spaces or a backslash; Reddit joins the lines of a soft break. */
  | { t: 'br'; hard: boolean }

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  /** `depths`: how deep each item is (0 is the top level). */
  | { t: 'ul'; items: Inline[][]; depths: number[] }
  /** `start`: the number the owner gave the first item. */
  | { t: 'ol'; items: Inline[][]; depths: number[]; start: number }
  | { t: 'quote'; c: Inline[][] }
  | { t: 'pre'; v: string }
  /** A table: `align` per column (null: none given), the header cells and the rows of cells. */
  | { t: 'table'; align: ('left' | 'center' | 'right' | null)[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'hr' }

/**
 * A picture placed in the text: `![alt](media:<id>)`. The alt text and the id are bounded, so no text can make a search for one slow, and
 * every reader of a text (the parser, the preview, the check, the editor) agrees on what is one.
 */
const MEDIA_IMAGE = /^!\[([^\]\n]{0,200})\]\(media:([A-Za-z0-9-]{1,64})\)/
const PICTURE_IN_TEXT = /!\[[^\]\n]{0,200}\]\(media:([A-Za-z0-9-]{1,64})\)/g

/** The ids of the pictures placed in a text, in the order they first appear. */
export function pictureIdsIn(text: string): string[] {
  const ids: string[] = []
  for (const match of text.matchAll(PICTURE_IN_TEXT)) if (!ids.includes(match[1])) ids.push(match[1])
  return ids
}

const LINK = /^\[([^\]\n]+)\]\((https?:\/\/[^\s()]+)\)/i
const BARE_URL = /^https?:\/\/[^\s<>]+/i
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>~|^]/
const WORD = /[\p{L}\p{N}]/u

/**
 * One parse scans at most this many characters looking for closing marks; what is not closed within it is plain text. It also bounds how
 * deep marks can nest (a level costs the scan to its closing mark, so a few hundred levels use it up) and how long a text of unclosed
 * marks can take: nothing a person pastes makes this slow or overflow the stack.
 */
const SCAN_BUDGET = 200_000

/**
 * The end of a bare web address that starts at `from` (and is not part of a word), or -1. An address is taken whole: the marks inside it
 * (`_next/static/_build_/x.js`, a segment written between asterisks) are part of it, and the punctuation that closes a sentence or a mark is not.
 */
function urlEnd(source: string, from: number): number {
  if (from > 0 && WORD.test(source[from - 1])) return -1
  const match = BARE_URL.exec(source.slice(from, from + 2048))
  if (!match) return -1
  return from + match[0].replace(/[.,;:!?'")\]*_~]+$/, '').length
}

/** A mark may open where a word does not run into it, and close where the word it closes does not run on: `5*3 and 2*4` and `snake_case` have no marks. */
const opens = (source: string, at: number): boolean => at === 0 || !WORD.test(source[at - 1])
const closes = (source: string, after: number): boolean => after >= source.length || !WORD.test(source[after])

/**
 * The superscript that starts at `at` (a `^`), Reddit's way: `^word` raises the characters up to the next space or `^`, `^(some words)` raises what is between the
 * brackets. It must raise a letter or a digit, so `^_^` stays an emoticon. Null when there is none.
 */
function superscriptAt(source: string, at: number): { words: string; end: number } | null {
  if (source[at + 1] === '(') {
    const close = source.indexOf(')', at + 2)
    if (close > at + 2 && close - at < 400) return { words: source.slice(at + 2, close), end: close + 1 }
    return null
  }
  let end = at + 1
  while (end < source.length && !/[\s^]/.test(source[end])) end += 1
  const words = source.slice(at + 1, end)
  return /[\p{L}\p{N}]/u.test(words) && words.length <= 200 ? { words, end } : null
}

/** Inline marks. A mark that is not closed is plain text; nothing here can fail, and no text can make it slow or deep. */
export function parseInline(source: string): Inline[] {
  return inlines(source, 0, { left: SCAN_BUDGET })
}

function inlines(source: string, depth: number, budget: { left: number }): Inline[] {
  const out: Inline[] = []
  // Where a search for each kind of closing mark came up empty: no later opener of that kind can find one either, so the search is made once.
  const none: Record<string, number> = {}
  let text = ''
  const flush = (): void => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
  }
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\' && i + 1 < source.length) {
      if (source[i + 1] === '\n') {
        flush()
        out.push({ t: 'br', hard: true })
        i += 2
        continue
      }
      if (ESCAPABLE.test(source[i + 1])) {
        text += source[i + 1]
        i += 2
        continue
      }
    }
    if (ch === '`') {
      const close = source.indexOf('`', i + 1)
      if (close > i + 1) {
        flush()
        out.push({ t: 'code', v: source.slice(i + 1, close) })
        i = close + 1
        continue
      }
    }
    if (ch === 'h' || ch === 'H') {
      const end = urlEnd(source, i)
      if (end > i) {
        text += source.slice(i, end)
        i = end
        continue
      }
    }
    if (ch === '>' && source[i + 1] === '!') {
      // `>!words!<`: the words are found by the first `!<` after them; no closing mark, no spoiler.
      const close = source.indexOf('!<', i + 2)
      if (close > i + 2 && budget.left > 0) {
        budget.left -= close - i
        flush()
        out.push({ t: 'spoiler', c: inlines(source.slice(i + 2, close), depth + 1, budget) })
        i = close + 2
        continue
      }
    }
    if (ch === '~' && source[i + 1] === '~' && source[i + 2] !== '~' && opens(source, i) && !/\s/.test(source[i + 2] ?? ' ')) {
      const close = findClose(source, i + 2, '~~', budget, none)
      if (close > i + 2 && !/\s/.test(source[close - 1])) {
        flush()
        out.push({ t: 'strike', c: inlines(source.slice(i + 2, close), depth + 1, budget) })
        i = close + 2
        continue
      }
    }
    if (ch === '^') {
      const sup = superscriptAt(source, i)
      if (sup) {
        flush()
        out.push({ t: 'sup', c: inlines(sup.words, depth + 1, budget) })
        i = sup.end
        continue
      }
    }
    if (ch === '!') {
      const image = MEDIA_IMAGE.exec(source.slice(i, i + 300))
      if (image) {
        flush()
        out.push({ t: 'image', alt: image[1], id: image[2] })
        i += image[0].length
        continue
      }
    }
    if (ch === '[') {
      const link = LINK.exec(source.slice(i, i + 2200))
      if (link) {
        flush()
        out.push({ t: 'link', href: link[2], c: inlines(link[1], depth + 1, budget) })
        i += link[0].length
        continue
      }
    }
    if (ch === '*' || ch === '_') {
      // A run of marks: four or more (a rule, a blank to fill in, a row of stars) is plain text, and so is one that is followed by a space.
      let run = 1
      while (source[i + run] === ch) run += 1
      if (run >= 4 || /\s/.test(source[i + run] ?? ' ')) {
        text += ch.repeat(run)
        i += run
        continue
      }
    }
    if ((ch === '*' || ch === '_') && source[i + 1] === ch && opens(source, i) && !/\s/.test(source[i + 2] ?? ' ')) {
      const close = findClose(source, i + 2, ch + ch, budget, none)
      if (close > i + 2 && !/\s/.test(source[close - 1])) {
        flush()
        out.push({ t: 'strong', c: inlines(source.slice(i + 2, close), depth + 1, budget) })
        i = close + 2
        continue
      }
    }
    if (ch === '*' || ch === '_') {
      const close = opens(source, i) && !/\s/.test(source[i + 1] ?? ' ') ? findClose(source, i + 1, ch, budget, none) : -1
      if (close > i + 1 && !/\s/.test(source[close - 1])) {
        flush()
        out.push({ t: 'em', c: inlines(source.slice(i + 1, close), depth + 1, budget) })
        i = close + 1
        continue
      }
    }
    text += ch
    i += 1
  }
  flush()
  return out
}

/**
 * The position of the closing mark, skipping escapes, code and web addresses; -1 when there is none, or when the scan has used its budget.
 * A closing mark that ends a run (`***both***`) is taken at the end of the run, so the marks left over belong to the mark inside.
 */
function findClose(source: string, from: number, mark: string, budget: { left: number }, none: Record<string, number>): number {
  if (none[mark] !== undefined && from >= none[mark]) return -1
  for (let i = from; i < source.length; i += 1) {
    if (budget.left <= 0) return -1
    budget.left -= 1
    if (source[i] === '\\') {
      i += 1
      continue
    }
    if (source[i] === '`') {
      const end = source.indexOf('`', i + 1)
      if (end > i) i = end
      continue
    }
    if (source[i] === 'h' || source[i] === 'H') {
      const end = urlEnd(source, i)
      if (end > i) {
        i = end - 1
        continue
      }
    }
    if (source.startsWith(mark, i)) {
      if (!closes(source, i + mark.length)) continue
      if (mark.length === 1 && source[i + 1] === mark) {
        i += 1
        continue
      }
      let at = i
      while (mark.length === 2 && source[at + 2] === mark[0]) at += 1
      return at
    }
  }
  none[mark] = Math.min(none[mark] ?? from, from)
  return -1
}

/** How many spaces end a line: counted from the end, so the cost is the length of the run whatever the line holds. */
function trailingSpaces(line: string): number {
  let n = 0
  while (n < line.length && line[line.length - 1 - n] === ' ') n += 1
  return n
}

/** The lines of one paragraph as inline marks, a line break between lines (hard when the line ends with two spaces). */
function paragraph(lines: string[]): Inline[] {
  const out: Inline[] = []
  lines.forEach((line, index) => {
    const spaces = trailingSpaces(line)
    out.push(...parseInline(line.slice(0, line.length - spaces).trim()))
    if (index < lines.length - 1) out.push({ t: 'br', hard: spaces >= 2 })
  })
  return out
}

const HEADING_OPEN = /^(#{1,6})[ \t]+/

/** A heading line: its level and words. A closing run of `#` is part of the markup only when a space comes before it (`# C#` is a heading about C#). */
function headingOf(line: string): { level: 1 | 2 | 3 | 4 | 5 | 6; text: string } | null {
  const open = HEADING_OPEN.exec(line)
  if (!open) return null
  let text = line.slice(open[0].length).trimEnd()
  let end = text.length
  while (end > 0 && text[end - 1] === '#') end -= 1
  if (end < text.length && (end === 0 || text[end - 1] === ' ' || text[end - 1] === '\t')) text = text.slice(0, end).trimEnd()
  return { level: open[1].length as 1 | 2 | 3 | 4 | 5 | 6, text }
}

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
/** A list line, at any indentation: the indentation says how deep it is. */
const BULLET = /^([ \t]*)[-*+][ \t]+(.*)$/
/** A list number has one or two digits: a line that starts with "2025. Our best year" is a sentence. */
const NUMBERED = /^([ \t]*)(\d{1,2})[.)][ \t]+(.*)$/
const QUOTE = /^[ \t]{0,3}>[ \t]?(.*)$/
const FENCE = /^[ \t]{0,3}(```+|~~~+)/

/** The width of an indentation, a tab counting as four spaces. */
const indentWidth = (indent: string): number => [...indent].reduce((width, c) => width + (c === '\t' ? 4 : 1), 0)

/** The cells of a table row: the outer bars are optional, a bar written `\\|` is part of a cell. */
function splitRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  const body = line.trim()
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cell += '|'
      i += 1
    } else if (body[i] === '|') {
      cells.push(cell)
      cell = ''
    } else cell += body[i]
  }
  cells.push(cell)
  if (body.startsWith('|')) cells.shift()
  if (body.endsWith('|') && !body.endsWith('\\|')) cells.pop()
  return cells.map((c) => c.trim())
}

/** The row under a table's header: `---`, `:---`, `---:` or `:---:` in each column. */
const DELIMITER_CELL = /^:?-{1,}:?$/
function alignmentRow(line: string): ('left' | 'center' | 'right' | null)[] | null {
  if (!line.includes('-') || !line.includes('|')) return null
  const cells = splitRow(line)
  if (cells.length === 0 || !cells.every((c) => DELIMITER_CELL.test(c))) return null
  return cells.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null))
}

/** The most columns and rows of a table that are read; what is beyond is ordinary text (nothing a person pastes makes the parse slow). */
const TABLE_MAX_COLUMNS = 12
const TABLE_MAX_ROWS = 200

/** A line that is a spoiler on its own line, not a quote: `>!words!<`. */
const SPOILER_LINE = /^[ \t]{0,3}>!.*!</

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const endParagraph = (): void => {
    if (para.length > 0) blocks.push({ t: 'p', c: paragraph(para) })
    para = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = FENCE.exec(line)
    if (fence) {
      endParagraph()
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith(fence[1].slice(0, 3))) {
        code.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push({ t: 'pre', v: code.join('\n') })
      continue
    }
    if (line.trim() === '') {
      endParagraph()
      i += 1
      continue
    }
    const heading = headingOf(line)
    if (heading) {
      endParagraph()
      blocks.push({ t: 'h', level: heading.level, c: parseInline(heading.text) })
      i += 1
      continue
    }
    if (RULE.test(line)) {
      endParagraph()
      blocks.push({ t: 'hr' })
      i += 1
      continue
    }
    if (line.includes('|') && i + 1 < lines.length) {
      const align = alignmentRow(lines[i + 1])
      const head = splitRow(line)
      if (align && head.length === align.length && head.length >= 1 && head.length <= TABLE_MAX_COLUMNS) {
        endParagraph()
        const rows: Inline[][][] = []
        i += 2
        while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|') && rows.length < TABLE_MAX_ROWS) {
          const cells = splitRow(lines[i])
          // A row is as wide as the header: a short one is filled, a long one is cut.
          rows.push(head.map((_, column) => parseInline(cells[column] ?? '')))
          i += 1
        }
        blocks.push({ t: 'table', align, head: head.map((cell) => parseInline(cell)), rows })
        continue
      }
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      endParagraph()
      const ordered = NUMBERED.test(line) && !BULLET.test(line)
      const kind = ordered ? NUMBERED : BULLET
      const start = ordered ? Number(NUMBERED.exec(line)?.[2] ?? 1) : 1
      const items: Inline[][] = []
      const depths: number[] = []
      const indents: number[] = []
      while (i < lines.length) {
        const match = kind.exec(lines[i])
        if (match) {
          // How deep an item is: how many shallower indentations are open above it.
          const width = indentWidth(match[1])
          while (indents.length > 0 && indents[indents.length - 1] > width) indents.pop()
          if (indents.length === 0 || indents[indents.length - 1] < width) indents.push(width)
          items.push(parseInline(match[ordered ? 3 : 2]))
          depths.push(indents.length - 1)
          i += 1
          continue
        }
        // A line indented under an item goes on with that item instead of ending the list.
        if (items.length > 0 && lines[i].trim() !== '' && indentWidth(/^[ \t]*/.exec(lines[i])?.[0] ?? '') >= 2 && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !FENCE.test(lines[i])) {
          items[items.length - 1] = [...items[items.length - 1], { t: 'br', hard: false }, ...parseInline(lines[i].trim())]
          i += 1
          continue
        }
        break
      }
      blocks.push(ordered ? { t: 'ol', items, depths, start } : { t: 'ul', items, depths })
      continue
    }
    if (QUOTE.test(line) && !SPOILER_LINE.test(line)) {
      endParagraph()
      const paragraphs: string[][] = [[]]
      while (i < lines.length) {
        const match = SPOILER_LINE.test(lines[i]) ? null : QUOTE.exec(lines[i])
        if (!match) break
        if (match[1].trim() === '') paragraphs.push([])
        else paragraphs[paragraphs.length - 1].push(match[1])
        i += 1
      }
      blocks.push({ t: 'quote', c: paragraphs.filter((p) => p.length > 0).map(paragraph) })
      continue
    }
    para.push(line)
    i += 1
  }
  endParagraph()
  return blocks
}

// ───────────────────────────── plain text ─────────────────────────────

/** What stands where a picture was taken out, until the spaces around it are closed up. */
const GAP = '\u0001'

/** Takes the markers of removed pictures out of a line, with the spaces they left: one space stays between two words, none at an edge. Every other space stays. */
function closeGaps(line: string): string {
  if (!line.includes(GAP)) return line
  let out = ''
  let i = 0
  while (i < line.length) {
    if (line[i] !== GAP) {
      out += line[i]
      i += 1
      continue
    }
    let keep = out.length
    while (keep > 0 && (out[keep - 1] === ' ' || out[keep - 1] === '\t')) keep -= 1
    const wordBefore = keep > 0 && out[keep - 1] !== '\n'
    out = out.slice(0, keep)
    let next = i + 1
    while (next < line.length && (line[next] === ' ' || line[next] === '\t' || line[next] === GAP)) next += 1
    if (wordBefore && next < line.length && line[next] !== '\n') out += ' '
    i = next
  }
  return out
}

/** The raised forms of the characters that have one. */
const RAISED: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', i: 'ⁱ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', n: 'ⁿ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ'
}

/** Raised words for a platform that has no superscript: the raised characters where every one has one (m^2 is m²), else the plain way of writing it, `^(some words)`. */
export function raisedWords(words: string): string {
  const raised = [...words].map((c) => RAISED[c])
  if (raised.length > 0 && raised.every((c) => c !== undefined)) return raised.join('')
  return /\s/.test(words) ? `^(${words})` : `^${words}`
}

/** The words of an inline run without its marks: a link shows its address after the words, a picture shows nothing. */
export function inlineToPlain(inlines: Inline[]): string {
  return inlines
    .map((node): string => {
      switch (node.t) {
        case 'text':
          return node.v
        case 'code':
          return node.v
        case 'strong':
        case 'em':
        case 'strike':
        case 'spoiler':
          return inlineToPlain(node.c)
        case 'sup':
          return raisedWords(inlineToPlain(node.c))
        case 'link': {
          const words = inlineToPlain(node.c)
          return words === node.href || words === '' ? node.href : `${words} (${node.href})`
        }
        case 'image':
          return GAP
        case 'br':
          return '\n'
      }
    })
    .join('')
}

/** The marks a text uses that not every platform has: what the owner should be told a platform does with them. */
export interface MarksUsed {
  spoiler: boolean
  table: boolean
  strike: boolean
  superscript: boolean
}

/** Which of the less common marks the text holds, read from the parsed text (so a mark inside code or a mark that is not closed does not count). */
export function marksIn(source: string): MarksUsed {
  const used: MarksUsed = { spoiler: false, table: false, strike: false, superscript: false }
  const walk = (nodes: Inline[]): void => {
    for (const node of nodes) {
      if (node.t === 'spoiler') used.spoiler = true
      if (node.t === 'strike') used.strike = true
      if (node.t === 'sup') used.superscript = true
      if (node.t === 'strong' || node.t === 'em' || node.t === 'strike' || node.t === 'sup' || node.t === 'spoiler' || node.t === 'link') walk(node.c)
    }
  }
  for (const block of parseBlocks(source)) {
    switch (block.t) {
      case 'p':
      case 'h':
        walk(block.c)
        break
      case 'ul':
      case 'ol':
        block.items.forEach(walk)
        break
      case 'quote':
        block.c.forEach(walk)
        break
      case 'table':
        used.table = true
        block.head.forEach(walk)
        block.rows.forEach((row) => row.forEach(walk))
        break
      case 'pre':
      case 'hr':
        break
    }
  }
  return used
}

/** What a platform that shows no marks receives: the words, with headings as lines, lists as bullets and quotes in quotation marks. */
export function toPlainText(source: string): string {
  const blocks = parseBlocks(source)
  const parts = blocks.map((block): string => {
    switch (block.t) {
      case 'p':
        return inlineToPlain(block.c)
      case 'h':
        return inlineToPlain(block.c)
      case 'ul':
        return block.items.map((item, index) => `${'  '.repeat(block.depths[index])}• ${inlineToPlain(item)}`).join('\n')
      case 'ol': {
        // Each depth counts on its own, and a shallower item starts the deeper ones again.
        const counters: number[] = []
        return block.items
          .map((item, index) => {
            const depth = block.depths[index]
            counters.length = depth + 1
            counters[depth] = (counters[depth] ?? (depth === 0 ? block.start - 1 : 0)) + 1
            return `${'  '.repeat(depth)}${counters[depth]}. ${inlineToPlain(item)}`
          })
          .join('\n')
      }
      case 'quote':
        return block.c.map((q) => `“${inlineToPlain(q)}”`).join('\n\n')
      case 'pre':
        return block.v
      case 'table':
        // A platform without tables gets the rows as lines, the cells apart by a bar: the header first.
        return [block.head, ...block.rows].map((row) => row.map((cell) => inlineToPlain(cell)).join(' | ')).join('\n')
      case 'hr':
        return '———'
    }
  })
  // A picture taken out of a line is closed up (nothing else in a line is touched, spacing and code included); a line does not end in spaces.
  return parts
    .map((part, index) => (blocks[index].t === 'pre' ? part : part.split('\n').map((line) => closeGaps(line).trimEnd()).join('\n').trim()))
    .filter((part) => part !== '')
    .join('\n\n')
}

const PICTURE_EVERYWHERE = /!\[[^\]\n]{0,200}\]\(media:([A-Za-z0-9-]{1,64})\)/g
const PICTURE_HERE = /!\[[^\]\n]{0,200}\]\(media:[A-Za-z0-9-]{1,64}\)/
/** What is left of a list, quote or heading line when its picture was taken out: nothing a reader should see (a bare `-` under a line would turn it into a heading). */
const BARE_MARKER = /^[ \t]*(?:[-*+]|\d{1,2}[.)]|>|#{1,6})[ \t]*$/

/**
 * The text without pictures placed in it (all of them, or those `which` accepts). Only the pictures go: the spaces they leave are closed up,
 * a line that held nothing else goes with its blank line so no gap is left, code (fenced) is not touched, and every other character of the
 * text stays as the owner wrote it.
 */
export function removePictures(source: string, which: (id: string) => boolean = () => true): string {
  if (!PICTURE_HERE.test(source)) return source
  const out: string[] = []
  let gap = false
  let fence: string | null = null
  for (const line of source.split('\n')) {
    const opened = FENCE.exec(line)
    if (fence !== null) {
      if (line.trimStart().startsWith(fence)) fence = null
      out.push(line)
      gap = false
      continue
    }
    if (opened) {
      fence = opened[1].slice(0, 3)
      out.push(line)
      gap = false
      continue
    }
    if (PICTURE_HERE.test(line)) {
      let removed = false
      const rest = closeGaps(
        line.replace(PICTURE_EVERYWHERE, (mark, id: string) => {
          if (!which(id)) return mark
          removed = true
          return GAP
        })
      )
      if (removed) {
        if (rest.trim() === '' || BARE_MARKER.test(rest)) {
          gap = true
          continue
        }
        out.push(rest)
        gap = false
        continue
      }
    }
    // The blank line after a picture that stood alone would double the one before it.
    if (gap && line.trim() === '' && (out.length === 0 || out[out.length - 1].trim() === '')) continue
    out.push(line)
    gap = false
  }
  return out.join('\n')
}

/** Pictures placed in a Markdown text, all removed (a platform that takes pictures beside the text, not inside it). */
export const withoutInlinePictures = (source: string): string => removePictures(source).trim()

// ───────────────────────────── platforms ─────────────────────────────

export interface PlatformForm {
  /** What the platform shows: `markdown` (Reddit) or plain text only. */
  format: 'markdown' | 'plain'
  /** Whether the platform has a title above the text. */
  hasTitle: boolean
  titleLimit: number | null
  textLimit: number | null
  /** How many characters the platform's API takes as the words under a picture or a video, when that is less than `textLimit` (Telegram). */
  apiCaptionLimit?: number
  /** `none`: the platform takes a video, but this application's API connector of it carries none (a Facebook Page). */
  apiVideos?: 'none'
  /** `required`: a post without a picture is refused by the platform (Instagram). A video can stand in for the picture where the platform takes one (`videos` is not `none`). */
  pictures: 'none' | 'optional' | 'required'
  maxPictures: number
  /** `none`: the platform takes no video with a post; `required`: a post without a video is refused (TikTok, YouTube). */
  videos: 'none' | 'optional' | 'required'
  /** A post carries one video, and a video goes alone: pictures and a video are not mixed in one post. */
  maxVideos: number
  /**
   * Where a draft's link goes. `field`: the platform's form has a field for it (Reddit), and a site that is not listed is taken to have one.
   * `in_text`: no field, but a link in the text works: it is the last paragraph of the text. `in_bio`: no field, and a link in the text does
   * not work either (Instagram does not make a caption's link clickable): the address is not sent, the caption ends with "Link in bio" instead
   * and the link lives in the account's profile (DEC-036, changed by DEC-044).
   */
  link: 'field' | 'in_text' | 'in_bio'
}

const OTHER: PlatformForm = { format: 'plain', hasTitle: false, titleLimit: null, textLimit: null, pictures: 'optional', maxPictures: 10, videos: 'optional', maxVideos: 1, link: 'field' }

/** What each platform of the application shows and holds. Limits are the platforms' published ones; a site that is not listed has none. */
export const PLATFORM_FORMS: Record<string, PlatformForm> = {
  reddit: { format: 'markdown', hasTitle: true, titleLimit: 300, textLimit: 40_000, pictures: 'optional', maxPictures: 20, videos: 'optional', maxVideos: 1, link: 'field' },
  instagram: { format: 'plain', hasTitle: false, titleLimit: null, textLimit: 2_200, pictures: 'required', maxPictures: 10, videos: 'optional', maxVideos: 1, link: 'in_bio' },
  facebook: { format: 'plain', hasTitle: false, titleLimit: null, textLimit: 63_206, apiVideos: 'none', pictures: 'optional', maxPictures: 10, videos: 'optional', maxVideos: 1, link: 'in_text' },
  threads: { format: 'plain', hasTitle: false, titleLimit: null, textLimit: 500, pictures: 'optional', maxPictures: 10, videos: 'optional', maxVideos: 1, link: 'in_text' },
  x: { format: 'plain', hasTitle: false, titleLimit: null, textLimit: 280, pictures: 'optional', maxPictures: 4, videos: 'optional', maxVideos: 1, link: 'in_text' },
  linkedin: { format: 'plain', hasTitle: false, titleLimit: null, textLimit: 3_000, pictures: 'optional', maxPictures: 9, videos: 'optional', maxVideos: 1, link: 'in_text' },
  telegram: { format: 'plain', hasTitle: false, titleLimit: null, textLimit: 4_096, apiCaptionLimit: 1_024, pictures: 'optional', maxPictures: 10, videos: 'optional', maxVideos: 1, link: 'in_text' },
  pinterest: { format: 'plain', hasTitle: true, titleLimit: 100, textLimit: 500, pictures: 'required', maxPictures: 1, videos: 'optional', maxVideos: 1, link: 'field' },
  tiktok: { format: 'plain', hasTitle: false, titleLimit: null, textLimit: 2_200, pictures: 'none', maxPictures: 0, videos: 'required', maxVideos: 1, link: 'field' },
  youtube: { format: 'plain', hasTitle: true, titleLimit: 100, textLimit: 5_000, pictures: 'none', maxPictures: 0, videos: 'required', maxVideos: 1, link: 'field' }
}

/** How many of the attachments are pictures and how many are videos (every other place that counted "pictures" counts through this). */
export function kindsOf(attachments: readonly Pick<Attachment, 'mime'>[]): { pictures: number; videos: number } {
  const videos = attachments.filter((a) => isVideoMime(a.mime)).length
  return { pictures: attachments.length - videos, videos }
}

export const formOf = (platform: string): PlatformForm => PLATFORM_FORMS[platform] ?? OTHER

/**
 * What the AI that writes a post is told about the platform's link: nothing when the form has a field for it, else where it goes. The same
 * rule `renderForPlatform` applies, so the AI does not write what the platform cannot take.
 */
export function linkRuleOf(platform: string): string | null {
  const link = formOf(platform).link
  if (link === 'in_text') return `${platformLabel(platform)} has no link field: a link is added at the end of the text, and counts against the text limit.`
  if (link === 'in_bio') return `${platformLabel(platform)} does not show links in a post: leave "link" empty. The application ends the caption with "${BIO_LINE}" itself, so do not write that line; it counts against the text limit.`
  return null
}

/**
 * Whether the text already holds this very address, not a longer one that starts with it ("https://x.io" is not in "https://x.io/pricing" or
 * in "https://x.io:8080"), with or without a closing slash ("https://x.io" is in "https://x.io/."), and not as the end of another word
 * ("x.io/a" is not in "notx.io/a"). The scheme and the host are read without their case ("https://X.io" is "https://x.io"); the rest of the
 * address is not, because a path can be case-sensitive: "https://x.io/Docs" is not "https://x.io/docs".
 */
function holdsAddress(text: string, address: string): boolean {
  const base = address.replace(/\/+$/, '')
  if (base === '') return false
  const origin = /^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*/i.exec(base)?.[0].length ?? 0
  const pattern = [...base]
    .map((c, i) => (i < origin && /[A-Za-z]/.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('')
  const more = '[\\p{L}\\p{N}_%~@+/?#&=-]'
  return new RegExp(`(?<![\\p{L}\\p{N}_@./:-])${pattern}(?:/(?!${more}|\\.[\\p{L}\\p{N}]|:\\d))?(?!${more}|\\.[\\p{L}\\p{N}]|:\\d)`, 'u').test(text)
}

/** The closing line of a caption on a platform that does not make a link in a post work: the link is in the account's profile (DEC-044). */
export const BIO_LINE = 'Link in bio'

/** Whether the text already sends the reader to the profile ("link in bio", "link in my profile"), so the line is not written twice. */
const holdsBioLine = (text: string): boolean => /\blink\s+in\s+(?:my\s+|our\s+|the\s+)?(?:bio|profile)\b/i.test(text)

/**
 * The link of a draft where the platform has no field for it (DEC-036). `in_text`: the last paragraph of the text, unless the text already holds
 * that very address. `in_bio`: the address is not sent; the last paragraph is "Link in bio", unless the text says so already. Either way the link is
 * no longer a separate part of the post, so nothing is typed into a field that is not there, and the preview says what became of it.
 */
function placeLink(form: PlatformForm, label: string, text: string, link: string | null): { text: string; link: string | null; shown: string | null; note: string | null } {
  const address = link?.trim() ?? ''
  if (address === '' || form.link === 'field') return { text, link, shown: link, note: null }
  if (form.link === 'in_bio') {
    // A line that only points to the profile is no caption: with no words of the owner's, a link alone is still nothing to post.
    if (text.trim() === '' || holdsBioLine(text)) return { text, link: null, shown: null, note: null }
    return { text: `${text.trimEnd()}\n\n${BIO_LINE}`, link: null, shown: null, note: `${label} does not make a link in a post clickable and has no field for it: the caption ends with "${BIO_LINE}", and the link belongs in the profile.` }
  }
  if (holdsAddress(text, address)) return { text, link: null, shown: link, note: null }
  return { text: text.trim() === '' ? address : `${text.trimEnd()}\n\n${address}`, link: null, shown: link, note: `${label} has no link field: the link is added at the end of the text.` }
}

/** Raised when where a link goes on a platform, or what is said of it, changes: an approval given under the old placement stops matching. */
export const LINK_PLACEMENT_VERSION = 1

/**
 * How the link of a draft is placed on `platform` when its form has no field for it (`in_text:1`, `in_bio:1`), or null when the draft has no link
 * or the form has a field. The approval hash carries it (DEC-036): a draft approved before the rule existed, or under another placement, was
 * approved for a different post than the one this rule types, and is approved again. Reddit and a draft without a link are never touched.
 */
export function linkPlacementOf(platform: string, link: string | null | undefined): string | null {
  const how = formOf(platform).link
  if (how === 'field' || !link || link.trim() === '') return null
  return `${how}:${LINK_PLACEMENT_VERSION}`
}

/**
 * The address of the product's site that ends a new post, or null (DEC-044): only where the link goes in the post's text or points to the profile
 * (`in_text`, `in_bio`), never into a platform's link field (a Reddit post with a link is another kind of post), and only when the product keeps
 * the setting on and has a site. The one answer for the core, which writes it into the first draft, and for the composer's preview.
 */
export function siteLinkFor(platform: string, product: { websiteUrl: string | null; addSiteLink: boolean; tagSiteLink?: boolean }, channelTarget?: string): string | null {
  const how = formOf(platform).link
  if (how !== 'in_text' && how !== 'in_bio') return null
  const address = product.websiteUrl?.trim() ?? ''
  if (!product.addSiteLink || address === '') return null
  // On Instagram the address is not printed (the caption says "Link in bio"): there is nothing to tag.
  return product.tagSiteLink && how === 'in_text' && channelTarget ? taggedLink(address, platform, channelTarget) : address
}

/**
 * The site's address with the tags a site's analytics reads (utm_source: the platform, utm_medium: social, utm_campaign: the channel), so a visit
 * says where it came from. Tags the address already has are kept; an address that is not a web address is returned as it is.
 */
export function taggedLink(address: string, platform: string, channelTarget: string): string {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return address
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return address
  const channel = channelTarget.toLowerCase().replace(/^(@|r\/)/, '').replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
  const tags: [string, string][] = [['utm_source', platform], ['utm_medium', 'social'], ['utm_campaign', channel]]
  for (const [key, value] of tags) if (value && !url.searchParams.has(key)) url.searchParams.set(key, value)
  return url.toString()
}

const LABELS: Record<string, string> = { reddit: 'Reddit', instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads', x: 'X', linkedin: 'LinkedIn', telegram: 'Telegram', pinterest: 'Pinterest', tiktok: 'TikTok', youtube: 'YouTube' }

/** The name of the platform for a sentence; a site that is not listed is "this site". */
export const platformLabel = (platform: string): string => LABELS[platform] ?? 'This site'

export interface PostContent {
  title: string | null
  text: string
  link: string | null
  attachments: Attachment[]
  markup: PostMarkup
  /** `quick`: one picture and a caption, sent as it is written (DEC-046). Left out, the post is an article (an older draft is one). */
  postType?: PostType
}

/**
 * Whether the application judges what a platform takes of this post (its limits, its pictures, the way it is carried) before it is approved:
 * a post written in the post editor, and a quick post, whose caption is plain words (`markup` legacy) but whose picture must fit the platform.
 * An older draft is judged by its connector, as before (DEC-030). One answer for the approval, the gate, the group view and the preview.
 */
export const judgedForFit = (content: Pick<PostContent, 'markup' | 'postType'>): boolean => content.markup === 'markdown' || content.postType === 'quick'

export interface RenderedPost {
  title: string | null
  text: string
  link: string | null
  /**
   * The link as the post shows it: the draft's link where it stands in the text (DEC-036), null where the platform leaves it out.
   */
  shownLink: string | null
  attachments: Attachment[]
  format: 'markdown' | 'plain'
  /** Things the owner should know about how the platform will show this post; they do not stop it. */
  notes: string[]
  /** Reasons the platform cannot take this post as it is; an approval is refused while there are any. */
  problems: string[]
}

export interface RenderOptions {
  /** `keep`: pictures stay in the Markdown text (the AI browser places them in the platform's own editor). Default `drop`: pictures go beside the text. */
  pictures?: 'drop' | 'keep'
}

/**
 * The post as `platform` receives it. A draft that is not `markdown` is returned as written, but for where its link goes (DEC-036): nothing else
 * is changed, so nothing that was approved before the post editor can differ. For a `markdown` draft: Reddit gets the Markdown (pictures beside it), every other
 * platform gets plain text, and a title the platform has no place for is left out and said so.
 */
export function renderForPlatform(content: PostContent, platform: string, options: RenderOptions = {}): RenderedPost {
  const form = formOf(platform)
  if (content.markup !== 'markdown') {
    // Written as it is, except where the platform has no field for the link (it is the last line of the text, or left out): nothing could carry it otherwise.
    // Nothing else of an older draft is judged here; but a link added to the text can take it over the limit, and that is said (it did not count before).
    const label = platformLabel(platform)
    const placed = placeLink(form, label, content.text, content.link)
    // Only what the link caused: a draft that was over the limit without it was never judged here, and is not now.
    const over = placed.text !== content.text && form.textLimit !== null && characterCount(content.text) <= form.textLimit && characterCount(placed.text) > form.textLimit
    // A quick post is judged whole, by the rules of the platform, on the caption as it is written (plus the link where it is placed in the text).
    const problems = content.postType === 'quick' ? formProblems(form, label, { title: content.title, text: placed.text, link: placed.link, ...kindsOf(content.attachments), quick: true }) : over ? [`The text is ${characterCount(placed.text)} characters; ${label} allows ${form.textLimit}.`] : []
    return {
      title: content.title,
      text: placed.text,
      link: placed.link,
      shownLink: placed.shown,
      attachments: content.attachments,
      format: 'plain',
      notes: placed.note ? [placed.note] : [],
      problems
    }
  }
  const notes: string[] = []
  const placed = pictureIdsIn(content.text).length
  const words = form.format === 'markdown' ? (options.pictures === 'keep' ? content.text.trim() : withoutInlinePictures(content.text)) : toPlainText(content.text)
  let title = content.title
  const label = platformLabel(platform)
  const linked = placeLink(form, label, words, content.link)
  const text = linked.text
  if (linked.note) notes.push(linked.note)
  // A picture or a video in the text is written as ![alt](media:ID), which is not formatting: only the marks of the words count here.
  if (form.format === 'plain' && /[*_#>`~]|\]\(|^[ \t]*[-+][ \t]/m.test(withoutInlinePictures(content.text))) notes.push(`${label} shows no formatting: the marks are removed and the words stay.`)
  if (form.format === 'plain') {
    const used = marksIn(content.text)
    if (used.spoiler) notes.push(`${label} has no spoilers: the hidden words show as they are.`)
    if (used.table) notes.push(`${label} has no tables: the rows are shown as lines, the cells apart by a bar.`)
    if (used.strike) notes.push(`${label} cannot cross words out: they show as they are.`)
  }
  if (placed > 0 && options.pictures !== 'keep') {
    notes.push(kindsOf(content.attachments).videos > 0 ? `${label} takes the video beside the text, not inside it: it is shown after the text.` : `${label} takes the pictures beside the text, not inside it: they are shown after the text, in order.`)
  }
  if (title && !form.hasTitle) {
    notes.push(`${label} has no title: the title is left out.`)
    title = null
  }
  const problems = formProblems(form, label, { title, text, link: linked.link, ...kindsOf(content.attachments) })
  return { title, text, link: linked.link, shownLink: linked.shown, attachments: content.attachments, format: form.format, notes, problems }
}

/**
 * What a platform's form refuses about a post whatever the way it is written: the pictures it takes, needs or refuses, the limits of its title and
 * text (`text` is what is typed, the link included where it is placed in the text), a post with nothing in it. One list for a post written in
 * the post editor and for a quick post, so the two cannot be judged by different rules.
 */
function formProblems(form: PlatformForm, label: string, post: { title: string | null; text: string; link: string | null; pictures: number; videos?: number; quick?: boolean }): string[] {
  const problems: string[] = []
  const videos = post.videos ?? 0
  const takesVideos = form.videos !== 'none'
  // A quick post is a picture and a caption, so what it lacks is a picture; any other post may have a video in its place.
  const orVideo = takesVideos && !post.quick ? ' or a video' : ''
  if (form.pictures === 'none' && post.pictures > 0) problems.push(`${label} takes no pictures with a post.`)
  if (form.pictures === 'required' && post.pictures === 0 && videos === 0) problems.push(`${label} needs a picture${orVideo}: add one.`)
  if (post.pictures > form.maxPictures && form.maxPictures > 0) problems.push(`${label} takes at most ${form.maxPictures} picture${form.maxPictures === 1 ? '' : 's'}; this post has ${post.pictures}.`)
  if (videos > 0) {
    if (!takesVideos) problems.push(`${label} takes no videos with a post.`)
    else {
      if (videos > form.maxVideos) problems.push(`${label} takes ${form.maxVideos === 1 ? 'one video' : `at most ${form.maxVideos} videos`} with a post; this post has ${videos}.`)
      if (post.pictures > 0) problems.push(`${label} takes a video or pictures with a post, not both: take one kind out.`)
    }
  }
  if (form.videos === 'required' && videos === 0) problems.push(`${label} needs a video: add one.`)
  if (post.title && form.titleLimit !== null && characterCount(post.title) > form.titleLimit) problems.push(`The title is ${characterCount(post.title)} characters; ${label} allows ${form.titleLimit}.`)
  if (form.textLimit !== null && characterCount(post.text) > form.textLimit) problems.push(`The text is ${characterCount(post.text)} characters; ${label} allows ${form.textLimit}.`)
  if (post.text === '' && post.pictures === 0 && videos === 0 && !post.title && !post.link) problems.push(orVideo ? 'There is nothing to post: no words, no picture and no video.' : 'There is nothing to post: no words and no picture.')
  return problems
}

/** How this application can publish, as far as it decides what a post may hold: the AI browser carries pictures to any platform, and only on a send the owner presses (DEC-031). */
export interface SendWays {
  aiBrowser: boolean
  /** The AI browser is chosen, and this send is one it never carries: one on an automatic rule's approval, or an automatic one the owner gave no time. */
  unattended?: boolean
  /**
   * The channel is one the application does not read (Instagram, Facebook, Threads...): no connector can post to it, so the AI browser is its
   * only way and needs no switch in the settings (DEC-035). Everything else about it is as for any AI-browser send.
   */
  noConnector?: boolean
  /** The channel works through its platform's own API (DEC-055): its connector carries every send, pictures and video included, and the AI browser is never used. */
  api?: boolean
  /** The AI browser would carry this send, but the selected engine cannot work the browser: why, in words (only for a channel with no connector). */
  engineProblem?: string
}

const UNATTENDED_MESSAGE =
  'This is an automatic send, and the AI browser carries only what you send yourself, with a press or with a time you set: press Send on it, or use “Copy post” and publish it by hand. Nothing was sent.'

/**
 * Why a send to a channel that no connector can post to cannot go by the AI browser right now, when it is something other than the post that
 * stops it: the selected engine (it cannot work the browser), or a send that is scheduled or automatic (DEC-035). It is the
 * same for every kind of draft, an older one too: the form of the post is no part of it. Null when nothing stops it, and for a channel a
 * connector can post to.
 */
export function noConnectorProblem(ways: SendWays): string | null {
  if (!ways.noConnector || ways.aiBrowser) return null
  if (ways.engineProblem) return ways.engineProblem
  return ways.unattended ? UNATTENDED_MESSAGE : null
}

/**
 * Why a markdown post cannot be sent from this application as it is, in words: what the platform cannot take (`problems` of the render) and
 * what the way the application publishes cannot carry. Through the connector a picture goes out only as a Reddit post by itself; through the
 * AI browser (`ways.aiBrowser`: chosen in the settings, the engine drives the account's own browser, and the owner presses Send) a picture
 * goes to any platform that takes one, and is limited by what the platform takes. The owner can always copy the post and publish it by hand.
 * Older drafts are not judged here: their connectors check them when they send.
 */
export function sendProblems(platform: string, rendered: RenderedPost, ways: SendWays = { aiBrowser: false }): string[] {
  const problems = [...rendered.problems]
  const label = platformLabel(platform)
  // What the Reddit publisher refuses, said before the owner approves rather than after the send fails.
  if (platform === 'reddit') {
    if (!rendered.title?.trim()) problems.push('A Reddit post needs a title.')
    if (rendered.link && rendered.text.trim()) problems.push('A Reddit post is a link or a text, not both: leave the link out, or the words (put the link in the words).')
    if (rendered.link && !/^https?:\/\//i.test(rendered.link)) problems.push('The link must start with http:// or https://.')
  }
  // A channel no connector can post to has the AI browser as its only way: what stops it is said whatever the post holds (DEC-035).
  const stopped = noConnectorProblem(ways)
  if (stopped) problems.push(stopped)
  // Through its API a platform may take fewer words with a picture or a video than in a post of words alone.
  const captionLimit = ways.api ? formOf(platform).apiCaptionLimit : undefined
  if (captionLimit !== undefined && rendered.attachments.length > 0 && [...rendered.text].length > captionLimit) {
    problems.push(`${label} takes at most ${captionLimit.toLocaleString('en-US')} characters with a picture or a video; this post has ${[...rendered.text].length.toLocaleString('en-US')}. Shorten the words, or send them without the picture.`)
  }
  if (ways.api && formOf(platform).apiVideos === 'none' && kindsOf(rendered.attachments).videos > 0) {
    problems.push(`A video is not sent to ${label} through its API by this application. Take the video off, or publish it on ${label} yourself.`)
  }
  if (rendered.attachments.length > 0 && !ways.aiBrowser && !ways.api) {
    // A video is carried by the AI browser only: no connector of this application uploads one.
    const hasVideo = kindsOf(rendered.attachments).videos > 0
    const things = hasVideo ? 'Videos' : 'Pictures'
    // What the connector cannot carry: a video anywhere; more than one picture, or a picture with words, on Reddit; any picture elsewhere.
    const connectorCannot = hasVideo || (platform === 'reddit' ? rendered.attachments.length > 1 || rendered.text.trim() !== '' || rendered.link !== null : true)
    if (ways.noConnector) {
      // Said above when it is the engine or an unattended send; otherwise the AI browser is simply not there (a build without it).
      if (!ways.engineProblem && !ways.unattended) problems.push(`${things} go to ${label} only through the AI browser, on a send of your own (a press of Send, or a time you set). It is not available in this build: use “Copy post” and publish it by hand.`)
    } else if (connectorCannot && ways.unattended) {
      // The AI browser is chosen, but this send is one it never carries: the owner presses Send, or publishes by hand.
      problems.push(UNATTENDED_MESSAGE)
    } else if (platform === 'reddit' && !hasVideo) {
      if (rendered.attachments.length > 1) problems.push(`From this application Reddit takes one picture as a post by itself; this post has ${rendered.attachments.length}. The AI browser can send more: choose it in the settings and press Send yourself.`)
      else if (rendered.text.trim() || rendered.link) problems.push('From this application Reddit takes a picture only as a post by itself, without text or a link. Choose the AI browser in the settings and press Send yourself, or use “Copy post” and publish it by hand, or post the words without the picture.')
    } else {
      problems.push(`${things} go to ${label} only through the AI browser, on a send of your own (a press of Send, or a time you set): choose it in the settings and send this by hand, or use “Copy post” and publish it by hand.`)
    }
  }
  return problems
}
