import { describe, expect, it } from 'vitest'
import { overviewSuggestions, type SuggestionInput } from './overview-suggestions'
import type { AttentionItem, Channel, OverviewChannel, OverviewView } from './types'

const NOW = new Date('2026-11-15T12:00:00.000Z')
const DAY = 86_400_000
const ago = (days: number): string => new Date(NOW.getTime() - days * DAY).toISOString()

function channel(id: string, over: Partial<Channel> = {}, mixOn = true): Channel {
  return {
    id,
    productId: 'p1',
    accountId: 'a1',
    platform: 'reddit',
    connectorId: 'reddit',
    target: `r/${id}`,
    url: '',
    mode: 'approval',
    settings: { mix: [{ kind: 'product_post', enabled: mixOn, everyDays: 7 }] },
    capabilities: [],
    status: 'active',
    statusDetail: '',
    baselineDoneAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    nextCheckAt: null,
    plan: { steps: [] },
    reads: true,
    createdAt: ago(1),
    ...over
  } as unknown as Channel
}

function tile(c: Channel, over: Partial<OverviewChannel> = {}): OverviewChannel {
  return { channelId: c.id, platform: c.platform, target: c.target, status: c.status, waiting: 0, sent: 0, lastSuccessAt: null, nextCheckAt: null, lastSentAt: ago(1), ...over }
}

function input(channels: Channel[], over: { tiles?: OverviewChannel[]; attention?: AttentionItem[]; unusedNotes?: number } = {}): SuggestionInput {
  const overview: OverviewView = {
    productId: 'p1',
    days: 7,
    from: ago(7),
    to: NOW.toISOString(),
    funnel: { found: 0, drafted: 0, approved: 0, sent: 0 },
    channels: over.tiles ?? channels.map((c) => tile(c)),
    attention: over.attention ?? [],
    activity: []
  }
  return { overview, channels, unusedNotes: over.unusedNotes ?? 0, now: NOW }
}

const unknown = (id: string): AttentionItem => ({ id, kind: 'unknown_result', title: '', detail: '', refType: 'opportunity', refId: id, createdAt: ago(1) })

describe('overviewSuggestions', () => {
  it('has nothing to say about a channel that is planned, mixed, recent and has nothing waiting', () => {
    expect(overviewSuggestions(input([channel('a')]))).toEqual([])
  })

  it('asks the owner to confirm results first, with the right count', () => {
    const one = overviewSuggestions(input([channel('a')], { attention: [unknown('x')] }))
    expect(one[0]).toMatchObject({ id: 'unconfirmed', action: { kind: 'inbox' } })
    expect(one[0].text).toBe('Check 1 result the app could not confirm')
    const two = overviewSuggestions(input([channel('a')], { attention: [unknown('x'), unknown('y')] }))
    expect(two[0].text).toBe('Check 2 results the app could not confirm')
  })

  it('counts the drafts that wait over every channel, and puts them after the unconfirmed results', () => {
    const a = channel('a')
    const b = channel('b')
    const list = overviewSuggestions(input([a, b], { tiles: [tile(a, { waiting: 2 }), tile(b, { waiting: 1 })], attention: [unknown('x')] }))
    expect(list.map((s) => s.id)).toEqual(['unconfirmed', 'waiting'])
    expect(list[1].text).toBe('Decide on 3 drafts that wait for you')
    const single = overviewSuggestions(input([a], { tiles: [tile(a, { waiting: 1 })] }))
    expect(single[0].text).toBe('Decide on 1 draft that waits for you')
  })

  it('suggests a plan for an active channel without one, and nothing for a paused one', () => {
    const planned = channel('a')
    const open = channel('b', { plan: null })
    const paused = channel('c', { plan: null, status: 'paused' })
    const list = overviewSuggestions(input([planned, open, paused]))
    expect(list.map((s) => s.id)).toEqual(['plan:b'])
    expect(list[0].action).toEqual({ kind: 'channel', channelId: 'b', tab: 'plan' })
  })

  it('works only on channels that run: not on one in setup, waiting for the owner, in error or paused', () => {
    const states = (['setup', 'needs_user', 'error', 'paused'] as const).map((status) => channel(status, { status, plan: null }, false))
    expect(overviewSuggestions(input(states))).toEqual([])
  })

  it('suggests a content mix when no kind of post is on, including when the mix is empty', () => {
    const off = channel('a', {}, false)
    const empty = channel('b', { settings: { mix: [] } } as unknown as Partial<Channel>)
    const on = channel('c')
    const list = overviewSuggestions(input([off, empty, on]))
    expect(list.map((s) => s.id)).toEqual(['mix:a', 'mix:b'])
    expect(list[0].action).toEqual({ kind: 'channel', channelId: 'a', tab: 'mix' })
  })

  it("mentions the owner's unused notes only when a channel can use them", () => {
    expect(overviewSuggestions(input([channel('a')], { unusedNotes: 1 }))[0]).toMatchObject({
      id: 'notes',
      text: '1 note of yours is waiting to become a post',
      action: { kind: 'channel', channelId: 'a', tab: 'mix' }
    })
    expect(overviewSuggestions(input([channel('a')], { unusedNotes: 3 }))[0].text).toBe('3 notes of yours are waiting to become a post')
    expect(overviewSuggestions(input([channel('a', { status: 'paused' })], { unusedNotes: 3 }))).toEqual([])
    expect(overviewSuggestions(input([channel('a')], { unusedNotes: 0 }))).toEqual([])
  })

  it('names a channel that has been silent for the threshold, counting from its creation when it never sent', () => {
    const a = channel('a')
    const old = overviewSuggestions(input([a], { tiles: [tile(a, { lastSentAt: ago(14) })] }))
    expect(old[0]).toMatchObject({ id: 'silent:a', text: 'Nothing was sent on r/a for 14 days', action: { kind: 'posts' } })
    expect(overviewSuggestions(input([a], { tiles: [tile(a, { lastSentAt: ago(13) })] }))).toEqual([])
    // Whole days only: 13 and a half days is still 13.
    expect(overviewSuggestions(input([a], { tiles: [tile(a, { lastSentAt: ago(13.5) })] }))).toEqual([])
    const never = channel('n', { createdAt: ago(30) })
    const list = overviewSuggestions(input([never], { tiles: [tile(never, { lastSentAt: null })] }))
    expect(list[0]).toMatchObject({ id: 'silent:n', why: 'Nothing was ever sent there.' })
    const fresh = channel('f', { createdAt: ago(2) })
    expect(overviewSuggestions(input([fresh], { tiles: [tile(fresh, { lastSentAt: null })] }))).toEqual([])
  })

  it("ignores another product's channels and never shows more than the cap", () => {
    const foreign = channel('x', { productId: 'p2', plan: null })
    expect(overviewSuggestions(input([foreign]))).toEqual([])
    const many = Array.from({ length: 9 }, (_, i) => channel(`c${i}`, { plan: null }))
    expect(overviewSuggestions(input(many))).toHaveLength(5)
  })

  it('gives every suggestion a reason and a stable id', () => {
    const a = channel('a', { plan: null }, false)
    const first = overviewSuggestions(input([a], { unusedNotes: 2, attention: [unknown('x')] }))
    const second = overviewSuggestions(input([a], { unusedNotes: 2, attention: [unknown('x')] }))
    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id))
    expect(new Set(first.map((s) => s.id)).size).toBe(first.length)
    for (const s of first) {
      expect(s.why.length).toBeGreaterThan(10)
      expect(s.actionLabel.length).toBeGreaterThan(3)
    }
  })
})
