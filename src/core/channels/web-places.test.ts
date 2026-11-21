// The pages the AI may open when the app cannot read a channel (DEC-045): from the channel's own address, never from a list of platforms.

import { describe, expect, it } from 'vitest'
import { webPlaces } from './web-places'

describe('webPlaces', () => {
  it('a Reddit community: the AI stays on reddit.com, and has its newest posts, its best of the week and its own search', () => {
    const places = webPlaces({ platform: 'reddit', url: 'https://www.reddit.com/r/astrology' })
    expect(places.hosts).toEqual(['reddit.com'])
    expect(places.newest).toBe('https://www.reddit.com/r/astrology/new/')
    expect(places.top).toBe('https://www.reddit.com/r/astrology/top/?t=week')
    expect(places.search('natal chart')).toBe('https://www.reddit.com/r/astrology/search/?q=natal%20chart&restrict_sr=1&sort=new')
    expect(places.search('   ')).toBeNull()
  })

  it('a Reddit address with a path after the community still names the community, and a name that is not one is not read as one', () => {
    expect(webPlaces({ platform: 'reddit', url: 'https://old.reddit.com/r/astrology/comments/abc/title/' }).newest).toBe('https://www.reddit.com/r/astrology/new/')
    expect(webPlaces({ platform: 'reddit', url: 'https://www.reddit.com/user/someone' }).newest).toBeNull()
    expect(webPlaces({ platform: 'reddit', url: 'https://www.reddit.com/r/a' }).newest).toBeNull()
  })

  it('a platform the app knows keeps its own domains and its own search, with no newest or best page of its own', () => {
    const places = webPlaces({ platform: 'instagram', url: 'https://www.instagram.com/natalmystic/' })
    expect(places.hosts).toEqual(['instagram.com'])
    expect(places.search('natal chart')).toBe('https://www.instagram.com/explore/search/keyword/?q=natal%20chart')
    expect(places.newest).toBeNull()
    expect(places.top).toBeNull()
  })

  it('any other site: the AI stays on the site of the address (without a leading www), with no search the app knows', () => {
    const places = webPlaces({ platform: 'web', url: 'https://www.forum.example.com/c/astrology' })
    expect(places).toMatchObject({ hosts: ['forum.example.com'], newest: null, top: null })
    expect(places.search('natal chart')).toBeNull()
  })

  it('an address that cannot be opened in a browser gives no place at all', () => {
    expect(webPlaces({ platform: 'web', url: 'not an address' }).hosts).toEqual([])
    expect(webPlaces({ platform: 'web', url: 'file:///etc/passwd' }).hosts).toEqual([])
    expect(webPlaces({ platform: 'web', url: 'javascript:alert(1)' }).hosts).toEqual([])
  })
})
