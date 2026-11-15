import { describe, expect, it } from 'vitest'
import type { Attachment } from './types'
import { RENDER_VERSION, pictureIdsIn, removePictures, characterCount, formOf, parseBlocks, parseInline, renderForPlatform, sendProblems, toPlainText, withoutInlinePictures, type PostContent } from './post-format'

const picture = (id: string): Attachment => ({ name: `${id}.png`, path: `/data/media/${id}.png`, mime: 'image/png', sha256: id.repeat(8), mediaId: id })
const post = (over: Partial<PostContent> = {}): PostContent => ({ title: 'A title', text: 'Some words', link: null, attachments: [], markup: 'markdown', ...over })

describe('inline marks', () => {
  it('reads emphasis, strong, code, links and pictures', () => {
    expect(parseInline('a **bold** and *soft* and `code` [site](https://x.io/a) ![a cat](media:ab-12)')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'bold' }] },
      { t: 'text', v: ' and ' },
      { t: 'em', c: [{ t: 'text', v: 'soft' }] },
      { t: 'text', v: ' and ' },
      { t: 'code', v: 'code' },
      { t: 'text', v: ' ' },
      { t: 'link', href: 'https://x.io/a', c: [{ t: 'text', v: 'site' }] },
      { t: 'text', v: ' ' },
      { t: 'image', alt: 'a cat', id: 'ab-12' }
    ])
  })

  it('leaves a mark that is not closed as plain words', () => {
    expect(parseInline('2 * 3 and **open')).toEqual([{ t: 'text', v: '2 * 3 and **open' }])
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }])
  })

  it('lets a backslash keep a mark as a character', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([{ t: 'text', v: '*not italic*' }])
  })

  it('does not make a link of an address that is not http(s), nor a picture of one that is not from the library', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ t: 'text', v: '[x](javascript:alert(1))' }])
    expect(parseInline('[x](javascript:void)').some((n) => n.t === 'link')).toBe(false)
    expect(parseInline('[x](data:text/html;base64,AAAA)').some((n) => n.t === 'link')).toBe(false)
    expect(parseInline('[x](ftp://host/file)').some((n) => n.t === 'link')).toBe(false)
    expect(parseInline('[x](https://example.org/a)').some((n) => n.t === 'link')).toBe(true)
    expect(parseInline('![x](https://evil.example/a.png)').some((n) => n.t === 'image')).toBe(false)
  })
})

describe('blocks', () => {
  it('reads headings, lists, quotes, code and rules', () => {
    const blocks = parseBlocks('# Title\n\nFirst line\nsecond line\n\n- one\n- two\n\n1. a\n2. b\n\n> quoted\n\n```\ncode here\n```\n\n---')
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'ul', 'ol', 'quote', 'pre', 'hr'])
    expect(blocks[1]).toMatchObject({ t: 'p', c: [{ t: 'text', v: 'First line' }, { t: 'br', hard: false }, { t: 'text', v: 'second line' }] })
    expect(blocks[5]).toEqual({ t: 'pre', v: 'code here' })
  })

  it('makes a hard line break of two trailing spaces', () => {
    expect(parseBlocks('one  \ntwo')[0]).toMatchObject({ c: [{ t: 'text', v: 'one' }, { t: 'br', hard: true }, { t: 'text', v: 'two' }] })
  })

  it('never throws on any text', () => {
    for (const text of ['', '#', '>', '```', '- ', '1.', '![', '[](', '**', '\\', '\n\n\n', '*'.repeat(500), '[a](https://'.repeat(50)]) expect(() => parseBlocks(text)).not.toThrow()
  })
})

describe('plain text for a platform that shows no marks', () => {
  it('keeps the words, makes bullets of lists and quotation marks of quotes', () => {
    expect(toPlainText('# Big news\n\nWe **shipped** it.\n\n- fast\n- cheap\n\n1. first\n2. second\n\n> a wise word')).toBe('Big news\n\nWe shipped it.\n\n• fast\n• cheap\n\n1. first\n2. second\n\n“a wise word”')
  })

  it('shows the address of a link after its words, and drops a picture', () => {
    expect(toPlainText('See [the chart](https://x.io/c) ![alt](media:a1) now')).toBe('See the chart (https://x.io/c) now')
    expect(toPlainText('[https://x.io](https://x.io)')).toBe('https://x.io')
  })
})

