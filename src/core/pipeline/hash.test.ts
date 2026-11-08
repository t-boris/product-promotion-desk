import { describe, expect, it } from 'vitest'
import { commentBodyHash, contentHash, type HashedAccount } from './hash'

describe('content hash (REQ-004 criterion 1)', () => {
  const base: { title: string | null; text: string; link: string | null; attachments: { name: string; sha256: string }[] } = {
    title: 'T',
    text: 'body',
    link: 'https://natalmystic.com',
    attachments: [{ name: 'a.png', sha256: 'aa' }]
  }
  const account: HashedAccount = { id: 'acc', identity: 'brand' }
  const hash = (content = base, who = account, destination = 'https://x/y') => contentHash(content, who, destination)

  it('is stable for equal content', () => {
    expect(hash()).toBe(hash({ ...base, attachments: [{ name: 'a.png', sha256: 'aa' }] }))
  })

  it.each([
    ['title', { ...base, title: 'T2' }],
    ['text', { ...base, text: 'body!' }],
    ['link', { ...base, link: 'https://natalmystic.com/x' }],
    ['attachment name', { ...base, attachments: [{ name: 'b.png', sha256: 'aa' }] }],
    ['attachment bytes', { ...base, attachments: [{ name: 'a.png', sha256: 'ab' }] }],
    ['an added attachment', { ...base, attachments: [...base.attachments, { name: 'c.png', sha256: 'cc' }] }],
    ['a removed attachment', { ...base, attachments: [] }]
  ])('changes when the %s changes', (_name, changed) => {
    expect(hash(changed)).not.toBe(hash())
  })

  it('changes with the account and with the destination', () => {
    expect(hash(base, { ...account, id: 'other' })).not.toBe(hash())
    expect(hash(base, account, 'https://x/z')).not.toBe(hash())
  })

  it('changes with who is signed in to the account: another identity, a newly confirmed one, or none', () => {
    expect(hash(base, { ...account, identity: 'someone_else' })).not.toBe(hash())
    expect(hash(base, { ...account, identity: null })).not.toBe(hash())
    expect(hash(base, { id: 'acc', identity: null })).not.toBe(hash(base, { id: 'acc', identity: 'brand' }))
  })

  it('ignores decoration and case of the identity, which are not a different login', () => {
    expect(hash(base, { ...account, identity: 'u/Brand' })).toBe(hash())
    expect(hash(base, { ...account, identity: ' @BRAND ' })).toBe(hash())
    expect(hash(base, { ...account, identity: '' })).toBe(hash(base, { ...account, identity: null }))
  })

  it('treats a missing and an empty optional field alike, but not text moved between fields', () => {
    expect(hash({ ...base, title: null })).toBe(hash({ ...base, title: '' }))
    expect(contentHash({ title: 'ab', text: 'c', link: null, attachments: [] }, { id: 'a', identity: null }, 'd')).not.toBe(contentHash({ title: 'a', text: 'bc', link: null, attachments: [] }, { id: 'a', identity: null }, 'd'))
  })

  it('ignores the local path and mime of an attachment, which are not part of what is published', () => {
    const a = contentHash({ ...base, attachments: [{ name: 'a.png', sha256: 'aa', path: '/one', mime: 'image/png' } as never] }, account, 'd')
    const b = contentHash({ ...base, attachments: [{ name: 'a.png', sha256: 'aa', path: '/two', mime: 'image/jpeg' } as never] }, account, 'd')
    expect(a).toBe(b)
  })

  it('compares comment bodies ignoring line-ending and surrounding whitespace noise only', () => {
    expect(commentBodyHash('a\r\nb ')).toBe(commentBodyHash('  a\nb'))
    expect(commentBodyHash('a b')).not.toBe(commentBodyHash('a  b'))
  })
})
