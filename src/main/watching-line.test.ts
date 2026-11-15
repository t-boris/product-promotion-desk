// The watching line (DEC-040) lives in src/renderer/src/pages/feed/watching-line.ts: the Feed's header, the channel's status card and an
// Overview tile all say it. It is pure and imports only src/shared types, so it is tested here (the renderer has no runner of its own).
// Every moment below is given with an explicit zone (UTC+1, UTC-5 ...), so the tests read the same wherever they run.

import { describe, expect, it } from 'vitest'
import type { ChannelStatus } from '../shared/types'
import { FAILURE_DETAIL_PREFIX } from '../shared/types'
import { NOT_READ_LINE, clockTime, failureReason, intervalWords, isWatchable, isWatchedInBrowser, productWatching, watchingLine, type WatchedChannel, type WatchingContext } from '../renderer/src/pages/feed/watching-line'

// Sunday 15 Nov 2026, 12:00 UTC = 13:00 in UTC+1.
const NOW = new Date('2026-11-15T12:00:00.000Z')
const ctx = (over: Partial<WatchingContext> = {}): WatchingContext => ({ now: NOW, automationPaused: false, offsetAt: () => 60, ...over })

function channel(over: Partial<WatchedChannel> & { checkIntervalMin?: number } = {}): WatchedChannel {
  const { checkIntervalMin = 180, ...rest } = over
  return { status: 'active', statusDetail: '', reads: true, watchedInBrowser: false, lastRunAt: '2026-11-15T09:05:00.000Z', nextCheckAt: '2026-11-15T13:12:00.000Z', settings: { checkIntervalMin }, ...rest }
}

