// The buttons of the post editor (DEC-030) as pure functions on a text and the selection in it, so each is tested without the screen
// (lesson 101). A mark that is already there is taken off again; the selection stays on the words it was on.

import { pictureIdsIn, removePictures } from '../../../../shared/post-format'

export interface Selection {
  text: string
  start: number
  end: number
}

export type Mark = 'bold' | 'italic' | 'code' | 'heading' | 'bullets' | 'numbers' | 'quote' | 'link'

const PLACEHOLDER: Record<'bold' | 'italic' | 'code' | 'link', string> = { bold: 'bold words', italic: 'words', code: 'code', link: 'link text' }

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
    case 'code':
      return wrap(sel, '`', PLACEHOLDER.code)
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
