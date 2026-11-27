import { describe, expect, it } from 'vitest'
import { against, lastFullWeek, shiftWeeks, weekKey, weekLabel, weekNumbers, weekOfKey, weekStartOf, type WeekSend } from './weekly-review'

const monday = new Date(2026, 10, 23) // Monday, Nov 23, 2026
const send = (channelId: string, kind: 'post' | 'reply', week: number, numbers: WeekSend['numbers'] = null, removed = false): WeekSend => ({ channelId, kind, sentAtMs: shiftWeeks(monday, week).getTime() + 3 * 3600_000, removed, numbers })

describe('the weeks of the review', () => {
  it('start on Monday in the computer\'s own time', () => {
    expect(weekKey(weekStartOf(new Date(2026, 10, 27, 15)))).toBe('2026-11-23')
    expect(weekKey(weekStartOf(new Date(2026, 10, 29, 23, 59)))).toBe('2026-11-23')
    expect(weekKey(weekStartOf(new Date(2026, 10, 30, 0, 0)))).toBe('2026-11-30')
    expect(weekLabel(monday)).toBe('Nov 23 – Nov 29')
    expect(weekOfKey('2026-11-23')?.getTime()).toBe(monday.getTime())
    expect(weekOfKey('2026-11-24')).toBeNull()
    expect(weekOfKey('nonsense')).toBeNull()
  })

  it('the week that ended is due from Monday 9:00', () => {
    expect(lastFullWeek(new Date(2026, 10, 30, 8, 59))).toMatchObject({ due: false })
    const week = lastFullWeek(new Date(2026, 10, 30, 9, 0))
    expect(week.due).toBe(true)
    expect(weekKey(week.start)).toBe('2026-11-23')
    expect(lastFullWeek(new Date(2026, 11, 3, 12)).due).toBe(true)
  })
})

describe('the numbers of a week', () => {
  it('counts posts, replies, removals and what the sites showed, and never makes a zero of an unread number', () => {
    const numbers = weekNumbers(
      [
        send('a', 'post', 0, { likes: 40, comments: 6, views: null }),
        send('a', 'post', 0, null),
        send('a', 'reply', 0),
        send('b', 'post', 0, null, true),
        send('a', 'post', 1, { likes: 99, comments: 9, views: 9 })
      ],
      monday
    )
    expect(numbers.week).toEqual({ posts: 3, replies: 1, removed: 1, likes: 40, comments: 6, views: null, read: 1 })
    expect(numbers.channels.map((c) => [c.channelId, c.week.posts, c.week.likes])).toEqual([['a', 2, 40], ['b', 1, null]])
  })

  it('compares with the average week of the four before, and has no usual when those weeks are empty', () => {
    const numbers = weekNumbers(
      [send('a', 'post', 0, { likes: 40, comments: 6, views: null }), send('a', 'post', -1, { likes: 10, comments: 2, views: null }), send('a', 'post', -3, { likes: 30, comments: null, views: null }), send('a', 'reply', -4), send('a', 'post', -5, { likes: 500, comments: 1, views: null })],
      monday
    )
    expect(numbers.usual).toMatchObject({ posts: 0.5, replies: 0.3, likes: 10, comments: 0.5, views: null })
    expect(numbers.before.posts).toBe(1)
    expect(weekNumbers([send('a', 'post', 0)], monday).usual).toEqual({ posts: null, replies: null, likes: null, comments: null, views: null, removed: null })
  })

  it('says up or down only for a difference of a fifth or more', () => {
    expect(against(61, 22)).toBe('up')
    expect(against(10, 22)).toBe('down')
    expect(against(23, 22)).toBe('same')
    expect(against(2, 0)).toBe('up')
    expect(against(null, 22)).toBeNull()
    expect(against(5, null)).toBeNull()
  })
})
