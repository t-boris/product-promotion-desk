// The Feed screen's rules (sources, the three lists, what the AI proposes, the filters, the day groups, what is not read, the empty states)
// live in src/renderer/src/pages/feed/feed-filter.ts; the renderer has no test runner of its own, and that module imports only src/shared
// and other pure modules, so it is tested from here.

import { describe, expect, it } from 'vitest'
import type { Capability, CapabilityKey, CapabilityStatus, Channel, OpportunityCard, OpportunitySource, OpportunityState } from '../shared/types'
import {
  FEED_LIMIT,
  FEED_SOURCES,
  FEED_STATES,
  LINE_LIMIT,
  NEW_POST_NOTE,
  NOTHING_FOUND,
  NOTHING_FOUND_BROWSER_ONLY,
  PROPOSAL_LABEL,
  SOURCE_LABEL,
  barNote,
  browserWatchedChannels,
  buildFeedRows,
  channelOptionLabel,
  dayLabel,
  emptyKind,
  feedCountLabel,
  feedRowOf,
  feedStateOf,
  groupByDay,
  isCapped,
  lineOf,
  matchesFilter,
  mergeCards,
  nothingFoundWords,
  onlyWatchedInBrowser,
  proposalOf,
  readableChannels,
  readingProblems,
  rowTime,
  sourceCounts,
  stateCounts,
  statesOf,
  unreadChannels,
  visibleRows,
  watchedChannels,
  whoOf,
  widestFilter,
  type FeedFilter,
  type FeedRow,
  type FeedState
} from '../renderer/src/pages/feed/feed-filter'
import { CAPABILITY_LABEL } from '../renderer/src/pages/channels/capability-words'
import { STATE_HINT, stateHintFor } from '../renderer/src/pages/review/labels'

const ALL_STATES: OpportunityState[] = ['discovered', 'analyzing', 'draft', 'awaiting_approval', 'ready', 'sending', 'confirmed', 'no_reply', 'deferred', 'cancelled', 'needs_user', 'error', 'unknown_result']

interface Seed {
  id: string
  state?: OpportunityState
  source?: OpportunitySource
  channelId?: string
  target?: string
  createdAt?: string
  updatedAt?: string
  /** Undefined: a default comment; null: no comment (a reply to a new post). */
  comment?: { author?: string; body?: string } | null
  /** Undefined: a default post; null: the post is not stored. */
  post?: { author?: string; title?: string; body?: string } | null
  draft?: boolean
  completedAt?: string | null
}

function card(seed: Seed): OpportunityCard {
  const comment = seed.comment === undefined ? { author: 'alice', body: 'A comment' } : seed.comment
  const post = seed.post === undefined ? { author: 'poster', title: 'A post', body: 'Post body' } : seed.post
  return {
    opportunity: {
      id: seed.id,
      channelId: seed.channelId ?? 'c1',
      productId: 'p1',
      kind: 'reply',
      source: seed.source ?? 'comment',
      state: seed.state ?? 'draft',
      createdAt: seed.createdAt ?? '2026-11-14T10:00:00.000Z',
      updatedAt: seed.updatedAt ?? '2026-11-14T10:00:00.000Z'
    },
    channelTarget: seed.target ?? 'r/alpha',
    comment: comment === null ? null : { author: comment.author ?? 'alice', body: comment.body ?? 'A comment' },
    discussion: post === null ? null : { author: post.author ?? 'poster', title: post.title ?? 'A post', body: post.body ?? 'Post body' },
    draft: seed.draft === false ? null : { text: 'A reply' },
    lastAction: seed.completedAt ? { completedAt: seed.completedAt } : null
  } as unknown as OpportunityCard
}

const rowOf = (seed: Seed): FeedRow => feedRowOf(card(seed))

function channel(id: string, options: { reads?: boolean; watchedInBrowser?: boolean; target?: string; capabilities?: Partial<Record<CapabilityKey, CapabilityStatus>>; detail?: string } = {}): Channel {
  const capabilities: Capability[] = Object.entries(options.capabilities ?? {}).map(([key, status]) => ({ key: key as CapabilityKey, status: status as CapabilityStatus, detail: options.detail ?? `why ${key}`, checkedAt: null }))
  return { id, target: options.target ?? `r/${id}`, reads: options.reads ?? true, watchedInBrowser: options.watchedInBrowser ?? false, capabilities } as unknown as Channel
}

