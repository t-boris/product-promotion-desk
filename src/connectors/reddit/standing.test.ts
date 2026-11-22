import { describe, expect, it } from 'vitest'
import type { RedditPost } from './mapping'
import { removalWords, standingOfPost } from './standing'

function post(overrides: Partial<RedditPost> = {}): RedditPost {
  return {
    fullname: 't3_abc123',
    title: 'A post',
    author: 'someone',
    body: '',
    permalink: 'https://www.reddit.com/r/Laserengraving/comments/abc123/a_post/',
    url: '',
    createdAt: '2026-11-22T10:00:00.000Z',
    score: 1,
    numComments: 0,
    upvoteRatio: 1,
    locked: false,
    archived: false,
    removed: false,
    removedBy: null,
    subreddit: 'Laserengraving',
    ...overrides
  }
}

describe('what Reddit says about a post the account published', () => {
  it('reads a post that is up as up', () => {
    expect(standingOfPost([post()], 't3_abc123')).toEqual({ state: 'live', note: 'The post is up on Reddit.' })
  })

  it("names Reddit's own filters when Reddit removed it", () => {
    const reading = standingOfPost([post({ removed: true, removedBy: 'reddit' })], 't3_abc123')
    expect(reading?.state).toBe('removed')
    expect(reading?.note).toMatch(/^Reddit's own filters removed it/)
    // The way out is named: the moderators of that community, through modmail.
    expect(reading?.note).toContain('moderators of r/Laserengraving')
    expect(reading?.note).toContain('modmail')
  })

  it('names the community when a moderator removed it', () => {
    expect(standingOfPost([post({ removed: true, removedBy: 'moderator' })], 't3_abc123')?.note).toBe('A moderator of r/Laserengraving removed it.')
  })

  it('says AutoModerator held it back', () => {
    expect(standingOfPost([post({ removed: true, removedBy: 'automod_filtered' })], 't3_abc123')?.note).toBe("r/Laserengraving's AutoModerator held it back for the moderators to check.")
  })

  it('says the account deleted it when the author did', () => {
    expect(removalWords('deleted', 'x')).toBe('It was deleted by the account that posted it')
    expect(removalWords('author', 'x')).toBe('It was deleted by the account that posted it')
  })

  it('says a policy removal is a policy removal', () => {
    for (const category of ['anti_evil_ops', 'community_ops', 'content_takedown', 'copyright_takedown']) {
      expect(removalWords(category, 'x')).toBe('Reddit removed it for a policy reason')
    }
  })

  it('still reads a removal whose category Reddit does not name (the text is "[removed]")', () => {
    const reading = standingOfPost([post({ removed: true, removedBy: null })], 't3_abc123')
    expect(reading).toEqual({ state: 'removed', note: 'Reddit shows it as removed.' })
  })

  it('names an unknown category as Reddit gave it, so a new kind is never hidden', () => {
    expect(removalWords('something_new', 'x')).toBe('Reddit marks it as removed (something_new)')
  })

  it('cannot tell when the post is not among the account\'s own posts: that proves nothing', () => {
    expect(standingOfPost([post({ fullname: 't3_other' })], 't3_abc123')).toBeNull()
    expect(standingOfPost([], 't3_abc123')).toBeNull()
  })

  it('matches the platform id whatever its letter case', () => {
    expect(standingOfPost([post({ fullname: 't3_ABC123' })], 't3_abc123')?.state).toBe('live')
  })
})
