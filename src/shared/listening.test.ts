import { describe, expect, it } from 'vitest'
import { cleanTerms, findAddress, watchedTerm } from './listening'

describe('wider listening: the plain rules', () => {
  it('keeps the owner\'s terms once each, within the limit', () => {
    expect(cleanTerms(['  natal   chart ', 'Natal Chart', 'x', '', 'a b', 'c d'], 2)).toEqual(['natal chart', 'a b'])
  })
  it('accepts a find only for a watched term, as the owner wrote it', () => {
    expect(watchedTerm(' co-star ', ['Natal Mystic', 'Co-Star'])).toBe('Co-Star')
    expect(watchedTerm('costar', ['Co-Star'])).toBeNull()
  })
  it('keeps a web address without credentials and fragment, and nothing else', () => {
    expect(findAddress('https://u:p@a.test/x?y=1#z')).toBe('https://a.test/x?y=1')
    expect(findAddress('ftp://a.test/x')).toBeNull()
    expect(findAddress('not an address')).toBeNull()
  })
})
