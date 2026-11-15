// The Posts screen's rules (list, filter, search, sort, calendar) live in src/renderer/src/pages/posts/*; the renderer has no test
// runner of its own, and these modules import only src/shared, so they are tested from here.

import { describe, expect, it } from 'vitest'
import { plannedTimeNote } from '../renderer/src/pages/posts/planned-note'
import { selectionAfterDismiss } from '../renderer/src/pages/inbox/inbox-groups'
import type { Attachment, MixCard, OpportunityCard, OpportunityState, PostGroupCard } from '../shared/types'
import {
  attentionOf,
  buildPostRows,
  matchesFilter,
  postStateOf,
  sortRows,
  stateCounts,
  titleOf,
  visibleRows,
  type PostFilter,
  type PostRow
} from '../renderer/src/pages/posts/posts-filter'
import { calendarEntries, canWriteOn, monthGrid, monthOf, monthTitle, offsetOn, plannedTimeOn, rhythmDays, rhythmMarkers, shiftMonth } from '../renderer/src/pages/posts/posts-calendar'

interface CardSeed {
  id: string
  state?: OpportunityState
  scheduledAt?: string | null
  channelId?: string
  target?: string
  platform?: string
  title?: string | null
  text?: string
  updatedAt?: string
  groupId?: string | null
  attachments?: Attachment[]
  completedAt?: string | null
}

function card(seed: CardSeed): OpportunityCard {
  return {
    opportunity: {
      id: seed.id,
      channelId: seed.channelId ?? 'c1',
      productId: 'p1',
      kind: 'standalone',
      source: 'comment',
      state: seed.state ?? 'draft',
      scheduledAt: seed.scheduledAt ?? null,
      groupId: seed.groupId ?? null,
      updatedAt: seed.updatedAt ?? '2026-11-08T10:00:00.000Z'
    },
    channelTarget: seed.target ?? 'r/alpha',
    channelPlatform: seed.platform ?? 'reddit',
    draft: { title: seed.title === undefined ? null : seed.title, text: seed.text ?? 'Some text', attachments: seed.attachments ?? [] },
    lastAction: seed.completedAt ? { completedAt: seed.completedAt } : null
  } as unknown as OpportunityCard
}

function group(id: string, cards: OpportunityCard[], master = { title: null as string | null, text: 'Master text' }): PostGroupCard {
  return { group: { id, productId: 'p1', master: { ...master, link: null, attachments: [], markup: 'markdown' }, createdAt: '2026-11-01T00:00:00.000Z' }, versions: cards.map((c) => ({ card: c, problems: [], edited: false, way: 'connector' })) } as unknown as PostGroupCard
}

const picture = (name: string): Attachment => ({ name, path: `/media/${name}`, mime: 'image/png', sha256: 'x' }) as Attachment
const all: PostFilter = { state: 'all', channelId: null, query: '' }

describe('postStateOf', () => {
  it('names the state a post is in for the filter', () => {
    expect(postStateOf('draft', null)).toBe('draft')
    expect(postStateOf('awaiting_approval', null)).toBe('draft')
    expect(postStateOf('ready', null)).toBe('approved')
    expect(postStateOf('ready', '2026-11-09T10:00:00.000Z')).toBe('scheduled')
    expect(postStateOf('sending', null)).toBe('approved')
    expect(postStateOf('unknown_result', null)).toBe('approved')
    expect(postStateOf('confirmed', null)).toBe('sent')
    expect(postStateOf('cancelled', null)).toBe('deleted')
  })
  it('keeps a post that needs the owner among the drafts, and says why', () => {
    for (const state of ['needs_user', 'error', 'no_reply', 'deferred', 'discovered', 'analyzing'] as const) expect(postStateOf(state, null)).toBe('draft')
    expect(attentionOf('needs_user')).toBe('Needs you')
    expect(attentionOf('error')).toBe('Failed')
    expect(attentionOf('unknown_result')).toBe('Result unknown')
    expect(attentionOf('draft')).toBeNull()
  })
})

