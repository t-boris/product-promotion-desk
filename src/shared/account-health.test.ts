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

describe('the warm-up plan', () => {
  it('counts the day and the replies, and is over only with both', async () => {
    const { warmUpLine, warmUpOf } = await import('./account-health')
    const start = '2026-11-01T10:00:00.000Z'
    const at = (days: number): number => Date.parse(start) + days * 86_400_000
    expect(warmUpLine(warmUpOf(start, at(2.5), 4, 0))).toBe('Day 3 of 14 · 4 of 10 replies sent')
    expect(warmUpLine(warmUpOf(start, at(2.5), 4, 1))).toBe('Day 3 of 14 · 4 of 10 replies sent · 1 post with your site’s address already sent')
    expect(warmUpOf(start, at(20), 4, 0)).toMatchObject({ day: 14, over: false })
    expect(warmUpOf(start, at(3), 12, 0).over).toBe(false)
    expect(warmUpLine(warmUpOf(start, at(14), 12, 0))).toBe('Done: 12 replies in 14 days')
  })
})
