// The link rule of the safety checks (REQ-003): a draft may only point to the product's own addresses, however the link is written.
// Pure function, so every way of writing an address is a table row.

import { describe, expect, it } from 'vitest'
import type { ClaimView } from './context'
import { allowedHostsFor, checkDraftSafety, linksIn, moneyTalkIn } from './safety'

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

describe('findings: the same problems, shaped for a screen', () => {
  const run = (text: string, extra: Partial<Parameters<typeof checkDraftSafety>[0]> = {}) =>
    checkDraftSafety({ text, title: null, link: null, usedClaimIds: [], approved: [], prohibited: [], allowedHosts: OWN, ...extra })

  it('are one for each violation, in the same order, for an AI draft', () => {
    const report = run('It is free. A price: $9. Use the coupon. See bit.ly/x. A guaranteed result.', {
      prohibited: ['A guaranteed result'],
      usedClaimIds: ['nope'],
      approved: [claim('c9', 'Something else')]
    })
    expect(report.findings.map((f) => f.rule)).toEqual(['unknown_claim', 'prohibited', 'price', 'discount', 'free', 'link'])
    expect(report.findings).toHaveLength(report.violations.length)
  })

  it('quote the sentence a price, a discount or a free offer sits in, and cut a long one', () => {
    expect(run('Hello there. It is $9 a month. Bye.').findings[0].quote).toBe('It is $9 a month')
    expect(run('First line\nUse the coupon today!\nThird').findings[0].quote).toBe('Use the coupon today')
    expect(run('First line\nUse the coupon today\nSecond line, no full stop').findings[0].quote).toBe('Use the coupon today')
    // A long sentence is cut around the words, never away from them.
    const long = run(`${'word '.repeat(40)}is free now`).findings[0].quote ?? ''
    expect(long.length).toBeLessThanOrEqual(92)
    expect(long.startsWith('…')).toBe(true)
    expect(long).toContain('free')
    const early = run(`It is free ${'word '.repeat(40)}and so on`).findings[0].quote ?? ''
    expect(early.startsWith('It is free')).toBe(true)
    expect(early.endsWith('…')).toBe(true)
    // What the front does not use, the back gets: the quote is as long as the room allows (90 characters and the mark).
    expect(early).toHaveLength(91)
    const middle = run(`${'before '.repeat(20)}the first month is free for everyone ${'after '.repeat(20)}`).findings[0].quote ?? ''
    expect(middle.startsWith('…') && middle.endsWith('…')).toBe(true)
    expect(middle).toContain('is free for')
    expect(middle.length).toBeLessThanOrEqual(92)
  })

  it('cut a long sentence evenly around the words, for each rule', () => {
    const around = (words: string): string => `${'before '.repeat(20)}${words} ${'after '.repeat(20)}`
    expect(run(around('the first month is free for everyone')).findings[0].quote).toBe('…re before before before the first month is free for everyone after after after after after…')
    expect(run(around('it costs $9 a month for everyone')).findings[0].quote).toBe('…before before before before before it costs $9 a month for everyone after after after afte…')
    expect(run(around('use the coupon NATAL for everyone')).findings[0].quote).toBe('…efore before before before before use the coupon NATAL for everyone after after after afte…')
  })

  it('show a sentence with its spaces squeezed to one', () => {
    expect(run('Yes   it is  free   for  a month').findings[0].quote).toBe('Yes it is free for a month')
  })

  it('keep a number, an address or a question mark inside the sentence it is in', () => {
    expect(run('It costs $9.99 a month, which is cheap.').findings[0].quote).toBe('It costs $9.99 a month, which is cheap')
    expect(run('Try evil.com it is free for everyone.').findings.map((f) => f.quote)).toEqual(['Try evil.com it is free for everyone', 'evil.com'])
    expect(run('See evil.com/a?b=1 and use the coupon.', { allowedHosts: [] }).findings.map((f) => f.quote)).toEqual(['See evil.com/a?b=1 and use the coupon', 'evil.com'])
    // A full stop, "!" or "?" before a space still ends the sentence, and so does the end of the text.
    expect(run('Is it ok? Use the coupon! Fine.').findings[0].quote).toBe('Use the coupon')
    expect(run('Hello. Use the coupon.').findings[0].quote).toBe('Use the coupon')
  })

  it('cut a long sentence by characters, not through an emoji', () => {
    const quote = run(`${'😀'.repeat(120)} free`).findings[0].quote ?? ''
    expect(quote).toContain('free')
    expect(quote).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/)
    const after = run(`It is free ${'😀'.repeat(120)}`).findings[0].quote ?? ''
    expect(after.startsWith('It is free')).toBe(true)
    expect(after).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })

  it('say which addresses may be linked, or that there are none', () => {
    expect(run('See evil.com').findings[0].why).toBe('Only natalmystic.com may be linked.')
    expect(run('See evil.com', { allowedHosts: [] }).findings[0].why).toBe('The product has no website, and no approved fact names an address.')
    expect(run('See evil.com', { allowedHosts: ['a.com', 'b.com', 'c.com', 'd.com'] }).findings[0].why).toBe('Only a.com, b.com, c.com may be linked.')
  })

  it("for the owner's own text skip the rules about citing, and count any approved fact as the backing", () => {
    const approved = [claim('c1', 'It costs $9 a month.'), { ...claim('c2', 'A Windows build.'), unconfirmedAvailability: true }]
    // It cites an unconfirmed fact and an unknown id, as an AI draft would: for the owner's text that is nothing to report.
    const owner = run('It is $9 a month, on Windows.', { mode: 'owner', approved, usedClaimIds: ['c1', 'c2', 'nope'] })
    expect(owner.violations).toEqual([])
    expect(owner.findings).toEqual([])
    expect(owner.usedClaims).toEqual([])
    // The same text as an AI draft that cites nothing is refused: nothing backs the price.
    expect(run('It is $9 a month, on Windows.', { approved }).findings.map((f) => f.rule)).toEqual(['price'])
    // A price no approved fact names is found in the owner's text too.
    expect(run('It is $12 a month.', { mode: 'owner', approved }).findings.map((f) => f.rule)).toEqual(['price'])
  })
})

describe('the money talk a text holds, as written', () => {
  it('lists amounts, discount words and "free" words once each, in lower case', () => {
    expect(moneyTalkIn('It costs $9 a month, or $9 on sale. Use the PROMO CODE: it is free for a week, 20% off.').sort()).toEqual(['$9', '20% off', 'free', 'on sale', 'promo code'].sort())
  })

  it('finds nothing in a text without any', () => {
    expect(moneyTalkIn('A chart is drawn from the moment and the place.')).toEqual([])
  })
})
