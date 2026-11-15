// A new post becomes a Feed item (DEC-039): the same safety rules as for a comment (baseline, own login, one voice, once), plus the topic rule.

import { afterEach, describe, expect, it } from 'vitest'
import type { Channel, Opportunity } from '../../shared/types'
import { POST_EDITED_REASON } from './ingest'
import { OTHER_LOGIN_SPEAKS_REASON } from './store'
import { closeWorld, makeWorld, type World, type WorldOptions } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const ABOUT_CHARTS: WorldOptions = { mode: 'approval', settings: { topics: ['natal chart'], queries: [] } }

const postOpps = (channel: Channel = world.channel): Opportunity[] => world.store.list({ channelId: channel.id, source: 'new_post' })
const allOpps = (channel: Channel = world.channel): Opportunity[] => world.store.list({ channelId: channel.id })

const post = (externalId = 'np1', over: Record<string, unknown> = {}) =>
  world.connector.addDiscussion({ externalId, title: 'Which natal chart app is best?', body: 'I want to try one this week.', author: 'curious_user', ...over })

const cycle = async (channel: Channel = world.channel) => {
  const outcome = await world.monitor.runChannel(channel.id)
  expect(outcome.status).toBe('ok')
  return outcome
}

describe('a new post that names a topic of the channel', () => {
  it('becomes one opportunity whose target is the post, not a comment', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post()

    const outcome = await cycle()

    expect(outcome.newOpportunities).toBe(1)
    const [opp] = postOpps()
    const stored = world.store.discussionByExternalId(world.channel.id, 'np1')!
    expect(opp).toMatchObject({ kind: 'reply', source: 'new_post', state: 'discovered', commentId: null, discussionId: stored.id, destination: 'https://fake.test/r/test/comments/np1' })
    expect(opp.reason).toBe('New post that matches "natal chart"')
    expect(world.store.postOf(opp)?.externalId).toBe('np1')
    expect(world.store.replyParentOf(opp)).toEqual({ externalId: 'np1' })
  })

  it('also matches a search query of the channel, in the text of the post', async () => {
    world = makeWorld({ mode: 'approval', settings: { topics: [], queries: ['birth date'] } })
    post('np1', { title: 'Question', body: 'My Birth Date is in March, what now?' })
    await cycle()
    expect(postOpps()).toHaveLength(1)
  })

  it('is queued once however many times it is read again', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post()
    await cycle()
    await cycle()
    const third = await cycle()

    expect(third.newOpportunities).toBe(0)
    expect(postOpps()).toHaveLength(1)
  })

  it('is not queued again after the owner rejected it', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post()
    await cycle()
    world.store.updateOpportunity(postOpps()[0].id, { state: 'cancelled' })

    await cycle()

    expect(postOpps()).toHaveLength(1)
    expect(postOpps()[0].state).toBe('cancelled')
  })

  it('is told apart from the comments under it, which keep their own opportunities', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post()
    world.connector.addComment('np1', { externalId: 't1_first', author: 'someone', body: 'Try the free sites.' })
    await cycle()

    expect(postOpps()).toHaveLength(1)
    expect(world.store.list({ channelId: world.channel.id, source: 'comment' })).toHaveLength(1)
    expect(allOpps()).toHaveLength(2)
  })
})

describe('a new post that is not worth a look', () => {
  it('queues nothing when it names no topic or query of the channel', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post('np1', { title: 'Best pizza in town?', body: 'Asking for a friend.' })
    const outcome = await cycle()
    expect(outcome.newOpportunities).toBe(0)
    expect(allOpps()).toEqual([])
    // It is still stored, so a later edit can be told from a new post.
    expect(world.store.discussionByExternalId(world.channel.id, 'np1')).not.toBeNull()
  })

  it('queues nothing on a channel that was never told what it is about', async () => {
    world = makeWorld({ mode: 'approval' })
    post()
    await cycle()
    expect(allOpps()).toEqual([])
  })

  it('queues nothing for a topic inside a longer word', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post('np1', { title: 'The unnatal chartreuse club', body: '' })
    await cycle()
    expect(allOpps()).toEqual([])
  })

  it('queues nothing for a locked or an archived post', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post('locked', { locked: true })
    post('old', { archived: true })
    await cycle()
    expect(allOpps()).toEqual([])
  })

  it('queues nothing while the account identity is unknown, since its own posts could not be told', async () => {
    world = makeWorld({ ...ABOUT_CHARTS, identity: null })
    world.core.db.prepare('UPDATE accounts SET identity = NULL').run()
    post()
    const outcome = await cycle()
    expect(outcome.newOpportunities).toBe(0)
    expect(allOpps()).toEqual([])
  })
})

describe('the baseline rule', () => {
  it('queues nothing for the posts that were there at the first read, and then only for what is new', async () => {
    world = makeWorld({ ...ABOUT_CHARTS, baselineDone: false })
    post('old1')
    post('old2')

    const first = await cycle()
    expect(first.summary).toMatch(/Baseline stored/)
    expect(allOpps()).toEqual([])

    await cycle()
    expect(allOpps()).toEqual([]) // seen at the baseline: never "new"

    post('fresh')
    await cycle()
    expect(postOpps().map((o) => world.store.postOf(o)?.externalId)).toEqual(['fresh'])
  })

  it('never creates one when a thread is read again for the send gate', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const stranger = post('np-gate')
    const channel = world.channel
    // The ingestor is what the gate hands a changed thread to; a discussion it never stored is not a new post there.
    const ingestor = (world.core.services.monitor as unknown as { ingestor: { refreshThread: (c: Channel, a: unknown, d: unknown) => unknown } }).ingestor
    ingestor.refreshThread(channel, world.core.repos.account(channel.accountId), structuredClone(stranger))
    expect(allOpps()).toEqual([])
  })
})

