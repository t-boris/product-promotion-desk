import { describe, expect, it } from 'vitest'
import type { PostResult, PostResultsView } from '../shared/types'
import { columnLabel, emptyReason, lineOf, shownColumns, totalOf } from '../renderer/src/pages/channels/post-results'

const post = (id: string, numbers: PostResult['numbers'], readings: PostResult['readings'] = []): PostResult => ({ actionId: id, opportunityId: `o-${id}`, title: id, url: null, sentAt: '2026-12-01T10:00:00.000Z', removed: false, numbers, readings })
const at = '2026-12-01T11:00:00.000Z'

describe('the Results tab of a channel', () => {
  it('draws only the columns the site has a number for, in the platform\'s words', () => {
    const posts = [post('a', { likes: 5, comments: 2, views: null, readAt: at }), post('b', null)]
    expect(shownColumns(posts)).toEqual(['likes', 'comments'])
    expect(shownColumns([post('b', null)])).toEqual([])
    expect(columnLabel('likes', 'reddit')).toBe('Points')
    expect(columnLabel('likes', 'instagram')).toBe('Likes')
    expect(columnLabel('views', 'reddit')).toBe('Views')
  })

  it('adds up what is known and says for how many posts that is', () => {
    const posts = [post('a', { likes: 5, comments: 2, views: null, readAt: at }), post('b', { likes: -1, comments: null, views: null, readAt: at }), post('c', null)]
    expect(totalOf(posts, 'likes')).toEqual({ sum: 4, known: 2 })
    expect(totalOf(posts, 'comments')).toEqual({ sum: 2, known: 1 })
    expect(lineOf(post('a', null, [{ readAt: at, likes: 1, comments: 0, views: null }, { readAt: at, likes: 4, comments: 1, views: null }]), 'likes')).toEqual([1, 4])
  })

  it('says why there is nothing to show', () => {
    const view = (over: Partial<PostResultsView>): PostResultsView => ({ channelId: 'c', platform: 'reddit', readable: true, byAi: false, posts: [], ...over })
    expect(emptyReason(view({ readable: false }))).toMatch(/cannot read the numbers/)
    expect(emptyReason(view({}))).toMatch(/No post of yours/)
    expect(emptyReason(view({ posts: [post('a', null)] }))).toBeNull()
  })
})
