// The buttons of the post editor (DEC-030): pure functions on a text and a selection; the renderer has no test runner of its own, so they run from here.

import { describe, expect, it } from 'vitest'
import { applyMark, imageFilesOf, insertPicture, placedPictures, withoutPicture, type Selection } from '../renderer/src/pages/review/editor-marks'

const sel = (text: string, start: number, end = start): Selection => ({ text, start, end })
const chosen = (s: Selection): string => s.text.slice(s.start, s.end)

describe('emphasis', () => {
  it('wraps the selected words and keeps them selected', () => {
    const next = applyMark(sel('make it loud', 8, 12), 'bold')
    expect(next.text).toBe('make it **loud**')
    expect(chosen(next)).toBe('loud')
  })

  it('takes the marks off again, whether the selection is inside them or includes them', () => {
    const inside = applyMark(sel('make it **loud**', 10, 14), 'bold')
    expect(inside).toMatchObject({ text: 'make it loud' })
    expect(chosen(inside)).toBe('loud')
    const around = applyMark(sel('make it **loud**', 8, 16), 'bold')
    expect(around.text).toBe('make it loud')
    expect(chosen(around)).toBe('loud')
  })

  it('puts a placeholder where nothing is selected, and selects it for typing over', () => {
    const next = applyMark(sel('hello ', 6), 'italic')
    expect(next.text).toBe('hello *words*')
    expect(chosen(next)).toBe('words')
  })

  it('keeps italic and bold apart', () => {
    expect(applyMark(sel('a', 0, 1), 'italic').text).toBe('*a*')
    expect(applyMark(applyMark(sel('a', 0, 1), 'italic'), 'bold').text).toBe('***a***')
  })
})

describe('lines', () => {
  it('makes bullets of every line the selection touches, and takes them off when all have them', () => {
    const on = applyMark(sel('one\ntwo\nthree', 2, 6), 'bullets')
    expect(on.text).toBe('- one\n- two\nthree')
    const off = applyMark(sel(on.text, on.start, on.end), 'bullets')
    expect(off.text).toBe('one\ntwo\nthree')
  })

  it('numbers the lines in order and renumbers nothing it did not touch', () => {
    expect(applyMark(sel('a\nb\nc', 0, 5), 'numbers').text).toBe('1. a\n2. b\n3. c')
    expect(applyMark(sel('a\nb\nc', 2, 3), 'numbers').text).toBe('a\n1. b\nc')
  })

  it('turns one kind of line into another instead of piling marks up', () => {
    expect(applyMark(sel('- item', 0, 6), 'quote').text).toBe('> item')
    expect(applyMark(sel('# old', 0, 5), 'heading').text).toBe('## old')
  })

  it('makes a heading of the line at the cursor and unmakes it', () => {
    const on = applyMark(sel('Title\nbody', 2), 'heading')
    expect(on.text).toBe('## Title\nbody')
    expect(applyMark(sel(on.text, 3), 'heading').text).toBe('Title\nbody')
  })

  it('leaves an empty line empty', () => {
    expect(applyMark(sel('a\n\nb', 0, 4), 'bullets').text).toBe('- a\n\n- b')
  })
})

describe('a link', () => {
  it('makes the selected words the text of the link and selects the address for typing', () => {
    const next = applyMark(sel('see the chart now', 4, 13), 'link')
    expect(next.text).toBe('see [the chart](https://) now')
    expect(chosen(next)).toBe('https://')
  })

  it('offers placeholder words when nothing is selected', () => {
    expect(applyMark(sel('', 0), 'link').text).toBe('[link text](https://)')
  })
})

describe('a picture in the text', () => {
  it('goes on a paragraph of its own, whatever is around the cursor', () => {
    expect(insertPicture(sel('before', 6), 'p1', 'a cat').text).toBe('before\n\n![a cat](media:p1)')
    expect(insertPicture(sel('before after', 6), 'p1', 'a cat').text).toBe('before\n\n![a cat](media:p1)\n\n after')
    expect(insertPicture(sel('', 0), 'p1', '').text).toBe('![](media:p1)')
    expect(insertPicture(sel('one\n\ntwo', 5), 'p1', 'x').text).toBe('one\n\n![x](media:p1)\n\ntwo')
  })

  it('never lets the alternative text break the mark', () => {
    expect(insertPicture(sel('', 0), 'p1', 'a [bad]\nname').text).toBe('![a  bad  name](media:p1)')
  })

  it('is found, and taken out again, by its id', () => {
    const text = 'one\n\n![a](media:p1)\n\ntwo ![b](media:p2) three ![a](media:p1)'
    expect(placedPictures(text)).toEqual(['p1', 'p2'])
    expect(withoutPicture(text, 'p1')).toBe('one\n\ntwo ![b](media:p2) three')
  })
})