describe('pictures placed in the text', () => {
  it('are taken out where the platform takes pictures beside the text', () => {
    expect(withoutInlinePictures('before\n\n![a](media:p1)\n\nafter')).toBe('before\n\nafter')
    expect(withoutInlinePictures('word ![a](media:p1) word')).toBe('word word')
  })
})

describe('the post as a platform receives it', () => {
  it('returns a draft that is not markdown exactly as it was written', () => {
    const legacy = post({ markup: 'legacy', text: '**raw** text', attachments: [picture('p1')] })
    expect(renderForPlatform(legacy, 'facebook')).toMatchObject({ title: 'A title', text: '**raw** text', notes: [], problems: [] })
    expect(renderForPlatform(legacy, 'facebook').attachments).toBe(legacy.attachments)
  })

  it('gives Reddit the Markdown with the pictures beside it, and keeps the title', () => {
    const rendered = renderForPlatform(post({ text: 'Hello **there**\n\n![a](media:p1)\n\nBye', attachments: [picture('p1')] }), 'reddit')
    expect(rendered).toMatchObject({ format: 'markdown', title: 'A title', text: 'Hello **there**\n\nBye', problems: [] })
    expect(rendered.notes.join(' ')).toMatch(/pictures beside the text/)
  })

  it('keeps the pictures in the text when the platform editor places them', () => {
    expect(renderForPlatform(post({ text: 'x\n\n![a](media:p1)', attachments: [picture('p1')] }), 'reddit', { pictures: 'keep' }).text).toBe('x\n\n![a](media:p1)')
  })

  it('gives every other platform plain words, drops a title it has no place for, and says so', () => {
    const rendered = renderForPlatform(post({ text: 'Big **news**', attachments: [picture('p1')] }), 'facebook')
    expect(rendered).toMatchObject({ format: 'plain', title: null, text: 'Big news', problems: [] })
    expect(rendered.notes.join(' ')).toMatch(/no formatting/)
    expect(rendered.notes.join(' ')).toMatch(/no title/)
  })

  it('refuses what the platform cannot take, in words', () => {
    expect(renderForPlatform(post({ text: 'no picture here' }), 'instagram').problems.join(' ')).toMatch(/needs a picture/)
    expect(renderForPlatform(post({ text: 'x'.repeat(2201), attachments: [picture('p1')] }), 'instagram').problems.join(' ')).toMatch(/2201 characters; Instagram allows 2200/)
    expect(renderForPlatform(post({ text: 'x'.repeat(501) }), 'threads').problems.join(' ')).toMatch(/allows 500/)
    expect(renderForPlatform(post({ text: 'x', attachments: [picture('a'), picture('b'), picture('c'), picture('d'), picture('e')] }), 'x').problems.join(' ')).toMatch(/at most 4 pictures/)
    expect(renderForPlatform(post({ text: 'clip', attachments: [picture('a')] }), 'tiktok').problems.join(' ')).toMatch(/takes no pictures/)
    expect(renderForPlatform(post({ title: 't'.repeat(301), text: 'x' }), 'reddit').problems.join(' ')).toMatch(/title is 301 characters/)
  })

  it('counts the limit on the words the platform will see, not on the marks', () => {
    const marked = '**' + 'x'.repeat(496) + '**'
    expect(renderForPlatform(post({ text: marked }), 'threads').problems).toEqual([])
  })

  it('treats a site that is not listed as plain text without limits', () => {
    expect(formOf('some-forum')).toMatchObject({ format: 'plain', textLimit: null })
  })
})

