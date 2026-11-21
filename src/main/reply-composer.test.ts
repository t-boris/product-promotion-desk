// What the reply window of the Feed keeps and says about a place in a thread. The window itself is the screen; its words and rounds are plain functions.

import { describe, expect, it } from 'vitest'
import type { FindingComment } from '../shared/types'
import type { FindingSendResult } from '../shared/api'
import {
  nextAsk,
  placeKey,
  placeLabel,
  pickedTime,
  scheduleChoices,
  scheduledLine,
  sendBlock,
  sendLine,
  sendNote,
  storedText,
  wayOut,
  whenWords,
  withRound,
  type Round
} from '../renderer/src/pages/feed/reply-composer'

const comments: FindingComment[] = [
  { position: 0, depth: 0, author: 'anna', text: 'Try a free chart site, there are several.', url: '' },
  { position: 1, depth: 1, author: '', text: 'x'.repeat(100), url: '' }
]

describe('placeKey', () => {
  it('tells the post and each comment of each finding apart', () => {
    expect(placeKey('f1', 'post')).toBe('f1:post')
    expect(placeKey('f1', 0)).toBe('f1:0')
    expect(placeKey('f1', 0)).not.toBe(placeKey('f2', 0))
  })
})

describe('placeLabel', () => {
  it('names the post by its author, or plainly when there is none', () => {
    expect(placeLabel('post', 'u/maya', comments)).toBe('the post by u/maya')
    expect(placeLabel('post', '  ', comments)).toBe('the post')
  })

  it('names a comment by who wrote it and its first words, cut when long', () => {
    expect(placeLabel(0, 'u/maya', comments)).toBe("anna's comment: Try a free chart site, there are several.")
    const long = placeLabel(1, 'u/maya', comments)
    expect(long.startsWith("someone's comment: ")).toBe(true)
    expect(long.endsWith('…')).toBe(true)
  })

  it('does not fail on a place that is no longer in the thread', () => {
    expect(placeLabel(7, 'u/maya', comments)).toBe('a comment')
  })
})

describe('nextAsk', () => {
  it('sends the text as it stands, which the owner may have changed, and the wish without the spaces around it', () => {
    expect(nextAsk('my text', '  shorter ')).toEqual({ current: 'my text', instruction: 'shorter' })
    expect(nextAsk('', '')).toEqual({ current: '', instruction: '' })
  })
})

describe('withRound', () => {
  it('adds the round to the end and leaves the list it was given alone', () => {
    const before: Round[] = [{ wish: '', text: 'first' }]
    const after = withRound(before, ' friendlier ', 'second')
    expect(after).toEqual([
      { wish: '', text: 'first' },
      { wish: 'friendlier', text: 'second' }
    ])
    expect(before).toHaveLength(1)
  })

  it('keeps the last twenty rounds', () => {
    let rounds: Round[] = []
    for (let i = 0; i < 30; i++) rounds = withRound(rounds, `w${i}`, `t${i}`)
    expect(rounds).toHaveLength(20)
    expect(rounds[0]?.text).toBe('t10')
    expect(rounds[19]?.text).toBe('t29')
  })
})

describe('sendBlock: when Send cannot be pressed, and why', () => {
  const ok = { text: 'A comment.', blocked: '', state: null, comment: null, busy: false } as const

  it('is nothing to say when there is a text and nothing stands in the way', () => {
    expect(sendBlock(ok)).toBe('')
    expect(sendBlock({ ...ok, state: 'draft', comment: { url: 'https://www.reddit.com/r/x/comments/1/comment/2' } })).toBe('')
    // an answer that was returned to review after a failure may be sent again
    expect(sendBlock({ ...ok, state: 'awaiting_approval' })).toBe('')
  })

  it('says what the application said about the channel first, then what happened here before', () => {
    expect(sendBlock({ ...ok, blocked: 'The channel is paused.', state: 'confirmed' })).toBe('The channel is paused.')
    expect(sendBlock({ ...ok, state: 'confirmed' })).toMatch(/already posted/)
    expect(sendBlock({ ...ok, state: 'sending' })).toMatch(/being posted/)
    expect(sendBlock({ ...ok, state: 'unknown_result' })).toMatch(/not known yet/)
    expect(sendBlock({ ...ok, state: 'cancelled' })).toMatch(/stopped for good/)
  })

  it('refuses a comment with no address of its own, and an empty text, and says nothing while a send is running', () => {
    expect(sendBlock({ ...ok, comment: { url: '  ' } })).toMatch(/no address of its own/)
    expect(sendBlock({ ...ok, text: '   ' })).toBe('Write the comment first.')
    expect(sendBlock({ ...ok, text: '', blocked: 'The channel is paused.', busy: true })).toBe('')
  })
})

