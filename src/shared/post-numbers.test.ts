import { describe, expect, it } from 'vitest'
import { NO_NUMBERS, numbersDue, numbersLine, shortCount } from './post-numbers'

const H = 3_600_000
describe('the numbers under a sent post', () => {
  it('are read after the first minutes, hourly in the first day, four times a day in the first week, daily for a month', () => {
    const sent = 1_000_000_000_000
    expect(numbersDue(sent, null, sent + 5 * 60_000)).toBe(false)
    expect(numbersDue(sent, null, sent + 20 * 60_000)).toBe(true)
    expect(numbersDue(sent, sent + H, sent + H + 30 * 60_000)).toBe(false)
    expect(numbersDue(sent, sent + H, sent + 2 * H)).toBe(true)
    expect(numbersDue(sent, sent + 48 * H, sent + 50 * H)).toBe(false)
    expect(numbersDue(sent, sent + 48 * H, sent + 54 * H)).toBe(true)
    expect(numbersDue(sent, sent + 10 * 24 * H, sent + 10 * 24 * H + 23 * H)).toBe(false)
    expect(numbersDue(sent, sent + 10 * 24 * H, sent + 11 * 24 * H)).toBe(true)
    expect(numbersDue(sent, null, sent + 31 * 24 * H)).toBe(false)
  })

  it('are said in the platform\'s words, and one the site does not show is left out, never a zero', () => {
    expect(numbersLine('reddit', { likes: 84, comments: 12, views: null })).toBe('84 points · 12 comments')
    expect(numbersLine('instagram', { likes: 1, comments: 1, views: 15_300 })).toBe('15k views · 1 like · 1 comment')
    expect(numbersLine('reddit', { likes: 0, comments: null, views: null })).toBe('0 points')
    expect(numbersLine('reddit', NO_NUMBERS)).toBeNull()
    expect([shortCount(999), shortCount(1200), shortCount(2_500_000)]).toEqual(['999', '1.2k', '2.5M'])
  })
})
