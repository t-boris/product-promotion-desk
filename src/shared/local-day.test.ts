import { describe, expect, it } from 'vitest'
import { dayRange, localDay } from './local-day'

describe('localDay', () => {
  it('puts a moment on the local day the offset gives it', () => {
    expect(localDay('2026-11-08T23:30:00.000Z', 0)).toBe('2026-11-08')
    expect(localDay('2026-11-08T23:30:00.000Z', 180)).toBe('2026-11-09')
    expect(localDay('2026-11-08T01:00:00.000Z', -180)).toBe('2026-11-07')
  })
  it('takes a date, a string or a number of milliseconds', () => {
    const at = '2026-11-08T12:00:00.000Z'
    expect(localDay(new Date(at), 0)).toBe('2026-11-08')
    expect(localDay(Date.parse(at), 0)).toBe('2026-11-08')
  })
  it('changes day exactly at local midnight', () => {
    expect(localDay('2026-11-08T20:59:59.999Z', 180)).toBe('2026-11-08')
    expect(localDay('2026-11-08T21:00:00.000Z', 180)).toBe('2026-11-09')
  })
})

describe('dayRange', () => {
  it('lists the days from the first to the last, both included', () => {
    expect(dayRange('2026-11-06', '2026-11-08')).toEqual(['2026-11-06', '2026-11-07', '2026-11-08'])
    expect(dayRange('2026-11-08', '2026-11-08')).toEqual(['2026-11-08'])
  })
  it('crosses a month and a year, and a leap day', () => {
    expect(dayRange('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(dayRange('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  })
  it('is empty for a backwards range or something that is not a day', () => {
    expect(dayRange('2026-11-08', '2026-11-06')).toEqual([])
    expect(dayRange('x', '2026-11-06')).toEqual([])
    expect(dayRange('2026-11-06', 'y')).toEqual([])
  })
})