describe('the three lists', () => {
  it('puts every state in exactly one list: the owner has something to do or the AI works, it was sent, or it was left alone', () => {
    const expected: Record<OpportunityState, FeedState> = {
      discovered: 'decide',
      analyzing: 'decide',
      draft: 'decide',
      awaiting_approval: 'decide',
      ready: 'decide',
      sending: 'decide',
      needs_user: 'decide',
      error: 'decide',
      deferred: 'decide',
      unknown_result: 'decide',
      confirmed: 'sent',
      no_reply: 'skipped',
      cancelled: 'skipped'
    }
    expect(ALL_STATES).toHaveLength(13)
    for (const state of ALL_STATES) expect(feedStateOf(state), state).toBe(expected[state])
  })

  it('asks the core for the states of a list, and the three lists together are every state once', () => {
    expect([...statesOf('sent')]).toEqual(['confirmed'])
    expect([...statesOf('skipped')].sort()).toEqual(['cancelled', 'no_reply'])
    expect([...statesOf('decide')].sort()).toEqual(['analyzing', 'awaiting_approval', 'deferred', 'discovered', 'draft', 'error', 'needs_user', 'ready', 'sending', 'unknown_result'])
    const together = FEED_STATES.flatMap((s) => statesOf(s.id))
    expect([...together].sort()).toEqual([...ALL_STATES].sort())
  })

  it('names the lists and the chips in the order of the screen', () => {
    expect(FEED_STATES.map((s) => s.label)).toEqual(['To decide', 'Sent', 'Skipped'])
    expect(FEED_SOURCES.map((s) => [s.id, s.label])).toEqual([
      ['all', 'All'],
      ['new_post', 'New posts'],
      ['comment', 'Comments'],
      ['reply_to_me', 'Replies to me'],
      ['mention', 'Mentions']
    ])
    expect(SOURCE_LABEL).toEqual({ comment: 'Comment', new_post: 'New post', reply_to_me: 'Reply to me', mention: 'Mention' })
  })
})

describe('proposalOf', () => {
  it('says what the AI proposes for an item that waits: a reply drafted, or not drafted', () => {
    for (const state of ['discovered', 'draft', 'awaiting_approval', 'deferred'] as const) {
      expect(proposalOf(card({ id: 'a', state })), state).toBe('drafted')
      expect(proposalOf(card({ id: 'a', state, draft: false })), state).toBe('undrafted')
    }
    expect(PROPOSAL_LABEL.drafted).toBe('Reply drafted')
    expect(PROPOSAL_LABEL.undrafted).toBe('Not drafted')
    expect(PROPOSAL_LABEL.skip).toBe('Suggests skipping')
  })

  it('lets the state win where it says more than the draft does', () => {
    const table: [OpportunityState, string][] = [
      ['analyzing', 'preparing'],
      ['ready', 'approved'],
      ['sending', 'sending'],
      ['unknown_result', 'unknown'],
      ['error', 'failed'],
      ['needs_user', 'needs'],
      ['no_reply', 'skip'],
      ['confirmed', 'sent'],
      ['cancelled', 'cancelled']
    ]
    for (const [state, proposal] of table) {
      expect(proposalOf(card({ id: 'a', state })), state).toBe(proposal)
      expect(proposalOf(card({ id: 'a', state, draft: false })), `${state} without a draft`).toBe(proposal)
    }
  })

  it('has a label for every proposal and every state is covered', () => {
    const seen = new Set(ALL_STATES.flatMap((state) => [proposalOf(card({ id: 'a', state })), proposalOf(card({ id: 'a', state, draft: false }))]))
    for (const proposal of seen) expect(PROPOSAL_LABEL[proposal]).toBeTruthy()
    expect(seen.size).toBe(Object.keys(PROPOSAL_LABEL).length)
  })
})

