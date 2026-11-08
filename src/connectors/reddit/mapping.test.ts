import { describe, expect, it } from 'vitest'
import { commentThing, listing, moreStub, postThing, threadJson } from '../test-helpers'
import { flattenComments, mapListing, mapMe, mapMoreChildren, mapThread } from './mapping'

describe('Reddit listing mapping', () => {
  it('maps posts with stable fullnames, ISO timestamps and absolute permalinks', () => {
    const posts = mapListing(listing([postThing({ id: 'a1', title: 'Hello', selftext: 'body text', created: 1_762_600_000 })]))
    expect(posts).toHaveLength(1)
    expect(posts?.[0]).toMatchObject({ fullname: 't3_a1', title: 'Hello', body: 'body text', permalink: 'https://www.reddit.com/r/test/comments/a1/post/' })
    expect(posts?.[0].createdAt).toBe(new Date(1_762_600_000 * 1000).toISOString())
  })

  it('shows the outbound link of a link post as its body and flags removed posts', () => {
    const posts = mapListing(
      listing([
        postThing({ id: 'l1', isSelf: false, url: 'https://example.com/x' }),
        postThing({ id: 'r1', removedByCategory: 'moderator' }),
        postThing({ id: 'r2', selftext: '[removed]' })
      ])
    )
    expect(posts?.[0].body).toBe('Link: https://example.com/x')
    expect(posts?.[1].removed).toBe(true)
    expect(posts?.[2].removed).toBe(true)
  })

  it('returns null for something that is not a listing', () => {
    expect(mapListing({ error: 403 })).toBeNull()
    expect(mapListing(null)).toBeNull()
  })
})

describe('Reddit comment tree flattening', () => {
  const permalink = 'https://www.reddit.com/r/test/comments/p1/post/'

  it('flattens nested replies and keeps parent ids', () => {
    const tree = listing([
      commentThing({ id: 'c1', replies: [commentThing({ id: 'c2', parent: 't1_c1', replies: [commentThing({ id: 'c3', parent: 't1_c2' })] })] }),
      commentThing({ id: 'c4' })
    ])
    const { comments } = flattenComments(tree, permalink)
    expect(comments.map((c) => [c.externalId, c.parentExternalId])).toEqual([
      ['t1_c1', 't3_p1'],
      ['t1_c2', 't1_c1'],
      ['t1_c3', 't1_c2'],
      ['t1_c4', 't3_p1']
    ])
    expect(comments[1].url).toBe('https://www.reddit.com/r/test/comments/p1/post/c2/')
    expect(comments[0].postedAt).not.toBeNull()
  })

  it('skips deleted and removed comments but keeps their replies and counts them', () => {
    const tree = listing([
      commentThing({ id: 'd1', author: '[deleted]', body: '[deleted]', replies: [commentThing({ id: 'k1', parent: 't1_d1', body: 'still here' })] }),
      commentThing({ id: 'm1', body: '[removed]' })
    ])
    const result = flattenComments(tree, permalink)
    expect(result.comments.map((c) => c.externalId)).toEqual(['t1_k1'])
    expect(result.skipped).toBe(2)
  })

  it('reports "load more" stubs without failing and ignores continue-thread stubs', () => {
    const tree = listing([commentThing({ id: 'c1', replies: [moreStub(['x1', 'x2'])] }), moreStub(['_']), moreStub(['x3'])])
    const result = flattenComments(tree, permalink)
    expect(result.moreIds).toEqual(['x1', 'x2', 'x3'])
    expect(result.comments).toHaveLength(1)
  })

  it('survives malformed nodes and pathological nesting', () => {
    let deep: unknown[] = [commentThing({ id: 'leaf' })]
    for (let i = 0; i < 200; i += 1) deep = [commentThing({ id: `n${i}`, replies: deep })]
    expect(() => flattenComments(listing([...deep, null, 42, { kind: 't1' }]), permalink)).not.toThrow()
  })

  it('maps a two-listing thread response and the morechildren response', () => {
    const thread = mapThread(threadJson({ id: 'p1', numComments: 2 }, [commentThing({ id: 'c1' })]))
    expect(thread?.post.fullname).toBe('t3_p1')
    expect(thread?.mapped.comments).toHaveLength(1)
    expect(mapThread([listing([])])).toBeNull()

    const more = mapMoreChildren({ json: { errors: [], data: { things: [commentThing({ id: 'x1', parent: 't1_c1' })] } } }, permalink)
    expect(more.comments.map((c) => c.externalId)).toEqual(['t1_x1'])
  })
})

describe('identity parsing', () => {
  it('reads the username from both response shapes and rejects logged-out answers', () => {
    expect(mapMe({ kind: 't2', data: { name: 'natal_bot' } })).toBe('natal_bot')
    expect(mapMe({ name: 'natal_bot' })).toBe('natal_bot')
    expect(mapMe({})).toBeNull()
    expect(mapMe({ message: 'Forbidden', error: 403 })).toBeNull()
  })
})
