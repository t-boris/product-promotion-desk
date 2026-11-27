// The Overview screen's rules (src/renderer/src/pages/overview/overview-data.ts) and the channel routes (src/renderer/src/route.ts).
// The renderer has no test runner of its own; these modules import only src/shared and pure renderer code, so they are tested from here.

import { describe, expect, it } from 'vitest'
import type { MetricSeries, ProductUpdate, ResultsHistory } from '../shared/types'
import { NOTE_GIVE_UP, mainMetric, suggestionHref, tileLine, unusedNoteCount, valuesOver } from '../renderer/src/pages/overview/overview-data'
import { channelHref, channelsNewHref, parseChannelHash, peopleNewHref, peoplePrefillOf } from '../renderer/src/route'
import { platformOfAddress } from '../renderer/src/pages/channels/add-channel'

const DAYS = ['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']

function series(channelId: string, key: string, readings: [string, number | null][], label = key): MetricSeries {
  return { channelId, key, label, points: readings.map(([capturedAt, value]) => ({ capturedAt, value })) }
}
const history = (all: MetricSeries[]): ResultsHistory => ({ productId: 'p1', days: 5, from: '2026-11-04T00:00:00.000Z', to: '2026-11-08T12:00:00.000Z', series: all })
const name = (id: string): string => `Channel ${id}`

const update = (id: string, over: Partial<ProductUpdate> = {}): ProductUpdate => ({ id, productId: 'p1', text: 'did a thing', createdAt: '2026-11-01T00:00:00.000Z', usedInOpportunityId: null, failedTries: 0, ...over }) as ProductUpdate

describe('unusedNoteCount', () => {
  it('counts the notes no post has used, and not those the AI gave up on', () => {
    expect(unusedNoteCount([])).toBe(0)
    expect(unusedNoteCount([update('a'), update('b', { usedInOpportunityId: 'o1' }), update('c', { failedTries: NOTE_GIVE_UP }), update('d', { failedTries: NOTE_GIVE_UP - 1 })])).toBe(2)
  })
  it('gives a note up after three failed tries', () => {
    expect(unusedNoteCount([update('a', { failedTries: 2 })])).toBe(1)
    expect(unusedNoteCount([update('a', { failedTries: 3 })])).toBe(0)
  })
})

describe('valuesOver', () => {
  it('gives the last reading of each local day, and a gap where a day has none, never a zero', () => {
    const s = series('c1', 'subs', [
      ['2026-11-04T08:00:00.000Z', 10],
      ['2026-11-04T20:00:00.000Z', 12],
      ['2026-11-06T08:00:00.000Z', null],
      ['2026-11-07T08:00:00.000Z', 15]
    ])
    expect(valuesOver(s, DAYS, 0)).toEqual([12, null, null, 15, null])
  })
  it('reads a day in the viewer’s zone', () => {
    const s = series('c1', 'subs', [['2026-11-04T22:00:00.000Z', 7]])
    expect(valuesOver(s, DAYS, 180)).toEqual([null, 7, null, null, null])
    expect(valuesOver(s, DAYS, -180)).toEqual([7, null, null, null, null])
  })
  it('ignores a reading outside the period', () => {
    expect(valuesOver(series('c1', 'subs', [['2026-10-01T00:00:00.000Z', 3]]), DAYS, 0)).toEqual([null, null, null, null, null])
  })
})