describe('what this application can send of a post', () => {
  const sent = (content: Partial<PostContent>, platform: string): string[] => sendProblems(platform, renderForPlatform(post(content), platform))

  it('sends a Reddit picture only as a post by itself: one picture, no words, no link', () => {
    expect(sent({ title: 'T', text: '', attachments: [picture('a')] }, 'reddit')).toEqual([])
    expect(sent({ title: 'T', text: '', attachments: [picture('a'), picture('b')] }, 'reddit').join(' ')).toMatch(/one picture as a post by itself; this post has 2/)
    expect(sent({ title: 'T', text: 'words', attachments: [picture('a')] }, 'reddit').join(' ')).toMatch(/only as a post by itself, without text/)
    expect(sent({ title: 'T', text: '', link: 'https://example.org', attachments: [picture('a')] }, 'reddit').join(' ')).toMatch(/without text/)
  })

  it('sends no picture to any other platform yet, and says how to publish by hand', () => {
    for (const platform of ['facebook', 'instagram', 'threads', 'x', 'linkedin']) {
      expect(sent({ text: 'x', attachments: [picture('a')] }, platform).join(' ')).toMatch(/cannot be sent to .* from this application yet\. Use .Copy post. and publish/)
    }
  })

  it('says what the Reddit publisher refuses before it is approved: no title, a link with text, a link that is not a web address', () => {
    expect(sent({ title: null, text: 'words' }, 'reddit').join(' ')).toMatch(/needs a title/)
    expect(sent({ title: 'T', text: 'words', link: 'https://example.org' }, 'reddit').join(' ')).toMatch(/a link or a text, not both/)
    expect(sent({ title: 'T', text: '', link: 'ftp://example.org' }, 'reddit').join(' ')).toMatch(/must start with http/)
    expect(sent({ title: 'T', text: '', link: 'https://example.org' }, 'reddit')).toEqual([])
    expect(sent({ title: 'T', text: 'words' }, 'reddit')).toEqual([])
  })

  it('has nothing to say about a post without pictures that the platform can show', () => {
    expect(sent({ text: 'plain words' }, 'reddit')).toEqual([])
    expect(sent({ text: 'plain words' }, 'facebook')).toEqual([])
  })
})

describe('the words of the owner reach a platform as they were written', () => {
  const plain = (text: string): string => renderForPlatform(post({ title: null, text }), 'facebook').text

  it('keeps a web address whole, whatever marks are inside it', () => {
    expect(plain('Docs: https://example.com/_next/static/_build_/x.js')).toBe('Docs: https://example.com/_next/static/_build_/x.js')
    expect(plain('See https://example.com/*draft*/page now')).toBe('See https://example.com/*draft*/page now')
    expect(plain('Is it *really* at https://example.com/a_b_c?')).toBe('Is it really at https://example.com/a_b_c?')
    expect(plain('_see https://example.com/x_y here_')).toBe('see https://example.com/x_y here')
  })

  it('does not take a star or an underscore inside a word for a mark', () => {
    expect(plain('Price: 5*3 and 2*4 total')).toBe('Price: 5*3 and 2*4 total')
    expect(plain('use snake_case_names and file__name__x too')).toBe('use snake_case_names and file__name__x too')
    expect(plain('a *real* mark and a *second* one')).toBe('a real mark and a second one')
    expect(plain('**bold**, then more')).toBe('bold, then more')
  })

  it('does not take a mark that runs into a word, on either side, for a mark', () => {
    expect(plain('a*b* c')).toBe('a*b* c')
    expect(plain('*a*b')).toBe('*a*b')
    expect(plain('x_y_ z')).toBe('x_y_ z')
    expect(plain('*a* and (*b*)')).toBe('a and (b)')
  })

  it('keeps the number the owner gave a list, and does not make a list of a year', () => {
    expect(parseBlocks('2025. Our best year so far')[0].t).toBe('p')
    expect(plain('2025. Our best year so far')).toBe('2025. Our best year so far')
    expect(plain('3. third\n4. fourth')).toBe('3. third\n4. fourth')
    expect(plain('1. one\n2. two')).toBe('1. one\n2. two')
    expect(parseBlocks('7. seven\n8. eight')[0]).toMatchObject({ t: 'ol', start: 7 })
  })

  it('leaves the Markdown of a Reddit post as it was written when there is no picture in it', () => {
    const text = 'line one  \nline two\n\n```\na\n\n\nb\n```\n\n\n\nend'
    expect(renderForPlatform(post({ text }), 'reddit').text).toBe(text)
  })

  it('takes only the pictures out of a Reddit post: no gap is left, no other line is touched', () => {
    const mark = '![x](media:p1)'
    expect(withoutInlinePictures(`a\n\n${mark}\n\nb`)).toBe('a\n\nb')
    expect(withoutInlinePictures(`${mark}\n\nb`)).toBe('b')
    expect(withoutInlinePictures(`a  \nkept ${mark} here  \nc`)).toBe('a  \nkept here  \nc')
    expect(withoutInlinePictures(`first ${mark}\n\n\nsecond`)).toBe('first\n\n\nsecond')
    expect(withoutInlinePictures(`a\n\n${mark}\n${mark}\n\nb`)).toBe('a\n\nb')
  })
})

