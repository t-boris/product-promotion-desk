import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { chooseLinks, OUTLINE_MAX_CHARS, outlineScript, parsePageOutline, publicSite, sameSite, type PageOutline } from './site-outline'

// A tiny DOM: enough to run the outline script and see what it reports.
interface Spec {
  tag: string
  id?: string
  cls?: string
  attrs?: Record<string, string>
  text?: string
  hidden?: boolean
  kids?: Spec[]
}

class FakeElement {
  readonly children: FakeElement[]
  readonly childNodes: { nodeType: number; textContent: string }[]
  readonly attributes: { name: string; value: string }[]
  constructor(private readonly spec: Spec) {
    this.children = (spec.kids ?? []).map((kid) => new FakeElement(kid))
    this.childNodes = spec.text ? [{ nodeType: 3, textContent: spec.text }] : []
    this.attributes = Object.entries(spec.attrs ?? {}).map(([name, value]) => ({ name, value }))
  }
  get tagName(): string {
    return this.spec.tag.toUpperCase()
  }
  get id(): string {
    return this.spec.id ?? ''
  }
  get className(): string {
    return this.spec.cls ?? ''
  }
  get hidden(): boolean {
    return this.spec.hidden === true
  }
  get textContent(): string {
    return this.spec.text ?? ''
  }
  get href(): string {
    return this.spec.attrs?.href ? new URL(this.spec.attrs.href, 'https://forum.example.com/').href : ''
  }
  getAttribute(name: string): string | null {
    return this.spec.attrs?.[name] ?? null
  }
  all(): FakeElement[] {
    return [this, ...this.children.flatMap((child) => child.all())]
  }
}

function runOutline(body: Spec, title = 'Forum home'): PageOutline | null {
  const root = new FakeElement(body)
  const document = {
    body: root,
    title,
    baseURI: 'https://forum.example.com/',
    querySelectorAll: (selector: string) => (selector === 'a[href]' ? root.all().filter((el) => el.tagName === 'A' && el.getAttribute('href')) : [])
  }
  return parsePageOutline(runInNewContext(outlineScript(), { document, location: { href: 'https://forum.example.com/' }, URL }))
}

const topic = (n: number): Spec => ({
  tag: 'li',
  cls: 'topic',
  attrs: { 'data-id': String(n) },
  kids: [{ tag: 'a', cls: 'title', attrs: { href: `/t/topic-${n}/${n}?utm=1#top` }, text: `Topic ${n}` }]
})

