// A reply to a new post (DEC-039) is a top-level comment: its parent is the post (t3_), not a comment. The connector already sends that; these
// tests pin that what the Feed relies on keeps working: the request is accepted for a post address, and an unknown result is found under the post.

import { describe, expect, it } from 'vitest'
import { makeTestCore } from '../../core/testing/fakes'
import type { PublishRequest } from '../../core/ports'
import { commentThing, isoAt, listing, routeHealthyReddit, seedChannel, T0 } from '../test-helpers'
import { RedditConnector } from './connector'
import { SEL } from './selectors'

const connector = new RedditConnector({ sleep: async () => undefined, pacingMs: 0 })
const POST_URL = 'https://www.reddit.com/r/test/comments/p1/post/'

function setup() {
  const t = makeTestCore({ connectors: [connector] })
  const seeded = seedChannel(t)
  routeHealthyReddit(seeded.page)
  const ticketFor = (destination: string) => t.core.tickets.issue({ actionId: 'act-1', contentHash: 'hash', accountId: seeded.accountId, destination })
  return { ...t, ...seeded, ticketFor }
}

const postReply = (over: Partial<PublishRequest> = {}): PublishRequest => ({
  kind: 'reply',
  destination: POST_URL,
  parentExternalId: 't3_p1',
  title: null,
  text: 'It builds the chart from your birth date, time and place.',
  link: null,
  attachments: [],
  attemptedAt: isoAt(1000),
  ...over
})

const mine = (over: { id?: string; parent?: string; body?: string; created?: number } = {}) =>
  commentThing({ id: over.id ?? 'zz', author: 'natal_bot', parent: over.parent ?? 't3_p1', body: over.body ?? 'It builds the chart from your birth date, time and place.', created: over.created ?? T0 + 1060 })

describe('Reddit: a reply to a post', () => {
  it('is sent as a top-level comment under the post, to the post address', async () => {
    const h = setup()
    h.page.selectors.add('div.thing[data-fullname="t3_p1"]').add(SEL.replyText('t3_p1'))
    h.page.postedReply = { fullname: 't1_top1', permalink: '/r/test/comments/p1/post/top1/' }
    h.page.route('/api/info.json?id=t1_top1', listing([commentThing({ id: 'top1', author: 'natal_bot', parent: 't3_p1', body: postReply().text })]))

    const outcome = await connector.publish(h.ctx, h.ticketFor(POST_URL), postReply())

    expect(outcome).toMatchObject({ status: 'confirmed', externalId: 't1_top1' })
  })

  it('is found under the post when its result was unknown, and not under a comment', async () => {
    const h = setup()
    h.page.route('/user/natal_bot/comments.json', listing([mine()]))
    expect(await connector.findPublished(h.ctx, postReply())).toEqual({ url: 'https://www.reddit.com/r/test/comments/p1/post/zz/', externalId: 't1_zz' })

    h.page.route('/user/natal_bot/comments.json', listing([mine({ parent: 't1_c1' })])) // the same words under a comment are not this reply
    expect(await connector.findPublished(h.ctx, postReply())).toBeNull()
  })

  it('is refused for a post address of another community', async () => {
    const h = setup()
    const outcome = await connector.publish(h.ctx, h.ticketFor('https://www.reddit.com/r/other/comments/p1/post/'), postReply({ destination: 'https://www.reddit.com/r/other/comments/p1/post/' }))
    expect(outcome.status).toBe('failed')
  })

  it('is refused without the id of the post', async () => {
    const h = setup()
    const outcome = await connector.publish(h.ctx, h.ticketFor(POST_URL), postReply({ parentExternalId: null }))
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/needs the Reddit id/) })
  })
})