describe('no text can make the parser fail or slow', () => {
  it('reads very deep and very long marks without a stack error, and still reads the words', () => {
    const deep = '*'.repeat(10_000) + 'a' + '*'.repeat(10_000)
    expect(() => toPlainText(deep)).not.toThrow()
    expect(toPlainText('_'.repeat(5000) + 'x')).toContain('x')
  })

  it('reads text full of unclosed marks in a short time (the scan for a closing mark is bounded)', () => {
    const started = Date.now()
    parseInline(' *a'.repeat(20_000))
    parseInline(' *a'.repeat(20_000) + ' *') // each opener finds a closing mark at the end, and the caller refuses it: only the budget stops that
    parseInline(' _snake_case'.repeat(8_000))
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('one measure of length', () => {
  it('counts a character, not a code unit, in the limit and in the words about it', () => {
    expect(characterCount('😀😀')).toBe(2)
    const problems = renderForPlatform(post({ title: null, text: '😀'.repeat(141) }), 'x').problems
    expect(problems).toEqual([])
    expect(renderForPlatform(post({ title: null, text: '😀'.repeat(281) }), 'x').problems.join(' ')).toMatch(/281 characters; X allows 280/)
  })

  it('has a render version that the hash carries', () => {
    expect(Number.isInteger(RENDER_VERSION) && RENDER_VERSION >= 1).toBe(true)
  })
})

describe('what the second review found in the words', () => {
  const plain = (text: string): string => renderForPlatform(post({ title: null, text }), 'facebook').text

  it('keeps a # that belongs to a word at the end of a heading', () => {
    expect(plain('# I love C#')).toBe('I love C#')
    expect(plain('## Why F# beats C#')).toBe('Why F# beats C#')
    expect(plain('# C# #')).toBe('C#')
    expect(plain('# Title ##')).toBe('Title')
  })

  it('keeps runs of marks that are not marks', () => {
    expect(plain('Name: ____ Date: ____')).toBe('Name: ____ Date: ____')
    expect(plain('**** NEW ****')).toBe('**** NEW ****')
    expect(plain('*** NEW ***')).toBe('*** NEW ***')
    expect(plain('****bold**** and ____x____')).toBe('****bold**** and ____x____')
    expect(plain('***both***')).toBe('both')
    expect(plain('a **bold** and *soft* and ***both***')).toBe('a bold and soft and both')
  })

  it('keeps the spacing the owner typed, in a line and in code, and closes up only where a picture was', () => {
    expect(plain('Name:    value')).toBe('Name:    value')
    expect(plain('use `a  b` here')).toBe('use a  b here')
    expect(plain('see ![x](media:a) here')).toBe('see here')
    expect(plain('see ![x](media:a)')).toBe('see')
    expect(plain('![x](media:a) ![y](media:b) after')).toBe('after')
  })

  it('keeps a nested list in one list, with its depth, and a continued item whole', () => {
    expect(plain('- a\n    - nested\n- b')).toBe('• a\n  • nested\n• b')
    expect(plain('1. one\n   1. inner\n   2. inner two\n2. two')).toBe('1. one\n  1. inner\n  2. inner two\n2. two')
    expect(plain('- first line\n  goes on here\n- second')).toBe('• first line\ngoes on here\n• second')
  })

  it('knows a picture of any alt text length is a picture, on every platform', () => {
    const alt = 'a'.repeat(190)
    expect(plain(`before ![${alt}](media:p1) after`)).toBe('before after')
    expect(pictureIdsIn(`![${alt}](media:p1)`)).toEqual(['p1'])
    expect(pictureIdsIn(`![${'a'.repeat(250)}](media:p1)`)).toEqual([])
  })

  it('leaves no bare marker where a picture stood alone in a list, a quote or a heading', () => {
    expect(removePictures('Some title\n- ![a](media:x)\n\nnext')).toBe('Some title\n\nnext')
    expect(removePictures('> ![a](media:x)\n\nnext')).toBe('next')
    expect(withoutInlinePictures('# ![a](media:x)\n\nnext')).toBe('next')
    expect(withoutInlinePictures('- ![a](media:x) caption')).toBe('- caption')
  })

  it('does not touch a picture mark inside a code fence', () => {
    expect(withoutInlinePictures('a\n\n```\n![x](media:p1)\n\n\n\nend\n```\n\n![y](media:p2)\n\nb')).toBe('a\n\n```\n![x](media:p1)\n\n\n\nend\n```\n\nb')
  })

  it('is fast on long runs of spaces, newlines and unclosed picture starts', () => {
    const started = Date.now()
    plain('a' + ' '.repeat(40_000) + 'b')
    plain('# a' + ' '.repeat(40_000) + 'b')
    plain('\n'.repeat(40_000) + 'x')
    renderForPlatform(post({ text: '![a'.repeat(20_000) }), 'reddit')
    renderForPlatform(post({ text: '![a'.repeat(20_000) }), 'facebook')
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('still reads a real mark after many that never close', () => {
    expect(plain('*a '.repeat(300) + 'and **bold** here')).toContain('and bold here')
  })
})

describe('no letter or digit of the owner is ever lost on a plain platform', () => {
  it('holds for thousands of random texts made of marks, words and breaks', () => {
    const alphabet = ['a', 'b', 'C', '1', '2', ' ', ' ', '\n', '\n', '*', '_', '#', '-', '>', '[', ']', '(', ')', '`', '.', '\\', '+']
    let seed = 7
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff
      return seed
    }
    const count = (text: string): Record<string, number> => {
      const counts: Record<string, number> = {}
      for (const c of text.match(/[\p{L}\p{N}]/gu) ?? []) counts[c] = (counts[c] ?? 0) + 1
      return counts
    }
    for (let round = 0; round < 3000; round += 1) {
      const text = Array.from({ length: 1 + (next() % 60) }, () => alphabet[next() % alphabet.length]).join('')
      if (text.includes('```')) continue // the line after an opening fence is its info string
      const before = count(text)
      const after = count(toPlainText(text))
      for (const [char, n] of Object.entries(before)) expect(after[char] ?? 0, JSON.stringify(text)).toBeGreaterThanOrEqual(n)
    }
  })
})

describe('what a platform receives is pinned to the version of the rules', () => {
  // Change a rule so that one of these results changes, and RENDER_VERSION must be raised in the same change: an approval of a markdown post
  // is bound to the version, and a post that was approved under the old rule must be approved again for the new one.
  const corpus: [string, string, string][] = [
    ['facebook', '# Big news\n\nWe **shipped** [it](https://example.org/a_b_c)\n\n- fast\n- free\n\n1. one\n2. two\n\n> said', 'Big news\n\nWe shipped it (https://example.org/a_b_c)\n\n• fast\n• free\n\n1. one\n2. two\n\n“said”'],
    ['facebook', 'snake_case and 5*3 and 2025. a year', 'snake_case and 5*3 and 2025. a year'],
    ['facebook', 'text ![a](media:p1) more\n\n![b](media:p2)', 'text more'],
    ['threads', 'a  \nb\n\n---\n\n```\ncode  \n```', 'a\nb\n\n———\n\ncode  '],
    ['reddit', 'a **b**\n\n![a](media:p1)\n\nc', 'a **b**\n\nc']
  ]

  it.each(corpus)('%s: %j', (platform, input, output) => {
    expect(renderForPlatform(post({ title: null, text: input }), platform).text).toBe(output)
  })

  it('is version 1 for this corpus', () => {
    expect(RENDER_VERSION).toBe(1)
  })
})