describe('sendLine: how a press of Send ended', () => {
  const result = (state: FindingSendResult['state'], message: string, url = ''): FindingSendResult => ({ state, message, opportunityId: 'o1', url })

  it('says posted, with the link when there is one', () => {
    expect(sendLine(result('sent', 'The comment was posted.'))).toEqual({ tone: 'good', text: 'The comment was posted.' })
    expect(sendLine(result('sent', 'The comment was posted.', 'https://x.test/c'))).toEqual({ tone: 'good', text: 'Posted: https://x.test/c' })
  })

  it('says an unknown result as it is, and never as posted', () => {
    const line = sendLine(result('unknown', 'The AI browser pressed the control. The app does not read this channel.'))
    expect(line.tone).toBe('warn')
    expect(line.text).not.toMatch(/^Posted/)
  })

  it('says that nothing was posted for a failure, a hold and a refusal', () => {
    expect(sendLine(result('failed', 'Nothing was submitted.'))).toEqual({ tone: 'bad', text: 'Not posted. Nothing was submitted.' })
    expect(sendLine(result('held', 'The browser is busy.'))).toEqual({ tone: 'warn', text: 'Not posted yet. The browser is busy. Press Send now to try again.' })
    expect(sendLine(result('refused', 'The comment is too long.'))).toEqual({ tone: 'warn', text: 'Not posted. The comment is too long.' })
  })
})

describe('sendNote: what Send now will do, said before the press', () => {
  it('names the account, the text as written and the place, and says nothing is posted before a press', () => {
    expect(sendNote('Natal Mystic Reddit', 'the post by u/maya')).toBe(
      'Send now: the AI opens the post in the browser of Natal Mystic Reddit and types this text, exactly as written, as a reply to the post by u/maya. Nothing is posted before you press a button.'
    )
  })

  it('still says whose browser when the account has no name yet', () => {
    expect(sendNote('  ', 'the post')).toContain("the account's browser")
  })
})

// The clock the owner sees: every time below is built in the local zone, so the words do not depend on where the test runs.
const at = (day: number, hours: number, minutes = 0): Date => new Date(2026, 10, day, hours, minutes, 0, 0)

describe('scheduleChoices: the times of the Schedule menu', () => {
  it('offers an hour from now, this evening at seven and tomorrow at nine in the morning', () => {
    const now = at(21, 10, 30)
    const choices = scheduleChoices(now)
    expect(choices.map((c) => c.id)).toEqual(['hour', 'evening', 'tomorrow'])
    expect(choices.map((c) => c.label)).toEqual(['In 1 hour', 'This evening 7:00 pm', 'Tomorrow 9:00 am'])
    expect(new Date(choices[0].at).getTime()).toBe(at(21, 11, 30).getTime())
    expect(new Date(choices[1].at).getTime()).toBe(at(21, 19).getTime())
    expect(new Date(choices[2].at).getTime()).toBe(at(22, 9).getTime())
  })

  it('does not offer the evening at seven or later', () => {
    expect(scheduleChoices(at(21, 19)).map((c) => c.id)).toEqual(['hour', 'tomorrow'])
    expect(scheduleChoices(at(21, 23, 40)).map((c) => c.id)).toEqual(['hour', 'tomorrow'])
    expect(scheduleChoices(at(21, 18, 59)).map((c) => c.id)).toContain('evening')
  })

  it('takes tomorrow across the end of the month', () => {
    const tomorrow = scheduleChoices(new Date(2026, 10, 30, 22, 0)).find((c) => c.id === 'tomorrow')!
    expect(new Date(tomorrow.at).getTime()).toBe(new Date(2026, 11, 1, 9, 0).getTime())
  })
})

describe('pickedTime: the time of "Pick a time…"', () => {
  const now = at(21, 10)
  it('takes a time in the future', () => {
    const picked = pickedTime('2026-11-23T14:05', now)
    expect(picked).toEqual({ ok: true, at: new Date(2026, 10, 23, 14, 5).toISOString() })
  })

  it('says why a time cannot be taken: none, past, too far', () => {
    expect(pickedTime('', now)).toEqual({ ok: false, message: 'Pick a day and a time.' })
    expect(pickedTime('2026-11-21T09:00', now)).toEqual({ ok: false, message: 'That time has already passed. Pick a time in the future.' })
    expect(pickedTime('2026-11-21T10:00', now)).toMatchObject({ ok: false })
    expect(pickedTime('2027-01-01T09:00', now)).toEqual({ ok: false, message: 'A comment can be scheduled up to 30 days ahead.' })
  })
})

