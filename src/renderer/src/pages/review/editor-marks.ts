// The buttons of the post editor (DEC-030) as pure functions on a text and the selection in it, so each is tested without the screen
// (lesson 101). A mark that is already there is taken off again; the selection stays on the words it was on.

import { pictureIdsIn, removePictures } from '../../../../shared/post-format'

export interface Selection {
  text: string
  start: number
  end: number
}

export type Mark = 'bold' | 'italic' | 'strike' | 'sup' | 'spoiler' | 'code' | 'codeblock' | 'heading' | 'bullets' | 'numbers' | 'quote' | 'table' | 'link'

const PLACEHOLDER: Record<'bold' | 'italic' | 'strike' | 'sup' | 'spoiler' | 'code' | 'link', string> = {
  bold: 'bold words',
  italic: 'words',
  strike: 'crossed out',
  sup: 'raised',
  spoiler: 'hidden words',
  code: 'code',
  link: 'link text'
}

/** `**`, `*` or a backtick around the selection; around the words that are selected already, taken off. Nothing selected: a placeholder, selected. */
function wrap(sel: Selection, mark: string, placeholder: string): Selection {
  const { text, start, end } = sel
  const chosen = text.slice(start, end)
  // `*` next to another `*` is the bold mark, not an italic one: italic on bold words adds a mark, it does not take half of the bold off.
  const partOfBold = mark === '*' && (text[start - 2] === '*' || text[end + 1] === '*')
  if (!partOfBold && text.slice(start - mark.length, start) === mark && text.slice(end, end + mark.length) === mark && start >= mark.length) {
    return { text: text.slice(0, start - mark.length) + chosen + text.slice(end + mark.length), start: start - mark.length, end: end - mark.length }
  }
  const chosenBold = mark === '*' && (chosen.startsWith('**') || chosen.endsWith('**'))
  if (!chosenBold && chosen.length >= mark.length * 2 + 1 && chosen.startsWith(mark) && chosen.endsWith(mark)) {
    const inner = chosen.slice(mark.length, chosen.length - mark.length)
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length }
  }
  const words = chosen === '' ? placeholder : chosen
  const next = text.slice(0, start) + mark + words + mark + text.slice(end)
  return { text: next, start: start + mark.length, end: start + mark.length + words.length }
}

/**
 * A mark that is written differently on each side (`^(` … `)`, `>!` … `!<`) around each line of the selection: the parser reads these marks within one line, so a selection of
 * several lines gets one mark on each of them. Words that are marked already (every line, or the mark just outside the selection) are taken off again. Nothing selected:
 * a placeholder, selected.
 */
function wrapLines(sel: Selection, open: string, close: string, placeholder: string): Selection {
  const { text, start, end } = sel
  const chosen = text.slice(start, end)
  if (chosen === '') {
    const next = text.slice(0, start) + open + placeholder + close + text.slice(end)
    return { text: next, start: start + open.length, end: start + open.length + placeholder.length }
  }
  if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close && start >= open.length) {
    return { text: text.slice(0, start - open.length) + chosen + text.slice(end + close.length), start: start - open.length, end: end - open.length }
  }
  const lines = chosen.split('\n')
  const marked = (line: string): boolean => line.trim().startsWith(open) && line.trim().endsWith(close) && line.trim().length > open.length + close.length
  const changed = lines.every((line) => line.trim() === '' || marked(line))
    ? lines.map((line) => (line.trim() === '' ? line : line.replace(open, '').replace(new RegExp(`${close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*)$`), '$1')))
    : lines.map((line) => (line.trim() === '' ? line : `${/^\s*/.exec(line)?.[0] ?? ''}${open}${line.trim()}${close}${/\s*$/.exec(line)?.[0] ?? ''}`))
  const joined = changed.join('\n')
  const next = text.slice(0, start) + joined + text.slice(end)
  // One line: the words stay selected inside their marks, like bold, so the same button takes the marks off again. Several lines: the marked lines are selected.
  if (lines.length === 1 && joined.trim().startsWith(open) && joined.trim().endsWith(close)) {
    const at = start + joined.indexOf(open) + open.length
    return { text: next, start: at, end: at + joined.trim().length - open.length - close.length }
  }
  return { text: next, start, end: start + joined.length }
}

/** The lines of the selection between code fences; fenced already (a fence on the line above and the line below), the fences go. Nothing selected: a fence with a placeholder. */
function codeBlock(sel: Selection): Selection {
  const { text, start, end } = sel
  const { from, to } = lineSpan(text, start, end)
  const above = from > 0 ? text.slice(text.lastIndexOf('\n', from - 2) + 1, from - 1) : null
  const belowStart = to + 1
  const below = to < text.length ? text.slice(belowStart, text.indexOf('\n', belowStart) === -1 ? text.length : text.indexOf('\n', belowStart)) : null
  if (above !== null && below !== null && above.trim() === '```' && below.trim() === '```') {
    const aboveFrom = from - 1 - above.length
    const belowTo = belowStart + below.length
    const inner = text.slice(from, to)
    return { text: text.slice(0, aboveFrom) + inner + text.slice(belowTo), start: aboveFrom, end: aboveFrom + inner.length }
  }
  const inner = text.slice(from, to) === '' ? 'code' : text.slice(from, to)
  const block = '```\n' + inner + '\n```'
  return { text: text.slice(0, from) + block + text.slice(to), start: from + 4, end: from + 4 + inner.length }
}