describe('mainMetric', () => {
  const two = (channel: string, key: string, a = 1, b = 2): MetricSeries => series(channel, key, [['2026-11-04T10:00:00.000Z', a], ['2026-11-06T10:00:00.000Z', b]], key.toUpperCase())

  it('takes the metric the most channels have two days of readings for', () => {
    const m = mainMetric(history([two('c1', 'karma'), two('c2', 'karma'), two('c1', 'subs'), two('c3', 'subs'), two('c2', 'subs')]), DAYS, 0, ['c1', 'c2', 'c3'], name)
    expect(m?.key).toBe('subs')
    expect(m?.label).toBe('SUBS')
    expect(m?.lines.map((l) => l.key)).toEqual(['c1', 'c2', 'c3'])
  })
  it('breaks a tie by the days of readings, then by key', () => {
    const rich = series('c1', 'rich', [['2026-11-04T10:00:00.000Z', 1], ['2026-11-05T10:00:00.000Z', 2], ['2026-11-06T10:00:00.000Z', 3]])
    expect(mainMetric(history([two('c1', 'a'), rich]), DAYS, 0, ['c1'], name)?.key).toBe('rich')
    expect(mainMetric(history([two('c1', 'b'), two('c2', 'a')]), DAYS, 0, ['c1', 'c2'], name)?.key).toBe('a')
  })
  it('puts the lines in the order of the channels given, and names them with the label given', () => {
    const m = mainMetric(history([two('c2', 'subs'), two('c1', 'subs')]), DAYS, 0, ['c1', 'c2'], name)
    expect(m?.lines.map((l) => [l.key, l.label])).toEqual([['c1', 'Channel c1'], ['c2', 'Channel c2']])
    const unknown = mainMetric(history([two('zz', 'subs'), two('c1', 'subs')]), DAYS, 0, ['c1'], name)
    expect(unknown?.lines.map((l) => l.key)).toEqual(['c1', 'zz'])
  })
  it('does not count a metric with fewer than two days of readings, so a line always has two points', () => {
    expect(mainMetric(history([series('c1', 'subs', [['2026-11-04T10:00:00.000Z', 5]])]), DAYS, 0, ['c1'], name)).toBeNull()
    expect(mainMetric(history([series('c1', 'subs', [['2026-11-04T10:00:00.000Z', 5], ['2026-11-04T18:00:00.000Z', 6]])]), DAYS, 0, ['c1'], name)).toBeNull()
    expect(mainMetric(history([series('c1', 'subs', [['2026-11-04T10:00:00.000Z', 5], ['2026-11-06T10:00:00.000Z', null]])]), DAYS, 0, ['c1'], name)).toBeNull()
    expect(mainMetric(history([]), DAYS, 0, [], name)).toBeNull()
  })
  it('does not count a reading that is not a number', () => {
    expect(mainMetric(history([series('c1', 'subs', [['2026-11-04T10:00:00.000Z', 5], ['2026-11-06T10:00:00.000Z', Number.NaN]])]), DAYS, 0, ['c1'], name)).toBeNull()
  })
  it('counts the days in the viewer’s zone: two readings of one UTC day can be two local days', () => {
    const split = history([series('c1', 'subs', [['2026-11-04T20:00:00.000Z', 5], ['2026-11-04T22:00:00.000Z', 6]])])
    expect(mainMetric(split, DAYS, 0, ['c1'], name)).toBeNull()
    expect(mainMetric(split, DAYS, 180, ['c1'], name)?.lines[0].values).toEqual([5, 6, null, null, null])
  })
  it('does not count readings outside the period', () => {
    expect(mainMetric(history([series('c1', 'subs', [['2026-10-01T10:00:00.000Z', 5], ['2026-10-02T10:00:00.000Z', 6]])]), DAYS, 0, ['c1'], name)).toBeNull()
  })
  it('keeps gaps in the values of a line', () => {
    const m = mainMetric(history([two('c1', 'subs', 4, 9)]), DAYS, 0, ['c1'], name)
    expect(m?.lines[0].values).toEqual([4, null, 9, null, null])
  })
})

describe('tileLine', () => {
  const two = (channel: string, key: string, a: number, b: number): MetricSeries => series(channel, key, [['2026-11-04T10:00:00.000Z', a], ['2026-11-07T10:00:00.000Z', b]], key.toUpperCase())
  const h = history([two('c1', 'karma', 1, 5), two('c1', 'subs', 10, 30), two('c2', 'karma', 2, 8)])

  it('shows the main metric where the channel has it, with its newest reading', () => {
    const line = tileLine(h, 'c1', DAYS, 0, 'subs')
    expect(line).toEqual({ label: 'SUBS', values: [10, null, null, 30, null], latest: 30 })
    expect(tileLine(h, 'c2', DAYS, 0, 'karma')?.latest).toBe(8)
  })
  it('falls back to the channel’s own best metric when it lacks the main one, ties by key', () => {
    expect(tileLine(h, 'c2', DAYS, 0, 'subs')?.label).toBe('KARMA')
    expect(tileLine(h, 'c1', DAYS, 0, null)?.label).toBe('KARMA')
    const rich = history([two('c1', 'a', 1, 2), series('c1', 'b', [['2026-11-04T10:00:00.000Z', 1], ['2026-11-05T10:00:00.000Z', 2], ['2026-11-06T10:00:00.000Z', 3]], 'B')])
    expect(tileLine(rich, 'c1', DAYS, 0, null)?.label).toBe('B')
  })
  it('has no line for a channel without two days of readings, or without any', () => {
    expect(tileLine(h, 'nope', DAYS, 0, 'subs')).toBeNull()
    expect(tileLine(history([series('c1', 'subs', [['2026-11-04T10:00:00.000Z', 1]])]), 'c1', DAYS, 0, 'subs')).toBeNull()
  })
  it('takes the newest known reading as the latest, though the period ends on a gap', () => {
    expect(tileLine(h, 'c1', DAYS, 0, 'subs')?.values.at(-1)).toBeNull()
    expect(tileLine(h, 'c1', DAYS, 0, 'subs')?.latest).toBe(30)
  })
})