describe('who and what a row is about', () => {
  it('is the comment and its author, or for a reply to a post the post and its author', () => {
    expect(whoOf(card({ id: 'a', comment: { author: 'bob' } }))).toBe('bob')
    expect(whoOf(card({ id: 'a', source: 'new_post', comment: null, post: { author: 'carol' } }))).toBe('carol')
    // A comment without an author name falls back to the post's author, and with neither the row says so.
    expect(whoOf(card({ id: 'a', comment: { author: '' }, post: { author: 'carol' } }))).toBe('carol')
    expect(whoOf(card({ id: 'a', comment: null, post: null }))).toBe('Unknown')
    expect(whoOf(card({ id: 'a', comment: null, post: { author: '' } }))).toBe('Unknown')
  })

  it('reads the comment on one line, cut to the row; for a post its title, else its text', () => {
    expect(lineOf(card({ id: 'a', comment: { body: 'two\n\n  lines   here' } }))).toBe('two lines here')
    const long = 'x'.repeat(LINE_LIMIT + 20)
    expect(lineOf(card({ id: 'a', comment: { body: long } }))).toHaveLength(LINE_LIMIT)
    expect(lineOf(card({ id: 'a', comment: { body: long } })).endsWith('…')).toBe(true)
    expect(lineOf(card({ id: 'a', comment: { body: 'y'.repeat(LINE_LIMIT) } }))).toBe('y'.repeat(LINE_LIMIT))
    expect(lineOf(card({ id: 'a', comment: null, post: { title: 'Looking for a tool', body: 'long text' } }))).toBe('Looking for a tool')
    expect(lineOf(card({ id: 'a', comment: null, post: { title: '   ', body: 'only a text' } }))).toBe('only a text')
    expect(lineOf(card({ id: 'a', comment: null, post: null }))).toBe('')
    // The comment is what is answered even when the post is stored too.
    expect(lineOf(card({ id: 'a', comment: { body: 'the comment' }, post: { title: 'the title' } }))).toBe('the comment')
  })
})

