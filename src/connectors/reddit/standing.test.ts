import { describe, expect, it } from 'vitest'
import type { RedditPost } from './mapping'
import { NOTICE_LIMIT, noticeOf, removalWords, standingOfPost } from './standing'

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

  it('names the community when a moderator or its bot took it down, and says the moderators can still approve it (many hold every new post)', () => {
    expect(standingOfPost([post({ removed: true, removedBy: 'moderator' })], 't3_abc123')?.note).toBe(
      'A moderator of r/Laserengraving or its bot took it down; the moderators can still approve it.'
    )
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

describe("what the community wrote under a post it took down", () => {
  const comment = (data: Record<string, unknown>) => ({ kind: 't1', data: { author: 'someone', body: 'Nice chart', stickied: false, distinguished: null, ...data } })
  const page = (...comments: unknown[]) => [{ kind: 'Listing', data: { children: [] } }, { kind: 'Listing', data: { children: comments } }]
  const AUTOMOD = 'ALL POSTS ARE INSTANTLY REMOVED INTO A QUEUE TO AWAIT MOD APPROVAL (allow 24 hours)'

  it("reads the community bot's pinned comment, as r/AskAstrologers leaves one under every new post", () => {
    expect(noticeOf(page(comment({}), comment({ author: 'AutoModerator', body: `${AUTOMOD}\n`, stickied: true, distinguished: 'moderator' })))).toEqual({ by: 'AutoModerator', text: AUTOMOD })
  })

  it("reads a moderator speaking as one, and prefers the pinned comment", () => {
    expect(noticeOf(page(comment({ author: 'mod_a', body: 'Removed: rule 2.', distinguished: 'moderator' })))).toEqual({ by: 'mod_a', text: 'Removed: rule 2.' })
    expect(noticeOf(page(comment({ author: 'mod_a', body: 'First.', distinguished: 'moderator' }), comment({ author: 'mod_b', body: 'Pinned.', distinguished: 'moderator', stickied: true })))?.by).toBe('mod_b')
  })

  it('ignores what members wrote, an empty or removed comment, and a page that is not a post page', () => {
    expect(noticeOf(page(comment({}), comment({ author: 'AutoModerator', body: '[removed]' })))).toBeNull()
    expect(noticeOf(page())).toBeNull()
    expect(noticeOf({})).toBeNull()
    expect(noticeOf([{}])).toBeNull()
  })

  it('cuts a very long message', () => {
    const text = noticeOf(page(comment({ author: 'AutoModerator', body: 'x'.repeat(NOTICE_LIMIT + 50) })))?.text ?? ''
    expect(text.length).toBe(NOTICE_LIMIT)
    expect(text.endsWith('…')).toBe(true)
  })
})
