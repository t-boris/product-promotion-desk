import { describe, expect, it } from 'vitest'
import { DEFAULT_CHANNEL_SETTINGS } from '../../shared/types'
import { JITTER_MAX_MIN, MINUTE_MS, jitterWindowMs, nextCheckFor } from './scheduler-timing'

const NOW = Date.parse('2026-11-15T12:00:00.000Z')
/** Each interval with how far a check of it may move either way, written out: 10 percent of the interval, at most 20 minutes. */
const WINDOWS: [intervalMin: number, windowMs: number][] = [
  [5, 30 * 1000],
  [60, 6 * 60_000],
  [180, 18 * 60_000],
  [1440, 20 * 60_000]
]
const INTERVALS = WINDOWS.map(([interval]) => interval)

const channel = (id: string, checkIntervalMin: number, lastRunAt: string | null = null) => ({
  id,
  lastRunAt,
  settings: { ...DEFAULT_CHANNEL_SETTINGS, checkIntervalMin }
})
/** How far the planned time lies from now plus the interval, in milliseconds. */
const offsetOf = (id: string, intervalMin: number, lastRunAt: string | null = null): number => Date.parse(nextCheckFor(channel(id, intervalMin, lastRunAt), NOW, true)) - (NOW + intervalMin * MINUTE_MS)
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `channel-${i}-${(i * 7919).toString(16)}`)

describe('jitterWindowMs: how far a check may move (DEC-040)', () => {
  it('is 10 percent of the interval, but never more than 20 minutes', () => {
    for (const [interval, window] of WINDOWS) expect(jitterWindowMs(interval)).toBe(window)
    expect(jitterWindowMs(200)).toBe(JITTER_MAX_MIN * MINUTE_MS)
    expect(jitterWindowMs(10_080)).toBe(20 * MINUTE_MS)
  })
})

describe('nextCheckFor: the one function that plans the next check (DEC-040)', () => {
  it('without jitter is exactly now plus the interval, for every interval', () => {
    for (const interval of INTERVALS) {
      expect(nextCheckFor(channel('c1', interval), NOW, false)).toBe(new Date(NOW + interval * MINUTE_MS).toISOString())
    }
  })

  it('moves a check by at most the window either way, for 5 minutes, an hour, 3 hours and a day', () => {
    for (const [interval, window] of WINDOWS) {
      for (const id of ids(400)) expect(Math.abs(offsetOf(id, interval))).toBeLessThanOrEqual(window)
    }
  })

  it('uses the whole window: some channels start earlier and some later, near both ends', () => {
    for (const [interval, window] of WINDOWS) {
      const offsets = ids(400).map((id) => offsetOf(id, interval))
      expect(Math.min(...offsets)).toBeLessThan(-0.8 * window)
      expect(Math.max(...offsets)).toBeGreaterThan(0.8 * window)
      expect(offsets.filter((o) => o < 0).length).toBeGreaterThan(100)
      expect(offsets.filter((o) => o > 0).length).toBeGreaterThan(100)
    }
  })

  it('gives the same time for the same channel and last run, however often it is asked', () => {
    const last = '2026-11-15T09:00:00.000Z'
    const first = nextCheckFor(channel('c1', 180, last), NOW, true)
    expect(nextCheckFor(channel('c1', 180, last), NOW, true)).toBe(first)
    expect(nextCheckFor(channel('c1', 180, last), NOW, true)).toBe(first)
    // Only the channel and its last run decide the offset: asking at another moment moves the time by exactly that much.
    expect(Date.parse(nextCheckFor(channel('c1', 180, last), NOW + 5_000, true)) - Date.parse(first)).toBe(5_000)
  })

  it('gives different channels different offsets, so they never start together', () => {
    const offsets = new Set(ids(60).map((id) => offsetOf(id, 180)))
    expect(offsets.size).toBeGreaterThan(55)
  })

  it('gives the same channel another offset after another run', () => {
    const offsets = new Set(Array.from({ length: 20 }, (_, i) => offsetOf('c1', 180, `2026-11-15T0${i % 10}:${String(i).padStart(2, '0')}:00.000Z`)))
    expect(offsets.size).toBeGreaterThan(15)
    expect(offsetOf('c1', 180, null)).not.toBe(offsetOf('c1', 180, '2026-11-15T09:00:00.000Z'))
  })

  it('is never sooner than a minute from now, however the jitter falls', () => {
    // A one-minute interval has a six-second window: without the floor about half of the channels would be planned sooner than a minute.
    const times = ids(400).map((id) => Date.parse(nextCheckFor(channel(id, 1), NOW, true)))
    expect(Math.min(...times)).toBe(NOW + MINUTE_MS)
    expect(times.filter((t) => t === NOW + MINUTE_MS).length).toBeGreaterThan(100)
    expect(Math.max(...times)).toBeGreaterThan(NOW + MINUTE_MS)
    for (const interval of [5, 60]) {
      for (const id of ids(100)) expect(Date.parse(nextCheckFor(channel(id, interval), NOW, true))).toBeGreaterThanOrEqual(NOW + MINUTE_MS)
    }
  })

  it('treats an interval below a minute (a damaged setting) as a minute', () => {
    expect(nextCheckFor(channel('c1', 0), NOW, false)).toBe(new Date(NOW + MINUTE_MS).toISOString())
    expect(nextCheckFor(channel('c1', -5), NOW, false)).toBe(new Date(NOW + MINUTE_MS).toISOString())
    expect(Date.parse(nextCheckFor(channel('c1', -5), NOW, true))).toBeGreaterThanOrEqual(NOW + MINUTE_MS)
  })

  it('plans from the interval the channel has, which is 3 hours unless the owner chose another', () => {
    expect(nextCheckFor({ id: 'c1', lastRunAt: null, settings: DEFAULT_CHANNEL_SETTINGS }, NOW, false)).toBe(new Date(NOW + 180 * MINUTE_MS).toISOString())
  })
})
