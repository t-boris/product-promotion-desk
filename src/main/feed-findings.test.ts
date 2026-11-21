// The Feed's Noted list and the posts the AI judged not relevant (DEC-040) live in src/renderer/src/pages/feed/finding-rows.ts: one row for
// each finding, the four tabs, the counts on the tab, when a notice is marked seen, and the empty states. The module is pure, so it is
// tested here (the renderer has no runner of its own). A finding is not an opportunity: the tests also show that the Feed's selection,
// arrow keys and day groups, which work on ids and moments, do the same for the rows of either.

import { describe, expect, it } from 'vitest'
import type { Finding, FindingCard, FindingCounts, FindingLabel, OpportunityCard, OpportunityState } from '../shared/types'
import { SELECTION_KEYS, resolveSelection, selectionAfterKey } from '../renderer/src/list-selection'
import { FEED_STATES, buildFeedRows, feedRowOf, groupByDay, statesOf } from '../renderer/src/pages/feed/feed-filter'
import {
  FEED_TABS,
  FINDING_LABEL_WORDS,
  FINDING_STAGE_WORDS,
  FIRST_LOOK,
  buildFindingRows,
  findingBarNote,
  findingRowOf,
  isFindingRow,
  judgedLine,
  notedCount,
  notedEmptyKind,
  opportunityListOf,
  unseenNoticeCount,
  unseenToMark,
  visibleFindings,
  type FindingRow
} from '../renderer/src/pages/feed/finding-rows'
import { STREAM_FILTERS, STREAM_SORTS, filterByTags, filterStream, searchStream, sortStream, streamCounts, toggleTag, visibleFilters } from '../renderer/src/pages/feed/stream-filter'
import { selectionAfterDismiss } from '../renderer/src/pages/inbox/inbox-groups'

interface Seed {
  id: string
  channelId?: string
  target?: string
  title?: string
  relation?: string
  label?: FindingLabel | null
  stage?: Finding['stage']
  firstLook?: boolean
  postedAt?: string | null
  createdAt?: string
  seenAt?: string | null
  starredAt?: string | null
  own?: boolean
  tags?: string[]
}

function card(seed: Seed): FindingCard {
  return {
    finding: {
      id: seed.id,
      productId: 'p1',
      channelId: seed.channelId ?? 'c1',
      externalId: `t3_${seed.id}`,
      about: '',
      thread: '',
      replyTo: '',
      suggestedComment: '',
      title: seed.title ?? `Post ${seed.id}`,
      url: `https://www.reddit.com/r/alpha/comments/${seed.id}/`,
      author: 'poster',
      postedAt: seed.postedAt === undefined ? '2026-11-14T10:00:00.000Z' : seed.postedAt,
      stage: seed.stage ?? 'read',
      label: seed.label === undefined ? 'notice' : seed.label,
      relation: seed.relation ?? 'Relates to the goal.',
      firstLook: seed.firstLook ?? false,
      opportunityId: null,
      seenAt: seed.seenAt === undefined ? null : seed.seenAt,
      starredAt: seed.starredAt === undefined ? null : seed.starredAt,
      own: seed.own ?? false,
      analysis: '',
      topics: [],
      readAt: null,
      replies: null,
      score: null,
      statsAt: null,
      body: '',
      bodyAt: null,
      createdAt: seed.createdAt ?? '2026-11-15T08:00:00.000Z'
    },
    channelTarget: seed.target ?? 'r/alpha',
    channelPlatform: 'reddit',
    tags: (seed.tags ?? []).map((name) => ({ id: `tag-${name}`, name }))
  }
}

const rowOf = (seed: Seed): FindingRow => findingRowOf(card(seed))
const ids = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id)
const counts = (over: Partial<FindingCounts> = {}): FindingCounts => ({ unseenNotices: 0, notices: 0, skipped: 0, pending: 0, ...over })

