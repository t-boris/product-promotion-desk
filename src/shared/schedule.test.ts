import { describe, expect, it } from 'vitest'
import { isPostingSlot, isScheduleGraceHours, nextFreeSlot, normalizeSlots, parseSlotTime, scheduleGraceMs, slotTime } from './schedule'

// A Monday, 08:00 local time.
const monday = new Date(2026, 10, 30, 8, 0)

describe('lateness of a scheduled item', () => {
  it('accepts 1 to 48 whole hours and nothing else', () => {
    expect(isScheduleGraceHours(1)).toBe(true)
    expect(isScheduleGraceHours(48)).toBe(true)
    for (const bad of [0, 49, 1.5, '6', null, Number.NaN]) expect(isScheduleGraceHours(bad)).toBe(false)
  })

  it('reads a stored value that is not valid as six hours', () => {
    expect(scheduleGraceMs(2)).toBe(2 * 3_600_000)
    expect(scheduleGraceMs(undefined)).toBe(6 * 3_600_000)
    expect(scheduleGraceMs(1000)).toBe(6 * 3_600_000)
  })
})

describe('posting times', () => {
  it('knows a slot from what is not one', () => {
    expect(isPostingSlot({ weekday: 0, minute: 0 })).toBe(true)
    expect(isPostingSlot({ weekday: 6, minute: 1439 })).toBe(true)
    for (const bad of [{ weekday: 7, minute: 0 }, { weekday: 1, minute: 1440 }, { weekday: 1.5, minute: 0 }, { weekday: 1 }, null, 'x']) expect(isPostingSlot(bad)).toBe(false)
  })

  it('orders Monday first, by time within a day, without repeats', () => {
    expect(
      normalizeSlots([
        { weekday: 0, minute: 600 },
        { weekday: 1, minute: 900 },
        { weekday: 1, minute: 600 },
        { weekday: 1, minute: 900 }
      ])
    ).toEqual([
      { weekday: 1, minute: 600 },
      { weekday: 1, minute: 900 },
      { weekday: 0, minute: 600 }
    ])
  })

  it('writes and reads a time of day', () => {
    expect(slotTime(570)).toBe('09:30')
    expect(parseSlotTime('09:30')).toBe(570)
    expect(parseSlotTime('9:05')).toBe(545)
    for (const bad of ['24:00', '10:60', 'ten', '']) expect(parseSlotTime(bad)).toBeNull()
  })
})

describe('the next free posting time', () => {
  const slots = [
    { weekday: 1, minute: 10 * 60 },
    { weekday: 3, minute: 10 * 60 }
  ]

  it('is the first time after now', () => {
    expect(nextFreeSlot(slots, [], monday)).toEqual(new Date(2026, 10, 30, 10, 0))
  })

  it('skips a time another item of the channel holds', () => {
    const held = [new Date(2026, 10, 30, 10, 0).toISOString()]
    expect(nextFreeSlot(slots, held, monday)).toEqual(new Date(2026, 11, 2, 10, 0))
    expect(nextFreeSlot(slots, [...held, new Date(2026, 11, 2, 10, 0).toISOString()], monday)).toEqual(new Date(2026, 11, 7, 10, 0))
  })

  it('does not offer a time that is past or minutes away', () => {
    expect(nextFreeSlot(slots, [], new Date(2026, 10, 30, 9, 58))).toEqual(new Date(2026, 11, 2, 10, 0))
    expect(nextFreeSlot(slots, [], new Date(2026, 10, 30, 10, 0))).toEqual(new Date(2026, 11, 2, 10, 0))
  })

  it('has no answer for a channel without posting times, and ignores what is not a slot', () => {
    expect(nextFreeSlot([], [], monday)).toBeNull()
    expect(nextFreeSlot([{ weekday: 9, minute: 0 }], [], monday)).toBeNull()
  })

  it('takes the earliest of several times in one day', () => {
    const twice = [
      { weekday: 1, minute: 18 * 60 },
      { weekday: 1, minute: 10 * 60 }
    ]
    expect(nextFreeSlot(twice, [], monday)).toEqual(new Date(2026, 10, 30, 10, 0))
    expect(nextFreeSlot(twice, [new Date(2026, 10, 30, 10, 0).toISOString()], monday)).toEqual(new Date(2026, 10, 30, 18, 0))
  })
})