describe('whenWords: a planned time in words', () => {
  const now = at(21, 10)
  it('says today and tomorrow, with the clock the twelve-hour way', () => {
    expect(whenWords(at(21, 19).toISOString(), now)).toBe('today 7:00 pm')
    expect(whenWords(at(22, 9).toISOString(), now)).toBe('tomorrow 9:00 am')
    expect(whenWords(at(21, 0, 5).toISOString(), now)).toBe('today 12:05 am')
    expect(whenWords(at(21, 12).toISOString(), now)).toBe('today 12:00 pm')
  })

  it('names the day when it is further away', () => {
    expect(whenWords(at(24, 9, 30).toISOString(), now)).toBe('Tue 24 Nov, 9:30 am')
  })

  it('does not fail on a time that is not one', () => {
    expect(whenWords('nonsense', now)).toBe('a time that is not known')
  })
})

describe('sendLine for a schedule', () => {
  const now = at(21, 10)
  const result = (state: FindingSendResult['state'], message: string, extra: Partial<FindingSendResult> = {}): FindingSendResult => ({ state, message, opportunityId: 'o1', url: '', ...extra })

  it('says when the comment goes out', () => {
    expect(sendLine(result('scheduled', 'The comment is scheduled.', { at: at(21, 19).toISOString() }), now, 'schedule')).toEqual({ tone: 'good', text: 'Scheduled for today 7:00 pm.' })
  })

  it('says a hold for the community\'s rules without "try again": the way through is the button beside it', () => {
    expect(sendLine(result('held', 'The community\'s rules do not allow this: no AI.', { code: 'channel_restricted' }), now, 'send')).toEqual({ tone: 'warn', text: 'Not posted. The community\'s rules do not allow this: no AI.' })
    expect(sendLine(result('refused', 'The community\'s rules do not allow this: no AI.', { code: 'channel_restricted' }), now, 'schedule')).toEqual({ tone: 'warn', text: 'Not scheduled. The community\'s rules do not allow this: no AI.' })
  })

  it('says "not scheduled" when a schedule was refused, and still tells a press of Send as before', () => {
    expect(sendLine(result('refused', 'That time has passed.'), now, 'schedule')).toEqual({ tone: 'warn', text: 'Not scheduled. That time has passed.' })
    expect(sendLine(result('held', 'The browser is busy.'), now, 'schedule')).toEqual({ tone: 'warn', text: 'Not scheduled. The browser is busy.' })
    expect(sendLine(result('refused', 'The comment is too long.'), now, 'send')).toEqual({ tone: 'warn', text: 'Not posted. The comment is too long.' })
  })
})

describe('wayOut: what the owner can do about a press that did not go through', () => {
  const result = (state: FindingSendResult['state'], code?: 'channel_restricted'): FindingSendResult => ({ state, message: 'm', opportunityId: null, url: '', ...(code ? { code } : {}) })

  it('offers Send anyway when the community\'s own rules are the reason, held or refused', () => {
    expect(wayOut(result('held', 'channel_restricted'))).toBe('anyway')
    expect(wayOut(result('refused', 'channel_restricted'))).toBe('anyway')
  })

  it('offers copying and the post for any other refusal, hold or failure', () => {
    expect(wayOut(result('held'))).toBe('by-hand')
    expect(wayOut(result('refused'))).toBe('by-hand')
    expect(wayOut(result('failed'))).toBe('by-hand')
  })

  it('offers nothing after a press that went through, or an unknown result, or no press', () => {
    expect(wayOut(result('sent'))).toBeNull()
    expect(wayOut(result('scheduled'))).toBeNull()
    expect(wayOut(result('unknown'))).toBeNull()
    expect(wayOut(null)).toBeNull()
  })
})

describe('storedText and scheduledLine: what a place already holds', () => {
  it('reopens a kept, edited or planned text, and nothing for a posted, stopped or empty one', () => {
    expect(storedText({ state: 'draft', text: 'Kept.' })).toBe('Kept.')
    expect(storedText({ state: 'ready', text: 'Planned.' })).toBe('Planned.')
    expect(storedText({ state: 'confirmed', text: 'Posted.' })).toBeNull()
    expect(storedText({ state: 'cancelled', text: 'Stopped.' })).toBeNull()
    expect(storedText({ state: 'draft', text: '  ' })).toBeNull()
    expect(storedText(null)).toBeNull()
  })

  it('says when it is planned, and that the text above is not the planned one when it changed', () => {
    const now = at(21, 10)
    const place = { scheduledAt: at(21, 19).toISOString(), text: 'Planned.' }
    expect(scheduledLine(place, 'Planned.', now)).toBe('Scheduled for today 7:00 pm')
    expect(scheduledLine(place, 'Changed.', now)).toBe('Scheduled for today 7:00 pm, with the text it had when you scheduled it. Change plans the text above instead.')
    expect(scheduledLine({ scheduledAt: null, text: 'Planned.' }, 'Planned.', now)).toBeNull()
  })
})
