import { describe, expect, it } from 'vitest'
import { cleanUserAgent, isAbortedNavigation, normalizeBrowserUrl, persistentPartition } from './targets'

describe('browser address normalization', () => {
  it('accepts http(s) addresses and adds https to bare hosts', () => {
    expect(normalizeBrowserUrl('https://www.reddit.com/login/')).toBe('https://www.reddit.com/login/')
    expect(normalizeBrowserUrl('  reddit.com/r/astrology ')).toBe('https://reddit.com/r/astrology')
    expect(normalizeBrowserUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x')
  })

  it.each(['javascript:alert(1)', 'data:text/html,<b>x', 'file:///etc/passwd', 'ftp://example.com/', 'chrome://settings', 'about:blank', 'blob:https://x/1', '', '   '])(
    'refuses %j',
    (input) => {
      expect(() => normalizeBrowserUrl(input)).toThrow()
    }
  )

  it('refuses addresses with embedded credentials: passwords are typed on the site only', () => {
    expect(() => normalizeBrowserUrl('https://me:hunter2@example.com/')).toThrow(/credentials/)
    expect(() => normalizeBrowserUrl('https://me@example.com/')).toThrow(/credentials/)
  })
})

describe('persistent partitions', () => {
  it('adds the persist: prefix consistently and is idempotent', () => {
    expect(persistentPartition('ppd-account-1')).toBe('persist:ppd-account-1')
    expect(persistentPartition('persist:ppd-account-1')).toBe('persist:ppd-account-1')
    expect(persistentPartition(persistentPartition('x1'))).toBe('persist:x1')
  })

  it('refuses names that could escape or be empty', () => {
    expect(() => persistentPartition('')).toThrow()
    expect(() => persistentPartition('persist:')).toThrow()
    expect(() => persistentPartition('persist:../../etc')).toThrow()
    expect(() => persistentPartition('a b')).toThrow()
  })
})

describe('user agent', () => {
  const electronUa =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) product-promotion-desk/0.1.0 Chrome/140.0.0.0 Electron/45.2.3 Safari/537.36'

  it('presents plain Chromium: no Electron or application tokens', () => {
    expect(cleanUserAgent(electronUa)).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
  })

  it('leaves a normal Chrome user agent unchanged', () => {
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    expect(cleanUserAgent(chrome)).toBe(chrome)
  })
})

describe('navigation errors', () => {
  it('recognizes an aborted navigation caused by a redirect', () => {
    expect(isAbortedNavigation(new Error("ERR_ABORTED (-3) loading 'https://x/'"))).toBe(true)
    expect(isAbortedNavigation(new Error('ERR_NAME_NOT_RESOLVED (-105) loading'))).toBe(false)
  })
})