describe('the account\'s own posts', () => {
  it('are never answered: the channel\'s login, another login of the product, and a post this app published', async () => {
    world = makeWorld(ABOUT_CHARTS)
    world.addAccount({ label: 'Developer', identity: 'dev_dan' })
    post('mine', { author: 'Brand_Account' })
    post('dev', { author: 'u/dev_dan' })
    post('sent', { author: 'someone_else' })
    // A post the app published and confirmed under the account, whatever name it shows.
    world.core.db
      .prepare(
        `INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, created_at, updated_at) VALUES ('prior', ?, ?, 'standalone', 'confirmed', 'x', 'then', 'then')`
      )
      .run(world.channel.id, world.product.id)
    world.core.db.prepare(`INSERT INTO drafts (id, opportunity_id, text, author, created_at) VALUES ('d-prior', 'prior', 't', 'user', 'then')`).run()
    world.core.db
      .prepare(`INSERT INTO approvals (id, draft_id, content_hash, account_id, destination, approved_by, approved_at) VALUES ('ap-prior', 'd-prior', 'h', ?, 'x', 'user', 'then')`)
      .run(world.account.id)
    world.core.db
      .prepare(
        `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, authorization_basis, result_external_id)
         VALUES ('act-prior', 'prior', 'd-prior', 'ap-prior', 'h', ?, 'x', 'confirmed', 'then', 'user approval', 'sent')`
      )
      .run(world.account.id)

    await cycle()

    expect(postOpps()).toEqual([])
  })

  it('still answers somebody else\'s post next to them', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post('mine', { author: 'brand_account' })
    post('theirs', { author: 'real_person' })
    await cycle()
    expect(postOpps().map((o) => world.store.postOf(o)?.externalId)).toEqual(['theirs'])
  })

  it('does not treat the login of another product as its own', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const other = world.addProduct('Other product')
    world.addAccount({ label: 'Rival', identity: 'rival_rita', productId: other.id })
    post('rival', { author: 'rival_rita' })
    await cycle()
    expect(postOpps()).toHaveLength(1)
  })
})

describe('one voice per discussion (DEC-010)', () => {
  /** A second login of the product with a channel in the same community. */
  function twoLogins() {
    world = makeWorld(ABOUT_CHARTS)
    const developer = world.addAccount({ label: 'Developer', identity: 'dev_dan' })
    const channelB = world.addChannel({ accountId: developer.id, target: world.channel.target, mode: 'approval', settings: { topics: ['natal chart'] } })
    return { channelA: world.channel, channelB }
  }

  it('does not queue the post for a login while another login already speaks in it', async () => {
    const { channelA, channelB } = twoLogins()
    post()
    await cycle(channelB)
    const [oppB] = postOpps(channelB)
    world.store.updateOpportunity(oppB.id, { state: 'awaiting_approval' }) // the developer's reply waits for approval: it holds the discussion

    const outcome = await cycle(channelA)

    expect(outcome.newOpportunities).toBe(0)
    const [oppA] = postOpps(channelA)
    expect(oppA).toMatchObject({ state: 'cancelled', reason: OTHER_LOGIN_SPEAKS_REASON })
    // Read again: it stays the one cancelled record, nothing else appears.
    await cycle(channelA)
    expect(postOpps(channelA)).toHaveLength(1)
  })

  it('lets the second login in once the first one gave the discussion up', async () => {
    const { channelA, channelB } = twoLogins()
    post()
    await cycle(channelB)
    world.store.updateOpportunity(postOpps(channelB)[0].id, { state: 'cancelled' }) // rejected items do not hold the discussion

    await cycle(channelA)

    expect(postOpps(channelA)[0].state).toBe('discovered')
  })

  it('is enforced again when the draft is made: the AI is not asked and nothing is saved', async () => {
    const { channelA, channelB } = twoLogins()
    post()
    await cycle(channelA)
    await cycle(channelB)
    const [oppA] = postOpps(channelA)
    const [oppB] = postOpps(channelB)
    world.store.updateOpportunity(oppB.id, { state: 'awaiting_approval' })
    world.engine.on('draft.reply', JSON.stringify({ category: 'product_question', decision: 'reply', reply: 'x', rationale: 'y', usedClaimIds: ['c1'] }))

    await world.drafting.processChannel(channelA.id)

    expect(world.opportunity(oppA.id).state).not.toBe('awaiting_approval')
    expect(world.core.repos.latestDraft(oppA.id)).toBeNull()
  })
})

describe('a post that is edited', () => {
  it('sends its pending reply back to review, with the reason', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post()
    await cycle()
    const [opp] = postOpps()
    world.core.db.prepare('INSERT INTO drafts (id, opportunity_id, text, author, created_at) VALUES (?, ?, ?, ?, ?)').run('dr1', opp.id, 'A reply.', 'ai', 'now')
    world.store.updateOpportunity(opp.id, { state: 'awaiting_approval' })

    world.connector.discussions[0].body = 'Actually I changed my mind about what I need.'
    await cycle()

    // With a draft, review returns it to where the owner reads it again; the reason says why.
    expect(world.opportunity(opp.id).reason).toBe(POST_EDITED_REASON)
    expect(world.opportunity(opp.id).state).not.toBe('ready')
  })

  it('leaves an unchanged post alone, however often it is read', async () => {
    world = makeWorld(ABOUT_CHARTS)
    post()
    await cycle()
    const [opp] = postOpps()
    world.store.updateOpportunity(opp.id, { state: 'awaiting_approval', reason: 'kept' })
    await cycle()
    await cycle()
    expect(world.opportunity(opp.id)).toMatchObject({ state: 'awaiting_approval', reason: 'kept' })
  })
})
