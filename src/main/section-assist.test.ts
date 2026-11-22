import { describe, expect, it } from 'vitest'
import { applyProposal, changeReason, MAX_SECTION, newPart, oldPart, QUICKS, rangeOf, selectedWord } from '../renderer/src/pages/review/section-assist'

describe('the selection', () => {
  it('is a range only when something real is selected', () => {
    expect(rangeOf(null, 4, 'hello world')).toBeNull()
    expect(rangeOf(3, 3, 'hello world')).toBeNull()
    expect(rangeOf(3, 4, 'hello world')).toBeNull()
    expect(rangeOf(0, 5, 'hello world')).toEqual({ start: 0, end: 5 })
    expect(rangeOf(5, 0, 'hello world')).toEqual({ start: 0, end: 5 })
    expect(rangeOf(0, 99, 'hello world')).toEqual({ start: 0, end: 11 })
    expect(rangeOf(5, 8, 'hello   world')).toBeNull()
  })

  it('says why a part cannot be changed, and how much is selected', () => {
    expect(changeReason(null)).toMatch(/Select the part/)
    expect(changeReason({ start: 0, end: MAX_SECTION + 1 })).toMatch(/smaller part/)
    expect(changeReason({ start: 0, end: 50 })).toBeNull()
    expect(selectedWord({ start: 0, end: 214 })).toBe('214 characters selected')
    expect(selectedWord({ start: 4, end: 5 })).toBe('1 character selected')
  })

  it('offers the five quick words the core knows', () => {
    expect(QUICKS.map((q) => q.value)).toEqual(['shorter', 'longer', 'simpler', 'warmer', 'rewrite'])
  })
})

describe('putting the AI\'s part in', () => {
  const asked = { text: 'one two three', title: 'T' }
  const result = { start: 4, end: 7, replacement: 'TWO!' }

  it('replaces only the chosen characters and says where the new part is', () => {
    expect(applyProposal(asked, asked, result)).toEqual({ text: 'one TWO! three', range: { start: 4, end: 8 } })
  })

  it('does nothing when the owner typed meanwhile', () => {
    expect(applyProposal({ text: 'one two three!', title: 'T' }, asked, result)).toBeNull()
  })

  it('shows the old and the new part without the blank space around them', () => {
    expect(oldPart('a\n\nbody  \n\nz', { start: 1, end: 11 })).toBe('body')
    expect(newPart({ replacement: '\n\nNew body.  ' })).toBe('New body.')
  })
})
