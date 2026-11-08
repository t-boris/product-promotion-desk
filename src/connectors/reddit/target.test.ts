import { describe, expect, it } from 'vitest'
import { isRedditAddress, normalizeRedditTarget, parseSubreddit, postIdFromUrl } from './target'

describe('Reddit target parsing', () => {
  it.each([
    ['r/astrology', 'astrology'],
    ['/r/astrology', 'astrology'],
    ['r/astrology/', 'astrology'],
    ['https://www.reddit.com/r/astrology/', 'astrology'],
    ['https://old.reddit.com/r/Astrology/comments/abc123/some_post/', 'Astrology'],
    ['reddit.com/r/astrology/new', 'astrology'],
    ['np.reddit.com/r/astrology', 'astrology']
  ])('recognizes %s', (input, name) => {
    expect(parseSubreddit(input)).toBe(name)
    expect(isRedditAddress(input)).toBe(true)
  })

  it.each(['https://example.com/r/astrology', 'astrology', 'https://www.reddit.com/user/someone', 'r/a', 'u/someone', '', 'https://notreddit.com/r/astrology'])(
    'does not claim %s',
    (input) => {
      expect(isRedditAddress(input)).toBe(false)
    }
  )

  it('normalizes to the short address and the canonical community URL', () => {
    expect(normalizeRedditTarget('https://old.reddit.com/r/AstroLogy/comments/x1/y/')).toEqual({
      target: 'r/AstroLogy',
      url: 'https://www.reddit.com/r/AstroLogy/'
    })
  })

  it('refuses aggregate feeds, which are not a place to promote anything', () => {
    expect(() => normalizeRedditTarget('r/all')).toThrow(/choose a specific community/)
    expect(() => normalizeRedditTarget('r/popular')).toThrow()
  })

  it('extracts a post id from permalinks', () => {
    expect(postIdFromUrl('https://www.reddit.com/r/x/comments/abc123/slug/def456/')).toBe('abc123')
    expect(postIdFromUrl('https://www.reddit.com/r/x/')).toBeNull()
  })
})
