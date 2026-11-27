import { describe, expect, it } from 'vitest'
import { daysLeft, endOfDay, goalState, isDay, progressLine } from './goal-target'

describe('a goal with a number and a date', () => {
  it('takes only a real day', () => {
    expect(isDay('2026-12-31')).toBe(true)
    expect(isDay('2026-02-30')).toBe(false)
    expect(isDay('31.12.2026')).toBe(false)
  })

  it('is running until its day ends, reached at its number, missed after', () => {
    const noon = new Date(2026, 11, 30, 12).getTime()
    expect(endOfDay('2026-12-31')).toBe(new Date(2027, 0, 1).getTime())
    expect(goalState(12, 40, noon, '2026-12-31')).toBe('running')
    expect(goalState(40, 40, noon, '2026-12-31')).toBe('reached')
    expect(goalState(12, 40, endOfDay('2026-12-31'), '2026-12-31')).toBe('missed')
    expect(goalState(41, 40, endOfDay('2026-12-31') + 1, '2026-12-31')).toBe('reached')
    expect(daysLeft(noon, '2026-12-31')).toBe(2)
    expect(daysLeft(endOfDay('2026-12-31'), '2026-12-31')).toBe(0)
  })

  it('says how far it is in one line', () => {
    expect(progressLine({ count: 12, number: 40, measure: 'comments', state: 'running', daysLeft: 18, by: '2026-12-31' })).toBe('12 of 40 comments received · 18 days left')
    expect(progressLine({ count: 12, number: 40, measure: 'posts', state: 'running', daysLeft: 1, by: '2026-12-31' })).toBe('12 of 40 posts sent · the last day')
    expect(progressLine({ count: 41, number: 40, measure: 'likes', state: 'reached', daysLeft: 3, by: '2026-12-31' })).toBe('Reached: 41 of 40 points and likes')
    expect(progressLine({ count: 2, number: 5, measure: 'people', state: 'missed', daysLeft: 0, by: '2026-12-31' })).toBe('Not reached: 2 of 5 people met by 2026-12-31')
  })
})