describe('when a row is listed', () => {
  it('is when it was found; a sent reply when the platform confirmed it, else when it last changed', () => {
    const found = card({ id: 'a', state: 'draft', createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-14T09:00:00.000Z' })
    expect(rowTime(found)).toBe('2026-11-10T08:00:00.000Z')
    const sent = card({ id: 'b', state: 'confirmed', createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-14T09:00:00.000Z', completedAt: '2026-11-13T12:00:00.000Z' })
    expect(rowTime(sent)).toBe('2026-11-13T12:00:00.000Z')
    const noRecord = card({ id: 'c', state: 'confirmed', createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-14T09:00:00.000Z' })
    expect(rowTime(noRecord)).toBe('2026-11-14T09:00:00.000Z')
    // A skipped item is listed by when it was found too, not by when the AI judged it.
    expect(rowTime(card({ id: 'd', state: 'no_reply', createdAt: '2026-11-10T08:00:00.000Z', updatedAt: '2026-11-14T09:00:00.000Z' }))).toBe('2026-11-10T08:00:00.000Z')
  })
})

describe('feedRowOf and buildFeedRows', () => {
  it('carries what the row shows', () => {
    const row = rowOf({ id: 'a', state: 'awaiting_approval', source: 'mention', channelId: 'c9', target: 'r/beta', comment: { author: 'bob', body: 'hey' } })
    expect(row).toMatchObject({ id: 'a', source: 'mention', state: 'decide', channelId: 'c9', where: 'r/beta', who: 'bob', line: 'hey', proposal: 'drafted', tone: 'warn' })
  })

  it('colours the dot by the state: amber to decide, green when approved or sent, red when it failed, grey otherwise', () => {
    const tone = (state: OpportunityState): string => rowOf({ id: 'a', state }).tone
    expect(tone('awaiting_approval')).toBe('warn')
    expect(tone('needs_user')).toBe('warn')
    expect(tone('ready')).toBe('good')
    expect(tone('confirmed')).toBe('good')
    expect(tone('error')).toBe('bad')
    expect(tone('unknown_result')).toBe('bad')
    expect(tone('draft')).toBe('')
    expect(tone('no_reply')).toBe('')
    expect(tone('analyzing')).toBe('')
  })

  it('lists the newest first, equal moments by id, and leaves the cards as they were', () => {
    const cards = [
      card({ id: 'b', createdAt: '2026-11-14T10:00:00.000Z' }),
      card({ id: 'a', createdAt: '2026-11-14T10:00:00.000Z' }),
      card({ id: 'old', createdAt: '2026-11-01T10:00:00.000Z' }),
      card({ id: 'new', createdAt: '2026-11-15T10:00:00.000Z' })
    ]
    const before = cards.map((c) => c.opportunity.id)
    expect(buildFeedRows(cards).map((r) => r.id)).toEqual(['new', 'a', 'b', 'old'])
    expect(cards.map((c) => c.opportunity.id)).toEqual(before)
  })
})

describe('mergeCards and isCapped', () => {
  it('lists an item once, as its newer card says, when it changed state between two loads', () => {
    const decide = [card({ id: 'a', state: 'ready', updatedAt: '2026-11-14T10:00:00.000Z' }), card({ id: 'b', state: 'draft' })]
    const sent = [card({ id: 'a', state: 'confirmed', updatedAt: '2026-11-14T10:05:00.000Z' })]
    const merged = mergeCards([decide, sent])
    expect(merged.map((c) => c.opportunity.id)).toEqual(['a', 'b'])
    expect(merged[0].opportunity.state).toBe('confirmed')
    // The other way round: an older card of the later list does not win.
    const mergedBack = mergeCards([sent, [card({ id: 'a', state: 'ready', updatedAt: '2026-11-14T10:00:00.000Z' })]])
    expect(mergedBack[0].opportunity.state).toBe('confirmed')
    // Equal times keep the first card.
    const tie = mergeCards([[card({ id: 'a', state: 'ready' })], [card({ id: 'a', state: 'draft' })]])
    expect(tie[0].opportunity.state).toBe('ready')
    expect(mergeCards([])).toEqual([])
  })

  it('knows a list is as long as the core returns', () => {
    const list = (n: number): OpportunityCard[] => Array.from({ length: n }, (_, i) => card({ id: `c${i}` }))
    expect(FEED_LIMIT).toBe(300)
    expect(isCapped([list(FEED_LIMIT)])).toBe(true)
    expect(isCapped([list(FEED_LIMIT - 1)])).toBe(false)
    expect(isCapped([list(2), list(FEED_LIMIT), list(0)])).toBe(true)
    expect(isCapped([undefined, list(3)])).toBe(false)
    expect(isCapped([])).toBe(false)
  })
})

describe('filters', () => {
  const rows = buildFeedRows([
    card({ id: 'p1', source: 'new_post', state: 'draft', channelId: 'c1', comment: null }),
    card({ id: 'p2', source: 'new_post', state: 'no_reply', channelId: 'c1', comment: null }),
    card({ id: 'k1', source: 'comment', state: 'awaiting_approval', channelId: 'c1' }),
    card({ id: 'k2', source: 'comment', state: 'confirmed', channelId: 'c2' }),
    card({ id: 'r1', source: 'reply_to_me', state: 'ready', channelId: 'c2' }),
    card({ id: 'm1', source: 'mention', state: 'needs_user', channelId: 'c2' }),
    card({ id: 'm2', source: 'mention', state: 'cancelled', channelId: 'c1' })
  ])
  const filter = (over: Partial<FeedFilter> = {}): FeedFilter => ({ source: 'all', state: 'decide', channelId: null, ...over })
  const ids = (list: FeedRow[]): string[] => list.map((r) => r.id).sort()

  it('keeps the rows of one list, one source and one channel', () => {
    expect(ids(visibleRows(rows, filter()))).toEqual(['k1', 'm1', 'p1', 'r1'])
    expect(ids(visibleRows(rows, filter({ state: 'sent' })))).toEqual(['k2'])
    expect(ids(visibleRows(rows, filter({ state: 'skipped' })))).toEqual(['m2', 'p2'])
    expect(ids(visibleRows(rows, filter({ source: 'new_post' })))).toEqual(['p1'])
    expect(ids(visibleRows(rows, filter({ source: 'mention' })))).toEqual(['m1'])
    expect(ids(visibleRows(rows, filter({ channelId: 'c2' })))).toEqual(['m1', 'r1'])
    expect(ids(visibleRows(rows, filter({ source: 'comment', channelId: 'c1' })))).toEqual(['k1'])
    expect(visibleRows(rows, filter({ source: 'reply_to_me', channelId: 'c1' }))).toEqual([])
  })

  it('matches each dimension on its own', () => {
    const row = rowOf({ id: 'x', source: 'mention', state: 'ready', channelId: 'c1' })
    expect(matchesFilter(row, filter({ source: 'mention' }))).toBe(true)
    expect(matchesFilter(row, filter({ source: 'comment' }))).toBe(false)
    expect(matchesFilter(row, filter({ state: 'sent' }))).toBe(false)
    expect(matchesFilter(row, filter({ channelId: 'c1' }))).toBe(true)
    expect(matchesFilter(row, filter({ channelId: 'c2' }))).toBe(false)
  })

  it('does not change the order it was given', () => {
    const visible = visibleRows(rows, filter())
    expect(visible.map((r) => r.id)).toEqual(rows.filter((r) => r.state === 'decide').map((r) => r.id))
  })

  it('counts a chip by what it would show with the list and the channel chosen, a list by what it would show with the chip and the channel', () => {
    expect(sourceCounts(rows, { state: 'decide', channelId: null })).toEqual({ all: 4, new_post: 1, comment: 1, reply_to_me: 1, mention: 1 })
    expect(sourceCounts(rows, { state: 'skipped', channelId: null })).toEqual({ all: 2, new_post: 1, comment: 0, reply_to_me: 0, mention: 1 })
    expect(sourceCounts(rows, { state: 'decide', channelId: 'c2' })).toEqual({ all: 2, new_post: 0, comment: 0, reply_to_me: 1, mention: 1 })
    expect(stateCounts(rows, { source: 'all', channelId: null })).toEqual({ decide: 4, sent: 1, skipped: 2 })
    expect(stateCounts(rows, { source: 'new_post', channelId: null })).toEqual({ decide: 1, sent: 0, skipped: 1 })
    expect(stateCounts(rows, { source: 'all', channelId: 'c1' })).toEqual({ decide: 2, sent: 0, skipped: 2 })
    expect(stateCounts([], { source: 'all', channelId: null })).toEqual({ decide: 0, sent: 0, skipped: 0 })
  })

  it('"Show all" opens every source and channel in the first list that has something, To decide first', () => {
    expect(widestFilter(rows)).toEqual({ source: 'all', state: 'decide', channelId: null })
    expect(widestFilter(rows.filter((r) => r.state !== 'decide'))).toEqual({ source: 'all', state: 'sent', channelId: null })
    expect(widestFilter(rows.filter((r) => r.state === 'skipped'))).toEqual({ source: 'all', state: 'skipped', channelId: null })
    expect(widestFilter([])).toEqual({ source: 'all', state: 'decide', channelId: null })
  })
})

describe('days', () => {
  const at = (iso: string, id: string): FeedRow => rowOf({ id, createdAt: iso })

  it('names a day: Today, Yesterday, the date, the year when it is not this one, and Earlier when the time cannot be read', () => {
    expect(dayLabel('2026-11-15', '2026-11-15')).toBe('Today')
    expect(dayLabel('2026-11-14', '2026-11-15')).toBe('Yesterday')
    expect(dayLabel('2026-11-12', '2026-11-15')).toBe('Nov 12')
    expect(dayLabel('2026-01-05', '2026-11-15')).toBe('Jan 5')
    expect(dayLabel('2025-12-31', '2026-11-15')).toBe('Dec 31, 2025')
    expect(dayLabel('2026-02-28', '2026-03-01')).toBe('Yesterday')
    expect(dayLabel('2025-12-31', '2026-01-01')).toBe('Yesterday')
    expect(dayLabel('', '2026-11-15')).toBe('Earlier')
  })

  it('puts the rows under their local day, in the order they were given', () => {
    const rows = [at('2026-11-15T09:00:00.000Z', 'a'), at('2026-11-15T01:00:00.000Z', 'b'), at('2026-11-14T20:00:00.000Z', 'c'), at('2026-11-12T08:00:00.000Z', 'd')]
    const days = groupByDay(rows, '2026-11-15', 0)
    expect(days).toEqual([
      { day: '2026-11-15', label: 'Today', ids: ['a', 'b'] },
      { day: '2026-11-14', label: 'Yesterday', ids: ['c'] },
      { day: '2026-11-12', label: 'Nov 12', ids: ['d'] }
    ])
    expect(days.flatMap((d) => d.ids)).toEqual(rows.map((r) => r.id))
  })

  it('reads the day in the viewer\'s zone, not in UTC', () => {
    const rows = [at('2026-11-15T23:30:00.000Z', 'late'), at('2026-11-15T10:00:00.000Z', 'noon')]
    // Two hours east of UTC: 23:30 UTC is already the 16th there.
    expect(groupByDay(rows, '2026-11-16', 120).map((d) => [d.day, d.ids])).toEqual([
      ['2026-11-16', ['late']],
      ['2026-11-15', ['noon']]
    ])
    // Five hours west: 01:00 UTC on the 15th is still the 14th.
    expect(groupByDay([at('2026-11-15T01:00:00.000Z', 'x')], '2026-11-15', -300)).toEqual([{ day: '2026-11-14', label: 'Yesterday', ids: ['x'] }])
  })

  it('never merges two runs of the same day and puts an unreadable time under Earlier', () => {
    const rows = [at('2026-11-15T09:00:00.000Z', 'a'), at('not a time', 'b'), at('2026-11-15T08:00:00.000Z', 'c')]
    const days = groupByDay(rows, '2026-11-15', 0)
    expect(days.map((d) => [d.label, d.ids])).toEqual([
      ['Today', ['a']],
      ['Earlier', ['b']],
      ['Today', ['c']]
    ])
    expect(groupByDay([], '2026-11-15', 0)).toEqual([])
  })
})

describe('what is read', () => {
  const channels = [
    channel('c1', { target: 'r/alpha', capabilities: { read_inbox: 'verified', read_posts: 'verified', read_comments: 'verified' } }),
    channel('c2', { target: 'r/beta', capabilities: { read_inbox: 'unavailable', read_posts: 'needs_check', read_comments: 'verified' }, detail: 'No inbox here' }),
    channel('c3', { target: '@brand', reads: false, capabilities: { read_inbox: 'unavailable', read_posts: 'unavailable' } })
  ]

  it('gives the channels a check is for: the ones the app reads, the chosen one alone', () => {
    expect(readableChannels(channels, null).map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(readableChannels(channels, 'c2').map((c) => c.id)).toEqual(['c2'])
    expect(readableChannels(channels, 'c3')).toEqual([])
    expect(readableChannels([], null)).toEqual([])
  })

  it('names the channels the app does not read, beside others it reads, or the chosen one', () => {
    expect(unreadChannels(channels, null).map((c) => c.id)).toEqual(['c3'])
    expect(unreadChannels(channels, 'c3').map((c) => c.id)).toEqual(['c3'])
    expect(unreadChannels(channels, 'c1')).toEqual([])
    // With every channel unread and none chosen the empty state says it, so none is named.
    const none = [channel('u1', { reads: false }), channel('u2', { reads: false })]
    expect(unreadChannels(none, null)).toEqual([])
    expect(unreadChannels(none, 'u1').map((c) => c.id)).toEqual(['u1'])
    // A chosen channel is always named, even when it is the only one the product has.
    expect(unreadChannels([channel('only', { reads: false })], 'only').map((c) => c.id)).toEqual(['only'])
    expect(unreadChannels([channel('only', { reads: false })], null)).toEqual([])
    expect(unreadChannels([], null)).toEqual([])
  })

  describe('a channel the AI watches in the browser (DEC-042)', () => {
    const ig = channel('ig', { target: '@brand', reads: false, watchedInBrowser: true, capabilities: { read_inbox: 'unavailable', read_posts: 'unavailable' } })
    const mixed = [...channels, ig]

    it('is checked, but is not one whose older discussions are read: a connector does that', () => {
      expect(watchedChannels(mixed, null).map((c) => c.id)).toEqual(['c1', 'c2', 'ig'])
      expect(watchedChannels(mixed, 'ig').map((c) => c.id)).toEqual(['ig'])
      expect(watchedChannels(mixed, 'c3')).toEqual([])
      expect(watchedChannels(mixed, 'c1').map((c) => c.id)).toEqual(['c1'])
      expect(readableChannels(mixed, null).map((c) => c.id)).toEqual(['c1', 'c2'])
      expect(readableChannels(mixed, 'ig')).toEqual([])
      expect(watchedChannels([], null)).toEqual([])
    })

    it('is named as watched in the browser, the chosen one alone when one is chosen', () => {
      expect(browserWatchedChannels(mixed, null).map((c) => c.id)).toEqual(['ig'])
      expect(browserWatchedChannels(mixed, 'ig').map((c) => c.id)).toEqual(['ig'])
      expect(browserWatchedChannels(mixed, 'c1')).toEqual([])
      expect(browserWatchedChannels(mixed, 'c3')).toEqual([])
      // A connector reads it: the flag does not make it a browser channel.
      expect(browserWatchedChannels([channel('x', { reads: true, watchedInBrowser: true })], null)).toEqual([])
    })

    it('is not "not read": the channels the app leaves alone are the ones that are neither', () => {
      expect(unreadChannels(mixed, null).map((c) => c.id)).toEqual(['c3'])
      expect(unreadChannels(mixed, 'ig')).toEqual([])
      expect(unreadChannels(mixed, 'c3').map((c) => c.id)).toEqual(['c3'])
      // Only browser channels and one unread: the unread one is named. Every channel unread: none is, as before.
      expect(unreadChannels([ig, channel('u', { reads: false })], null).map((c) => c.id)).toEqual(['u'])
      expect(unreadChannels([ig], null)).toEqual([])
      expect(unreadChannels([channel('u1', { reads: false }), channel('u2', { reads: false })], null)).toEqual([])
    })

    it('says in the channel pop-up how the app looks at the channel', () => {
      expect(channelOptionLabel(channel('c1'))).toBe('r/c1')
      expect(channelOptionLabel(channel('c3', { target: '@brand', reads: false }))).toBe('@brand (not read)')
      expect(channelOptionLabel(ig)).toBe('@brand (in the browser)')
      expect(channelOptionLabel(channel('x', { target: 'r/x', reads: true, watchedInBrowser: true }))).toBe('r/x')
    })

    it('knows the product is watched in the browser only when no connector reads any channel of it', () => {
      expect(onlyWatchedInBrowser([ig])).toBe(true)
      expect(onlyWatchedInBrowser([ig, channel('u', { reads: false })])).toBe(true)
      expect(onlyWatchedInBrowser(mixed)).toBe(false)
      expect(onlyWatchedInBrowser([channel('u', { reads: false })])).toBe(false)
      expect(onlyWatchedInBrowser([])).toBe(false)
      expect(NOTHING_FOUND_BROWSER_ONLY).toMatch(/Noted/)
      expect(NOTHING_FOUND_BROWSER_ONLY).toMatch(/Check now/)
    })

    it('says an empty To decide list stays empty only when nothing is replied to anywhere', () => {
      expect(nothingFoundWords([ig])).toBe(NOTHING_FOUND_BROWSER_ONLY)
      expect(nothingFoundWords(mixed)).toBe(NOTHING_FOUND)
      expect(nothingFoundWords(channels)).toBe(NOTHING_FOUND)
      expect(NOTHING_FOUND).toMatch(/replies to you and mentions/)
      expect(NOTHING_FOUND).not.toMatch(/in the browser/)
    })

    it('leaves the abilities of a channel without a connector out of the reading problems', () => {
      expect(readingProblems(mixed, { source: 'reply_to_me', channelId: 'ig' })).toEqual([])
      expect(readingProblems(mixed, { source: 'all', channelId: null }).map((p) => p.channelId)).toEqual(['c2'])
    })
  })

  it('says why a source is empty: the ability it depends on, in the channel\'s own words', () => {
    const problems = readingProblems(channels, { source: 'reply_to_me', channelId: null })
    expect(problems).toEqual([
      { channelId: 'c2', target: 'r/beta', key: 'read_inbox', ability: CAPABILITY_LABEL.read_inbox, status: 'Unavailable', detail: 'No inbox here' }
    ])
    expect(readingProblems(channels, { source: 'mention', channelId: null })).toHaveLength(1)
  })

  it('reads each source against its own abilities, and "All" against all three', () => {
    const c = [channel('c1', { capabilities: { read_posts: 'unavailable', read_comments: 'needs_user', read_inbox: 'restricted' } })]
    const keys = (source: Parameters<typeof readingProblems>[1]['source']): string[] => readingProblems(c, { source, channelId: null }).map((p) => p.key)
    expect(keys('new_post')).toEqual(['read_posts'])
    expect(keys('comment')).toEqual(['read_comments'])
    expect(keys('reply_to_me')).toEqual(['read_inbox'])
    expect(keys('mention')).toEqual(['read_inbox'])
    expect(keys('all')).toEqual(['read_posts', 'read_comments', 'read_inbox'])
    expect(readingProblems(c, { source: 'comment', channelId: null })[0].status).toBe('Needs you')
    expect(readingProblems(c, { source: 'mention', channelId: null })[0].status).toBe('Restricted by rules')
  })

  it('is no problem when the ability only needs checking, is verified, or was never recorded; nor for a channel of another scope or one the app does not read', () => {
    const c = [channel('c1', { capabilities: { read_posts: 'needs_check', read_comments: 'verified' } }), channel('c2', { capabilities: {} })]
    expect(readingProblems(c, { source: 'all', channelId: null })).toEqual([])
    expect(readingProblems(channels, { source: 'new_post', channelId: 'c1' })).toEqual([])
    // c3 is unread: its abilities are not the Feed's to report, it is named as unread.
    expect(readingProblems(channels, { source: 'new_post', channelId: null })).toEqual([])
    expect(readingProblems(channels, { source: 'reply_to_me', channelId: 'c1' })).toEqual([])
    expect(readingProblems(channels, { source: 'reply_to_me', channelId: 'c2' })).toHaveLength(1)
    expect(readingProblems([], { source: 'all', channelId: null })).toEqual([])
  })
})

describe('emptyKind', () => {
  const read = [
    { reads: true, watchedInBrowser: false },
    { reads: false, watchedInBrowser: false }
  ]
  const some = [rowOf({ id: 'a' })]

  it('says why nothing is listed', () => {
    expect(emptyKind([], [], [])).toBe('no_channels')
    expect(
      emptyKind(
        [
          { reads: false, watchedInBrowser: false },
          { reads: false, watchedInBrowser: false }
        ],
        [],
        []
      )
    ).toBe('nothing_read')
    expect(emptyKind(read, [], [])).toBe('nothing_found')
    expect(emptyKind(read, some, [])).toBe('no_match')
    expect(emptyKind(read, some, some)).toBeNull()
  })

  it('is not "nothing read" for a product whose channels are watched in the browser (DEC-042)', () => {
    const browser = { reads: false, watchedInBrowser: true }
    expect(emptyKind([browser], [], [])).toBe('nothing_found')
    expect(emptyKind([browser, { reads: false, watchedInBrowser: false }], [], [])).toBe('nothing_found')
    expect(emptyKind([browser], some, [])).toBe('no_match')
    expect(emptyKind([browser], some, some)).toBeNull()
  })

  it('names the lack of a channel before anything else', () => {
    expect(emptyKind([], some, some)).toBe('no_channels')
    expect(emptyKind([], some, [])).toBe('no_channels')
  })
})

describe('the words of an item', () => {
  it('says in the bar what is left of an item that has no buttons', () => {
    expect(barNote('confirmed')).toBe('This reply was sent.')
    expect(barNote('sending')).toBe('This reply is being sent right now.')
    expect(barNote('cancelled')).toBe('This item was rejected. The record of it stays.')
    for (const state of ALL_STATES.filter((s) => !['confirmed', 'sending', 'cancelled'].includes(s))) expect(barNote(state), state).toBeNull()
  })

  it('tells the owner a reply to a new post goes under the post and is never sent automatically', () => {
    expect(NEW_POST_NOTE).toContain('top-level comment')
    expect(NEW_POST_NOTE).toContain('never sent automatically')
  })

  it('says what a new item is, by its source, and keeps the other states\' hints', () => {
    const hint = (source: OpportunitySource, state: OpportunityState = 'discovered'): string | undefined => stateHintFor({ source, state })
    expect(hint('comment')).toBe(STATE_HINT.discovered)
    expect(hint('new_post')).toMatch(/^A new post/)
    expect(hint('reply_to_me')).toMatch(/^Someone replied to you/)
    expect(hint('mention')).toMatch(/^Someone mentioned you/)
    for (const source of ['new_post', 'reply_to_me', 'mention'] as const) {
      expect(hint(source)).toContain('prepare one with the AI')
      expect(hint(source, 'awaiting_approval')).toBe(STATE_HINT.awaiting_approval)
      expect(hint(source, 'ready')).toBe(STATE_HINT.ready)
    }
    expect(hint('comment', 'draft')).toBeUndefined()
  })
})

describe('the sidebar count of the Feed', () => {
  it('draws nothing for none and the number for a few', () => {
    expect(feedCountLabel(0)).toBeNull()
    expect(feedCountLabel(-1)).toBeNull()
    expect(feedCountLabel(1)).toBe('1')
    expect(feedCountLabel(42)).toBe('42')
  })

  it('says "300+" once the list is as long as the core returns, and not before', () => {
    expect(feedCountLabel(FEED_LIMIT - 1)).toBe('299')
    expect(feedCountLabel(FEED_LIMIT)).toBe('300+')
    expect(feedCountLabel(FEED_LIMIT + 5)).toBe('300+')
  })
})

