import { describe, expect, it } from 'vitest'
import { isSessionAddress } from './session-address'

describe('isSessionAddress: an address the owner can change who is signed in with (DEC-038)', () => {
  it.each([
    'https://www.reddit.com/login/',
    'https://www.reddit.com/login?dest=https%3A%2F%2Fwww.reddit.com%2F',
    'https://www.reddit.com/logout',
    'https://www.instagram.com/accounts/login/',
    'https://www.instagram.com/accounts/logout/',
    'https://www.facebook.com/logout.php?h=abc',
    'https://www.facebook.com/login.php',
    'https://x.com/i/flow/login',
    'https://x.com/logout',
    'https://www.linkedin.com/uas/login',
    'https://www.threads.net/login',
    'https://example.com/Sign-Out',
    'https://example.com/account/switch',
    'https://example.com/oauth/authorize?client_id=1',
    'https://example.com/session?logout=1',
    'https://example.com/index.php?action=logout',
    'https://example.com/index.php?do=Login'
  ])('%s is one', (address) => {
    expect(isSessionAddress(address)).toBe(true)
    expect(isSessionAddress(address, 'request')).toBe(true)
  })

  it.each([
    'https://www.reddit.com/r/astrology/',
    'https://www.reddit.com/user/natal_bot/',
    'https://www.instagram.com/accounts/edit/',
    'https://example.com/blog/',
    'https://example.com/static/login.js.map-less',
    'https://example.com/logins-report',
    'https://example.com/api/auth',
    'https://example.com/api/auth/session',
    'https://example.com/post?next=/login',
    'https://example.com/post?login=failed',
    'https://example.com/search?q=logout',
    'https://example.com/',
    'about:blank',
    'chrome://settings/',
    'file:///login',
    'not an address'
  ])('%s is not one', (address) => {
    expect(isSessionAddress(address)).toBe(false)
  })

  it('a sign-in service is recognised by its host on a page, never from a background request', () => {
    expect(isSessionAddress('https://accounts.google.com/o/oauth2/v2/auth')).toBe(true)
    expect(isSessionAddress('https://accounts.google.com/gsi/client')).toBe(true)
    expect(isSessionAddress('https://accounts.google.com/gsi/client', 'request')).toBe(false)
    expect(isSessionAddress('https://login.microsoftonline.com/common/')).toBe(true)
    // A host with no dot is not a sign-in service.
    expect(isSessionAddress('http://login/')).toBe(false)
  })

  it('does not throw on an undecodable path', () => {
    expect(isSessionAddress('https://example.com/%E0%A4%A/logout')).toBe(true)
    expect(isSessionAddress('https://example.com/%E0%A4%A/x')).toBe(false)
  })
})
