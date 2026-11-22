import { describe, expect, it } from 'vitest'
import { flairNames, flairRequired, mapPostForm } from './flair'

// The shape of Reddit's answers, as read from r/AskAstrologers.
const answer = [
  { type: 'text', text_editable: false, allowable_content: 'all', text: 'Question - Career', mod_only: false, id: 'a' },
  { type: 'text', text_editable: false, text: 'Question - Transits', mod_only: false, id: 'b' },
  { type: 'richtext', text: '', mod_only: false, id: 'c', richtext: [{ e: 'text', t: 'x' }] },
  { type: 'text', text: 'Mod announcement', mod_only: true, id: 'd' },
  { type: 'text', text: '  Question -   Transits ', mod_only: false, id: 'e' },
  { type: 'text', text: 'Discussion', id: 'f' },
  'not a flair',
  null
]

describe('the flairs a Reddit community offers', () => {
  it('are the names in Reddit\'s order, without the ones for moderators, without a name and without repeats', () => {
    expect(flairNames(answer)).toEqual(['Question - Career', 'Question - Transits', 'Discussion'])
  })

  it('are an empty list for a community with none, and unreadable for an answer that is not a list', () => {
    expect(flairNames([])).toEqual([])
    expect(flairNames({ error: 403 })).toBeNull()
    expect(flairNames(null)).toBeNull()
  })

  it('are cut to a short label', () => {
    expect(flairNames([{ text: 'x'.repeat(300) }])?.[0]).toHaveLength(100)
  })
})

describe('whether a community requires a flair', () => {
  it('is what Reddit says, and nothing when it says nothing', () => {
    expect(flairRequired({ is_flair_required: true, body_restriction_policy: 'required' })).toBe(true)
    expect(flairRequired({ is_flair_required: false })).toBe(false)
    expect(flairRequired({})).toBeNull()
    expect(flairRequired('x')).toBeNull()
    expect(flairRequired(null)).toBeNull()
  })
})

describe('the form of a post', () => {
  it('holds the flairs and the requirement', () => {
    expect(mapPostForm(answer, { is_flair_required: true })).toEqual({ flairs: ['Question - Career', 'Question - Transits', 'Discussion'], flairRequired: true })
  })

  it('does not require a flair when the requirements could not be read', () => {
    expect(mapPostForm(answer, null)).toEqual({ flairs: ['Question - Career', 'Question - Transits', 'Discussion'], flairRequired: false })
  })

  it('is unreadable when the list is', () => {
    expect(mapPostForm({ message: 'Forbidden' }, { is_flair_required: true })).toBeNull()
  })
})
