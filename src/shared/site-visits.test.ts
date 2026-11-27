import { describe, expect, it } from 'vitest'
import { analyticsNote } from './site-visits'

describe('what a results page says about the site\'s analytics (DEC-073)', () => {
  it('says that none is chosen when the product has none, or nothing is known yet', () => {
    expect(analyticsNote({ source: 'none', canRead: false })).toMatch(/^No analytics is chosen for this product’s site/)
    expect(analyticsNote(null)).toMatch(/^No analytics is chosen/)
  })

  it('names the service the visitors are read from, and never claims more than visitors', () => {
    expect(analyticsNote({ source: 'plausible', canRead: true })).toBe('Visitors of the site are read from Plausible (the “Site visits” card); they say how many people came, not what they did there.')
  })

  it('says a chosen service is not read: Google Analytics, or Plausible with no key', () => {
    expect(analyticsNote({ source: 'google', canRead: false })).toMatch(/^Google Analytics is chosen as this site’s analytics; the application does not read visitors from it now/)
    expect(analyticsNote({ source: 'plausible', canRead: false })).toMatch(/^Plausible is chosen .* does not read visitors from it now/)
  })
})
