import { describe, expect, it } from 'vitest'
import { graceChoices } from '../shared/schedule'
import { addTimes, removeTime, sameSlots, timesLine, weekRows } from '../renderer/src/pages/channels/posting-times'
import { scheduleHint } from '../renderer/src/pages/review/schedule-words'

describe('Posting times card', () => {
  const slots = [
    { weekday: 0, minute: 600 },
    { weekday: 1, minute: 1080 },
    { weekday: 1, minute: 600 }
  ]

  it('shows the week Monday first, only the days that have times, each in order', () => {
    expect(weekRows(slots)).toEqual([
      { weekday: 1, name: 'Monday', times: [{ minute: 600, label: '10:00' }, { minute: 1080, label: '18:00' }] },
      { weekday: 0, name: 'Sunday', times: [{ minute: 600, label: '10:00' }] }
    ])
    expect(weekRows([])).toEqual([])
  })

  it('adds one time to every chosen day, once, and says what is missing', () => {
    expect(addTimes([], [], '10:00')).toEqual({ ok: false, error: 'Choose at least one day.' })
    expect(addTimes([], [1], 'ten')).toEqual({ ok: false, error: 'Enter the time as HH:MM.' })
    const added = addTimes(slots, [1, 3], '10:00')
    expect(added).toEqual({ ok: true, slots: [{ weekday: 1, minute: 600 }, { weekday: 1, minute: 1080 }, { weekday: 3, minute: 600 }, { weekday: 0, minute: 600 }] })
  })

  it('refuses more times than a channel may have', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ weekday: i % 7, minute: Math.floor(i / 7) * 60 }))
    expect(addTimes(many, [0], '23:59')).toMatchObject({ ok: false, error: expect.stringMatching(/at most 50/) })
  })

  it('removes exactly one time and knows the same set in another order', () => {
    expect(removeTime(slots, 1, 600)).toEqual([{ weekday: 1, minute: 1080 }, { weekday: 0, minute: 600 }])
    expect(sameSlots(slots, [...slots].reverse())).toBe(true)
    expect(sameSlots(slots, removeTime(slots, 0, 600))).toBe(false)
  })

  it('counts the times in words', () => {
    expect(timesLine(1)).toBe('1 time a week')
    expect(timesLine(3)).toBe('3 times a week')
    expect(timesLine(0)).toMatch(/No posting times yet/)
  })
})

describe('Send at', () => {
  it('says that a time needs an approval given before it, and that the Mac must be awake', () => {
    expect(scheduleHint(false)).toMatch(/only if you approve it before that time.*Mac must be awake/)
    expect(scheduleHint(true)).toMatch(/Approved.*by itself.*Mac must be awake/)
  })
})

describe('Lateness choices', () => {
  it('offers the known limits and keeps a stored one that is not among them', () => {
    expect(graceChoices(6).map((c) => c.hours)).toEqual([1, 2, 3, 6, 12, 24, 48])
    expect(graceChoices(5).map((c) => c.hours)).toEqual([1, 2, 3, 5, 6, 12, 24, 48])
    expect(graceChoices(1)[0]).toEqual({ hours: 1, label: '1 hour' })
  })
})