describe('pictures of a paste or a drop', () => {
  it('keeps only the images the application can use', () => {
    const files = [{ type: 'image/png' }, { type: 'image/svg+xml' }, { type: 'text/plain' }, { type: 'image/webp' }] as File[]
    expect(imageFilesOf(files)).toHaveLength(2)
    expect(imageFilesOf(null)).toEqual([])
  })
})

describe('what the second review found in the toolbar', () => {
  const at = (text: string, start: number, end = start): Selection => ({ text, start, end })

  it('removes a picture without gluing the words around it, and leaves code and breaks alone', () => {
    expect(withoutPicture('see ![x](media:a) here', 'a')).toBe('see here')
    expect(withoutPicture('a\n\n```\n![x](media:a)\n\n\n\nend\n```\n\nb', 'a')).toBe('a\n\n```\n![x](media:a)\n\n\n\nend\n```\n\nb')
    expect(withoutPicture('  indented\n\n\n\nkept', 'a')).toBe('  indented\n\n\n\nkept')
  })

  it('works on the line the cursor is on at the very start of a text, not on the next one', () => {
    expect(applyMark(at('\nabc', 0), 'heading').text).toBe('\nabc') // the cursor is on an empty line: nothing to prefix, and the second line is not touched
    expect(applyMark(at('abc\ndef', 0), 'bullets').text).toBe('- abc\ndef')
    expect(applyMark(at('abc', 0), 'heading').text).toBe('## abc')
  })

  it('adds italic to words that are bold already, and takes italic off words that are only italic', () => {
    expect(applyMark(at('**word**', 2, 6), 'italic').text).toBe('***word***')
    expect(applyMark(at('**word**', 0, 8), 'italic').text).toBe('***word***')
    expect(applyMark(at('*word*', 1, 5), 'italic').text).toBe('word')
  })
})

describe('the marks of Reddit\'s editor: strikethrough, superscript, spoiler, code block, table', () => {
  it('crosses words out and takes it off again', () => {
    const on = applyMark(sel('an old price', 3, 6), 'strike')
    expect(on.text).toBe('an ~~old~~ price')
    expect(chosen(on)).toBe('old')
    expect(applyMark(on, 'strike').text).toBe('an old price')
  })

  it('raises words in brackets, so a phrase stays raised, and takes it off again', () => {
    const on = applyMark(sel('E = mc2', 4, 7), 'sup')
    expect(on.text).toBe('E = ^(mc2)')
    expect(chosen(on)).toBe('mc2')
    const off = applyMark(on, 'sup')
    expect(off.text).toBe('E = mc2')
    expect(chosen(off)).toBe('mc2')
  })

  it('hides words as a spoiler, each line of a selection on its own, and takes them off again', () => {
    const on = applyMark(sel('one\ntwo\nthree', 0, 7), 'spoiler')
    expect(on.text).toBe('>!one!<\n>!two!<\nthree')
    const off = applyMark(sel(on.text, on.start, on.end), 'spoiler')
    expect(off.text).toBe('one\ntwo\nthree')
  })

  it('puts a placeholder where nothing is selected, and selects it', () => {
    const next = applyMark(sel('go ', 3), 'spoiler')
    expect(next.text).toBe('go >!hidden words!<')
    expect(chosen(next)).toBe('hidden words')
    expect(chosen(applyMark(sel('', 0), 'strike'))).toBe('crossed out')
  })

  it('makes a code block of the lines the selection touches, and takes the fences off again', () => {
    const on = applyMark(sel('intro\nlet a = 1\nlet b = 2\nafter', 8, 20), 'codeblock')
    expect(on.text).toBe('intro\n```\nlet a = 1\nlet b = 2\n```\nafter')
    expect(chosen(on)).toBe('let a = 1\nlet b = 2')
    const off = applyMark(on, 'codeblock')
    expect(off.text).toBe('intro\nlet a = 1\nlet b = 2\nafter')
  })

  it('makes an empty code block with a placeholder', () => {
    const next = applyMark(sel('', 0), 'codeblock')
    expect(next.text).toBe('```\ncode\n```')
    expect(chosen(next)).toBe('code')
  })

  it('adds a table on a paragraph of its own and selects its first heading', () => {
    const next = applyMark(sel('before\nafter', 6), 'table')
    expect(next.text).toBe('before\n\n| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n\nafter')
    expect(chosen(next)).toBe('Column 1')
    expect(applyMark(sel('', 0), 'table').text).toBe('| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |')
  })
})