describe('intervalWords', () => {
  it('says whole hours as "~N h", a whole day as "once a day", anything else in minutes', () => {
    expect(intervalWords(180)).toBe('every ~3 h')
    expect(intervalWords(60)).toBe('every ~1 h')
    expect(intervalWords(120)).toBe('every ~2 h')
    expect(intervalWords(1440)).toBe('once a day')
    expect(intervalWords(45)).toBe('every ~45 min')
    expect(intervalWords(30)).toBe('every ~30 min')
    expect(intervalWords(90)).toBe('every ~90 min')
    expect(intervalWords(61)).toBe('every ~61 min')
    expect(intervalWords(5)).toBe('every ~5 min')
  })

  it('keeps to hours for a longer interval, and to a day only for exactly one', () => {
    expect(intervalWords(2880)).toBe('every ~48 h')
    expect(intervalWords(1500)).toBe('every ~25 h')
    expect(intervalWords(10080)).toBe('every ~168 h')
  })

  it('says nothing for a number that is no interval', () => {
    expect(intervalWords(0)).toBeNull()
    expect(intervalWords(-30)).toBeNull()
    expect(intervalWords(0.4)).toBeNull()
    expect(intervalWords(Number.NaN)).toBeNull()
    expect(intervalWords(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('clockTime', () => {
  it('writes a time of today as a 24 hour clock in the owner\'s zone, two digits each', () => {
    expect(clockTime('2026-11-15T09:05:00.000Z', ctx())).toBe('10:05')
    expect(clockTime('2026-11-15T12:00:00.000Z', ctx())).toBe('13:00')
    expect(clockTime('2026-11-15T00:00:00.000Z', ctx({ offsetAt: () => 0 }))).toBe('00:00')
    expect(clockTime('2026-11-15T23:59:00.000Z', ctx({ offsetAt: () => 0 }))).toBe('23:59')
  })

  it('reads the day in the owner\'s zone, not in UTC', () => {
    // 23:30 UTC is already Monday 01:30 two hours east, and still Sunday evening five hours west.
    expect(clockTime('2026-11-15T23:30:00.000Z', ctx({ offsetAt: () => 120 }))).toBe('Mon 01:30')
    expect(clockTime('2026-11-15T23:30:00.000Z', ctx({ offsetAt: () => -300 }))).toBe('18:30')
    // The same instant is "today" for the one who lives west of it and "tomorrow" for the one east.
    expect(clockTime('2026-11-16T03:00:00.000Z', ctx({ offsetAt: () => -300 }))).toBe('22:00')
  })

  it('adds the weekday for another day of the last or next six', () => {
    expect(clockTime('2026-11-16T07:00:00.000Z', ctx())).toBe('Mon 08:00')
    expect(clockTime('2026-11-14T20:15:00.000Z', ctx())).toBe('Sat 21:15')
    expect(clockTime('2026-11-21T10:00:00.000Z', ctx())).toBe('Sat 11:00')
    expect(clockTime('2026-11-09T10:00:00.000Z', ctx())).toBe('Mon 11:00')
  })

  it('adds the date from the seventh day on, and the year when it is not this one', () => {
    expect(clockTime('2026-11-22T10:00:00.000Z', ctx())).toBe('Nov 22, 11:00')
    expect(clockTime('2026-11-08T10:00:00.000Z', ctx())).toBe('Nov 8, 11:00')
    expect(clockTime('2027-01-05T10:00:00.000Z', ctx())).toBe('Jan 5 2027, 11:00')
    expect(clockTime('2025-12-31T10:00:00.000Z', ctx())).toBe('Dec 31 2025, 11:00')
  })

  it('is empty for a moment that cannot be read', () => {
    expect(clockTime('not a time', ctx())).toBe('')
    expect(clockTime('', ctx())).toBe('')
  })
})

describe('watchingLine: a channel that is watched', () => {
  it('says how often, when it was last looked at and when it is next', () => {
    const line = watchingLine(channel(), ctx())
    expect(line).toEqual({ kind: 'watching', watching: true, text: 'Watching every ~3 h · last 10:05 · next ≈14:12', schedule: 'Every ~3 h' })
  })

  it('writes the other intervals the same way', () => {
    expect(watchingLine(channel({ checkIntervalMin: 60 }), ctx()).text).toBe('Watching every ~1 h · last 10:05 · next ≈14:12')
    expect(watchingLine(channel({ checkIntervalMin: 45 }), ctx()).text).toBe('Watching every ~45 min · last 10:05 · next ≈14:12')
    const daily = watchingLine(channel({ checkIntervalMin: 1440 }), ctx())
    expect(daily.text).toBe('Watching once a day · last 10:05 · next ≈14:12')
    expect(daily.schedule).toBe('Once a day')
  })

  it('says "never" before the first run and "soon" for a next check that is due, overdue or not set', () => {
    expect(watchingLine(channel({ lastRunAt: null }), ctx()).text).toBe('Watching every ~3 h · last never · next ≈14:12')
    expect(watchingLine(channel({ nextCheckAt: null }), ctx()).text).toBe('Watching every ~3 h · last 10:05 · next soon')
    expect(watchingLine(channel({ nextCheckAt: '2026-11-15T11:00:00.000Z' }), ctx()).text).toBe('Watching every ~3 h · last 10:05 · next soon')
    // Due this very moment is not still to come.
    expect(watchingLine(channel({ nextCheckAt: NOW.toISOString() }), ctx()).text).toBe('Watching every ~3 h · last 10:05 · next soon')
    expect(watchingLine(channel({ lastRunAt: null, nextCheckAt: null }), ctx()).text).toBe('Watching every ~3 h · last never · next soon')
  })

  it('does not make up a time for a moment it cannot read', () => {
    expect(watchingLine(channel({ lastRunAt: 'garbage', nextCheckAt: 'garbage' }), ctx()).text).toBe('Watching every ~3 h · last never · next soon')
  })

  it('adds the weekday or the date to a time that is not today', () => {
    const line = watchingLine(channel({ checkIntervalMin: 1440, lastRunAt: '2026-11-14T20:15:00.000Z', nextCheckAt: '2026-11-16T07:00:00.000Z' }), ctx())
    expect(line.text).toBe('Watching once a day · last Sat 21:15 · next ≈Mon 08:00')
    const far = watchingLine(channel({ nextCheckAt: '2026-12-02T09:00:00.000Z' }), ctx())
    expect(far.text).toBe('Watching every ~3 h · last 10:05 · next ≈Dec 2, 10:00')
  })

  it('leaves the how-often out for an interval it cannot say, and keeps the rest', () => {
    const line = watchingLine(channel({ checkIntervalMin: 0 }), ctx())
    expect(line.text).toBe('Watching · last 10:05 · next ≈14:12')
    expect(line.schedule).toBe('On a schedule')
  })

  it('says a channel failing under the scheduler\'s backoff failed, and when it is retried: its "last" would be a failed attempt', () => {
    const line = watchingLine(channel({ statusDetail: 'Last check failed (2 times in a row): timeout. Retrying in 10 min.', nextCheckAt: '2026-11-15T12:10:00.000Z' }), ctx())
    expect(line.kind).toBe('error')
    expect(line.text).toBe('Last check failed · timeout · retrying ≈13:10')
  })
})

describe('watchingLine: a channel that is not watched', () => {
  it('says the app does not read a channel for the owner\'s own posts, whatever else is true', () => {
    for (const status of ['setup', 'active', 'paused', 'needs_user', 'error'] as ChannelStatus[]) {
      const line = watchingLine(channel({ reads: false, status }), ctx({ automationPaused: true }))
      expect(line).toEqual({ kind: 'not_read', watching: false, text: 'The app does not read this channel', schedule: 'The app does not read this channel' })
    }
    expect(NOT_READ_LINE).toBe('The app does not read this channel')
  })

  it('says a channel still being set up is not watched yet, before automation or anything else', () => {
    const line = watchingLine(channel({ status: 'setup', lastRunAt: null, nextCheckAt: null }), ctx({ automationPaused: true }))
    expect(line.kind).toBe('setup')
    expect(line.watching).toBe(false)
    expect(line.text).toBe('Not watching yet: the channel is still being set up')
  })

  it('says automation is paused for every channel the app reads and that is set up, whatever its own state', () => {
    for (const status of ['active', 'paused', 'needs_user', 'error'] as ChannelStatus[]) {
      const line = watchingLine(channel({ status, statusDetail: 'something' }), ctx({ automationPaused: true }))
      expect(line).toEqual({ kind: 'automation_paused', watching: false, text: 'Not watching: automation is paused', schedule: 'Not watching: automation is paused' })
    }
  })

  it('says a paused channel is paused', () => {
    const line = watchingLine(channel({ status: 'paused' }), ctx())
    expect(line.kind).toBe('channel_paused')
    expect(line.text).toBe('Not watching: this channel is paused')
  })

  it('says what the owner has to do, in the channel\'s own words', () => {
    const line = watchingLine(channel({ status: 'needs_user', statusDetail: ' The sign-in expired. ' }), ctx())
    expect(line.kind).toBe('needs_you')
    expect(line.watching).toBe(false)
    expect(line.text).toBe('Not watching: needs you · The sign-in expired.')
    expect(watchingLine(channel({ status: 'needs_user', statusDetail: '' }), ctx()).text).toBe('Not watching: needs you')
  })

  it('says a failed check failed, why, and when it is retried', () => {
    const failed = (over: Partial<WatchedChannel>): string => watchingLine(channel({ status: 'error', ...over }), ctx()).text
    expect(failed({ statusDetail: 'Reddit answered 429', nextCheckAt: '2026-11-15T13:30:00.000Z' })).toBe('Last check failed · Reddit answered 429 · retrying ≈14:30')
    expect(failed({ statusDetail: '', nextCheckAt: '2026-11-15T13:30:00.000Z' })).toBe('Last check failed · retrying ≈14:30')
    expect(failed({ statusDetail: 'Reddit answered 429', nextCheckAt: null })).toBe('Last check failed · Reddit answered 429 · retrying soon')
    expect(failed({ nextCheckAt: '2026-11-15T11:00:00.000Z' })).toBe('Last check failed · retrying soon')
    expect(watchingLine(channel({ status: 'error' }), ctx())).toMatchObject({ kind: 'error', watching: false })
  })

  describe('the words the scheduler really writes (FAILURE_DETAIL_PREFIX)', () => {
    const REAL = `${FAILURE_DETAIL_PREFIX} (3 times in a row): Reading the channel failed: HTTP 503. Retrying in 20 min.`

    it('keeps the reason once: not the prefix, not the count, not the retry sentence the line says itself', () => {
      expect(failureReason(REAL)).toBe('Reading the channel failed: HTTP 503')
      expect(failureReason(`${FAILURE_DETAIL_PREFIX} (1 time in a row): Timed out.. Retrying in 10 min.`)).toBe('Timed out')
      expect(failureReason(`${FAILURE_DETAIL_PREFIX}: nothing more`)).toBe('nothing more')
      expect(failureReason(FAILURE_DETAIL_PREFIX)).toBe('')
      expect(failureReason('')).toBe('')
      // A text of another shape stays as it is.
      expect(failureReason('Reddit answered 429')).toBe('Reddit answered 429')
    })

    it('says "Last check failed" once, with the reason and the time of the retry', () => {
      const line = watchingLine(channel({ status: 'error', statusDetail: REAL, nextCheckAt: '2026-11-15T13:20:00.000Z' }), ctx())
      expect(line.text).toBe('Last check failed · Reading the channel failed: HTTP 503 · retrying ≈14:20')
      expect(line.text.match(/Last check failed/g)).toHaveLength(1)
      expect(line.text).not.toContain('Retrying in')
    })

    it('does not say "Watching" for a channel that is still active but whose last check failed (a timeout leaves it active)', () => {
      const line = watchingLine(channel({ status: 'active', statusDetail: REAL, lastRunAt: '2026-11-15T11:40:00.000Z', nextCheckAt: '2026-11-15T13:20:00.000Z' }), ctx())
      expect(line).toMatchObject({ kind: 'error', watching: false })
      expect(line.text).toBe('Last check failed · Reading the channel failed: HTTP 503 · retrying ≈14:20')
      expect(line.text).not.toContain('last 12:40')
    })

    it('an active channel with any other detail (the identity note) is still watched', () => {
      expect(watchingLine(channel({ statusDetail: 'The account identity is unknown, so nothing is queued.' }), ctx())).toMatchObject({ kind: 'watching', watching: true })
    })

    it('counts such a channel as failing in the line of a product', () => {
      expect(productWatching([channel({ statusDetail: REAL }), channel({ status: 'paused' })], ctx())?.text).toBe('Not watching any channel: 1 paused, 1 failing')
    })
  })

  it('never says "watching" for a channel that is not, and never shows a time it has not got', () => {
    const states: ChannelStatus[] = ['setup', 'paused', 'needs_user', 'error']
    for (const status of states) {
      const line = watchingLine(channel({ status, lastRunAt: null, nextCheckAt: null }), ctx())
      expect(line.watching).toBe(false)
      expect(line.text).not.toMatch(/^Watching/)
      expect(line.text).not.toContain('≈')
    }
  })
})

describe('productWatching', () => {
  const at = (iso: string): Partial<WatchedChannel> => ({ nextCheckAt: iso })

  it('says nothing when the app reads no channel of the product', () => {
    expect(productWatching([], ctx())).toBeNull()
    expect(productWatching([channel({ reads: false })], ctx())).toBeNull()
  })

  it('is the channel\'s own line for one channel the app reads, and ignores the channels it does not read', () => {
    expect(productWatching([channel()], ctx())).toEqual({ watching: true, text: 'Watching every ~3 h · last 10:05 · next ≈14:12' })
    expect(productWatching([channel({ reads: false }), channel(), channel({ reads: false })], ctx())).toEqual({ watching: true, text: 'Watching every ~3 h · last 10:05 · next ≈14:12' })
    expect(productWatching([channel({ status: 'paused' })], ctx())).toEqual({ watching: false, text: 'Not watching: this channel is paused' })
  })

  it('counts the channels and gives the soonest next check among them', () => {
    const summary = productWatching([channel(at('2026-11-15T15:00:00.000Z')), channel(at('2026-11-15T13:12:00.000Z')), channel(at('2026-11-16T07:00:00.000Z'))], ctx())
    expect(summary).toEqual({ watching: true, text: 'Watching 3 channels · next ≈14:12' })
  })

  it('says "next soon" when a watched channel is due, as the soonest there is', () => {
    expect(productWatching([channel(at('2026-11-15T15:00:00.000Z')), channel({ nextCheckAt: null })], ctx())?.text).toBe('Watching 2 channels · next soon')
    expect(productWatching([channel(at('2026-11-15T15:00:00.000Z')), channel(at('2026-11-15T10:00:00.000Z'))], ctx())?.text).toBe('Watching 2 channels · next soon')
  })

  it('counts only the channels that are watched, and says how many there are', () => {
    const summary = productWatching([channel(at('2026-11-15T15:00:00.000Z')), channel({ status: 'paused', ...at('2026-11-15T13:00:00.000Z') }), channel(at('2026-11-15T13:30:00.000Z'))], ctx())
    // The paused channel's own next time is not the product's next.
    expect(summary).toEqual({ watching: true, text: 'Watching 2 of 3 channels · next ≈14:30' })
    expect(productWatching([channel(), channel({ status: 'error' })], ctx())?.text).toBe('Watching 1 of 2 channels · next ≈14:12')
  })

  it('does not count a channel the app does not read as one of the product\'s channels', () => {
    expect(productWatching([channel(), channel(), channel({ reads: false })], ctx())?.text).toBe('Watching 2 channels · next ≈14:12')
  })

  it('says paused automation as it is', () => {
    expect(productWatching([channel(), channel()], ctx({ automationPaused: true }))).toEqual({ watching: false, text: 'Not watching: automation is paused' })
    expect(productWatching([channel(), channel({ status: 'setup' })], ctx({ automationPaused: true }))).toEqual({ watching: false, text: 'Not watching: automation is paused' })
  })

  it('says what stops the channels when none is watched', () => {
    expect(productWatching([channel({ status: 'paused' }), channel({ status: 'paused' })], ctx())).toEqual({ watching: false, text: 'Not watching any channel: 2 paused' })
    expect(productWatching([channel({ status: 'paused' }), channel({ status: 'needs_user' }), channel({ status: 'error' }), channel({ status: 'setup' })], ctx())?.text).toBe(
      'Not watching any channel: 1 paused, 1 needs you, 1 failing, 1 being set up'
    )
    expect(productWatching([channel({ status: 'needs_user' }), channel({ status: 'needs_user' })], ctx())?.text).toBe('Not watching any channel: 2 need you')
  })
})

// A channel the app has no connector for may be watched in the account's browser by the AI (DEC-042): the same schedule, said as such.
describe('a channel watched in the browser (DEC-042)', () => {
  const browser = (over: Partial<WatchedChannel> & { checkIntervalMin?: number } = {}): WatchedChannel => channel({ reads: false, watchedInBrowser: true, ...over })

  it('tells a channel read through a connector from one watched in the browser, and from one that is neither', () => {
    expect(isWatchedInBrowser({ reads: false, watchedInBrowser: true })).toBe(true)
    expect(isWatchedInBrowser({ reads: false, watchedInBrowser: false })).toBe(false)
    // A connector reads it: the flag cannot make it a browser channel.
    expect(isWatchedInBrowser({ reads: true, watchedInBrowser: true })).toBe(false)
    expect(isWatchedInBrowser({ reads: true, watchedInBrowser: false })).toBe(false)
    expect(isWatchable({ reads: true, watchedInBrowser: false })).toBe(true)
    expect(isWatchable({ reads: false, watchedInBrowser: true })).toBe(true)
    expect(isWatchable({ reads: false, watchedInBrowser: false })).toBe(false)
  })

  it('has the normal schedule line, with the words "in the browser"', () => {
    const line = watchingLine(browser(), ctx())
    expect(line).toEqual({ kind: 'watching', watching: true, text: 'Watching every ~3 h in the browser · last 10:05 · next ≈14:12', schedule: 'Every ~3 h' })
    expect(watchingLine(browser({ checkIntervalMin: 1440, lastRunAt: null, nextCheckAt: null }), ctx()).text).toBe('Watching once a day in the browser · last never · next soon')
  })

  it('leaves the how-often out for an interval it cannot say, and keeps the browser', () => {
    const line = watchingLine(browser({ checkIntervalMin: 0 }), ctx())
    expect(line.text).toBe('Watching in the browser · last 10:05 · next ≈14:12')
    expect(line.schedule).toBe('On a schedule')
  })

  it('says a channel read through a connector is not read in the browser, even if the flag said so', () => {
    expect(watchingLine(channel({ watchedInBrowser: true }), ctx()).text).toBe('Watching every ~3 h · last 10:05 · next ≈14:12')
  })

  it('says the usual reason when it is not watched, the same words as for any channel', () => {
    for (const over of [{ status: 'setup' }, { status: 'paused' }, { status: 'needs_user', statusDetail: 'Sign in again.' }, { status: 'error' }, { status: 'active', statusDetail: `${FAILURE_DETAIL_PREFIX} (2 times in a row): timeout. Retrying in 10 min.` }] as Partial<WatchedChannel>[]) {
      const asBrowser = watchingLine(browser(over), ctx())
      expect(asBrowser).toEqual(watchingLine(channel(over), ctx()))
      expect(asBrowser.watching).toBe(false)
      expect(asBrowser.text).not.toContain('in the browser')
    }
    expect(watchingLine(browser(), ctx({ automationPaused: true }))).toEqual({ kind: 'automation_paused', watching: false, text: 'Not watching: automation is paused', schedule: 'Not watching: automation is paused' })
  })

  it('is not watched when the app neither reads it nor watches it in the browser: that line is what it was', () => {
    for (const status of ['setup', 'active', 'paused', 'needs_user', 'error'] as ChannelStatus[]) {
      expect(watchingLine(channel({ reads: false, watchedInBrowser: false, status }), ctx())).toEqual({ kind: 'not_read', watching: false, text: 'The app does not read this channel', schedule: 'The app does not read this channel' })
    }
  })

  it('counts it as watched in the line of a product', () => {
    expect(productWatching([browser()], ctx())).toEqual({ watching: true, text: 'Watching every ~3 h in the browser · last 10:05 · next ≈14:12' })
    expect(productWatching([browser(), channel({ reads: false })], ctx())?.text).toBe('Watching every ~3 h in the browser · last 10:05 · next ≈14:12')
    expect(productWatching([browser(), channel()], ctx())?.text).toBe('Watching 2 channels · next ≈14:12')
    expect(productWatching([browser({ nextCheckAt: '2026-11-15T15:00:00.000Z' }), channel({ nextCheckAt: '2026-11-15T13:30:00.000Z' })], ctx())?.text).toBe('Watching 2 channels · next ≈14:30')
    expect(productWatching([browser(), channel(), channel({ reads: false })], ctx())?.text).toBe('Watching 2 channels · next ≈14:12')
  })

  it('says why none is watched, a paused browser channel included, and what is left alone', () => {
    expect(productWatching([browser({ status: 'paused' }), channel({ status: 'paused' })], ctx())?.text).toBe('Not watching any channel: 2 paused')
    expect(productWatching([browser({ status: 'paused' })], ctx())).toEqual({ watching: false, text: 'Not watching: this channel is paused' })
    expect(productWatching([browser(), channel()], ctx({ automationPaused: true }))).toEqual({ watching: false, text: 'Not watching: automation is paused' })
    expect(productWatching([browser(), channel({ status: 'paused' })], ctx())?.text).toBe('Watching 1 of 2 channels · next ≈14:12')
  })
})