describe('the tabs', () => {
  it('are the three lists of opportunities and Noted, in the order the owner reads them: there is no list of its own for posts worth a reply', () => {
    expect(FEED_TABS.map((tab) => tab.id)).toEqual(['decide', 'noted', 'sent', 'skipped'])
    expect(FEED_TABS.map((tab) => tab.label)).toEqual(['To decide', 'Noted', 'Sent', 'Skipped'])
  })

  it('leave Noted out of the lists of opportunities: no opportunity state is ever Noted', () => {
    expect(FEED_STATES.map((state) => state.id)).toEqual(['decide', 'sent', 'skipped'])
    expect(FEED_TABS.filter((tab) => tab.id !== 'noted').map((tab) => tab.id)).toEqual(FEED_STATES.map((state) => state.id))
    const every: OpportunityState[] = ['discovered', 'analyzing', 'draft', 'awaiting_approval', 'ready', 'sending', 'confirmed', 'no_reply', 'deferred', 'cancelled', 'needs_user', 'error', 'unknown_result']
    const listed = FEED_STATES.flatMap((state) => statesOf(state.id))
    expect([...listed].sort()).toEqual([...every].sort())
  })

  it('say which opportunity list a tab shows, and none for Noted', () => {
    expect(opportunityListOf('decide')).toBe('decide')
    expect(opportunityListOf('sent')).toBe('sent')
    expect(opportunityListOf('skipped')).toBe('skipped')
    expect(opportunityListOf('noted')).toBeNull()
  })
})

describe('findingRowOf', () => {
  it('carries what a row and a detail show', () => {
    const row = rowOf({ id: 'f1', channelId: 'c2', target: 'r/beta', title: 'Best birth chart apps?', relation: 'Asks for tools like ours.', firstLook: true, seenAt: null })
    expect(row).toMatchObject({ kind: 'finding', id: 'f1', channelId: 'c2', where: 'r/beta', title: 'Best birth chart apps?', relation: 'Asks for tools like ours.', firstLook: true, unseen: true, label: 'notice' })
    expect(row.card.finding.id).toBe('f1')
  })

  it('is unseen until the owner looked at it', () => {
    expect(rowOf({ id: 'f1', seenAt: null }).unseen).toBe(true)
    expect(rowOf({ id: 'f1', seenAt: '2026-11-15T09:00:00.000Z' }).unseen).toBe(false)
  })

  it('is listed under the day the post was written, else the day the AI found it', () => {
    expect(rowOf({ id: 'f1', postedAt: '2026-11-03T10:00:00.000Z', createdAt: '2026-11-15T08:00:00.000Z' }).at).toBe('2026-11-03T10:00:00.000Z')
    expect(rowOf({ id: 'f1', postedAt: null, createdAt: '2026-11-15T08:00:00.000Z' }).at).toBe('2026-11-15T08:00:00.000Z')
  })

  it('puts the title and the AI\'s line on one line, cut to the row, and names a post that has no title', () => {
    const row = rowOf({ id: 'f1', title: `  A   long\n title ${'x'.repeat(200)}`, relation: `line one\nline two ${'y'.repeat(400)}` })
    expect(row.title.startsWith('A long title x')).toBe(true)
    expect(row.title.length).toBeLessThanOrEqual(80)
    expect(row.title.endsWith('…')).toBe(true)
    expect(row.relation).not.toContain('\n')
    expect(row.relation.length).toBeLessThanOrEqual(160)
    expect(rowOf({ id: 'f2', title: '   ' }).title).toBe('Untitled post')
    expect(rowOf({ id: 'f3', title: '' }).title).toBe('Untitled post')
  })

  it('keeps what the AI wrote as text, whatever it looks like: nothing is stripped, parsed or run', () => {
    const wild = '<img src=x onerror=alert(1)> **bold** [a](javascript:alert(1)) {{t}} ${x}'
    const row = rowOf({ id: 'f1', title: wild, relation: wild })
    expect(row.title).toBe(wild)
    expect(row.relation).toBe(wild)
    expect(row.card.finding.relation).toBe(wild)
  })

  it('is a finding row, and an opportunity row is not', () => {
    expect(isFindingRow(rowOf({ id: 'f1' }))).toBe(true)
    const opportunity = { opportunity: { id: 'o1', channelId: 'c1', productId: 'p1', kind: 'reply', source: 'comment', state: 'draft', createdAt: '2026-11-14T10:00:00.000Z', updatedAt: '2026-11-14T10:00:00.000Z' }, channelTarget: 'r/alpha', comment: null, discussion: null, draft: null, lastAction: null } as unknown as OpportunityCard
    expect(isFindingRow(feedRowOf(opportunity))).toBe(false)
  })
})