describe('titleOf', () => {
  it('prefers the title, then the first line of the text, cut to a row', () => {
    expect(titleOf(card({ id: 'a', title: '  Launch day  ' }))).toBe('Launch day')
    expect(titleOf(card({ id: 'a', text: '\n\n  First line\nSecond' }))).toBe('First line')
    const long = titleOf(card({ id: 'a', text: 'x'.repeat(200) }))
    expect(long).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
    // A line of exactly 80 characters is not cut; one of 81 is.
    expect(titleOf(card({ id: 'a', text: 'y'.repeat(80) }))).toBe('y'.repeat(80))
    expect(titleOf(card({ id: 'a', text: 'y'.repeat(81) }))).toBe(`${'y'.repeat(79)}…`)
  })
  it('names a picture post and an empty draft', () => {
    expect(titleOf(card({ id: 'a', text: '', attachments: [picture('p.png')] }))).toBe('Picture post')
    expect(titleOf(card({ id: 'a', text: '  ' }))).toBe('Empty draft')
  })
})

describe('buildPostRows', () => {
  it('makes a row of each post and of each group, and lists a group once', () => {
    const v1 = card({ id: 'g1-a', groupId: 'g1', channelId: 'c1', target: 'r/alpha' })
    const v2 = card({ id: 'g1-b', groupId: 'g1', channelId: 'c2', target: '@beta', platform: 'instagram', state: 'ready' })
    const single = card({ id: 's1' })
    const rows = buildPostRows([v1, v2, single], [group('g1', [v1, v2])])
    expect(rows.map((r) => [r.id, r.kind])).toEqual([['g1', 'group'], ['s1', 'post']])
    const g = rows[0]
    expect(g.channelIds).toEqual(['c1', 'c2'])
    expect(g.platforms).toEqual(['reddit', 'instagram'])
    expect(g.targets).toEqual(['r/alpha', '@beta'])
    expect(g.states).toEqual(['draft', 'approved'])
    expect(g.state).toBe('draft')
  })
  it('lists a version of a group that is not in the group any more (deleted) by itself, so that the record is kept', () => {
    const live = card({ id: 'a', groupId: 'g1' })
    const gone = card({ id: 'b', groupId: 'g1', state: 'cancelled' })
    const rows = buildPostRows([live, gone], [group('g1', [live])])
    expect(rows.map((r) => r.id)).toEqual(['g1', 'b'])
    expect(rows[1].state).toBe('deleted')
  })
  it('leaves out replies and empty groups', () => {
    const reply = card({ id: 'r' })
    ;(reply.opportunity as { kind: string }).kind = 'reply'
    expect(buildPostRows([reply], [group('g', [])])).toEqual([])
  })
  it('shows a group in its least finished state, with the states of every version kept for the filter', () => {
    const rows = buildPostRows([], [group('g', [card({ id: 'a', state: 'confirmed' }), card({ id: 'b', state: 'ready', scheduledAt: '2026-11-20T10:00:00.000Z' })])])
    expect(rows[0].state).toBe('scheduled')
    expect(rows[0].states).toEqual(['sent', 'scheduled'])
    expect(rows[0].scheduledAt).toBe('2026-11-20T10:00:00.000Z')
  })
  it('takes the thumbnail from the first picture, the attention from the first version that needs the owner and the newest update', () => {
    const rows = buildPostRows([], [group('g', [card({ id: 'a', attachments: [picture('one.png')], updatedAt: '2026-11-01T00:00:00.000Z' }), card({ id: 'b', state: 'error', attachments: [picture('two.png')], updatedAt: '2026-11-05T00:00:00.000Z' })])])
    expect(rows[0].thumbnail?.name).toBe('one.png')
    expect(rows[0].attention).toBe('Failed')
    expect(rows[0].updatedAt).toBe('2026-11-05T00:00:00.000Z')
  })
  it('reports the time a post was sent, from the send and not from the last edit', () => {
    const rows = buildPostRows([card({ id: 's', state: 'confirmed', completedAt: '2026-11-07T09:00:00.000Z', updatedAt: '2026-11-08T09:00:00.000Z' })], [])
    expect(rows[0].sentAt).toBe('2026-11-07T09:00:00.000Z')
    expect(buildPostRows([card({ id: 'd' })], [])[0].sentAt).toBeNull()
  })
})

