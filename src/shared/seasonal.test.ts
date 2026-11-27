import { describe, expect, it } from 'vitest'
import { daysUntil, dueNow, easter, eventsBetween, giftDates, leadDays, moonPhaseMs, sunLongitude } from './seasonal'

const HOUR = 3600_000
const near = (ms: number, iso: string, withinMs: number): void => expect(Math.abs(ms - Date.parse(iso)), `${new Date(ms).toISOString()} vs ${iso}`).toBeLessThan(withinMs)

describe('the computed dates', () => {
  it('new and full moons fall where the almanac puts them', () => {
    // Meeus, example 49.a: the new moon of 1977 February 18, 03:37:42 TD (k = -283).
    near(moonPhaseMs(-283, 0), '1977-02-18T03:37:00.000Z', 0.5 * HOUR)
    // The first new moon of 2000: January 6, 18:14 UT; the full moon after it: January 21, 04:40 UT.
    near(moonPhaseMs(0, 0), '2000-01-06T18:14:00.000Z', 0.5 * HOUR)
    near(moonPhaseMs(0, 0.5), '2000-01-21T04:40:00.000Z', 0.5 * HOUR)
  })

  it('the Sun reaches the turning points of the year on time', () => {
    // March equinox 2000: March 20, 07:35 UT. June solstice 2000: June 21, 01:48 UT. December solstice 2000: December 21, 13:37 UT.
    const off = (iso: string, degrees: number): number => Math.abs(((sunLongitude(Date.parse(iso)) - degrees + 540) % 360) - 180)
    expect(off('2000-03-20T07:35:00.000Z', 0)).toBeLessThan(0.02)
    expect(off('2000-06-21T01:48:00.000Z', 90)).toBeLessThan(0.02)
    expect(off('2000-12-21T13:37:00.000Z', 270)).toBeLessThan(0.02)
  })

  it('lists the events of the chosen calendars in order, each with a stable key', () => {
    const from = Date.parse('2000-03-01T00:00:00.000Z')
    const to = Date.parse('2000-04-25T00:00:00.000Z')
    const events = eventsBetween(['moon', 'zodiac', 'seasons'], [], from, to)
    expect(events.map((e) => e.name)).toEqual(['New Moon', 'Full Moon', 'March equinox', 'Sun enters Aries', 'New Moon', 'Full Moon', 'Sun enters Taurus'])
    near(events.find((e) => e.name === 'March equinox')!.atMs, '2000-03-20T07:35:00.000Z', HOUR)
    near(events[0]!.atMs, '2000-03-06T05:17:00.000Z', HOUR)
    near(events.at(-1)!.atMs, '2000-04-19T18:40:00.000Z', HOUR)
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length)
    expect(eventsBetween([], [], from, to)).toEqual([])
  })
})

describe('the listed dates', () => {
  it('gift dates follow their rules', () => {
    const of = (year: number, id: string): string => {
      const g = giftDates(year).find((d) => d.id === id)!
      return `${g.month}/${g.day}`
    }
    expect(of(2026, 'mothers-day')).toBe('5/10')
    expect(of(2026, 'fathers-day')).toBe('6/21')
    expect(of(2026, 'thanksgiving')).toBe('11/26')
    expect(of(2026, 'black-friday')).toBe('11/27')
    expect(of(2026, 'cyber-monday')).toBe('11/30')
    expect(of(2027, 'thanksgiving')).toBe('11/25')
    expect(easter(2026)).toEqual({ month: 4, day: 5 })
    expect(easter(2027)).toEqual({ month: 3, day: 28 })
  })

  it('the owner\'s dates come every year or once, and a date across the new year is found', () => {
    const from = new Date(2026, 11, 1).getTime()
    const to = new Date(2027, 1, 20).getTime()
    const own = [{ id: 'a', name: 'Shop birthday', month: 1, day: 15, year: null }, { id: 'b', name: 'Fair', month: 12, day: 12, year: 2026 }, { id: 'c', name: 'Old fair', month: 12, day: 13, year: 2025 }]
    const events = eventsBetween(['gifts'], own, from, to)
    expect(events.map((e) => e.key)).toEqual(['own:b:2026', 'gift:christmas:2026', 'gift:new-year:2027', 'own:a:2027', 'gift:valentines:2027'])
  })

  it('says when it is time to prepare: weeks ahead for a search-like surface, days ahead for a feed', () => {
    const now = new Date(2026, 10, 27, 15).getTime()
    const christmas = new Date(2026, 11, 25, 12).getTime()
    expect(daysUntil(christmas, now)).toBe(28)
    expect(leadDays('pinterest')).toBe(35)
    expect(dueNow(christmas, now, 'pinterest')).toBe(true)
    expect(dueNow(christmas, now, 'reddit')).toBe(false)
    expect(dueNow(new Date(2026, 11, 2, 12).getTime(), now, 'reddit')).toBe(true)
    expect(dueNow(new Date(2026, 10, 26, 12).getTime(), now, 'reddit')).toBe(false)
  })
})