describe('buildFindingRows', () => {
  const cards = [
    card({ id: 'a', postedAt: '2026-11-10T10:00:00.000Z' }),
    card({ id: 'b', postedAt: '2026-11-14T10:00:00.000Z' }),
    card({ id: 'c', postedAt: '2026-11-12T10:00:00.000Z' }),
    card({ id: 'd', label: 'skip', postedAt: '2026-11-13T10:00:00.000Z' }),
    card({ id: 'e', label: null, stage: 'pending', postedAt: '2026-11-15T10:00:00.000Z' }),
    card({ id: 'f', label: 'reply', postedAt: '2026-11-15T11:00:00.000Z' })
  ]

  it('lists the findings of one label, newest first', () => {
    expect(ids(buildFindingRows(cards, 'notice'))).toEqual(['b', 'c', 'a'])
    expect(ids(buildFindingRows(cards, 'skip'))).toEqual(['d'])
  })

  it('never lists a finding that has no label yet, or another label, in a list of one', () => {
    expect(ids(buildFindingRows(cards, 'notice'))).not.toContain('e')
    expect(ids(buildFindingRows(cards, 'notice'))).not.toContain('f')
    expect(buildFindingRows([card({ id: 'x', label: null, stage: 'title' })], 'notice')).toEqual([])
  })

  it('keeps a fixed order for equal moments, and leaves the cards as they were', () => {
    const same = [card({ id: 'z', postedAt: '2026-11-14T10:00:00.000Z' }), card({ id: 'm', postedAt: '2026-11-14T10:00:00.000Z' }), card({ id: 'q', postedAt: '2026-11-14T10:00:00.000Z' })]
    const before = JSON.stringify(same)
    expect(ids(buildFindingRows(same, 'notice'))).toEqual(['m', 'q', 'z'])
    expect(ids(buildFindingRows([...same].reverse(), 'notice'))).toEqual(['m', 'q', 'z'])
    expect(JSON.stringify(same)).toBe(before)
  })

  it('does not move a row when it is seen: the moment is the post\'s, not the owner\'s', () => {
    const before = ids(buildFindingRows([card({ id: 'a', postedAt: '2026-11-10T10:00:00.000Z' }), card({ id: 'b', postedAt: '2026-11-14T10:00:00.000Z' })], 'notice'))
    const after = ids(buildFindingRows([card({ id: 'a', postedAt: '2026-11-10T10:00:00.000Z', seenAt: '2026-11-15T09:00:00.000Z' }), card({ id: 'b', postedAt: '2026-11-14T10:00:00.000Z' })], 'notice'))
    expect(after).toEqual(before)
  })
})

describe('the numbers of the Noted tab', () => {
  const rows = [rowOf({ id: 'a', channelId: 'c1' }), rowOf({ id: 'b', channelId: 'c2', seenAt: '2026-11-15T09:00:00.000Z' }), rowOf({ id: 'c', channelId: 'c2' })]

  it('keeps the rows of one channel, or all of them', () => {
    expect(ids(visibleFindings(rows, null))).toEqual(['a', 'b', 'c'])
    expect(ids(visibleFindings(rows, 'c2'))).toEqual(['b', 'c'])
    expect(visibleFindings(rows, 'nope')).toEqual([])
  })

  it('counts the notices of the product from the core, and of a chosen channel from the rows held', () => {
    expect(notedCount(counts({ notices: 7 }), rows, null)).toBe(7)
    expect(notedCount(counts({ notices: 7 }), rows, 'c2')).toBe(2)
    expect(notedCount(counts({ notices: 7 }), rows, 'c9')).toBe(0)
  })

  it('counts the rows held while the core has not answered', () => {
    expect(notedCount(undefined, rows, null)).toBe(3)
    expect(notedCount(undefined, rows, 'c1')).toBe(1)
  })

  it('counts the notices not seen yet the same way: the core for the product, the rows for a channel', () => {
    expect(unseenNoticeCount(counts({ unseenNotices: 5 }), rows, null)).toBe(5)
    expect(unseenNoticeCount(counts({ unseenNotices: 5 }), rows, 'c2')).toBe(1)
    expect(unseenNoticeCount(undefined, rows, null)).toBe(2)
    expect(unseenNoticeCount(counts(), [], null)).toBe(0)
  })
})