describe('matchesFilter', () => {
  const rows = buildPostRows(
    [
      card({ id: 'a', state: 'draft', title: 'Launch day', text: 'We shipped it', target: 'r/alpha', channelId: 'c1' }),
      card({ id: 'b', state: 'confirmed', title: 'Weekly note', text: 'Charts and cards', target: '@beta', channelId: 'c2', platform: 'instagram' }),
      card({ id: 'c', state: 'ready', scheduledAt: '2026-11-20T10:00:00.000Z', text: 'Coming soon', channelId: 'c1' })
    ],
    []
  )
  const idsOf = (filter: PostFilter): string[] => rows.filter((r) => matchesFilter(r, filter)).map((r) => r.id)

  it('filters by state', () => {
    expect(idsOf({ ...all, state: 'all' })).toEqual(['a', 'b', 'c'])
    expect(idsOf({ ...all, state: 'draft' })).toEqual(['a'])
    expect(idsOf({ ...all, state: 'sent' })).toEqual(['b'])
    expect(idsOf({ ...all, state: 'scheduled' })).toEqual(['c'])
    expect(idsOf({ ...all, state: 'approved' })).toEqual([])
    expect(idsOf({ ...all, state: 'deleted' })).toEqual([])
  })
  it('filters by channel', () => {
    expect(idsOf({ ...all, channelId: 'c1' })).toEqual(['a', 'c'])
    expect(idsOf({ ...all, channelId: 'c2' })).toEqual(['b'])
    expect(idsOf({ ...all, channelId: 'nope' })).toEqual([])
  })
  it('finds a post by a word of its title, text or channel, ignoring case, and needs every word', () => {
    expect(idsOf({ ...all, query: 'LAUNCH' })).toEqual(['a'])
    expect(idsOf({ ...all, query: 'charts' })).toEqual(['b'])
    expect(idsOf({ ...all, query: '@beta' })).toEqual(['b'])
    expect(idsOf({ ...all, query: 'weekly cards' })).toEqual(['b'])
    expect(idsOf({ ...all, query: 'weekly shipped' })).toEqual([])
    expect(idsOf({ ...all, query: '   ' })).toEqual(['a', 'b', 'c'])
  })
  it('combines state, channel and search', () => {
    expect(idsOf({ state: 'draft', channelId: 'c1', query: 'shipped' })).toEqual(['a'])
    expect(idsOf({ state: 'sent', channelId: 'c1', query: '' })).toEqual([])
  })
  it('finds a group by its master text and by any of its channels, and under every state one of its versions is in', () => {
    const g = buildPostRows([], [group('g', [card({ id: 'x', state: 'confirmed', channelId: 'c1', target: 'r/alpha', text: 'v1' }), card({ id: 'y', state: 'draft', channelId: 'c2', target: '@beta', text: 'v2' })], { title: null, text: 'Big announcement' })])[0]
    expect(matchesFilter(g, { ...all, query: 'announcement' })).toBe(true)
    expect(matchesFilter(g, { ...all, channelId: 'c2' })).toBe(true)
    expect(matchesFilter(g, { ...all, state: 'sent' })).toBe(true)
    expect(matchesFilter(g, { ...all, state: 'draft' })).toBe(true)
    expect(matchesFilter(g, { ...all, state: 'deleted' })).toBe(false)
  })
})

describe('stateCounts', () => {
  it('counts what each segment would show, with the channel and the search applied but not the state', () => {
    const rows = buildPostRows(
      [card({ id: 'a', channelId: 'c1' }), card({ id: 'b', state: 'confirmed', channelId: 'c1' }), card({ id: 'c', state: 'confirmed', channelId: 'c2' }), card({ id: 'd', state: 'cancelled', channelId: 'c1' })],
      []
    )
    expect(stateCounts(rows, { channelId: null, query: '' })).toEqual({ all: 4, draft: 1, approved: 0, scheduled: 0, sent: 2, deleted: 1 })
    expect(stateCounts(rows, { channelId: 'c1', query: '' })).toEqual({ all: 3, draft: 1, approved: 0, scheduled: 0, sent: 1, deleted: 1 })
  })
})