describe('suggestionHref', () => {
  it('leads each action to its place', () => {
    expect(suggestionHref({ kind: 'inbox' })).toBe('#/inbox')
    expect(suggestionHref({ kind: 'posts' })).toBe('#/posts')
    expect(suggestionHref({ kind: 'channel', channelId: 'c 1', tab: 'plan' })).toBe('#/channels/c%201/plan')
    expect(suggestionHref({ kind: 'channel', channelId: 'c1', tab: 'mix' })).toBe('#/channels/c1/mix')
  })
})

describe('channel routes', () => {
  it('writes a channel’s address, leaving the first tab out', () => {
    expect(channelHref('c1')).toBe('#/channels/c1')
    expect(channelHref('c1', 'status')).toBe('#/channels/c1')
    expect(channelHref('c1', 'settings')).toBe('#/channels/c1/settings')
    expect(channelHref('a/b')).toBe('#/channels/a%2Fb')
  })
  it('reads it back, the tab and the id, and falls back to the first tab', () => {
    const list = { channelId: null, tab: 'status', adding: false, platform: null, accountId: null, address: null }
    expect(parseChannelHash('#/channels')).toEqual(list)
    expect(parseChannelHash('#/channels/c1')).toEqual({ ...list, channelId: 'c1' })
    expect(parseChannelHash('#/channels/c1/plan')).toEqual({ ...list, channelId: 'c1', tab: 'plan' })
    expect(parseChannelHash('#/channels/c1/mix?x=1')).toEqual({ ...list, channelId: 'c1', tab: 'mix' })
    expect(parseChannelHash('#/channels/c1/bogus')).toEqual({ ...list, channelId: 'c1' })
    expect(parseChannelHash('#/channels/a%2Fb/settings')).toEqual({ ...list, channelId: 'a/b', tab: 'settings' })
    expect(parseChannelHash('#/posts')).toEqual(list)
    expect(parseChannelHash('#/setup/passport')).toEqual(list)
  })
  it('opens the add-a-channel flow at #/channels/new, on a platform when one is named, and for an account just made for it', () => {
    expect(channelsNewHref()).toBe('#/channels/new')
    expect(channelsNewHref('reddit')).toBe('#/channels/new?platform=reddit')
    expect(parseChannelHash('#/channels/new')).toMatchObject({ channelId: null, adding: true, platform: null, accountId: null })
    expect(parseChannelHash(channelsNewHref('instagram'))).toMatchObject({ channelId: null, adding: true, platform: 'instagram' })
    // The account made from the flow comes back with its id: the flow is open again and chooses it.
    expect(parseChannelHash('#/channels?account=a1')).toMatchObject({ channelId: null, adding: true, accountId: 'a1' })
    // A channel is never taken for the flow, and a channel page keeps its own address.
    expect(parseChannelHash('#/channels/c1?account=a1')).toMatchObject({ channelId: 'c1', adding: false })
  })
  it('keeps the account asked for beside a channel list, and the old product address', () => {
    expect(parseChannelHash('#/products/p1/channels?account=a1')).toMatchObject({ channelId: null, adding: true, accountId: 'a1' })
    for (const tab of ['status', 'plan', 'mix', 'settings'] as const) expect(parseChannelHash(channelHref('c9', tab))).toMatchObject({ channelId: 'c9', tab, adding: false })
  })
})

describe('links that carry a start for a form', () => {
  it('open the add-a-channel flow on a found address, with the platform told from the site', () => {
    const href = channelsNewHref(undefined, 'https://old.reddit.com/r/astrology/')
    expect(parseChannelHash(href)).toMatchObject({ adding: true, platform: null, address: 'https://old.reddit.com/r/astrology/' })
    expect(parseChannelHash('#/channels/c1?address=https://x.example/')).toMatchObject({ adding: false, address: null })
    const platforms = [{ platform: 'reddit', loginUrl: 'https://www.reddit.com/login' }, { platform: 'universal', loginUrl: '' }]
    expect(platformOfAddress('https://old.reddit.com/r/astrology/', platforms)).toBe('reddit')
    expect(platformOfAddress('https://forum.example.org/t/1', platforms)).toBeNull()
    expect(platformOfAddress('not an address', platforms)).toBeNull()
  })

  it('open the new-person form filled from a comment, and only when asked', () => {
    const href = peopleNewHref({ handle: 'u/moon_reader', platform: 'reddit', where: 'r/beginnerastrology', note: 'Liked the answer & asked more' })
    expect(peoplePrefillOf(href)).toEqual({ handle: 'u/moon_reader', platform: 'reddit', where: 'r/beginnerastrology', note: 'Liked the answer & asked more' })
    expect(peoplePrefillOf('#/people')).toBeNull()
    expect(peoplePrefillOf('#/feed?new=1&handle=x')).toBeNull()
  })
})
