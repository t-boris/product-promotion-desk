// The text of the post a page is about: the script reads it from the markup of the sites it knows (Reddit new and old, Instagram, Threads), and from the
// first article of any other site; a page that is not the page of one post gives none. It is read against a tiny page here: the real sites are unproven.

import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { MAX_POST_TEXT, parseSnapshot, snapshotScript, type PageSnapshot } from './snapshot'

interface Part {
  innerText: string
}

/** An element of the tiny page: it has text, and children found by the selector the script asks for. */
class Box {
  readonly nodeType = 1
  readonly shadowRoot = null
  constructor(
    readonly innerText: string,
    private readonly children: Record<string, Part> = {}
  ) {}
  querySelector(selector: string): Part | null {
    return this.children[selector] ?? null
  }
  querySelectorAll(): Box[] {
    return []
  }
}

/** The page the script runs on: the address, and the elements each selector finds. */
function runPage(href: string, found: Record<string, Box[]>): PageSnapshot {
  const url = new URL(href)
  const document = {
    title: 'A page',
    body: { innerText: 'The page text' },
    getElementById: () => null,
    querySelectorAll: (selector: string) => found[selector] ?? []
  }
  const raw = runInNewContext(snapshotScript(), {
    document,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    location: { href, host: url.host, pathname: url.pathname },
    window: { innerWidth: 1000, innerHeight: 700 },
    URL
  })
  const parsed = parseSnapshot(raw)
  if (!parsed) throw new Error('the script returned nothing usable')
  return parsed
}

describe('the text of the post a Reddit page is about', () => {
  const POST = 'https://www.reddit.com/r/astrology/comments/abc/which_app/'

  it('is the text body of the post, not the comments around it', () => {
    const post = new Box('Which app?\nx comments', { '[slot="text-body"]': { innerText: 'I want a chart with houses.\n\n\n\nAny app you trust?' } })
    expect(runPage(POST, { 'shreddit-post': [post] }).post).toEqual({ href: POST, text: 'I want a chart with houses.\n\nAny app you trust?' })
  })

  it('is the old site\'s own text for a classic page', () => {
    const post = new Box('', { '.usertext-body': { innerText: 'Classic text.' } })
    expect(runPage('https://old.reddit.com/r/astrology/comments/abc/which_app/', { 'div.thing.link': [post] }).post?.text).toBe('Classic text.')
  })

  it('is empty for a post that plainly has no text of its own (a link or a picture), which is not the same as no post', () => {
    const post = new Box('A link post')
    expect(runPage(POST, { 'shreddit-post': [post] }).post).toEqual({ href: POST, text: '' })
  })

  it('is not there for a page of the site that is not the page of a post (a listing)', () => {
    const post = new Box('', { '[slot="text-body"]': { innerText: 'The first post of the listing.' } })
    expect(runPage('https://www.reddit.com/r/astrology/', { 'shreddit-post': [post] })).not.toHaveProperty('post')
  })

  it('is not there when the page has no post element at all (it is not loaded yet)', () => {
    expect(runPage(POST, {})).not.toHaveProperty('post')
  })
})

describe('the text of the post an Instagram or Threads page is about', () => {
  it('is the caption of an Instagram post', () => {
    const caption = new Box('Moon in Scorpio today. What does it do to you?')
    expect(runPage('https://www.instagram.com/p/Abc123/', { 'article h1, main h1': [caption] }).post).toEqual({ href: 'https://www.instagram.com/p/Abc123/', text: 'Moon in Scorpio today. What does it do to you?' })
  })

  it('is not there for an Instagram page that is a profile, or a post whose caption the markup does not show', () => {
    const caption = new Box('Not a caption')
    expect(runPage('https://www.instagram.com/brand/', { 'article h1, main h1': [caption] })).not.toHaveProperty('post')
    expect(runPage('https://www.instagram.com/p/Abc123/', {})).not.toHaveProperty('post')
  })

  it('is the first post of a Threads post page', () => {
    const post = new Box('someone\n2h\nWhat is a stellium?')
    expect(runPage('https://www.threads.com/@someone/post/Xyz', { '[data-pressable-container="true"]': [post] }).post?.text).toBe('someone\n2h\nWhat is a stellium?')
    expect(runPage('https://www.threads.com/@someone', { '[data-pressable-container="true"]': [post] })).not.toHaveProperty('post')
  })
})

describe('the text of the post a page of another site is about', () => {
  it('is the first article, or else the main part, of a page that is not the front page', () => {
    expect(runPage('https://example.org/blog/moon', { article: [new Box('The article.')] }).post?.text).toBe('The article.')
    expect(runPage('https://example.org/blog/moon', { 'main, [role=main]': [new Box('The main part.')] }).post?.text).toBe('The main part.')
    expect(runPage('https://example.org/', { article: [new Box('The front page.')] })).not.toHaveProperty('post')
  })

  it('is cut to the most a post can keep', () => {
    const page = runPage('https://example.org/blog/moon', { article: [new Box('x'.repeat(MAX_POST_TEXT + 1000))] })
    expect(page.post?.text).toHaveLength(MAX_POST_TEXT)
  })
})

describe('the post of a snapshot, as the application reads it', () => {
  const base = { url: 'https://www.reddit.com/r/x/comments/1/', title: 'T', text: 'x', alerts: [], humanCheck: '', elements: [{ ref: 'e1', role: 'link', name: 'A' }] }

  it('is kept only with an https address of the page and a text', () => {
    expect(parseSnapshot({ ...base, post: { href: 'https://www.reddit.com/r/x/comments/1/', text: 'Hello' } })?.post).toEqual({ href: 'https://www.reddit.com/r/x/comments/1/', text: 'Hello' })
    expect(parseSnapshot({ ...base, post: { href: 'http://www.reddit.com/r/x/comments/1/', text: 'Hello' } })).not.toHaveProperty('post')
    expect(parseSnapshot({ ...base, post: { href: 'javascript:alert(1)', text: 'Hello' } })).not.toHaveProperty('post')
    expect(parseSnapshot({ ...base, post: { href: 'https://www.reddit.com/r/x/comments/1/', text: 42 } })).not.toHaveProperty('post')
    expect(parseSnapshot({ ...base, post: 'text' })).not.toHaveProperty('post')
    expect(parseSnapshot({ ...base, post: null })).not.toHaveProperty('post')
    expect(parseSnapshot({ ...base })).not.toHaveProperty('post')
  })

  it('is cut to the most a post can keep', () => {
    expect(parseSnapshot({ ...base, post: { href: 'https://www.reddit.com/r/x/comments/1/', text: 'y'.repeat(MAX_POST_TEXT + 5) } })?.post?.text).toHaveLength(MAX_POST_TEXT)
  })
})
