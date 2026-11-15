import { describe, expect, it } from 'vitest'
import type { Attachment } from './types'
import { RENDER_VERSION, linkPlacementOf, linkRuleOf, pictureIdsIn, removePictures, characterCount, formOf, parseBlocks, parseInline, renderForPlatform, sendProblems, toPlainText, withoutInlinePictures, type PostContent, type SendWays } from './post-format'

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

  it('sends no picture to any other platform by the connector, and says how to send it: the AI browser, or by hand', () => {
    for (const platform of ['facebook', 'instagram', 'threads', 'x', 'linkedin']) {
      expect(sent({ text: 'x', attachments: [picture('a')] }, platform).join(' ')).toMatch(/Pictures go to .* only through the AI browser, and only when you press Send yourself.*Copy post/)
    }
  })

  it('says why a send the AI browser never carries is refused, when the AI browser is chosen: the owner presses Send', () => {
    const away = { aiBrowser: false, unattended: true }
    const via = (content: Partial<PostContent>, platform: string) => sendProblems(platform, renderForPlatform(post(content), platform), away).join(' ')
    expect(via({ text: 'words', attachments: [picture('a')] }, 'instagram')).toMatch(/scheduled or automatic send.*press Send on it/)
    expect(via({ title: 'T', text: 'words', attachments: [picture('a')] }, 'reddit')).toMatch(/scheduled or automatic send/)
    // what the connector carries is not refused, and nothing is said when there are no pictures
    expect(via({ title: 'T', text: '', attachments: [picture('a')] }, 'reddit')).toBe('')
    expect(via({ text: 'words' }, 'facebook')).toBe('')
  })

  it('lets the AI browser carry pictures to any platform that takes them, within what the platform takes', () => {
    const ai = { aiBrowser: true }
    const via = (content: Partial<PostContent>, platform: string) => sendProblems(platform, renderForPlatform(post(content), platform), ai)
    for (const platform of ['facebook', 'instagram', 'threads', 'x', 'linkedin']) expect(via({ text: 'words', attachments: [picture('a')] }, platform)).toEqual([])
    // Reddit: text and pictures together, and more than one, which the connector refuses.
    expect(via({ title: 'T', text: 'words', attachments: [picture('a'), picture('b')] }, 'reddit')).toEqual([])
    // What the platform itself takes still holds: a picture is required on Instagram, none on YouTube, at most 4 on X.
    expect(via({ text: 'words' }, 'instagram').join(' ')).toMatch(/needs a picture/)
    expect(via({ text: 'words', attachments: [picture('a')] }, 'tiktok').join(' ')).toMatch(/takes no pictures/)
    expect(via({ text: 'words', attachments: ['a', 'b', 'c', 'd', 'e'].map(picture) }, 'x').join(' ')).toMatch(/at most 4/)
    // And what Reddit's publisher asks of any post: a title, a link or a text.
    expect(via({ title: null, text: 'words', attachments: [picture('a')] }, 'reddit').join(' ')).toMatch(/needs a title/)
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

describe('the link of a post where the platform has no field for it (DEC-036)', () => {
  const link = 'https://natalmystic.com'

  it.each(['facebook', 'threads', 'x', 'linkedin', 'telegram'])('%s: the link is the last paragraph of the text, and no longer a part of its own', (platform) => {
    for (const markup of ['markdown', 'legacy'] as const) {
      const rendered = renderForPlatform(post({ title: null, text: 'A caption.', link, markup }), platform)
      expect(rendered.text, `${platform} ${markup}`).toBe(`A caption.\n\n${link}`)
      expect(rendered.link, `${platform} ${markup}`).toBeNull()
      expect(rendered.notes.join(' '), `${platform} ${markup}`).toMatch(/no link field: the link is added at the end of the text/)
      expect(rendered.problems, `${platform} ${markup}`).toEqual([])
    }
  })

  it('instagram: the link is left out, and the preview says so; the caption is what the owner wrote', () => {
    for (const markup of ['markdown', 'legacy'] as const) {
      const rendered = renderForPlatform(post({ title: null, text: 'A caption.', link, markup, attachments: [picture('a')] }), 'instagram')
      expect(rendered.text).toBe('A caption.')
      expect(rendered.link).toBeNull()
      expect(rendered.notes.join(' ')).toMatch(/does not make a link in a post clickable and has no field for it: the link is left out/)
      expect(rendered.problems).toEqual([])
    }
  })

  it('reddit and a site that is not listed keep the link as a field of its own', () => {
    for (const platform of ['reddit', 'some-new-site', 'pinterest']) {
      const rendered = renderForPlatform(post({ title: 'T', text: '', link }), platform)
      expect(rendered.link, platform).toBe(link)
      expect(rendered.notes.join(' '), platform).not.toMatch(/link/)
    }
    expect(renderForPlatform(post({ text: 'Old', link, markup: 'legacy' }), 'reddit')).toMatchObject({ text: 'Old', link })
  })

  it('does not add an address the text already holds, and a post of only a link is that link', () => {
    expect(renderForPlatform(post({ title: null, text: `See ${link} now`, link }), 'facebook')).toMatchObject({ text: `See ${link} now`, link: null, notes: [] })
    expect(renderForPlatform(post({ title: null, text: '', link }), 'facebook')).toMatchObject({ text: link, link: null })
    expect(renderForPlatform(post({ title: null, text: 'Words', link: '   ' }), 'facebook')).toMatchObject({ text: 'Words', link: '   ', notes: [] })
  })

  it('adds the link when the text holds only a longer address that starts with it, and not when it holds the address itself, also at the end of a sentence', () => {
    expect(renderForPlatform(post({ title: null, text: `See ${link}/pricing now`, link }), 'facebook').text).toBe(`See ${link}/pricing now\n\n${link}`)
    expect(renderForPlatform(post({ title: null, text: `See ${link}.uk now`, link }), 'facebook').text).toBe(`See ${link}.uk now\n\n${link}`)
    expect(renderForPlatform(post({ title: null, text: `See ${link}. Then more`, link }), 'facebook')).toMatchObject({ text: `See ${link}. Then more`, notes: [] })
    expect(renderForPlatform(post({ title: null, text: `Look (${link}) now`, link }), 'facebook')).toMatchObject({ text: `Look (${link}) now`, notes: [] })
    const marked = renderForPlatform(post({ title: null, text: `[the site](${link})`, link }), 'facebook')
    expect(marked.text).toBe(`the site (${link})`)
    expect(marked.notes.join(' ')).not.toMatch(/link field/)
  })

  it('knows the address of the link however the text writes it: another case, a closing slash, and not a longer address, another port or the end of another word', () => {
    // (an older draft is read as it is written: marks in an address are not marks)
    const held = (text: string, address = 'https://x.io'): boolean => renderForPlatform(post({ title: null, text, link: address, markup: 'legacy' }), 'facebook').notes.length === 0
    expect(held('See HTTPS://X.IO now')).toBe(true)
    expect(held('See https://x.io/ now')).toBe(true)
    expect(held('See https://x.io/. Next')).toBe(true)
    expect(held('See https://x.io now', 'https://x.io/')).toBe(true)
    expect(held('See https://x.io/pricing now')).toBe(false)
    expect(held('See https://x.io:8080/a now')).toBe(false)
    expect(held('See https://x.io?ref=1 now')).toBe(false)
    expect(held('See https://x.io#top now')).toBe(false)
    expect(held('See https://x.io.uk now')).toBe(false)
    expect(held('See xhttps://x.io now')).toBe(false)
    expect(held('See notx.io/a now', 'x.io/a')).toBe(false)
    expect(held('See x.io/a now', 'x.io/a')).toBe(true)
    expect(held('See https://x.io/?, then', 'https://x.io/')).toBe(false)
    expect(held('Ссылка (https://x.io) тут')).toBe(true)
    // the path is read as it is written: a case-sensitive server tells /Docs from /docs, and a look-alike letter is another letter
    expect(held('See https://x.io/docs/a now', 'https://x.io/Docs/A')).toBe(false)
    expect(held('See https://X.IO/Docs/A now', 'https://x.io/Docs/A')).toBe(true)
    expect(held('See https://\u212A.io now', 'https://k.io')).toBe(false)
    // every character of an address is itself, and none is a pattern
    expect(held('See https://x.io/a+b now', 'https://x.io/a+b')).toBe(true)
    expect(held('See https://x.io/aab now', 'https://x.io/a+b')).toBe(false)
    expect(held('See https://x.io/a_(b)?c=1 now', 'https://x.io/a_(b)?c=1')).toBe(true)
    expect(held('See https://x.io/a) now', 'https://x.io/a)')).toBe(true)
    expect(held('See https://x.io/a[1] now', 'https://x.io/a[1]')).toBe(true)
    expect(held('See https://x.io/a$ now', 'https://x.io/a$')).toBe(true)
    // a link of no more than a slash is nothing to look for
    expect(renderForPlatform(post({ title: null, text: 'Words and  more ', link: '/' }), 'facebook').text).toBe('Words and  more\n\n/')
  })

  it('says that a link added to the end of an older post took it over the limit, which it did not while the link was a part of its own', () => {
    const near = 'x'.repeat(480)
    for (const markup of ['legacy', 'markdown'] as const) {
      const over = renderForPlatform(post({ title: null, text: near, link, markup }), 'threads')
      expect(over.problems.join(' '), markup).toMatch(/505 characters; Threads allows 500/)
    }
    // an older post that was over the limit without a link is not judged here (it never was), and one that fits with the link has nothing to say
    expect(renderForPlatform(post({ title: null, text: 'x'.repeat(520), link: null, markup: 'legacy' }), 'threads').problems).toEqual([])
    expect(renderForPlatform(post({ title: null, text: 'x'.repeat(520), link, markup: 'legacy' }), 'threads').problems).toEqual([])
    expect(renderForPlatform(post({ title: null, text: 'x'.repeat(400), link, markup: 'legacy' }), 'threads').problems).toEqual([])
    // Instagram adds nothing to the text, so it takes no room of the limit
    expect(renderForPlatform(post({ title: null, text: 'x'.repeat(2_190), link, markup: 'legacy', attachments: [picture('a')] }), 'instagram').problems).toEqual([])
  })

  it('names how a link is placed, for the approval to be bound to it: only where the form has no field and the draft has a link', () => {
    expect(linkPlacementOf('facebook', 'https://x.io')).toBe('in_text:1')
    expect(linkPlacementOf('instagram', 'https://x.io')).toBe('left_out:1')
    expect(linkPlacementOf('reddit', 'https://x.io')).toBeNull()
    expect(linkPlacementOf('some-new-site', 'https://x.io')).toBeNull()
    expect(linkPlacementOf('facebook', null)).toBeNull()
    expect(linkPlacementOf('facebook', '   ')).toBeNull()
    expect(linkPlacementOf('instagram', undefined)).toBeNull()
  })

  it('counts the link against the limit of the text: a post that fits without it and not with it is refused, with the number', () => {
    const rendered = renderForPlatform(post({ title: null, text: 'x'.repeat(480), link }), 'threads')
    expect(rendered.text.length).toBe(480 + 2 + link.length)
    expect(rendered.problems.join(' ')).toMatch(/505 characters; Threads allows 500/)
  })

  it('does not take a link alone for a post on a platform that leaves it out', () => {
    const problems = renderForPlatform(post({ title: null, text: '', link }), 'instagram').problems.join(' ')
    expect(problems).toMatch(/nothing to post/)
    expect(problems).toMatch(/needs a picture/)
  })

  it('tells the AI that writes a post what the platform does with a link, and nothing for a platform that has a field', () => {
    expect(linkRuleOf('instagram')).toMatch(/leave "link" empty/)
    expect(linkRuleOf('facebook')).toMatch(/added at the end of the text.*counts against the text limit/)
    expect(linkRuleOf('reddit')).toBeNull()
    expect(linkRuleOf('some-new-site')).toBeNull()
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

  // The link of a draft where the platform has no field for it (DEC-036) changed what a post with a link receives, and is bound apart
  // (`linkPlacementOf`, in the hash), so the version is the same: Reddit and a post with no link are not made to be approved again.
  const linked: [string, string, string | null, string][] = [
    ['facebook', 'Words', 'https://example.org/a', 'Words\n\nhttps://example.org/a'],
    ['threads', 'Words', 'https://example.org/a', 'Words\n\nhttps://example.org/a'],
    ['instagram', 'Words', 'https://example.org/a', 'Words'],
    ['reddit', 'Words', 'https://example.org/a', 'Words']
  ]

  it.each(linked)('%s with a link: %j + %j', (platform, text, link, output) => {
    expect(renderForPlatform(post({ title: null, text, link }), platform).text).toBe(output)
  })

  it('is version 1 for this corpus', () => {
    expect(RENDER_VERSION).toBe(1)
  })
})

describe('a channel that no connector can post to (DEC-035): the AI browser is its only way', () => {
  const via = (content: Partial<PostContent>, platform: string, ways: SendWays) => sendProblems(platform, renderForPlatform(post(content), platform), ways).join(' ')

  it('lets a picture go to Instagram, Facebook and Threads once the AI browser may carry the send, with no word about a switch in the settings', () => {
    for (const platform of ['instagram', 'facebook', 'threads']) {
      expect(via({ text: 'words', attachments: [picture('a')] }, platform, { aiBrowser: true, noConnector: true }), platform).toBe('')
    }
  })

  it('says the engine is the problem, whatever the post holds, and keeps the way out in the words: Claude Code, or by hand', () => {
    const engineProblem = 'Codex cannot be held to the browser tools alone. Choose Claude Code in Settings (AI engine), or use “Copy post” and publish it by hand.'
    const ways = { aiBrowser: false, noConnector: true, engineProblem }
    expect(via({ text: 'words' }, 'facebook', ways)).toBe(engineProblem)
    expect(via({ text: 'words', attachments: [picture('a')] }, 'instagram', ways)).toBe(engineProblem) // said once
  })

  it('says a scheduled or automatic send is not carried, for a post with words alone too: nothing else can carry it', () => {
    const away = { aiBrowser: false, noConnector: true, unattended: true }
    expect(via({ text: 'words' }, 'facebook', away)).toMatch(/scheduled or automatic send.*press Send on it/)
    expect(via({ text: 'words', attachments: [picture('a')] }, 'instagram', away).match(/scheduled or automatic/g)).toHaveLength(1)
  })

  it('says, without a switch to offer, that the AI browser is not in this build', () => {
    const text = via({ text: 'words', attachments: [picture('a')] }, 'instagram', { aiBrowser: false, noConnector: true })
    expect(text).toMatch(/only through the AI browser.*not available in this build.*Copy post/)
    expect(text).not.toMatch(/choose it in the settings/i)
    // a post with words alone is not stopped by it: this build's connector is asked as before
    expect(via({ text: 'words' }, 'facebook', { aiBrowser: false, noConnector: true })).toBe('')
  })

  it('keeps the way out for Reddit: the words without the picture', () => {
    expect(via({ title: 'T', text: 'words', attachments: [picture('a')] }, 'reddit', { aiBrowser: false })).toMatch(/or post the words without the picture\.$/)
  })

  it('does not change what a channel the app reads is told', () => {
    expect(via({ text: 'x', attachments: [picture('a')] }, 'instagram', { aiBrowser: false })).toMatch(/choose it in the settings/)
    expect(via({ title: 'T', text: 'words', attachments: [picture('a')] }, 'reddit', { aiBrowser: false })).toMatch(/Choose the AI browser in the settings/)
  })
})
