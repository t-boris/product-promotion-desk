import { describe, expect, it } from 'vitest'
import { flairApproveReason, flairChoices, offeredFlair, sameFlair } from './flair'

const FLAIRS = ['Question - Career', 'Question - Transits', 'Discussion']

describe('the same flair', () => {
  it('ignores case, spacing and the form of letters, and never matches a name that only contains the other', () => {
    expect(sameFlair('Question - Transits', '  question -   transits ')).toBe(true)
    expect(sameFlair('Ａstro', 'Astro')).toBe(true)
    expect(sameFlair('Question', 'Question - Transits')).toBe(false)
    expect(sameFlair('', '')).toBe(false)
  })

  it('is the flair of the list in the list\'s own spelling, or none', () => {
    expect(offeredFlair(FLAIRS, 'discussion')).toBe('Discussion')
    expect(offeredFlair(FLAIRS, 'Books')).toBeNull()
    expect(offeredFlair(FLAIRS, null)).toBeNull()
  })
})

describe('the choices of the Flair line', () => {
  it('are the community\'s flairs in its order', () => {
    expect(flairChoices(FLAIRS, 'Discussion').map((c) => c.value)).toEqual(FLAIRS)
    expect(flairChoices(FLAIRS, null).map((c) => c.value)).toEqual(FLAIRS)
  })

  it('name a flair the post holds that the community no longer offers, first, never dropping it silently', () => {
    const choices = flairChoices(FLAIRS, 'Old flair')
    expect(choices[0]).toEqual({ value: 'Old flair', label: 'Old flair (the community no longer offers it)' })
    expect(choices).toHaveLength(4)
  })
})

describe('approving a post for a community that may require a flair', () => {
  it('is stopped, in words, when the community requires one and the post has none', () => {
    expect(flairApproveReason({ supported: true, flairRequired: true }, null)).toBe('Choose a flair first: this community requires one.')
    expect(flairApproveReason({ supported: true, flairRequired: true }, '  ')).toBe('Choose a flair first: this community requires one.')
  })

  it('is not stopped when a flair is chosen, when none is required, when the platform has no such form, or while nothing is known yet', () => {
    expect(flairApproveReason({ supported: true, flairRequired: true }, 'Discussion')).toBeNull()
    expect(flairApproveReason({ supported: true, flairRequired: false }, null)).toBeNull()
    expect(flairApproveReason({ supported: false, flairRequired: false }, null)).toBeNull()
    expect(flairApproveReason(undefined, null)).toBeNull()
  })
})
