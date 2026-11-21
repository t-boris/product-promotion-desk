// Posts of the Feed are marked as read after they are read (owner, 2026-11-21): the rule of the clock, what the owner marked unread by hand, which posts "Mark all
// as read" takes, and the words and numbers of the card a post gets in the Feed. Pure, so it is tested here; the card itself is rendered in feed-card-render.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Finding, FindingCard } from '../shared/types'
import { findingRowOf } from '../renderer/src/pages/feed/finding-rows'
import { HELD_LIMIT, READ_AFTER_MS, createHeldStore, createReadClock, isOnShow, mostlyInView, unreadIds, type HeldStorage } from '../renderer/src/pages/feed/read-marks'
import { BODY_LINES, channelMark, countText, needsReadMore, peopleSay, pictureColumns, siteNumbers } from '../renderer/src/pages/feed/stream-card'

function card(over: Partial<Finding> = {}): FindingCard {
  return {
    finding: {
      id: 'f1',
      productId: 'p1',
      channelId: 'c1',
      externalId: 't3_f1',
      title: 'Venus in the first house?',
      url: 'https://www.reddit.com/r/beginnerastrology/comments/f1/',
      author: 'u/anna',
      postedAt: '2026-11-14T10:00:00.000Z',
      stage: 'read',
      label: 'notice',
      relation: 'Asks for a chart tool.',
      about: 'The author asks about Taurus rising.',
      thread: '',
      replyTo: '',
      suggestedComment: '',
      firstLook: false,
      opportunityId: null,
      seenAt: null,
      starredAt: null,
      own: false,
      analysis: '',
      topics: [],
      readAt: '2026-11-15T08:30:00.000Z',
      replies: null,
      score: null,
      statsAt: null,
      body: 'I am new to this.',
      bodyAt: '2026-11-15T08:30:00.000Z',
      createdAt: '2026-11-15T08:00:00.000Z',
      ...over
    },
    channelTarget: 'r/beginnerastrology',
    channelPlatform: 'reddit',
    tags: []
  }
}

