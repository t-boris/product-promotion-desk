// The words and decisions of the channel page's "Look around with the AI" card (DEC-045). The card lives in src/renderer/src/pages/channels; its
// logic is pure and imports only src/shared types, so it is tested here (the renderer has no runner of its own).

import { describe, expect, it } from 'vitest'
import type { QuickTrendsResult } from '../shared/quick-ai'
import { LOOK_AROUND_INTRO, LOOK_BUTTONS, lookArgs, lookBlockedReason, lookButtonOf, lookView } from '../renderer/src/pages/channels/look-around'

describe('the buttons', () => {
  it('are the three kinds of look, in this order, each with its own words', () => {
    expect(LOOK_BUTTONS.map((b) => b.mode)).toEqual(['trends', 'now', 'feed'])
    expect(LOOK_BUTTONS.map((b) => b.label)).toEqual(['What people talk about', 'What is happening now', 'Analyse the feed'])
    expect(new Set(LOOK_BUTTONS.map((b) => b.what)).size).toBe(3)
    expect(lookButtonOf('feed')?.label).toBe('Analyse the feed')
    expect(lookButtonOf(null)).toBeUndefined()
  })

  it('say that the AI only reads', () => {
    expect(LOOK_AROUND_INTRO).toMatch(/only reads/)
    expect(LOOK_AROUND_INTRO).toMatch(/posts nothing/)
  })
})

describe('lookArgs', () => {
  const channel = { id: 'c1', productId: 'p1' }

  it('sends the channel, its product and the kind of look; the owner\'s words only when there are some', () => {
    expect(lookArgs(channel, 'now', '')).toEqual({ productId: 'p1', channelId: 'c1', mode: 'now' })
    expect(lookArgs(channel, 'trends', '  birth chart memes ')).toEqual({ productId: 'p1', channelId: 'c1', mode: 'trends', wish: 'birth chart memes' })
  })

  it('keeps the owner\'s words within the limit the core accepts', () => {
    expect((lookArgs(channel, 'feed', 'x'.repeat(1000)).wish ?? '').length).toBeLessThanOrEqual(200)
  })
})

describe('lookBlockedReason', () => {
  it('leaves a paused channel alone, and lets every other one be looked at', () => {
    expect(lookBlockedReason({ status: 'paused' })).toMatch(/paused/)
    for (const status of ['setup', 'active', 'needs_user', 'error'] as const) expect(lookBlockedReason({ status })).toBeNull()
  })
})

describe('lookView', () => {
  it('shows the topics, the angle and what was looked for', () => {
    const result: QuickTrendsResult = { state: 'ready', topics: [{ topic: 'Mercury retrograde', what: 'People ask what to avoid.', url: null }], angle: { text: 'Explain it in one minute.', why: 'It is asked a lot.' }, searched: ['natal chart'], note: null }
    expect(lookView(result)).toEqual({ kind: 'topics', topics: result.topics, angle: result.angle, searched: 'Looked for: natal chart', note: null })
  })

  it('says nothing about a search when none was made (the places themselves were looked at)', () => {
    expect(lookView({ state: 'ready', topics: [], angle: null, searched: [], note: 'Stopped early.' })).toMatchObject({ kind: 'topics', searched: null, note: 'Stopped early.' })
  })

  it('turns every other answer into one message; a look the owner stopped is not a warning', () => {
    expect(lookView({ state: 'stopped', message: 'You stopped it.' })).toEqual({ kind: 'message', state: 'stopped', tone: 'neutral', text: 'You stopped it.' })
    for (const state of ['unavailable', 'needs_owner', 'failed'] as const) expect(lookView({ state, message: 'Words.' })).toEqual({ kind: 'message', state, tone: 'warn', text: 'Words.' })
  })
})