describe('judgedLine', () => {
  it('says nothing until the counts are here', () => {
    expect(judgedLine(undefined)).toBeNull()
  })

  it('says how many posts were judged not relevant, and offers the list when there is one', () => {
    expect(judgedLine(counts({ skipped: 143 }))).toEqual({ text: 'Judged not relevant: 143', canShow: true, waiting: null })
    expect(judgedLine(counts({ skipped: 1 }))).toEqual({ text: 'Judged not relevant: 1', canShow: true, waiting: null })
  })

  it('has nothing to show for none, and still says so', () => {
    expect(judgedLine(counts({ skipped: 0 }))).toEqual({ text: 'Judged not relevant: 0', canShow: false, waiting: null })
  })

  it('says how many posts wait for the AI, so a silent engine is not mistaken for a quiet channel', () => {
    expect(judgedLine(counts({ skipped: 4, pending: 12 }))?.waiting).toBe('12 waiting for the AI')
    expect(judgedLine(counts({ skipped: 0, pending: 1 }))).toEqual({ text: 'Judged not relevant: 0', canShow: false, waiting: '1 waiting for the AI' })
    expect(judgedLine(counts({ pending: 0 }))?.waiting).toBeNull()
  })
})

describe('marking a notice seen', () => {
  it('asks for the notice on show once, when it is not seen', () => {
    const asked = new Set<string>()
    const shown = rowOf({ id: 'f1', seenAt: null })
    const first = unseenToMark(shown, asked)
    expect(first).toEqual(['f1'])
    for (const id of first) asked.add(id)
    // Every render and every reload after that.
    expect(unseenToMark(shown, asked)).toEqual([])
    expect(unseenToMark(rowOf({ id: 'f1', seenAt: null }), asked)).toEqual([])
  })

  it('asks once for each notice as the owner moves through the list, and not again when the owner comes back', () => {
    const asked = new Set<string>()
    const walk = ['f1', 'f2', 'f3', 'f2', 'f1', 'f3'].map((id) => rowOf({ id, seenAt: null }))
    let calls = 0
    for (const shown of walk) {
      const wanted = unseenToMark(shown, asked)
      calls += wanted.length
      for (const id of wanted) asked.add(id)
    }
    expect(calls).toBe(3)
  })

  it('does not ask for a notice that is seen, nothing on show, or a post judged not relevant', () => {
    const asked = new Set<string>()
    expect(unseenToMark(rowOf({ id: 'f1', seenAt: '2026-11-15T09:00:00.000Z' }), asked)).toEqual([])
    expect(unseenToMark(undefined, asked)).toEqual([])
    expect(unseenToMark(rowOf({ id: 'f2', label: 'skip' }), asked)).toEqual([])
    expect(unseenToMark(rowOf({ id: 'f3', label: null, stage: 'pending' }), asked)).toEqual([])
  })
})

describe('the words of a finding', () => {
  it('tells what the AI made of it and how far it looked', () => {
    expect(FINDING_LABEL_WORDS).toEqual({ reply: 'Worth a reply', notice: 'Noted', skip: 'Judged not relevant' })
    expect(FINDING_STAGE_WORDS.title).toBe('Judged by its title')
    expect(FINDING_STAGE_WORDS.read).toBe('Opened and read by the AI')
    expect(FINDING_STAGE_WORDS.pending).toBe('Not judged yet: waiting for the AI')
    expect(FIRST_LOOK).toBe('First look')
  })

  it('says in the bar that a notice has nothing to send, and what the owner can do with it', () => {
    expect(findingBarNote('notice')).toBe('A notice has nothing to send. Star it to find it again, or answer it from here.')
    expect(findingBarNote('skip')).toBe('The AI judged this post not relevant. Nothing is proposed for it.')
  })
})

describe('what to say when the Noted list is empty', () => {
  const reading = [
    { reads: true, watchedInBrowser: false },
    { reads: false, watchedInBrowser: false }
  ]
  const rows = [rowOf({ id: 'a', channelId: 'c1' })]

  it('names the lack of a channel before anything else', () => {
    expect(notedEmptyKind([], [], [])).toBe('no_channels')
    expect(notedEmptyKind([], rows, rows)).toBe('no_channels')
  })

  it('says nothing was noted yet when the AI has noted nothing, and the app reads a channel', () => {
    expect(notedEmptyKind(reading, [], [])).toBe('nothing_noted')
  })

  it('says there is nothing to read when no channel of the product is read', () => {
    expect(notedEmptyKind([{ reads: false, watchedInBrowser: false }], [], [])).toBe('nothing_read')
  })

  it('says nothing was noted yet, not that nothing is read, when the AI watches a channel in the browser (DEC-042)', () => {
    const browser = [{ reads: false, watchedInBrowser: true }]
    expect(notedEmptyKind(browser, [], [])).toBe('nothing_noted')
    expect(notedEmptyKind([...browser, { reads: false, watchedInBrowser: false }], [], [])).toBe('nothing_noted')
    expect(notedEmptyKind(browser, rows, [])).toBe('no_match')
    expect(notedEmptyKind(browser, rows, rows)).toBeNull()
  })

  it('says nothing matches when notices exist and the channel chosen has none', () => {
    expect(notedEmptyKind(reading, rows, [])).toBe('no_match')
  })

  it('is not empty while there is something to show', () => {
    expect(notedEmptyKind(reading, rows, rows)).toBeNull()
  })
})

