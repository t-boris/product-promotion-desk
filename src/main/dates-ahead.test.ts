import { describe, expect, it } from 'vitest'
import type { SeasonalEventView } from '../shared/types'
import { datesByDay, inDays, orderedEvents, ownDateLine, prepareFrom, standingOf } from '../renderer/src/pages/posts/dates-ahead'
import { fixLinkFor } from '../renderer/src/pages/attention-links'
import { postsCalendarAsked } from '../renderer/src/route'

const channel = (over: Partial<SeasonalEventView['channels'][number]> = {}): SeasonalEventView['channels'][number] => ({ channelId: 'c1', target: 'r/x', platform: 'reddit', leadDays: 7, due: false, opportunityId: null, ...over })
const event = (over: Partial<SeasonalEventView> = {}): SeasonalEventView => ({ key: 'k', kind: 'gifts', name: 'Christmas', at: '2026-12-25T12:00:00.000Z', days: 28, skipped: false, channels: [channel()], ...over })

describe('dates ahead', () => {
  it('names the dates in the cells of the viewer\'s day', () => {
    const days = datesByDay([event(), event({ key: 'm', name: 'Full Moon', at: '2026-12-25T23:30:00.000Z' }), event({ key: 'n', name: 'New Moon', at: '2026-12-09T00:52:00.000Z' })], 120)
    expect(days.get('2026-12-25')).toEqual(['Christmas'])
    expect(days.get('2026-12-26')).toEqual(['Full Moon'])
    expect(days.get('2026-12-09')).toEqual(['New Moon'])
  })

  it('says where a date stands and when each channel\'s time comes', () => {
    expect(standingOf(event())).toBe('ahead')
    expect(standingOf(event({ channels: [channel({ due: true })] }))).toBe('due')
    expect(standingOf(event({ channels: [channel({ due: true, opportunityId: 'o1' })] }))).toBe('prepared')
    expect(standingOf(event({ channels: [channel({ due: true, opportunityId: 'o1' }), channel({ channelId: 'c2', due: true })] }))).toBe('due')
    expect(standingOf(event({ skipped: true, channels: [channel({ due: true })] }))).toBe('skipped')
    expect(prepareFrom(28, 35)).toBe('now')
    expect(prepareFrom(28, 7)).toBe('in 21 days')
    expect(prepareFrom(8, 7)).toBe('tomorrow')
    expect(inDays(0)).toBe('today')
    expect(ownDateLine({ month: 12, day: 1, year: null })).toBe('December 1, every year')
    expect(ownDateLine({ month: 12, day: 12, year: 2026 })).toBe('December 12, 2026')
  })

  it('shows first what it is time to prepare, skipped dates last', () => {
    const list = orderedEvents([event({ key: 'a', days: 3, skipped: true }), event({ key: 'b', days: 20 }), event({ key: 'c', days: 30, channels: [channel({ due: true })] }), event({ key: 'd', days: 5 })])
    expect(list.map((e) => e.key)).toEqual(['c', 'd', 'b', 'a'])
  })

  it('the Inbox item opens the calendar of Posts for its product', () => {
    const link = fixLinkFor({ id: 'seasonal:p1', kind: 'question', title: '', detail: '', refType: 'product', refId: 'p1', createdAt: '' }, { channels: [], products: [{ id: 'p1', name: 'Natal Mystic' } as never] })
    expect(link).toEqual({ href: '#/posts?product=p1&view=calendar', label: 'Open the dates ahead', productName: 'Natal Mystic' })
    expect(postsCalendarAsked(link!.href)).toBe(true)
    expect(postsCalendarAsked('#/posts?product=p1')).toBe(false)
  })
})
