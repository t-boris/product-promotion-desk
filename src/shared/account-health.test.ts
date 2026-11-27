import { describe, expect, it } from 'vitest'
import { carriesOwnLink, reachOf, shareLine } from './account-health'

const n = (likes: number | null) => ({ likes, comments: null, views: null })

describe('account health: the plain rules', () => {
  it('finds the product\'s own address in the link field or in the text, and no other site\'s', () => {
    const site = 'https://www.natalmystic.app'
    expect(carriesOwnLink('Read more', 'https://natalmystic.app/blog?utm_source=reddit', site)).toBe(true)
    expect(carriesOwnLink('See natalmystic.app for the chart.', null, site)).toBe(true)
    expect(carriesOwnLink('See https://blog.NatalMystic.app/x', null, site)).toBe(true)
    expect(carriesOwnLink('See notnatalmystic.app and natalmystic.application', null, site)).toBe(false)
    expect(carriesOwnLink('No address here', 'https://reddit.com/r/x', site)).toBe(false)
    expect(carriesOwnLink('natalmystic.app', null, null)).toBe(false)
  })

  it('says the share as a count and a percentage', () => {
    expect(shareLine({ sent: 12, withLink: 3 })).toBe('3 of 12 (25%)')
    expect(shareLine({ sent: 4, withLink: 0 })).toBe('0 of 4')
    expect(shareLine({ sent: 0, withLink: 0 })).toBe('nothing sent')
  })

  it('compares the latest three posts with the ones before', () => {
    expect(reachOf([n(10), n(20), n(30), n(5), n(null), n(5)])).toMatchObject({ standing: 'unknown' })
    expect(reachOf([n(10), n(20), n(30), n(5), n(8), n(5)])).toEqual({ recent: 6, usual: 20, standing: 'fell' })
    expect(reachOf([n(10), n(20), n(30), n(40), n(20), n(30)])).toEqual({ recent: 30, usual: 20, standing: 'rose' })
    expect(reachOf([n(10), n(20), n(30), n(15), n(20), n(22)])).toMatchObject({ standing: 'usual' })
    expect(reachOf([n(0), n(0), n(0), n(0), n(0), n(0)])).toMatchObject({ standing: 'usual' })
  })
})
