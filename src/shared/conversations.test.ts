import { describe, expect, it } from 'vitest'
import { tookOff, usualOf, waitedNote } from './conversations'

const n = (likes: number | null, comments: number | null) => ({ likes, comments, views: null })

describe('conversations: the plain rules', () => {
  it('knows a channel\'s usual only from three earlier posts, each number from the posts that have it', () => {
    expect(usualOf([n(1, 1), n(2, 2)])).toBeNull()
    expect(usualOf([n(10, 2), n(20, null), n(30, 4)])).toEqual({ likes: 20, comments: 3 })
    expect(usualOf([n(null, null), n(null, null), n(null, null)])).toEqual({ likes: null, comments: null })
  })

  it('says a post took off when a number is at least twice the usual and above the floor', () => {
    const usual = { likes: 20, comments: 3 }
    expect(tookOff(n(48, 4), usual)).toEqual({ likes: true, comments: false })
    expect(tookOff(n(30, 6), usual)).toEqual({ likes: false, comments: true })
    expect(tookOff(n(39, 5), { likes: 20, comments: 3 })).toBeNull()
    expect(tookOff(n(9, 4), { likes: 2, comments: 1 })).toBeNull()
    expect(tookOff(n(100, 100), null)).toBeNull()
    expect(tookOff(n(null, null), usual)).toBeNull()
    expect(tookOff(n(100, null), { likes: null, comments: null })).toBeNull()
  })

  it('notes how long a comment to the account has waited', () => {
    const hour = 3_600_000
    expect(waitedNote(11 * hour)).toBe('')
    expect(waitedNote(31.5 * hour)).toBe('Has waited 31 hours: an answer within two days is the one that is read. ')
    expect(waitedNote(75 * hour)).toBe('Has waited 3 days: an answer this late is rarely read. ')
  })
})