describe('sortRows', () => {
  const rows = buildPostRows(
    [
      card({ id: 'old', updatedAt: '2026-11-01T00:00:00.000Z', target: 'r/zeta' }),
      card({ id: 'new', updatedAt: '2026-11-08T00:00:00.000Z', target: 'r/alpha' }),
      card({ id: 'soon', state: 'ready', scheduledAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', target: 'r/mid' }),
      card({ id: 'later', state: 'ready', scheduledAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z', target: 'r/Beta' })
    ],
    []
  )
  const ids = (list: PostRow[]): string[] => list.map((r) => r.id)
  it('puts the newest first by update', () => {
    expect(ids(sortRows(rows, 'updated'))).toEqual(['new', 'later', 'soon', 'old'])
  })
  it('puts what goes out soonest first, then the rest newest first', () => {
    expect(ids(sortRows(rows, 'planned'))).toEqual(['soon', 'later', 'new', 'old'])
  })
  it('orders by channel name ignoring case, newest first within one channel', () => {
    expect(ids(sortRows(rows, 'channel'))).toEqual(['new', 'later', 'soon', 'old'])
    const two = buildPostRows([card({ id: 'a', updatedAt: '2026-11-01T00:00:00.000Z' }), card({ id: 'b', updatedAt: '2026-11-05T00:00:00.000Z' })], [])
    expect(ids(sortRows(two, 'channel'))).toEqual(['b', 'a'])
  })
  it('orders channels by name without regard to case, and by update when the names are the same', () => {
    const named = buildPostRows([card({ id: 'lower', target: 'r/beta', updatedAt: '2026-11-01T00:00:00.000Z' }), card({ id: 'upper', target: 'r/Beta', updatedAt: '2026-11-05T00:00:00.000Z' })], [])
    expect(ids(sortRows(named, 'channel'))).toEqual(['upper', 'lower'])
  })
  it('does not change the list it is given, and gives equal rows a fixed order', () => {
    const own = buildPostRows([card({ id: 'a', updatedAt: '2026-11-01T00:00:00.000Z' }), card({ id: 'b', updatedAt: '2026-11-09T00:00:00.000Z' }), card({ id: 'c', updatedAt: '2026-11-05T00:00:00.000Z' })], [])
    const before = ids(own)
    expect(ids(sortRows(own, 'updated'))).toEqual(['b', 'c', 'a'])
    expect(ids(own)).toEqual(before)
    const tie = buildPostRows([card({ id: 'b' }), card({ id: 'a' })], [])
    expect(ids(sortRows(tie, 'updated'))).toEqual(['a', 'b'])
    expect(ids(sortRows([...tie].reverse(), 'updated'))).toEqual(['a', 'b'])
  })
  it('puts posts planned for the same time in update order', () => {
    const same = buildPostRows([card({ id: 'x', state: 'ready', scheduledAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }), card({ id: 'y', state: 'ready', scheduledAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' })], [])
    expect(ids(sortRows(same, 'planned'))).toEqual(['y', 'x'])
  })
})

describe('visibleRows and the row that takes the place of one that left', () => {
  const rows = buildPostRows([card({ id: 'a', updatedAt: '2026-11-03T00:00:00.000Z' }), card({ id: 'b', state: 'confirmed', updatedAt: '2026-11-02T00:00:00.000Z' }), card({ id: 'c', updatedAt: '2026-11-01T00:00:00.000Z' })], [])
  it('filters, then sorts', () => {
    expect(visibleRows(rows, { ...all, state: 'draft' }, 'updated').map((r) => r.id)).toEqual(['a', 'c'])
  })
  it('moves the selection to the next row when one leaves, else the one before, else nothing', () => {
    const ids = visibleRows(rows, all, 'updated').map((r) => r.id)
    expect(selectionAfterDismiss(ids, 'a')).toBe('b')
    expect(selectionAfterDismiss(ids, 'b')).toBe('c')
    expect(selectionAfterDismiss(ids, 'c')).toBe('b')
    expect(selectionAfterDismiss([ids[0]], 'a')).toBeNull()
    expect(selectionAfterDismiss(ids, 'unknown')).toBe('a')
    expect(selectionAfterDismiss([], 'a')).toBeNull()
  })
})

describe('calendar', () => {
  const NOV = { year: 2026, month: 10 }
  it('names months and moves between them across a year', () => {
    expect(monthTitle(NOV)).toBe('November 2026')
    expect(shiftMonth(NOV, 2)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth({ year: 2027, month: 0 }, -1)).toEqual({ year: 2026, month: 11 })
    expect(shiftMonth(NOV, -11)).toEqual({ year: 2025, month: 11 })
    expect(monthOf('2026-11-08')).toEqual(NOV)
  })

  it('lays a month out in whole weeks starting on the chosen day, with the days of the neighbouring months marked', () => {
    const sunday = monthGrid(NOV, [], '2026-11-08', 0)
    // 1 November 2026 is a Sunday: five full weeks, the last one reaching into December.
    expect(sunday).toHaveLength(5)
    expect(sunday[0][0].date).toBe('2026-11-01')
    expect(sunday[0][0].inMonth).toBe(true)
    expect(sunday[4][6].date).toBe('2026-12-05')
    expect(sunday[4][6].inMonth).toBe(false)
    const monday = monthGrid(NOV, [], '2026-11-08', 0, 1)
    expect(monday[0][0].date).toBe('2026-10-26')
    expect(monday[0][0].inMonth).toBe(false)
    expect(monday[0][6].date).toBe('2026-11-01')
    expect(monday.every((week) => week.length === 7)).toBe(true)
  })
  it('marks today and the days before it', () => {
    const grid = monthGrid(NOV, [], '2026-11-08', 0).flat()
    expect(grid.filter((d) => d.isToday).map((d) => d.date)).toEqual(['2026-11-08'])
    expect(grid.find((d) => d.date === '2026-11-07')?.isPast).toBe(true)
    expect(grid.find((d) => d.date === '2026-11-08')?.isPast).toBe(false)
    expect(grid.find((d) => d.date === '2026-11-09')?.isPast).toBe(false)
  })
  it('handles a month that needs six weeks, February of four, and a leap year', () => {
    expect(monthGrid({ year: 2026, month: 7 }, [], '2026-08-01', 0)).toHaveLength(6)
    expect(monthGrid({ year: 2026, month: 1 }, [], '2026-02-01', 0)).toHaveLength(4)
    const leap = monthGrid({ year: 2028, month: 1 }, [], '2028-02-01', 0).flat()
    expect(leap.some((d) => d.date === '2028-02-29' && d.inMonth)).toBe(true)
  })

  it('puts a planned and a sent post on the local day they belong to', () => {
    const rows = buildPostRows(
      [
        card({ id: 'p', state: 'ready', scheduledAt: '2026-11-09T22:30:00.000Z', target: 'r/alpha' }),
        card({ id: 's', state: 'confirmed', completedAt: '2026-11-03T09:00:00.000Z', target: '@beta' }),
        card({ id: 'd' }),
        card({ id: 'x', state: 'cancelled' })
      ],
      []
    )
    const entries = calendarEntries(rows)
    expect(entries.map((e) => [e.rowId, e.kind, e.state])).toEqual([['s', 'sent', 'sent'], ['p', 'planned', 'scheduled']])
    const utc = monthGrid(NOV, entries, '2026-11-08', 0).flat()
    expect(utc.find((d) => d.date === '2026-11-09')?.entries.map((e) => e.rowId)).toEqual(['p'])
    expect(utc.find((d) => d.date === '2026-11-03')?.entries.map((e) => e.target)).toEqual(['@beta'])
    // Three hours east of UTC the post planned for 22:30 goes out on the 10th.
    const shifted = monthGrid(NOV, entries, '2026-11-08', 180).flat()
    expect(shifted.find((d) => d.date === '2026-11-10')?.entries.map((e) => e.rowId)).toEqual(['p'])
    expect(shifted.find((d) => d.date === '2026-11-09')?.entries).toEqual([])
  })
  it('puts a draft with a planned time on its day as planned and unapproved, and leaves out a deleted one', () => {
    const rows = buildPostRows(
      [card({ id: 'd', state: 'draft', scheduledAt: '2026-11-12T10:00:00.000Z' }), card({ id: 'a', state: 'awaiting_approval', scheduledAt: '2026-11-13T10:00:00.000Z' }), card({ id: 'x', state: 'cancelled', scheduledAt: '2026-11-14T10:00:00.000Z' }), card({ id: 'n', state: 'draft' })],
      []
    )
    expect(calendarEntries(rows).map((e) => [e.rowId, e.kind, e.state])).toEqual([['d', 'planned', 'draft'], ['a', 'planned', 'draft']])
  })
  it('puts a sent post on the day it went out, not on the time it had been planned for', () => {
    const rows = buildPostRows([card({ id: 's', state: 'confirmed', scheduledAt: '2026-11-02T10:00:00.000Z', completedAt: '2026-11-04T10:05:00.000Z' })], [])
    expect(calendarEntries(rows).map((e) => [e.kind, e.at])).toEqual([['sent', '2026-11-04T10:05:00.000Z']])
  })
  it('keeps each version of a group on its own day, and a sent post without a send time on the day it was last updated', () => {
    const rows = buildPostRows([], [group('g', [card({ id: 'a', state: 'ready', scheduledAt: '2026-11-12T10:00:00.000Z' }), card({ id: 'b', state: 'ready', scheduledAt: '2026-11-14T10:00:00.000Z' })])])
    expect(calendarEntries(rows).map((e) => e.at)).toEqual(['2026-11-12T10:00:00.000Z', '2026-11-14T10:00:00.000Z'])
    const noSend = buildPostRows([card({ id: 's', state: 'confirmed', updatedAt: '2026-11-05T08:00:00.000Z' })], [])
    expect(calendarEntries(noSend)[0].at).toBe('2026-11-05T08:00:00.000Z')
  })
  it('offers to write on a day with nothing from today on, not on a day with a post or in the past', () => {
    const entries = calendarEntries(buildPostRows([card({ id: 'p', state: 'ready', scheduledAt: '2026-11-09T10:00:00.000Z' })], []))
    const grid = monthGrid(NOV, entries, '2026-11-08', 0).flat()
    const on = (date: string): boolean => canWriteOn(grid.find((d) => d.date === date)!)
    expect(on('2026-11-08')).toBe(true)
    expect(on('2026-11-10')).toBe(true)
    expect(on('2026-11-09')).toBe(false)
    expect(on('2026-11-07')).toBe(false)
  })
  it('plans a post written from the calendar for ten in the morning of the viewer', () => {
    expect(plannedTimeOn('2026-11-10', 0)).toBe('2026-11-10T10:00:00.000Z')
    expect(plannedTimeOn('2026-11-10', 180)).toBe('2026-11-10T07:00:00.000Z')
    expect(plannedTimeOn('2026-11-10', -480, 9)).toBe('2026-11-10T17:00:00.000Z')
  })
})

describe('the rhythm of the content mix', () => {
  it('lists the days a kind falls due from its next due time on, every N days, inside the window', () => {
    expect(rhythmDays('2026-11-10T08:00:00.000Z', 7, '2026-11-01', '2026-11-30', 0)).toEqual(['2026-11-10', '2026-11-17', '2026-11-24'])
    expect(rhythmDays('2026-11-10T08:00:00.000Z', 7, '2026-11-15', '2026-11-30', 0)).toEqual(['2026-11-17', '2026-11-24'])
    expect(rhythmDays('2026-11-10T08:00:00.000Z', 1, '2026-11-09', '2026-11-12', 0)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12'])
  })
  it('shows nothing for a kind that is off, has no next time, or has no usable rhythm, and nothing before its next time', () => {
    expect(rhythmDays(null, 7, '2026-11-01', '2026-11-30', 0)).toEqual([])
    expect(rhythmDays('2026-11-10T08:00:00.000Z', 0, '2026-11-01', '2026-11-30', 0)).toEqual([])
    expect(rhythmDays('2026-11-10T08:00:00.000Z', 1.5, '2026-11-01', '2026-11-30', 0)).toEqual([])
    expect(rhythmDays('2026-12-10T08:00:00.000Z', 7, '2026-11-01', '2026-11-30', 0)).toEqual([])
  })
  it('reads the next time in the viewer’s local day', () => {
    expect(rhythmDays('2026-11-10T22:00:00.000Z', 30, '2026-11-01', '2026-11-30', 180)).toEqual(['2026-11-11'])
  })
  it('gathers the enabled kinds of every channel by day, with their names', () => {
    const kind = (k: string, enabled: boolean, nextAt: string | null, everyDays: number) => ({ kind: k, enabled, everyDays, lastDraftAt: null, nextAt, problem: null })
    const cards = [
      { channelId: 'c1', blocked: null, waiting: 0, cap: 3, kinds: [kind('product_post', true, '2026-11-10T08:00:00.000Z', 7), kind('showcase', false, '2026-11-10T08:00:00.000Z', 7)] },
      { channelId: 'c2', blocked: null, waiting: 2, cap: 3, kinds: [kind('own_update', true, '2026-11-10T08:00:00.000Z', 14)] }
    ] as unknown as MixCard[]
    const markers = rhythmMarkers(cards, '2026-11-01', '2026-11-30', 0)
    expect(markers.get('2026-11-10')).toEqual(['Product post', 'My update'])
    expect(markers.get('2026-11-17')).toEqual(['Product post'])
    expect(markers.get('2026-11-24')).toEqual(['Product post', 'My update'])
    expect([...markers.keys()]).toEqual(['2026-11-10', '2026-11-17', '2026-11-24'])
  })
  it('marks nothing for a channel the mix cannot run on now, or one that already holds as many drafts as the cap', () => {
    const kind = { kind: 'product_post', enabled: true, everyDays: 7, lastDraftAt: null, nextAt: '2026-11-10T08:00:00.000Z', problem: null }
    const blocked = { channelId: 'c1', blocked: 'Paused.', waiting: 0, cap: 3, kinds: [kind] }
    const full = { channelId: 'c2', blocked: null, waiting: 3, cap: 3, kinds: [kind] }
    const room = { channelId: 'c3', blocked: null, waiting: 2, cap: 3, kinds: [kind] }
    expect([...rhythmMarkers([blocked, full] as unknown as MixCard[], '2026-11-01', '2026-11-30', 0).keys()]).toEqual([])
    expect(rhythmMarkers([blocked, full, room] as unknown as MixCard[], '2026-11-01', '2026-11-30', 0).get('2026-11-10')).toEqual(['Product post'])
  })
  it('shows the markers on the days of the grid', () => {
    const markers = new Map([['2026-11-10', ['Product post']]])
    const grid = monthGrid({ year: 2026, month: 10 }, [], '2026-11-08', 0, 0, markers).flat()
    expect(grid.find((d) => d.date === '2026-11-10')?.rhythm).toEqual(['Product post'])
    expect(grid.find((d) => d.date === '2026-11-11')?.rhythm).toEqual([])
  })
})


describe('what the review of Posts found', () => {
  it('gives every version of a group its own calendar entry id, though they share the row', () => {
    const v1 = card({ id: 'g-a', groupId: 'g', channelId: 'c1', target: 'r/alpha', state: 'ready', scheduledAt: '2026-11-20T10:00:00.000Z' })
    const v2 = card({ id: 'g-b', groupId: 'g', channelId: 'c2', target: '@beta', platform: 'instagram', state: 'ready', scheduledAt: '2026-11-20T10:00:00.000Z' })
    const entries = calendarEntries(buildPostRows([v1, v2], [group('g', [v1, v2])]))
    expect(entries.map((e) => e.rowId)).toEqual(['g', 'g'])
    expect(entries.map((e) => e.id).sort()).toEqual(['g-a', 'g-b'])
    expect(new Set(entries.map((e) => e.id)).size).toBe(2)
    // Entries of one moment keep one order whichever way they came, by their own id.
    const reversed = calendarEntries(buildPostRows([v2, v1], [group('g', [v2, v1])]))
    expect(reversed.map((e) => e.id)).toEqual(['g-a', 'g-b'])
  })

  it('treats a draft with a planned time as planned in the list too: its row has the time, so the Planned time sort and the row say so', () => {
    const planned = card({ id: 'p', state: 'draft', scheduledAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' })
    const plain = card({ id: 'q', state: 'draft', updatedAt: '2026-11-05T00:00:00.000Z' })
    const rows = buildPostRows([planned, plain], [])
    expect(rows.find((r) => r.id === 'p')?.scheduledAt).toBe('2026-11-20T10:00:00.000Z')
    expect(rows.find((r) => r.id === 'q')?.scheduledAt).toBeNull()
    expect(sortRows(rows, 'planned').map((r) => r.id)).toEqual(['p', 'q'])
  })

  it('has no planned time on a row that is sent or deleted', () => {
    const sent = card({ id: 's', state: 'confirmed', scheduledAt: '2026-11-20T10:00:00.000Z' })
    const gone = card({ id: 'd', state: 'cancelled', scheduledAt: '2026-11-21T10:00:00.000Z' })
    const rows = buildPostRows([sent, gone], [])
    expect(rows.map((r) => r.scheduledAt)).toEqual([null, null])
  })

  it('takes the planned time of a group from its earliest unsent version', () => {
    const early = card({ id: 'a', groupId: 'g', state: 'draft', scheduledAt: '2026-11-18T10:00:00.000Z' })
    const late = card({ id: 'b', groupId: 'g', state: 'ready', scheduledAt: '2026-11-25T10:00:00.000Z' })
    const done = card({ id: 'c', groupId: 'g', state: 'confirmed', scheduledAt: '2026-11-10T10:00:00.000Z' })
    expect(buildPostRows([], [group('g', [late, early, done])])[0].scheduledAt).toBe('2026-11-18T10:00:00.000Z')
  })

  it('finds the offset of the day itself, so a planned time keeps its hour across a clock change', () => {
    const noon = (y: number, m: number, d: number) => -new Date(y, m - 1, d, 12).getTimezoneOffset()
    expect(offsetOn('2026-03-01')).toBe(noon(2026, 3, 1))
    expect(offsetOn('2026-07-01')).toBe(noon(2026, 7, 1))
    expect(offsetOn('2026-12-31')).toBe(noon(2026, 12, 31))
    // Days after a clock change of the year (in a zone that has one) are not given the offset of the first of their month.
    for (const [date, y, m, d] of [['2026-03-31', 2026, 3, 31], ['2026-04-20', 2026, 4, 20], ['2026-10-31', 2026, 10, 31], ['2026-11-20', 2026, 11, 20]] as const) expect(offsetOn(date)).toBe(noon(y, m, d))
    // Ten in the morning of that day, whichever offset the day has.
    for (const date of ['2026-01-15', '2026-07-15']) {
      const at = new Date(plannedTimeOn(date, offsetOn(date)))
      expect(at.getFullYear()).toBe(Number(date.slice(0, 4)))
      expect(at.getHours()).toBe(10)
      expect(at.getMinutes()).toBe(0)
    }
  })
})

describe('plannedTimeNote', () => {
  it('says nothing when every version took the planned time', () => {
    expect(plannedTimeNote(2, [])).toBeUndefined()
    expect(plannedTimeNote(0, [])).toBeUndefined()
  })

  it('says the post is a draft without the time when no version took it, with each reason once', () => {
    expect(plannedTimeNote(1, ['Not for this channel.'])).toBe('Saved as a draft without the planned time. Not for this channel.')
    expect(plannedTimeNote(2, ['Same.', 'Same.'])).toBe('Saved as a draft without the planned time. Same.')
  })

  it('says how many versions took the time when only some did', () => {
    expect(plannedTimeNote(3, ['Only on my press.'])).toBe('Saved. The planned time is set on 2 of 3 versions; the others stay drafts without it. Only on my press.')
    expect(plannedTimeNote(2, ['A.', 'B.'])).toBe('Saved as a draft without the planned time. A. B.')
  })
})