describe('the clock that reads a post', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reads a post after three seconds on show, and only once', () => {
    const read = vi.fn()
    const clock = createReadClock(read)
    clock.update(true)
    vi.advanceTimersByTime(READ_AFTER_MS - 1)
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(read).toHaveBeenCalledTimes(1)
    // The window says "on show" again and again (every scroll event): nothing more is counted.
    clock.update(true)
    vi.advanceTimersByTime(10 * READ_AFTER_MS)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not read a post that was on show for two seconds and left', () => {
    const read = vi.fn()
    const clock = createReadClock(read)
    clock.update(true)
    vi.advanceTimersByTime(2000)
    clock.update(false)
    vi.advanceTimersByTime(60_000)
    expect(read).not.toHaveBeenCalled()
  })

  it('starts again from nothing when the post comes back: two seconds, away, two seconds is not four', () => {
    const read = vi.fn()
    const clock = createReadClock(read)
    clock.update(true)
    vi.advanceTimersByTime(2000)
    clock.update(false)
    clock.update(true)
    vi.advanceTimersByTime(2000)
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not restart the count while the post stays on show (the window repeats what it said)', () => {
    const read = vi.fn()
    const clock = createReadClock(read)
    clock.update(true)
    vi.advanceTimersByTime(2000)
    clock.update(true)
    vi.advanceTimersByTime(1000)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('counts nothing after stop', () => {
    const read = vi.fn()
    const clock = createReadClock(read)
    clock.update(true)
    clock.stop()
    vi.advanceTimersByTime(60_000)
    expect(read).not.toHaveBeenCalled()
  })

  it('takes a delay of its own', () => {
    const read = vi.fn()
    createReadClock(read, 500).update(true)
    vi.advanceTimersByTime(500)
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('when a post is on show', () => {
  it('is on show only while it is in the window, the window is in front and the page is visible', () => {
    expect(isOnShow({ inView: true, windowFocused: true, pageVisible: true })).toBe(true)
    expect(isOnShow({ inView: false, windowFocused: true, pageVisible: true })).toBe(false)
    expect(isOnShow({ inView: true, windowFocused: false, pageVisible: true })).toBe(false)
    expect(isOnShow({ inView: true, windowFocused: true, pageVisible: false })).toBe(false)
  })

  it('takes half of the card as most of it, and for a card taller than the window, half of the window', () => {
    expect(mostlyInView({ ratio: 0.5, visibleHeight: 300, viewHeight: 800 })).toBe(true)
    expect(mostlyInView({ ratio: 0.49, visibleHeight: 300, viewHeight: 800 })).toBe(false)
    // A card three screens tall can never show half of itself; a window full of it is enough.
    expect(mostlyInView({ ratio: 0.2, visibleHeight: 400, viewHeight: 800 })).toBe(true)
    expect(mostlyInView({ ratio: 0.2, visibleHeight: 399, viewHeight: 800 })).toBe(false)
    expect(mostlyInView({ ratio: 0, visibleHeight: 0, viewHeight: 0 })).toBe(false)
  })
})

describe('the posts the owner marked unread by hand', () => {
  const storage = (initial?: string): HeldStorage & { value: string | null } => {
    const box: HeldStorage & { value: string | null } = { value: initial ?? null, getItem: () => box.value, setItem: (_key, value) => void (box.value = value) }
    return box
  }

  it('holds a post and lets it go', () => {
    const held = createHeldStore(storage())
    expect(held.has('a')).toBe(false)
    held.hold('a')
    expect(held.has('a')).toBe(true)
    held.release(['a', 'unknown'])
    expect(held.has('a')).toBe(false)
  })

  it('keeps what it holds in the window\'s storage, so a restart does not give the post back to the clock', () => {
    const box = storage()
    createHeldStore(box).hold('a')
    expect(createHeldStore(box).has('a')).toBe(true)
  })

  it('forgets the oldest press first when it holds more than its limit, and holds a post once', () => {
    const held = createHeldStore(storage(), 3)
    for (const id of ['a', 'b', 'c', 'd', 'b']) held.hold(id)
    expect(['a', 'b', 'c', 'd'].map((id) => held.has(id))).toEqual([false, true, true, true])
    expect(HELD_LIMIT).toBe(500)
  })

  it('works without storage, or with storage that is broken, until the window closes', () => {
    const none = createHeldStore(undefined)
    none.hold('a')
    expect(none.has('a')).toBe(true)
    expect(createHeldStore(storage('not json')).has('a')).toBe(false)
    expect(createHeldStore(storage('{"a":1}')).has('a')).toBe(false)
    const refusing: HeldStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      }
    }
    const held = createHeldStore(refusing)
    expect(() => held.hold('a')).not.toThrow()
    expect(held.has('a')).toBe(true)
  })
})

describe('"Mark all as read"', () => {
  it('takes the unread posts among the rows it is given, in order, and leaves out the read ones', () => {
    const rows = [card({ id: 'a' }), card({ id: 'b', seenAt: '2026-11-15T09:00:00.000Z' }), card({ id: 'c' })].map(findingRowOf)
    expect(unreadIds(rows)).toEqual(['a', 'c'])
    expect(unreadIds([])).toEqual([])
    expect(unreadIds([findingRowOf(card({ id: 'x', seenAt: '2026-11-15T09:00:00.000Z' }))])).toEqual([])
  })
})

describe('the words and numbers of a card', () => {
  it('gives each platform a round mark of two letters at most', () => {
    expect(channelMark('reddit')).toBe('r/')
    expect(channelMark('instagram')).toBe('IG')
    expect(channelMark('threads')).toBe('@')
    expect(channelMark('mastodon')).toBe('M')
    expect(channelMark('')).toBe('?')
  })

  it('offers "Read more" only for a text that is longer than five lines', () => {
    expect(BODY_LINES).toBe(5)
    expect(needsReadMore('')).toBe(false)
    expect(needsReadMore('A short post.')).toBe(false)
    expect(needsReadMore('x'.repeat(80 * 5))).toBe(false)
    expect(needsReadMore('x'.repeat(80 * 5 + 1))).toBe(true)
    expect(needsReadMore('one\ntwo\nthree\nfour\nfive')).toBe(false)
    expect(needsReadMore('one\ntwo\nthree\nfour\nfive\nsix')).toBe(true)
  })

  it('stands for the thread with the first sentence of what the AI wrote of it, cut when it is long, and with nothing when it wrote nothing', () => {
    expect(peopleSay({ analysis: 'People recommend free sites. Nobody explained the houses.', thread: 'Two people name apps.' })).toBe('People recommend free sites.')
    expect(peopleSay({ analysis: '', thread: 'Two people name apps.  They agree.' })).toBe('Two people name apps.')
    expect(peopleSay({ analysis: '  \n ', thread: '' })).toBeNull()
    expect(peopleSay({ analysis: 'No full stop here', thread: '' })).toBe('No full stop here')
    const long = `${'word '.repeat(40)}end.`
    const said = peopleSay({ analysis: long, thread: '' }) ?? ''
    expect(said.length).toBeLessThanOrEqual(111)
    expect(said.endsWith('…')).toBe(true)
  })

  it('writes the numbers the site showed, and leaves out a number the site did not give', () => {
    expect(countText(0)).toBe('0')
    expect(countText(999)).toBe('999')
    expect(countText(1000)).toBe('1k')
    expect(countText(1240)).toBe('1.2k')
    expect(countText(15_999)).toBe('15.9k')
    expect(siteNumbers({ score: 97, replies: 12 })).toEqual({ score: '97', comments: '12' })
    expect(siteNumbers({ score: null, replies: 3 })).toEqual({ score: null, comments: '3' })
    expect(siteNumbers({ score: null, replies: null })).toEqual({ score: null, comments: null })
  })

  it('lays one picture across the card and two or more in two columns', () => {
    expect([0, 1, 2, 3, 4].map(pictureColumns)).toEqual([1, 1, 2, 2, 2])
  })
})