describe('findings and opportunities in the same selection logic', () => {
  const after = selectionAfterDismiss
  const notices = buildFindingRows([card({ id: 'n1', postedAt: '2026-11-14T10:00:00.000Z' }), card({ id: 'n2', postedAt: '2026-11-13T10:00:00.000Z' }), card({ id: 'n3', postedAt: '2026-11-12T10:00:00.000Z' })], 'notice')
  const order = ids(notices)

  it('shows the first notice while nothing was chosen, and keeps the chosen one', () => {
    expect(resolveSelection(order, [], null, after)).toBe('n1')
    expect(resolveSelection(order, order, 'n2', after)).toBe('n2')
  })

  it('moves to the neighbour when the chosen notice leaves the list', () => {
    expect(resolveSelection(['n1', 'n3'], order, 'n2', after)).toBe('n3')
    expect(resolveSelection(['n1', 'n2'], order, 'n3', after)).toBe('n2')
    expect(resolveSelection([], order, 'n1', after)).toBeNull()
  })

  it('falls to the first row of a list when the tab changes from a list the chosen row was in (the neighbour is in another list)', () => {
    const opportunities = ['o1', 'o2', 'o3']
    // The owner chose o2 on To decide and opened Noted: o2 is not listed, nor is its neighbour; the first notice is shown.
    expect(resolveSelection(order, opportunities, 'o2', after)).toBe('n1')
    // And back: the chosen notice is not an opportunity, the first one is shown.
    expect(resolveSelection(opportunities, order, 'n2', after)).toBe('o1')
  })

  it('walks the notices with the arrow keys, Home and End, and stops at the ends', () => {
    expect(SELECTION_KEYS).toEqual(['ArrowDown', 'ArrowUp', 'Home', 'End'])
    expect(selectionAfterKey(order, 'n1', 'ArrowDown')).toBe('n2')
    expect(selectionAfterKey(order, 'n2', 'ArrowDown')).toBe('n3')
    expect(selectionAfterKey(order, 'n3', 'ArrowDown')).toBeNull()
    expect(selectionAfterKey(order, 'n3', 'ArrowUp')).toBe('n2')
    expect(selectionAfterKey(order, 'n2', 'Home')).toBe('n1')
    expect(selectionAfterKey(order, 'n1', 'End')).toBe('n3')
    expect(selectionAfterKey([], null, 'ArrowDown')).toBeNull()
  })

  it('groups notices under the day the post was written, in the order the arrow keys walk', () => {
    const rows = buildFindingRows(
      [card({ id: 'n1', postedAt: '2026-11-15T07:00:00.000Z' }), card({ id: 'n2', postedAt: '2026-11-15T06:00:00.000Z' }), card({ id: 'n3', postedAt: '2026-11-14T22:00:00.000Z' }), card({ id: 'n4', postedAt: '2026-11-03T10:00:00.000Z' })],
      'notice'
    )
    const days = groupByDay(rows, '2026-11-15', 0)
    expect(days.map((day) => [day.label, day.ids])).toEqual([
      ['Today', ['n1', 'n2']],
      ['Yesterday', ['n3']],
      ['Nov 3', ['n4']]
    ])
    expect(days.flatMap((day) => day.ids)).toEqual(ids(rows))
  })

  it('groups a finding with no readable time under Earlier, and opportunity rows by the same function', () => {
    const odd = buildFindingRows([card({ id: 'n1', postedAt: 'not a time', createdAt: 'also not' })], 'notice')
    expect(groupByDay(odd, '2026-11-15', 0).map((day) => day.label)).toEqual(['Earlier'])
    const opportunity = { opportunity: { id: 'o1', channelId: 'c1', productId: 'p1', kind: 'reply', source: 'comment', state: 'draft', createdAt: '2026-11-15T07:00:00.000Z', updatedAt: '2026-11-15T07:00:00.000Z' }, channelTarget: 'r/alpha', comment: { author: 'a', body: 'b' }, discussion: null, draft: null, lastAction: null } as unknown as OpportunityCard
    expect(groupByDay(buildFeedRows([opportunity]), '2026-11-15', 0).map((day) => day.ids)).toEqual([['o1']])
  })
})

