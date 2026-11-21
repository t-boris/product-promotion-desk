// What the reply window of the Feed keeps and says about a place in a thread. The window itself is the screen; its words and rounds are plain functions.

import { describe, expect, it } from 'vitest'
import type { FindingComment } from '../shared/types'
import type { FindingSendResult } from '../shared/api'
import { nextAsk, placeKey, placeLabel, sendBlock, sendLine, sendNote, withRound, type Round } from '../renderer/src/pages/feed/reply-composer'

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
    expect(sendLine(result('held', 'The browser is busy.'))).toEqual({ tone: 'warn', text: 'Not posted yet. The browser is busy. Press Send to try again.' })
    expect(sendLine(result('refused', 'The comment is too long.'))).toEqual({ tone: 'warn', text: 'Not posted. The comment is too long.' })
  })
})

describe('sendNote: what Send will do, said before the press', () => {
  it('names the account, the text as written and the place, and says nothing is posted before the press', () => {
    expect(sendNote('Natal Mystic Reddit', 'the post by u/maya')).toBe(
      'Send: the AI opens the post in the browser of Natal Mystic Reddit and types this text, exactly as written, as a reply to the post by u/maya. Nothing is posted before you press it.'
    )
  })

  it('still says whose browser when the account has no name yet', () => {
    expect(sendNote('  ', 'the post')).toContain("the account's browser")
  })
})