describe('the outline of a page', () => {
  const page: Spec = {
    tag: 'body',
    kids: [
      { tag: 'script', text: 'window.secret = "do not read me"' },
      { tag: 'style', text: '.x { color: red }' },
      { tag: 'nav', attrs: { role: 'navigation', 'aria-label': 'Main' }, kids: [{ tag: 'a', attrs: { href: '/latest' }, text: 'Latest' }] },
      { tag: 'div', hidden: true, text: 'hidden panel' },
      { tag: 'div', attrs: { 'aria-hidden': 'true' }, text: 'decor' },
      { tag: 'ul', cls: 'topics', kids: Array.from({ length: 40 }, (_, i) => topic(i + 1)) },
      {
        tag: 'form',
        id: 'reply',
        kids: [
          { tag: 'textarea', attrs: { name: 'text', placeholder: 'Write a reply', value: 'my private draft' } },
          { tag: 'input', attrs: { type: 'password', name: 'pw', value: 'hunter2' } },
          { tag: 'button', cls: 'submit', attrs: { type: 'submit' }, text: 'Reply' }
        ]
      }
    ]
  }

  it('describes tags, ids, classes, roles, labels, types, link paths and short texts', () => {
    const outline = runOutline(page)!
    expect(outline.title).toBe('Forum home')
    expect(outline.outline).toContain('nav[role=navigation][aria-label=Main]')
    expect(outline.outline).toContain('a[href=/latest] "Latest"')
    expect(outline.outline).toContain('ul.topics')
    expect(outline.outline).toContain('li.topic[data-id=1]')
    expect(outline.outline).toContain('a.title[href=/t/topic-1/1] "Topic 1"')
    expect(outline.outline).toContain('form#reply')
    expect(outline.outline).toContain('textarea[name=text][placeholder=Write a reply]')
    expect(outline.outline).toContain('button.submit[type=submit] "Reply"')
  })

  it('leaves out scripts, styles and hidden parts, and never reports what is typed into a field', () => {
    const { outline } = runOutline(page)!
    for (const text of ['do not read me', 'color: red', 'hidden panel', 'decor', 'my private draft', 'hunter2']) expect(outline).not.toContain(text)
    expect(outline).not.toMatch(/\[value=/)
    expect(outline).not.toMatch(/\?utm|#top/) // only the path of a link is kept
  })

  it('shows two of a run of identical items and counts the rest', () => {
    const { outline } = runOutline(page)!
    expect((outline.match(/li\.topic/g) ?? []).length).toBe(3) // two shown + the summary line
    expect(outline).toMatch(/… 38 more like li\.topic/)
  })

  it('lists the links of the page for choosing what to read next', () => {
    const { links } = runOutline(page)!
    expect(links.slice(0, 2)).toEqual([
      { href: 'https://forum.example.com/latest', text: 'Latest' },
      { href: 'https://forum.example.com/t/topic-1/1?utm=1#top', text: 'Topic 1' }
    ])
    expect(links).toHaveLength(41)
  })

  it('is bounded: a huge page gives at most 20000 characters', () => {
    const big: Spec = { tag: 'body', kids: Array.from({ length: 3000 }, (_, i) => ({ tag: 'section', cls: `s${i}`, kids: [{ tag: 'p', cls: `p${i}`, text: 'x'.repeat(200) }] })) }
    const { outline } = runOutline(big)!
    expect(outline.length).toBeLessThanOrEqual(OUTLINE_MAX_CHARS)
    expect(outline.length).toBeGreaterThan(OUTLINE_MAX_CHARS - 1000)
  })

  it('is only a read: it does not touch the page', () => {
    expect(outlineScript()).not.toMatch(/\.click\(|\.submit\(|dispatchEvent|\.value\s*=|\.focus\(|innerHTML\s*=|\.remove\(|appendChild|setAttribute|fetch\(|XMLHttpRequest|location\.(href|assign|replace)\s*=/)
  })
})

// Control characters other than the line break (written without a regular expression on purpose).
const hasControl = (text: string): boolean => [...text].some((ch) => ch !== '\n' && (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127))

describe('what the page script returned is untrusted', () => {
  it('drops anything that is not the expected shape', () => {
    for (const raw of [null, undefined, 'text', 42, [], {}, { outline: 3 }]) expect(parsePageOutline(raw)).toBeNull()
  })

  it('strips control characters and bounds every field', () => {
    const parsed = parsePageOutline({
      title: `Hello\u0000\u001b[31m ${'t'.repeat(500)}`,
      outline: `div\u0007\n${'x'.repeat(1000)}\n${'y\n'.repeat(OUTLINE_MAX_CHARS)}`,
      links: [{ href: 'https://a.example/', text: 'ok\u0000' }, { href: 5 }, null, 'x', ...Array.from({ length: 600 }, () => ({ href: 'https://a.example/x', text: 'l' }))]
    })!
    expect(parsed.title.length).toBeLessThanOrEqual(200)
    expect(hasControl(parsed.title)).toBe(false)
    expect(hasControl(parsed.outline)).toBe(false)
    expect(parsed.outline.split('\n')[1].length).toBe(300)
    expect(parsed.outline.length).toBeLessThanOrEqual(OUTLINE_MAX_CHARS)
    expect(parsed.links[0]).toEqual({ href: 'https://a.example/', text: 'ok ' })
    expect(parsed.links.length).toBeLessThanOrEqual(400)
    expect(parsed.links.length).toBeGreaterThan(300)
  })
})

describe('which sites may be read', () => {
  it('accepts a public http(s) address and returns it without the fragment', () => {
    expect(publicSite(' https://Forum.Example.com/c/general#top ')).toEqual({ url: 'https://forum.example.com/c/general', host: 'forum.example.com' })
    expect(publicSite('http://forum.example.com').host).toBe('forum.example.com')
  })

  it.each([
    ['', 'not an address'],
    ['forum.example.com', 'no scheme'],
    ['ftp://forum.example.com/', 'ftp'],
    ['javascript:alert(1)', 'script scheme'],
    ['file:///etc/passwd', 'file'],
    ['data:text/html,hi', 'data'],
    ['https://user:pw@forum.example.com/', 'credentials'],
    ['http://127.0.0.1/', 'IPv4 loopback'],
    ['http://192.168.1.10/', 'private IPv4'],
    ['http://10.0.0.1:8080/', 'private IPv4 with port'],
    ['http://[::1]/', 'IPv6 loopback'],
    ['http://[2001:db8::1]/', 'IPv6'],
    ['http://0x7f.1/', 'numeric host'],
    ['http://2130706433/', 'decimal IPv4'],
    ['http://localhost:3000/', 'localhost'],
    ['http://app.localhost/', 'localhost domain'],
    ['http://printer.local/', 'mDNS name'],
    ['http://intranet/', 'single label'],
    ['http://wiki.internal/', 'internal name']
  ])('refuses %s (%s)', (input) => {
    expect(() => publicSite(input)).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })

  it('treats a site and its subdomains as one site', () => {
    expect(sameSite('www.example.com', 'example.com')).toBe(true)
    expect(sameSite('example.com', 'EXAMPLE.com')).toBe(true)
    expect(sameSite('example.com', 'notexample.com')).toBe(false)
    expect(sameSite('example.com', 'example.com.evil.test')).toBe(false)
  })
})

describe('which links are worth reading next', () => {
  const here = 'https://forum.example.com/'
  const host = 'forum.example.com'
  const link = (href: string, text = '') => ({ href, text })

  it('prefers where discussions and the compose form are, same site only, at most two', () => {
    const chosen = chooseLinks(
      [
        link('https://forum.example.com/about', 'About'),
        link('https://forum.example.com/c/general', 'General discussion'),
        link('https://forum.example.com/new-topic', 'New topic'),
        link('https://forum.example.com/latest', 'Latest'),
        link('https://other.example.org/forum', 'Forum elsewhere')
      ],
      here,
      host
    )
    expect(chosen).toEqual(['https://forum.example.com/new-topic', 'https://forum.example.com/c/general'])
  })

  it('never follows anything that could change something or end the session', () => {
    const risky = [
      link('https://forum.example.com/logout', 'Log out'),
      link('https://forum.example.com/session/sign_out', 'Sign out'),
      link('https://forum.example.com/t/1/delete', 'Delete topic'),
      link('https://forum.example.com/t/1?action=vote', 'Vote'),
      link('https://forum.example.com/forum/unsubscribe', 'Unsubscribe from forum'),
      link('https://forum.example.com/api/topics', 'Forum API'),
      link('https://forum.example.com/forum/flag', 'Report'),
      link('https://forum.example.com/forum/x.pdf', 'Forum rules PDF')
    ]
    expect(chooseLinks(risky, here, host)).toEqual([])
  })

  it('ignores the current page, the home page, other schemes and anything with credentials', () => {
    const chosen = chooseLinks(
      [
        link('https://forum.example.com/', 'Forum home'),
        link('https://forum.example.com/forum#top', 'Forum'),
        link('mailto:forum@example.com', 'Forum mail'),
        link('javascript:void(0)', 'Forum'),
        link('https://u:p@forum.example.com/forum', 'Forum'),
        link('not a url', 'Forum')
      ],
      'https://forum.example.com/forum',
      host
    )
    expect(chosen).toEqual([])
  })

  it('counts a repeated link once and accepts the www form of the same site', () => {
    const chosen = chooseLinks([link('https://www.forum.example.com/c/a', 'Community'), link('https://www.forum.example.com/c/a', 'Community')], here, host)
    expect(chosen).toEqual(['https://www.forum.example.com/c/a'])
  })
})
