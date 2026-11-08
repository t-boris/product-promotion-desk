import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { elementTextScript, extractItemsScript, loginProbeScript, parseCount, visibleTextScript } from './reader'
import { renderTemplate } from './templates'
import type { ItemReader } from './profile'

// A tiny DOM: elements know their text, attributes and which child answers which selector.
class El {
  constructor(
    readonly text = '',
    readonly attrs: Record<string, string> = {},
    readonly children: Record<string, El> = {}
  ) {}
  get textContent(): string {
    return this.text
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null
  }
  querySelector(selector: string): El | null {
    return this.children[selector] ?? null
  }
  offsetParent = {}
  getClientRects(): unknown[] {
    return [{}]
  }
}

function run<T>(script: string, document: Record<string, unknown>): T {
  return runInNewContext(script, { document, location: { href: 'https://forum.example.com/c/news' }, URL }) as T
}

const reader: ItemReader = {
  containerSelector: 'ul',
  itemSelector: 'li.topic',
  id: { attr: 'data-id' },
  title: { selector: 'a.title' },
  permalink: { selector: 'a.title', attr: 'href' },
  author: { selector: '.author' }
}

describe('extractItemsScript', () => {
  it('reads configured fields, makes permalinks absolute and tolerates missing parts', () => {
    const items = [
      new El('', { 'data-id': 'a1' }, { 'a.title': new El(' First ', { href: '/t/1' }), '.author': new El('ann') }),
      new El('', { 'data-id': 'a2' }, {})
    ]
    const result = run<Record<string, string>[]>(extractItemsScript(reader, 10), { querySelectorAll: () => items })
    expect(result[0]).toMatchObject({ id: 'a1', title: 'First', author: 'ann', permalink: 'https://forum.example.com/t/1', body: '', time: '' })
    expect(result[1]).toMatchObject({ id: 'a2', title: '', permalink: '' })
  })

  it('honours the item limit', () => {
    const items = Array.from({ length: 5 }, (_, i) => new El('', { 'data-id': String(i) }))
    const result = run<unknown[]>(extractItemsScript(reader, 2), { querySelectorAll: () => items })
    expect(result).toHaveLength(2)
  })

  it('carries profile data as a JSON literal only: a hostile selector cannot break out into code', () => {
    const hostile: ItemReader = { ...reader, itemSelector: `x"); globalThis.pwned = true; ("` }
    const sandbox = { document: { querySelectorAll: () => [] }, location: { href: 'https://forum.example.com/' }, URL, pwned: false } as Record<string, unknown>
    runInNewContext(extractItemsScript(hostile, 1), sandbox)
    expect(sandbox.pwned).toBe(false)
  })
})

describe('other page scripts', () => {
  it('probes login state and element text', () => {
    const doc = {
      querySelector: (s: string) => (s === '#me' ? new El('natal') : s === '.count' ? new El('1.2k members') : null)
    }
    expect(run(loginProbeScript({ loggedInSelector: '#me', identitySelector: '#me' }), doc)).toEqual({ loggedIn: true, identity: 'natal', captcha: false })
    expect(run(loginProbeScript({ loggedInSelector: '#gone' }), doc)).toEqual({ loggedIn: false, identity: '', captcha: false })
    expect(run(elementTextScript('.count'), doc)).toBe('1.2k members')
    expect(run(elementTextScript('.nope'), doc)).toBeNull()
  })

  it('collects visible error text only', () => {
    const hidden = Object.assign(new El('hidden'), { offsetParent: null, getClientRects: () => [] })
    const result = run<string[]>(visibleTextScript('.err'), { querySelectorAll: () => [new El(' Too fast '), hidden] })
    expect(result).toEqual(['Too fast'])
  })

  it('parses counts', () => {
    expect(parseCount('1.2k members')).toBe(1200)
    expect(parseCount('3,400')).toBe(3400)
    expect(parseCount('2M')).toBe(2_000_000)
    expect(parseCount('none')).toBeNull()
    expect(parseCount(null)).toBeNull()
  })
})

describe('placeholder rendering', () => {
  it('substitutes values by context and never lets a selector be altered', () => {
    expect(renderTemplate('div[data-id="{{parentId}}"]', { parentId: 'p-1' }, 'selector')).toBe('div[data-id="p-1"]')
    expect(() => renderTemplate('div[data-id="{{parentId}}"]', { parentId: '"] , body , ["' }, 'selector')).toThrow(/cannot be used inside a selector/)
    expect(renderTemplate('https://x.test/u/{{identity}}/posts', { identity: 'a b' }, 'url')).toBe('https://x.test/u/a%20b/posts')
    expect(renderTemplate('{{destination}}', { destination: 'https://x.test/t/1?a=b' }, 'url')).toBe('https://x.test/t/1?a=b')
    expect(renderTemplate('Hello {{text}}', { text: 'a "quoted" <b>' }, 'value')).toBe('Hello a "quoted" <b>')
    expect(() => renderTemplate('{{text}}', {}, 'value')).toThrow(/No value/)
  })
})
