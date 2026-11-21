import { describe, expect, it } from 'vitest'
import { MAX_SOURCES, readSources, sourceAddress, sourceHost } from './draft-sources'

const page = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ title: `Page ${n}`, url: `https://site${n}.example.org/a`, fact: `A fact number ${n} taken from the page.`, ...extra })

describe('the address of a source', () => {
  it('accepts the https address of a public page and drops the fragment', () => {
    expect(sourceAddress('https://www.astro.com/swisseph/swephinfo_e.htm#top')).toBe('https://www.astro.com/swisseph/swephinfo_e.htm')
  })

  it('refuses everything else: http, a script, a file, this computer, a private network, credentials, a bare word, spaces, a number, too long', () => {
    for (const bad of [
      'http://astro.com/x',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://10.0.0.5/x',
      'https://printer.local/x',
      'https://intranet.internal/x',
      'https://user:secret@astro.com/x',
      'https://intranet/x',
      'astro.com/x',
      'https://astro.com/a b',
      '',
      42,
      null,
      `https://astro.com/${'a'.repeat(600)}`
    ]) {
      expect(sourceAddress(bad), String(bad)).toBeNull()
    }
  })

  it('names the site without www', () => {
    expect(sourceHost('https://www.astro.com/x')).toBe('astro.com')
    expect(sourceHost('nonsense')).toBe('')
  })
})

describe('the sources an engine lists', () => {
  it('keeps real pages with a fact, in the order given', () => {
    expect(readSources([page(1), page(2)])).toEqual([
      { title: 'Page 1', url: 'https://site1.example.org/a', fact: 'A fact number 1 taken from the page.' },
      { title: 'Page 2', url: 'https://site2.example.org/a', fact: 'A fact number 2 taken from the page.' }
    ])
  })

  it('drops an entry that is not a real page or has no fact, and keeps the others', () => {
    const list = readSources([page(1, { url: 'http://site1.example.org/a' }), page(2, { fact: '  ' }), page(3, { url: 'https://localhost/x' }), page(4, { url: 'https://u:p@site4.example.org/' }), 'a string', null, page(5)])
    expect(list.map((source) => source.title)).toEqual(['Page 5'])
  })

  it('names a page by its site when the title is missing, and cleans markup out of the title and the fact', () => {
    const [source] = readSources([{ url: 'https://www.astro.com/x', title: '', fact: 'It is **free** for <b>non-commercial</b> use and has [docs](https://x.example) too.' }])
    expect(source.title).toBe('astro.com')
    expect(source.fact).toBe('It is free for non-commercial use and has docs too.')
  })

  it('lists a page once, caps the list and the lengths, and drops a fact that holds a credential', () => {
    expect(readSources([page(1), page(1, { fact: 'Another fact from the same page.' })])).toHaveLength(1)
    expect(readSources(Array.from({ length: 20 }, (_, n) => page(n + 1)))).toHaveLength(MAX_SOURCES)
    const [long] = readSources([page(1, { title: 'T'.repeat(500), fact: 'F'.repeat(2000) })])
    expect(long.title.length).toBeLessThanOrEqual(150)
    expect(long.fact.length).toBeLessThanOrEqual(300)
    expect(readSources([page(1, { fact: 'The api_key: sk-abcdefghijklmnopqrstuvwxyz0123456789 is in the page.' })])).toEqual([])
  })

  it('reads anything that is not a list as no sources', () => {
    for (const value of [undefined, null, 'x', 5, {}, { 0: page(1) }]) expect(readSources(value)).toEqual([])
  })
})
