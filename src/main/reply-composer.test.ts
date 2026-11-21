// What the reply window of the Feed keeps and says about a place in a thread. The window itself is the screen; its words and rounds are plain functions.

import { describe, expect, it } from 'vitest'
import type { FindingComment } from '../shared/types'
import { nextAsk, placeKey, placeLabel, withRound, type Round } from '../renderer/src/pages/feed/reply-composer'

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