describe('a post worth a reply, starred and own posts', () => {
  const asked = 'Worth a reply: asks for a tool like ours.'
  it('is a tag on the post, not a list: the row says the AI would answer it', () => {
    expect(rowOf({ id: 'a', relation: asked }).worthReply).toBe(true)
    expect(rowOf({ id: 'b', relation: 'Relates to the goal.' }).worthReply).toBe(false)
  })

  it('carries the owner\'s star and whether the post is the account\'s own', () => {
    expect(rowOf({ id: 'a', starredAt: '2026-11-15T09:00:00.000Z' }).starred).toBe(true)
    expect(rowOf({ id: 'b' }).starred).toBe(false)
    expect(rowOf({ id: 'c', own: true }).own).toBe(true)
    expect(rowOf({ id: 'd' }).own).toBe(false)
  })
})

describe('the stream: filters', () => {
  const rows = [
    rowOf({ id: 'a', starredAt: '2026-11-15T09:00:00.000Z', seenAt: '2026-11-15T10:00:00.000Z' }),
    rowOf({ id: 'b' }),
    rowOf({ id: 'c', own: true, seenAt: '2026-11-15T10:00:00.000Z' }),
    rowOf({ id: 'd', starredAt: '2026-11-15T09:30:00.000Z' })
  ]

  it('keeps every post, the starred ones, the own ones or the ones not seen yet, in the order given', () => {
    expect(ids(filterStream(rows, 'all'))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(filterStream(rows, 'starred'))).toEqual(['a', 'd'])
    expect(ids(filterStream(rows, 'own'))).toEqual(['c'])
    expect(ids(filterStream(rows, 'unseen'))).toEqual(['b', 'd'])
  })

  it('counts what each filter keeps: the number written on its button', () => {
    expect(streamCounts(rows)).toEqual({ all: 4, own: 1, starred: 2, unseen: 2 })
    expect(streamCounts([])).toEqual({ all: 0, own: 0, starred: 0, unseen: 0 })
  })

  it('offers the filters the screen lists, and "Your posts" only while there are some (or while it is the one chosen)', () => {
    expect(STREAM_FILTERS.map((f) => f.id)).toEqual(['all', 'own', 'starred', 'unseen'])
    expect(visibleFilters(streamCounts(rows), 'all').map((f) => f.id)).toEqual(['all', 'own', 'starred', 'unseen'])
    const none = streamCounts([rowOf({ id: 'x' })])
    expect(visibleFilters(none, 'all').map((f) => f.id)).toEqual(['all', 'starred', 'unseen'])
    expect(visibleFilters(none, 'own').map((f) => f.id)).toEqual(['all', 'own', 'starred', 'unseen'])
  })

  it('does not change the list it is given', () => {
    const before = ids(rows)
    filterStream(rows, 'starred')
    expect(ids(rows)).toEqual(before)
  })
})

