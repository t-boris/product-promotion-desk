// The link rule of the safety checks (REQ-003): a draft may only point to the product's own addresses, however the link is written.
// Pure function, so every way of writing an address is a table row.

import { describe, expect, it } from 'vitest'
import type { ClaimView } from './context'
import { allowedHostsFor, checkDraftSafety, linksIn } from './safety'

const OWN = ['natalmystic.com']
const check = (text: string, extra: { link?: string | null; allowedHosts?: string[] } = {}): string[] =>
  checkDraftSafety({ text, title: null, link: extra.link ?? null, usedClaimIds: [], approved: [], prohibited: [], allowedHosts: extra.allowedHosts ?? OWN }).violations

const claim = (id: string, text: string): ClaimView => ({ id, lineageId: `${id}-lineage`, text, section: 'offer', unconfirmedAvailability: false })

describe('links in a draft: every way of writing an address is checked', () => {
  const foreign: [string, string, string][] = [
    ['a full address', 'More at https://evil.example/post', 'evil.example'],
    ['a bare domain', 'More at evil.com', 'evil.com'],
    ['a short link', 'Details: bit.ly/3xYz', 'bit.ly'],
    ['another short link', 'Details: goo.gl/abc and t.ly/z', 'goo.gl'],
    ['a domain with a path and an unlisted ending', 'See evil.de/post', 'evil.de'],
    ['a domain with an ending added to the list', 'See evil.link now', 'evil.link'],
    ['a www host', 'See www.evil.de for more', 'evil.de'],
    ['a www host with an ending nobody listed', 'See www.shady.pl for more', 'shady.pl'],
    ['the target of a markdown link', 'Read [more](evil.de/x) here', 'evil.de'],
    ['the target of a markdown link with a scheme', 'Read [more](https://evil.example/x) here', 'evil.example'],
    ['the target of a markdown link in angle brackets', 'Read [more](<evil.de/x>) here', 'evil.de'],
    ['the target of a reference-style link', 'Read [more][1]\n\n[1]: evil.de/x', 'evil.de'],
    ['the target of a reference-style link with an ending nobody listed', 'Read [more][1]\n\n[1]: shady.pl', 'shady.pl'],
    ['the target of a markdown link with an ending nobody listed', 'Read [more](shady.pl) here', 'shady.pl'],
    ['a host that only ends with the product\'s own name', 'See evilnatalmystic.com', 'evilnatalmystic.com'],
    ['a scheme that is not http', 'Get it at ftp://files.example/a', 'files.example'],
    ['an address on this computer', 'Try http://localhost:3000/x', 'localhost'],
    ['a look-alike of the own host', 'See natalmystic.com.evil.example/x', 'natalmystic.com.evil.example']
  ]
  for (const [name, text, host] of foreign) {
    it(`blocks ${name}`, () => {
      expect(check(text)).toContain(`it links to ${host}, which is not the product's own address`)
    })
  }

  it('blocks a link written in the link field, with or without a scheme', () => {
    expect(check('Hello', { link: 'https://evil.example/x' })).toContain("it links to evil.example, which is not the product's own address")
    expect(check('Hello', { link: 'shady.pl' })).toContain("it links to shady.pl, which is not the product's own address")
    expect(check('Hello', { link: 'natalmystic.com/pricing' })).toEqual([])
  })

  it('blocks a link that is not a web address at all', () => {
    expect(check('Click [here](javascript:alert(1))')).toHaveLength(1)
    expect(check('Click [here](javascript:alert(1))')[0]).toMatch(/^it holds a link that is not a web address \(javascript:/)
    expect(check('Click [here](data:text/html;base64,AAAA)')[0]).toMatch(/not a web address \(data:/)
    expect(check('Click [here](vbscript:run)')[0]).toMatch(/not a web address/)
  })

  const own = [
    'See https://natalmystic.com/pricing',
    'See natalmystic.com',
    'See natalmystic.com/pricing',
    'See www.natalmystic.com/pricing',
    'See docs.natalmystic.com/start',
    'Read [more](natalmystic.com/x) here',
    'Read [more](https://www.natalmystic.com) here',
    'Read [more][1]\n\n[1]: https://natalmystic.com/x',
    'Write to team@natalmystic.com',
    'Jump to [the top](#top), [the docs](/docs) or [the next one](./next)',
    'Mail [us](mailto:team@natalmystic.com) or call [now](tel:+10000000)',
    'A link to [a word](docs) that leads nowhere else'
  ]
  for (const text of own) {
    it(`lets through "${text.replace(/\n/g, ' ')}"`, () => {
      expect(check(text)).toEqual([])
    })
  }

  const notAddresses = [
    'Works with Node.js/Express and React.js/Next.js',
    'Edit package.json/yarn.lock by hand',
    'Run install.sh or main.py/utils.py',
    'e.g. this, i.e. that, and/or the other, I/O and a.m./p.m. times',
    'It is version 1.2.3/4 of the thing',
    'A sentence that ends.Another that starts without a space',
    'Thanks, that was helpful. See you soon!'
  ]
  for (const text of notAddresses) {
    it(`does not mistake "${text}" for a link`, () => {
      expect(check(text)).toEqual([])
    })
  }

  it('reads the hosts a text points to, once each, and ignores relative targets', () => {
    expect(linksIn('a evil.de/x b evil.de c [d](evil.de/y) e [f](#g)')).toEqual({ hosts: ['evil.de'], unsafe: [] })
  })
})

describe('hosts the product allows', () => {
  it('are its website and every address an approved claim names, written in any way', () => {
    const hosts = allowedHostsFor('https://www.natalmystic.com/', [
      claim('c1', 'Docs live at https://docs.natalmystic.io/start.'),
      claim('c2', 'Short link: bit.ly/natal and see [the blog](blog.natalmystic.blog/posts).'),
      claim('c3', 'No address in this one.')
    ])
    expect(hosts.sort()).toEqual(['bit.ly', 'blog.natalmystic.blog', 'docs.natalmystic.io', 'natalmystic.com'])
    // An address the owner approved in a claim can then be used in a draft.
    expect(check('Details: bit.ly/natal', { allowedHosts: hosts })).toEqual([])
    expect(check('Details: bit.ly/other-thing', { allowedHosts: ['natalmystic.com'] })).toHaveLength(1)
  })

  it('are nothing when the product has no website and no claim names one', () => {
    expect(allowedHostsFor(null, [])).toEqual([])
    expect(check('See natalmystic.com', { allowedHosts: allowedHostsFor(null, []) })).toHaveLength(1)
  })
})