/** A table to fill in, on a paragraph of its own at the cursor; the first heading cell is selected. */
function table(sel: Selection): Selection {
  const { text, start, end } = sel
  const before = text.slice(0, start)
  const after = text.slice(end)
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trail = after === '' ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const rows = '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |'
  const first = before.length + lead.length + 2
  return { text: before + lead + rows + trail + after, start: first, end: first + 'Column 1'.length }
}

/** The lines the selection touches: from the start of the first to the end of the last. */
function lineSpan(text: string, start: number, end: number): { from: number; to: number } {
  const from = start <= 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1
  const lastChar = end > start && text[end - 1] === '\n' ? end - 1 : end
  const next = text.indexOf('\n', lastChar)
  return { from, to: next === -1 ? text.length : next }
}

/** A prefix on every line of the selection (`- `, `> `, `1. `), or taken off when every line has it already. */
function prefixLines(sel: Selection, has: RegExp, make: (index: number) => string): Selection {
  const { text, start, end } = sel
  const { from, to } = lineSpan(text, start, end)
  const lines = text.slice(from, to).split('\n')
  const allHave = lines.every((line) => line.trim() === '' || has.test(line))
  const changed = lines.map((line, index) => (line.trim() === '' ? line : allHave ? line.replace(has, '') : make(index) + line.replace(/^(?:[-*+] |\d+[.)] |> |#{1,6} )/, '')))
  const joined = changed.join('\n')
  return { text: text.slice(0, from) + joined + text.slice(to), start: from, end: from + joined.length }
}

/** `[words](https://)` with the address selected for typing; the words that were selected become the text of the link. */
function link(sel: Selection): Selection {
  const { text, start, end } = sel
  const chosen = text.slice(start, end)
  const words = chosen === '' ? PLACEHOLDER.link : chosen
  const address = 'https://'
  const next = `${text.slice(0, start)}[${words}](${address})${text.slice(end)}`
  const addressStart = start + words.length + 3
  return { text: next, start: addressStart, end: addressStart + address.length }
}

export function applyMark(sel: Selection, mark: Mark): Selection {
  switch (mark) {
    case 'bold':
      return wrap(sel, '**', PLACEHOLDER.bold)
    case 'italic':
      return wrap(sel, '*', PLACEHOLDER.italic)
    case 'strike':
      return wrap(sel, '~~', PLACEHOLDER.strike)
    case 'sup':
      return wrapLines(sel, '^(', ')', PLACEHOLDER.sup)
    case 'spoiler':
      return wrapLines(sel, '>!', '!<', PLACEHOLDER.spoiler)
    case 'code':
      return wrap(sel, '`', PLACEHOLDER.code)
    case 'codeblock':
      return codeBlock(sel)
    case 'table':
      return table(sel)
    case 'heading':
      return prefixLines(sel, /^## /, () => '## ')
    case 'bullets':
      return prefixLines(sel, /^[-*+] /, () => '- ')
    case 'numbers':
      return prefixLines(sel, /^\d+[.)] /, (index) => `${index + 1}. `)
    case 'quote':
      return prefixLines(sel, /^> ?/, () => '> ')
    case 'link':
      return link(sel)
  }
}

/** A picture on a paragraph of its own at the cursor; the cursor ends after it. The picture replaces what is selected. */
export function insertPicture(sel: Selection, id: string, alt: string): Selection {
  const { text, start, end } = sel
  const before = text.slice(0, start)
  const after = text.slice(end)
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trail = after === '' ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const mark = `![${alt.replace(/[\]\n[]/g, ' ').trim()}](media:${id})`
  const next = before + lead + mark + trail + after
  const cursor = before.length + lead.length + mark.length + (trail === '' && after === '' ? 0 : trail.length)
  return { text: next, start: cursor, end: cursor }
}

/** The text without the marks of one picture (it was taken out of the draft): the spaces it leaves are closed up, and nothing else is touched. */
export function withoutPicture(text: string, id: string): string {
  return removePictures(text, (other) => other === id)
}

/** The ids of the pictures placed in the text, in the order they appear. */
export function placedPictures(text: string): string[] {
  return pictureIdsIn(text)
}

/** The pictures of an event that carries files (a paste, a drop): only images, in order. */
export function imageFilesOf(files: ArrayLike<File> | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) => /^image\/(png|jpeg|gif|webp)$/.test(file.type))
}