describe('the stream: search and sort', () => {
  const rows = [
    rowOf({ id: 'old', target: 'r/beta', title: 'Chart apps?', relation: 'Worth a reply: asks for chart tools.', postedAt: '2026-11-10T08:00:00.000Z', seenAt: '2026-11-11T08:00:00.000Z' }),
    rowOf({ id: 'new', target: 'r/alpha', title: 'Moon sign help', relation: 'Worth a reply: a beginner question.', postedAt: '2026-11-15T08:00:00.000Z' }),
    rowOf({ id: 'mid', target: 'r/alpha', title: 'Rising sign?', relation: 'Worth a reply: asks what a rising sign is.', postedAt: '2026-11-12T08:00:00.000Z' })
  ]

  it('sorts newest first, oldest first, not seen first and by channel, the same way every time', () => {
    expect(ids(sortStream(rows, 'newest'))).toEqual(['new', 'mid', 'old'])
    expect(ids(sortStream(rows, 'oldest'))).toEqual(['old', 'mid', 'new'])
    expect(ids(sortStream(rows, 'unseen'))).toEqual(['new', 'mid', 'old'])
    expect(ids(sortStream(rows, 'channel'))).toEqual(['new', 'mid', 'old'])
    expect(ids(sortStream([...rows].reverse(), 'channel'))).toEqual(ids(sortStream(rows, 'channel')))
  })

  it('offers the sorts the screen lists, each once', () => {
    expect(STREAM_SORTS.map((sort) => sort.id)).toEqual(['newest', 'oldest', 'unseen', 'channel'])
  })

  it('lists the account\'s own posts first, whatever the order: their comments are answered before anything else', () => {
    const withOwn = [...rows, rowOf({ id: 'mine', own: true, target: 'r/zeta', postedAt: '2026-11-01T08:00:00.000Z', seenAt: '2026-11-02T08:00:00.000Z' })]
    for (const sort of STREAM_SORTS) expect(sortStream(withOwn, sort.id)[0].id).toBe('mine')
    expect(ids(sortStream(withOwn, 'newest'))).toEqual(['mine', 'new', 'mid', 'old'])
  })

  it('does not change the list it is given', () => {
    const before = ids(rows)
    sortStream(rows, 'oldest')
    expect(ids(rows)).toEqual(before)
  })

  it('searches the channel, the title and the note: every word, any case', () => {
    expect(ids(searchStream(rows, 'RISING'))).toEqual(['mid'])
    expect(ids(searchStream(rows, 'r/beta chart'))).toEqual(['old'])
    expect(ids(searchStream(rows, 'alpha'))).toEqual(['new', 'mid'])
    expect(ids(searchStream(rows, 'no such words'))).toEqual([])
    expect(ids(searchStream(rows, '   '))).toEqual(['old', 'new', 'mid'])
  })
})

describe('the stream: tags', () => {
  const rows = [
    rowOf({ id: 'a', title: 'Chart apps?', tags: ['houses', 'chart apps'] }),
    rowOf({ id: 'b', title: 'Moon sign help', tags: ['moon sign'] }),
    rowOf({ id: 'c', title: 'Which houses?', tags: ['houses', 'moon sign'] }),
    rowOf({ id: 'd', title: 'No tags yet' })
  ]

  it('picks a tag, takes it off when it is picked again, and keeps the order of the picking', () => {
    expect(toggleTag([], 'houses')).toEqual(['houses'])
    expect(toggleTag(['houses'], 'moon sign')).toEqual(['houses', 'moon sign'])
    expect(toggleTag(['houses', 'moon sign'], 'houses')).toEqual(['moon sign'])
    const picked = ['houses']
    toggleTag(picked, 'moon sign')
    expect(picked).toEqual(['houses'])
  })

  it('keeps every post while no tag is picked, the posts that carry the tag when one is, and only the posts that carry ALL of the tags when several are', () => {
    expect(ids(filterByTags(rows, []))).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(filterByTags(rows, ['houses']))).toEqual(['a', 'c'])
    expect(ids(filterByTags(rows, ['moon sign']))).toEqual(['b', 'c'])
    expect(ids(filterByTags(rows, ['houses', 'moon sign']))).toEqual(['c'])
    expect(ids(filterByTags(rows, ['houses', 'no such tag']))).toEqual([])
  })

  it('matches a tag by its whole name, and never changes the list it is given', () => {
    expect(ids(filterByTags(rows, ['house']))).toEqual([])
    const before = ids(rows)
    filterByTags(rows, ['houses'])
    expect(ids(rows)).toEqual(before)
  })

  it('searches the names of the tags too, with the words of the title and the note', () => {
    expect(ids(searchStream(rows, 'chart apps'))).toEqual(['a'])
    expect(ids(searchStream(rows, 'moon'))).toEqual(['b', 'c'])
    expect(ids(searchStream(rows, 'houses moon'))).toEqual(['c'])
    expect(ids(searchStream(rows, 'tags yet'))).toEqual(['d'])
  })

  it('works together with the other filters: a starred post that carries the tag', () => {
    const mixed = [rowOf({ id: 's1', tags: ['houses'], starredAt: '2026-11-15T09:00:00.000Z' }), rowOf({ id: 's2', tags: ['houses'] }), rowOf({ id: 's3', starredAt: '2026-11-15T09:00:00.000Z' })]
    expect(ids(filterByTags(filterStream(mixed, 'starred'), ['houses']))).toEqual(['s1'])
  })
})
