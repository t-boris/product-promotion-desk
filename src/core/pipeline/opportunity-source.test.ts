// opportunities.list filters by source and by product (DEC-039); every filter is optional and they combine. Nothing existing changes.

import { afterEach, describe, expect, it } from 'vitest'
import type { OpportunitySource } from '../../shared/types'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

/** One opportunity of each source in the world's channel, and one comment in a channel of another product. */
async function seeded() {
  world = makeWorld({ mode: 'approval', settings: { topics: ['natal chart'] } })
  await world.monitor.runChannel(world.channel.id) // the inbox baseline: what comes after is new
  world.connector.addDiscussion({ externalId: 'np1', title: 'A natal chart question', body: 'Which app?', author: 'someone' })
  const inboxItem = (kind: 'reply_to_me' | 'mention', id: string) => ({
    kind,
    discussionExternalId: 'ix',
    discussionUrl: 'https://fake.test/r/test/comments/ix',
    discussionTitle: 'Somewhere else',
    comment: { externalId: id, parentExternalId: null, author: 'curious_user', body: 'Hello there', url: `https://fake.test/r/test/comments/ix/${id}`, postedAt: null }
  })
  world.connector.inbox = [inboxItem('reply_to_me', 't1_reply'), inboxItem('mention', 't1_mention')]
  const comment = await world.newOpportunity() // runs a cycle: also finds the new post and the inbox items
  const post = world.store.list({ channelId: world.channel.id, source: 'new_post' })[0]
  const reply = world.store.list({ channelId: world.channel.id, source: 'reply_to_me' })[0]
  const mention = world.store.list({ channelId: world.channel.id, source: 'mention' })[0]
  const other = world.addProduct('Another product')
  // The fake platform is one world for every channel, so the other product's channel reads the same discussions; it is about nothing, so it finds no new post.
  const otherChannel = world.addChannel({ productId: other.id, target: 'r/other', settings: { topics: [], queries: [] } })
  world.connector.addDiscussion({ externalId: 'o1' })
  world.connector.addComment('o1', { externalId: 't1_o', author: 'curious_user', body: 'Hello?' })
  await world.monitor.runChannel(otherChannel.id)
  return { comment, post, reply, mention, other, otherChannel }
}

const list = (args: Parameters<World['core']['router']['call']>[1]) => world.core.router.call('opportunities.list', args as never)

describe('opportunities.list', () => {
  it('keeps the source of each opportunity and filters by it', async () => {
    const { comment, post, reply, mention } = await seeded()
    expect(comment.source).toBe('comment')
    expect(post.source).toBe('new_post')
    expect(reply.source).toBe('reply_to_me')
    expect(mention.source).toBe('mention')

    const posts = await list({ source: 'new_post' })
    expect(posts.map((c) => c.opportunity.id)).toEqual([post.id])
    expect(posts[0].comment).toBeNull()

    const comments = await list({ source: 'comment' })
    expect(comments.map((c) => c.opportunity.source)).toEqual(expect.arrayContaining(['comment']))
    expect(comments.every((c) => c.opportunity.source === 'comment')).toBe(true)
    expect(comments.some((c) => c.opportunity.id === post.id)).toBe(false)

    expect((await list({ source: 'mention' })).map((c) => c.opportunity.id)).toEqual([mention.id])
    expect((await list({ source: 'reply_to_me' })).map((c) => c.opportunity.id)).toEqual([reply.id])
  })

  it('filters by product', async () => {
    const { other, comment, post } = await seeded()
    const mine = await list({ productId: world.product.id })
    const ids = mine.map((c) => c.opportunity.id)
    expect(ids).toEqual(expect.arrayContaining([comment.id, post.id]))
    expect(mine.every((c) => c.opportunity.productId === world.product.id)).toBe(true)

    const theirs = await list({ productId: other.id })
    expect(theirs.length).toBeGreaterThan(0)
    expect(theirs.every((c) => c.opportunity.productId === other.id)).toBe(true)
    expect(theirs.map((c) => c.opportunity.id)).not.toContain(comment.id)
  })

  it('combines with the filters it always had', async () => {
    const { post, otherChannel } = await seeded()
    expect((await list({ productId: world.product.id, source: 'new_post', states: ['discovered'] })).map((c) => c.opportunity.id)).toEqual([post.id])
    expect(await list({ productId: world.product.id, source: 'new_post', states: ['confirmed'] })).toEqual([])
    expect(await list({ channelId: otherChannel.id, source: 'new_post' })).toEqual([])
    expect((await list({ channelId: world.channel.id, kind: 'reply', source: 'new_post' })).map((c) => c.opportunity.id)).toEqual([post.id])
  })

  it('lists everything as before when no filter is given', async () => {
    const { comment, post } = await seeded()
    const all = (await list(undefined)).map((c) => c.opportunity.id)
    expect(all).toEqual(expect.arrayContaining([comment.id, post.id]))
    expect(all.length).toBeGreaterThanOrEqual(3)
  })

  it('answers a source nobody has with an empty list, never an error', async () => {
    await seeded()
    expect(await list({ source: 'nonsense' as unknown as OpportunitySource })).toEqual([])
  })
})
