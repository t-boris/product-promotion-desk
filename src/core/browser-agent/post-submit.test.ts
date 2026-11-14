import { describe, expect, it } from 'vitest'
import { destinationMatches, fieldValueScript, formTextScript, normalizeText, parseHeldText, platformWarning, sameContent } from './post-submit'

const HOSTS = ['reddit.com']
const COMMENT = 'https://www.reddit.com/r/astrology/comments/abc123/my_chart/def456/'
const CHANNEL = 'https://www.reddit.com/r/astrology'

describe('where the compose page must be', () => {
  it('accepts the thread of the comment for a reply, whatever follows the thread in the address, and either host form', () => {
    expect(destinationMatches('https://www.reddit.com/r/astrology/comments/abc123/my_chart/', COMMENT, 'reply', HOSTS)).toBe(true)
    expect(destinationMatches('https://old.reddit.com/r/Astrology/comments/abc123/my_chart/def456/?context=3', COMMENT, 'reply', HOSTS)).toBe(true)
    expect(destinationMatches('https://reddit.com/r/astrology/comments/abc123/', COMMENT, 'reply', HOSTS)).toBe(true)
  })

  it('refuses another thread, another community, another host and a page that is not an address', () => {
    expect(destinationMatches('https://www.reddit.com/r/astrology/comments/zzz999/other/', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://www.reddit.com/r/tarot/comments/abc123/my_chart/', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://www.reddit.com/r/astrology', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://evil.example/r/astrology/comments/abc123/', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://reddit.com.evil.example/r/astrology/comments/abc123/', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('about:blank', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('not an address', COMMENT, 'reply', HOSTS)).toBe(false)
    expect(destinationMatches('https://www.reddit.com/r/astrology/comments/abc123/', 'not an address', 'reply', HOSTS)).toBe(false)
  })

  it('accepts the channel and its submit page for a post, and no other channel', () => {
    expect(destinationMatches('https://www.reddit.com/r/astrology', CHANNEL, 'post', HOSTS)).toBe(true)
    expect(destinationMatches('https://www.reddit.com/r/astrology/submit?type=TEXT', CHANNEL, 'post', HOSTS)).toBe(true)
    expect(destinationMatches('https://old.reddit.com/r/astrology/submit', CHANNEL, 'post', HOSTS)).toBe(true)
    expect(destinationMatches('https://www.reddit.com/r/tarot/submit', CHANNEL, 'post', HOSTS)).toBe(false)
    expect(destinationMatches('https://www.reddit.com/submit', CHANNEL, 'post', HOSTS)).toBe(false)
  })

  it('keeps the query of the destination: a site that names the thread by a parameter', () => {
    const item = 'https://news.ycombinator.com/item?id=4242'
    expect(destinationMatches('https://news.ycombinator.com/item?id=4242', item, 'reply', ['ycombinator.com'])).toBe(true)
    expect(destinationMatches('https://news.ycombinator.com/item?id=4243', item, 'reply', ['ycombinator.com'])).toBe(false)
    expect(destinationMatches('https://news.ycombinator.com/item', item, 'reply', ['ycombinator.com'])).toBe(false)
  })

  it('refuses a destination that is itself not on the platform: the fence is configured wrongly, so nothing matches', () => {
    expect(destinationMatches('https://www.reddit.com/r/astrology', 'https://other.example/r/astrology', 'post', HOSTS)).toBe(false)
  })
})

describe('text as a person compares it', () => {
  it('ignores spacing, line breaks, non-breaking spaces and zero-width characters, and nothing else', () => {
    expect(sameContent('Thanks,\n\n  glad it helps.', 'Thanks, glad it helps.')).toBe(true)
    expect(sameContent(`Thanks,${String.fromCharCode(0xa0)}glad${String.fromCharCode(0x200b)} it helps.`, 'Thanks, glad it helps.')).toBe(true)
    expect(sameContent('Thanks, glad it helps', 'Thanks, glad it helps.')).toBe(false)
    expect(sameContent('Thanks, glad it helps. extra', 'Thanks, glad it helps.')).toBe(false)
    expect(sameContent('thanks, glad it helps.', 'Thanks, glad it helps.')).toBe(false)
    expect(sameContent(null, 'x')).toBe(false)
    expect(sameContent(42, '42')).toBe(false)
    expect(normalizeText('  a \t b\n')).toBe('a b')
  })
})

describe('reading a field back', () => {
  it('builds a read-only script for one label, and refuses anything that is not a label', () => {
    const script = fieldValueScript('e12')
    expect(script).toContain('data-ppd-ref="e12"')
    expect(script).toContain('ppd-field e12')
    expect(script).not.toMatch(/\.value\s*=|innerText\s*=|click\(|submit\(/)
    for (const bad of ['', 'e', '12', 'e12"]; alert(1);//', 'e1 e2', 'E1']) expect(() => fieldValueScript(bad)).toThrow()
  })
})

describe('what the site says that makes publishing unwise', () => {
  it.each([
    "You're doing that too much. Try again in 9 minutes.",
    'Too many requests',
    'You are being rate limited',
    'Slow down, please',
    'Your account has been suspended',
    'We noticed unusual activity on your account',
    'Please verify your identity'
  ])('is found in: %s', (alert) => {
    expect(platformWarning(['Saved.', alert])).toBe(alert)
  })

  it.each(['Your comment is awaiting approval', 'This field is required', 'Reply posted', 'Comment cannot be empty'])('is not found in an ordinary message: %s', (alert) => {
    expect(platformWarning([alert])).toBeNull()
  })

  it('is null for no messages', () => {
    expect(platformWarning([])).toBeNull()
  })
})

describe('reading what the form holds', () => {
  /** A page as far as the script looks at it: elements that answer `querySelectorAll`, and shadow roots that have their own. */
  interface Node {
    tag: string
    type?: string
    value?: string
    editable?: boolean
    text?: string
    ref?: string
    role?: string
    shadow?: Node[]
  }
  const pageOf = (nodes: Node[]) => {
    const toElement = (n: Node): unknown => ({
      tagName: n.tag.toUpperCase(),
      value: n.value,
      isContentEditable: n.editable === true,
      innerText: n.text,
      textContent: n.text,
      getAttribute: (name: string) => (name === 'type' ? (n.type ?? null) : name === 'data-ppd-ref' ? (n.ref ?? null) : null),
      shadowRoot: n.shadow ? rootOf(n.shadow) : null
    })
    const matches = (n: Node): boolean => ['input', 'textarea'].includes(n.tag) || n.editable === true || n.role === 'textbox'
    const rootOf = (list: Node[]): unknown => ({
      querySelectorAll: (selector: string) => (selector === '*' ? list.map(toElement) : list.filter(matches).map(toElement))
    })
    return rootOf(nodes)
  }
  const read = (nodes: Node[]) => parseHeldText(new Function('document', `return ${formTextScript()}`)(pageOf(nodes)))

  it('is a read-only script', () => {
    const script = formTextScript()
    expect(script).toContain('ppd-form-text')
    expect(script).not.toMatch(/\.value\s*=[^=]|innerText\s*=[^=]|click\(|submit\(|dispatchEvent/)
  })

  it('answers the text-entry places that hold text, with their label when the AI could have been shown them, and none that are empty', () => {
    expect(read([{ tag: 'textarea', value: '', ref: 'e1' }, { tag: 'input', type: 'text', value: '   ' }])).toEqual([])
    expect(
      read([
        { tag: 'textarea', value: 'A comment', ref: 'e1' },
        { tag: 'input', type: 'text', value: 'A title', ref: 'e2' },
        { tag: 'input', value: 'no type attribute is a text input' },
        { tag: 'input', type: 'url', value: 'https://example.org/' },
        { tag: 'div', editable: true, text: 'typed in an editor', ref: 'e7' },
        { tag: 'div', role: 'textbox', editable: true, text: 'a textbox' }
      ])
    ).toEqual([
      { ref: 'e1', text: 'A comment' },
      { ref: 'e2', text: 'A title' },
      { ref: null, text: 'no type attribute is a text input' },
      { ref: null, text: 'https://example.org/' },
      { ref: 'e7', text: 'typed in an editor' },
      { ref: null, text: 'a textbox' }
    ])
  })

  it('does not count what is not text a person typed: blanks, zero-width characters, passwords, check boxes, hidden inputs, buttons, an element that is not editable', () => {
    expect(
      read([
        { tag: 'textarea', value: ' \n\t ' },
        { tag: 'textarea', value: '\u200b\u200c\u200d\u2060\ufeff' },
        { tag: 'input', type: 'password', value: 'secret' },
        { tag: 'input', type: 'checkbox', value: 'on' },
        { tag: 'input', type: 'hidden', value: 'token' },
        { tag: 'input', type: 'submit', value: 'Post' },
        { tag: 'input', type: 'file', value: 'C:\\fakepath\\x.png' },
        { tag: 'div', editable: false, role: 'textbox', text: 'not editable' }
      ])
    ).toEqual([])
  })

  it('looks into shadow roots, where a site keeps its editors', () => {
    expect(read([{ tag: 'comment-composer', shadow: [{ tag: 'textarea', value: 'inside', ref: 'e3' }] }])).toEqual([{ ref: 'e3', text: 'inside' }])
  })

  it('keeps what it reads in bounds', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ tag: 'textarea', value: `text ${i}` }))
    expect(read(many)).toHaveLength(20)
    expect(read([{ tag: 'textarea', value: 'x'.repeat(50_000) }])?.[0]?.text).toHaveLength(20_000)
  })

  it('treats an answer that is not a list of entries as unreadable, and a label that is not one as none', () => {
    expect(parseHeldText(undefined)).toBeNull()
    expect(parseHeldText('text')).toBeNull()
    expect(parseHeldText([{ ref: 'e1' }])).toBeNull()
    expect(parseHeldText([null])).toBeNull()
    expect(parseHeldText([{ ref: 'e1; drop', text: 'a' }])).toEqual([{ ref: null, text: 'a' }])
  })
})
