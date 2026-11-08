import { describe, expect, it } from 'vitest'
import { commentBodyHash, contentHash } from './hash'

describe('content hash (REQ-004 criterion 1)', () => {
  const base: { title: string | null; text: string; link: string | null; attachments: { name: string; sha256: string }[] } = {
    title: 'T',
    text: 'body',
    link: 'https://natalmystic.com',
    attachments: [{ name: 'a.png', sha256: 'aa' }]
  }
  const hash = (content = base, account = 'acc', destination = 'https://x/y') => contentHash(content, account, destination)

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
    expect(hash(base, 'other')).not.toBe(hash())
    expect(hash(base, 'acc', 'https://x/z')).not.toBe(hash())
  })

  it('treats a missing and an empty optional field alike, but not text moved between fields', () => {
    expect(hash({ ...base, title: null })).toBe(hash({ ...base, title: '' }))
    expect(contentHash({ title: 'ab', text: 'c', link: null, attachments: [] }, 'a', 'd')).not.toBe(contentHash({ title: 'a', text: 'bc', link: null, attachments: [] }, 'a', 'd'))
  })

  it('ignores the local path and mime of an attachment, which are not part of what is published', () => {
    const a = contentHash({ ...base, attachments: [{ name: 'a.png', sha256: 'aa', path: '/one', mime: 'image/png' } as never] }, 'acc', 'd')
    const b = contentHash({ ...base, attachments: [{ name: 'a.png', sha256: 'aa', path: '/two', mime: 'image/jpeg' } as never] }, 'acc', 'd')
    expect(a).toBe(b)
  })

  it('compares comment bodies ignoring line-ending and surrounding whitespace noise only', () => {
    expect(commentBodyHash('a\r\nb ')).toBe(commentBodyHash('  a\nb'))
    expect(commentBodyHash('a b')).not.toBe(commentBodyHash('a  b'))
  })
})
