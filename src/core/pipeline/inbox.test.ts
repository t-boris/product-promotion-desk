// The account's inbox (DEC-039): replies to the account and mentions of it become Feed items, under the rules of every other source
// (baseline, own login, one voice, once), and nothing that goes wrong with the inbox ever costs the discussion read.

import { afterEach, describe, expect, it } from 'vitest'
import type { Capability, Channel, Opportunity } from '../../shared/types'
import { NO_INBOX_REASON } from '../channels/capabilities'
import { TakeoverError, type RemoteInboxItem } from '../ports'
import type { Ingestor } from './ingest'
import { INBOX_ITEM_LIMIT, INBOX_NEEDS_IDENTITY, INBOX_PACING_MS, INBOX_READABLE_DETAIL, INBOX_THREAD_LIMIT } from './inbox'
import { OTHER_LOGIN_SPEAKS_REASON } from './store'
import { closeWorld, makeWorld, type World, type WorldOptions } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const APPROVAL: WorldOptions = { mode: 'approval' }

const inboxCalls = (): number => world.connector.calls.filter((c) => c === 'readInbox').length
const threadCalls = (): string[] => world.connector.calls.filter((c) => c.startsWith('fetchThread'))
const inboxCap = (channel: Channel = world.channel): Capability | undefined => world.refresh(channel).capabilities.find((c) => c.key === 'read_inbox')
const opps = (channel: Channel = world.channel): Opportunity[] => world.store.list({ channelId: channel.id })

let n = 0
function item(kind: RemoteInboxItem['kind'], over: Partial<RemoteInboxItem['comment']> = {}, discussionExternalId = 'd1'): RemoteInboxItem {
  n += 1
  const externalId = over.externalId ?? `t1_inbox${n}`
  return {
    kind,
    discussionExternalId,
    discussionUrl: `https://fake.test/r/test/comments/${discussionExternalId}`,
    discussionTitle: `Post ${discussionExternalId}`,
    comment: {
      externalId,
      parentExternalId: 't1_mine',
      author: 'curious_user',
      body: kind === 'mention' ? 'Hey, have you seen what brand_account built?' : 'Thanks, and how does the chart handle birth times?',
      url: `https://fake.test/r/test/comments/${discussionExternalId}/${externalId}`,
      postedAt: '2026-11-03T10:00:00.000Z',
      ...over
    }
  }
}

const cycle = async (channel: Channel = world.channel) => {
  const outcome = await world.monitor.runChannel(channel.id)
  expect(outcome.status).toBe('ok')
  return outcome
}

/** The first read of the inbox is the baseline: after it, what arrives is new. */
async function pastBaseline(channel: Channel = world.channel): Promise<void> {
  await cycle(channel)
  expect(world.store.inboxBaselineDone(channel.id)).toBe(true)
}

describe('the first read of the inbox is a baseline', () => {
  it('stores what is there and queues nothing, then only what arrives later', async () => {
    world = makeWorld(APPROVAL)
    world.connector.inbox = [item('reply_to_me', { externalId: 't1_old1' }), item('mention', { externalId: 't1_old2' })]

    const first = await cycle()

    expect(first.newOpportunities).toBe(0)
    expect(first.summary).toMatch(/inbox baseline stored: 2 item/)
    expect(opps()).toEqual([])
    expect(world.store.commentByExternalId(world.channel.id, 't1_old1')?.baseline).toBe(true)
    expect(world.store.inboxBaselineDone(world.channel.id)).toBe(true)

    await cycle()
    expect(opps()).toEqual([]) // seen at the baseline: never new

    world.connector.inbox.unshift(item('reply_to_me', { externalId: 't1_fresh' }))
    const third = await cycle()
    expect(third.newOpportunities).toBe(1)
    expect(opps().map((o) => world.store.comment(o.commentId as string)?.externalId)).toEqual(['t1_fresh'])
  })

  it('applies to a channel that was baselined long ago, once, because its inbox was never read', async () => {
    world = makeWorld({ ...APPROVAL, baselineDone: true })
    expect(world.store.inboxBaselineDone(world.channel.id)).toBe(false)
    world.connector.inbox = [item('reply_to_me', { externalId: 't1_backlog' })]
    await cycle()
    expect(opps()).toEqual([])
  })

  it('is done even when the inbox was empty', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.inbox = [item('reply_to_me')]
    expect((await cycle()).newOpportunities).toBe(1)
  })
})

describe('replies and mentions after the baseline', () => {
  it('become one opportunity each, of the source the inbox says, targeting the comment', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    const reply = item('reply_to_me', { externalId: 't1_r1' })
    const mention = item('mention', { externalId: 't1_m1', parentExternalId: null })
    world.connector.inbox = [reply, mention]

    const outcome = await cycle()

    expect(outcome.newOpportunities).toBe(2)
    expect(outcome.summary).toMatch(/2 inbox item\(s\), 2 new opportunity/)
    const byComment = new Map(opps().map((o) => [world.store.comment(o.commentId as string)?.externalId, o]))
    expect(byComment.get('t1_r1')).toMatchObject({ kind: 'reply', source: 'reply_to_me', state: 'discovered', destination: reply.comment.url })
    expect(byComment.get('t1_m1')).toMatchObject({ kind: 'reply', source: 'mention', state: 'discovered' })
    expect(world.store.list({ channelId: world.channel.id, source: 'mention' })).toHaveLength(1)
  })

  it('are queued once, however often the inbox is read again', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.inbox = [item('reply_to_me')]
    await cycle()
    await cycle()
    const third = await cycle()
    expect(third.newOpportunities).toBe(0)
    expect(opps()).toHaveLength(1)
  })

  it('are not queued again after the owner rejected them', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.inbox = [item('reply_to_me')]
    await cycle()
    world.store.updateOpportunity(opps()[0].id, { state: 'cancelled' })
    await cycle()
    expect(opps()).toHaveLength(1)
    expect(opps()[0].state).toBe('cancelled')
  })

  it('are named for what they are when the discussion read had already queued the same comment', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 't1_both', author: 'curious_user', body: 'Replying to your note: how does it work?' })
    world.connector.inbox = [item('reply_to_me', { externalId: 't1_both' })]

    const outcome = await cycle()

    expect(outcome.newOpportunities).toBe(1) // the discussion read's; the inbox adds nothing
    expect(opps()).toHaveLength(1)
    expect(opps()[0].source).toBe('reply_to_me')
  })

  it('leave a comment the baseline stored without an opportunity alone, when the inbox lists it later', async () => {
    world = makeWorld({ ...APPROVAL, baselineDone: false })
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 't1_old', author: 'curious_user' })
    await cycle() // baselines the discussion and the inbox
    world.connector.inbox = [item('reply_to_me', { externalId: 't1_old' })]
    await cycle()
    expect(opps()).toEqual([])
  })
})

describe('the account\'s own comments in the inbox', () => {
  it('are stored as own and never queued: the channel\'s login, another login of the product, and a result this app published', async () => {
    world = makeWorld(APPROVAL)
    world.addAccount({ label: 'Developer', identity: 'dev_dan' })
    await pastBaseline()
    world.core.db.prepare(`INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, created_at, updated_at) VALUES ('prior', ?, ?, 'standalone', 'confirmed', 'x', 'then', 'then')`).run(world.channel.id, world.product.id)
    world.core.db.prepare(`INSERT INTO drafts (id, opportunity_id, text, author, created_at) VALUES ('d-prior', 'prior', 't', 'user', 'then')`).run()
    world.core.db.prepare(`INSERT INTO approvals (id, draft_id, content_hash, account_id, destination, approved_by, approved_at) VALUES ('ap-prior', 'd-prior', 'h', ?, 'x', 'user', 'then')`).run(world.account.id)
    world.core.db
      .prepare(
        `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state, attempted_at, authorization_basis, result_external_id)
         VALUES ('act-prior', 'prior', 'd-prior', 'ap-prior', 'h', ?, 'x', 'confirmed', 'then', 'user approval', 't1_published')`
      )
      .run(world.account.id)
    world.connector.inbox = [
      item('reply_to_me', { externalId: 't1_me', author: 'Brand_Account' }),
      item('mention', { externalId: 't1_dev', author: 'u/dev_dan' }),
      item('reply_to_me', { externalId: 't1_published', author: 'someone' })
    ]

    const outcome = await cycle()

    expect(outcome.newOpportunities).toBe(0)
    expect(world.store.list({ channelId: world.channel.id, kind: 'reply' })).toEqual([])
    for (const id of ['t1_me', 't1_dev', 't1_published']) expect(world.store.commentByExternalId(world.channel.id, id)?.isOwn).toBe(true)
  })

  it('do not hide somebody else\'s item next to them', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.inbox = [item('reply_to_me', { author: 'brand_account' }), item('reply_to_me', { externalId: 't1_real' })]
    await cycle()
    expect(opps()).toHaveLength(1)
  })
})

describe('one voice per discussion (DEC-010)', () => {
  it('records an item as cancelled, with the reason, when another login of the product already speaks in its discussion', async () => {
    world = makeWorld(APPROVAL)
    const developer = world.addAccount({ label: 'Developer', identity: 'dev_dan' })
    const channelB = world.addChannel({ accountId: developer.id, target: world.channel.target, mode: 'approval' })
    world.connector.addDiscussion({ externalId: 'd1' })
    await pastBaseline(world.channel)
    await pastBaseline(channelB)
    // The developer's login is mid-reply in d1.
    world.connector.addComment('d1', { externalId: 't1_q', author: 'curious_user', body: 'Question for the developer?' })
    await cycle(channelB)
    const devOpp = opps(channelB).find((o) => o.state === 'discovered')!
    world.store.updateOpportunity(devOpp.id, { state: 'awaiting_approval' })

    world.connector.inbox = [item('reply_to_me', { externalId: 't1_replyA' })]
    const outcome = await cycle(world.channel)

    const mine = opps(world.channel).filter((o) => world.store.comment(o.commentId as string)?.externalId === 't1_replyA')
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ state: 'cancelled', reason: OTHER_LOGIN_SPEAKS_REASON, source: 'reply_to_me' })
    expect(outcome.newOpportunities).toBe(0)
  })
})

describe('the capability decides whether the inbox is read, and says why when it is not', () => {
  it('reads nothing while it is unavailable, and keeps the reason it was given', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(
      JSON.stringify(world.channel.capabilities.map((c) => (c.key === 'read_inbox' ? { ...c, status: 'unavailable', detail: 'Reddit refused the inbox (HTTP 403).' } : c))),
      world.channel.id
    )
    world.connector.inbox = [item('reply_to_me')]
    const before = inboxCalls()

    await cycle()

    expect(inboxCalls()).toBe(before)
    expect(opps()).toEqual([])
    expect(inboxCap()).toMatchObject({ status: 'unavailable', detail: 'Reddit refused the inbox (HTTP 403).' })
  })

  it('reads nothing while it is restricted', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.core.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(
      JSON.stringify(world.channel.capabilities.map((c) => (c.key === 'read_inbox' ? { ...c, status: 'restricted', detail: 'Rules forbid it.' } : c))),
      world.channel.id
    )
    world.connector.inbox = [item('reply_to_me')]
    const before = inboxCalls()
    await cycle()
    expect(inboxCalls()).toBe(before)
    expect(opps()).toEqual([])
  })

  it('reads a channel that was never assessed for it (needs_check)', async () => {
    world = makeWorld({ ...APPROVAL, capabilities: world_caps('needs_check') })
    await pastBaseline()
    world.connector.inbox = [item('reply_to_me')]
    expect((await cycle()).newOpportunities).toBe(1)
  })

  it('records that the inbox is readable after a good read, once', async () => {
    world = makeWorld({ ...APPROVAL, capabilities: world_caps('needs_check') })
    await cycle()
    expect(inboxCap()).toMatchObject({ status: 'verified', detail: INBOX_READABLE_DETAIL })
    const stamp = inboxCap()?.checkedAt
    await cycle()
    expect(inboxCap()?.checkedAt).toBe(stamp) // unchanged: the row is not rewritten on every cycle
  })

  it('stays empty on a platform that has no inbox, says so in the channel status, and still reads the discussions', async () => {
    world = makeWorld(APPROVAL)
    world.connector.readInbox = undefined
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 't1_c', author: 'curious_user', body: 'A question?' })

    const outcome = await cycle()

    expect(outcome.newOpportunities).toBe(1) // the discussion read, as ever
    expect(opps()).toHaveLength(1)
    expect(opps()[0].source).toBe('comment')
    expect(inboxCap()).toMatchObject({ status: 'unavailable', detail: NO_INBOX_REASON })
    expect(world.store.inboxBaselineDone(world.channel.id)).toBe(false)
  })

  it('waits for a sign-in when the account identity is unknown, and says so', async () => {
    world = makeWorld({ ...APPROVAL, identity: null })
    world.core.db.prepare('UPDATE accounts SET identity = NULL').run()
    world.connector.inbox = [item('reply_to_me')]
    await cycle()
    expect(inboxCalls()).toBe(0)
    expect(inboxCap()).toMatchObject({ status: 'needs_user', detail: INBOX_NEEDS_IDENTITY })
    expect(opps()).toEqual([])
  })
})

describe('an inbox that fails never costs the discussion read', () => {
  it('keeps the new comments of the discussions, records the reason, and tries again next time', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 't1_c', author: 'curious_user', body: 'A question?' })
    world.connector.inboxError = new Error('Could not read the inbox: unexpected response (HTTP 500)')

    const outcome = await cycle()

    expect(outcome.status).toBe('ok')
    expect(outcome.newOpportunities).toBe(1)
    expect(opps()).toHaveLength(1)
    expect(inboxCap()).toMatchObject({ status: 'needs_check', detail: 'The inbox could not be read: Could not read the inbox: unexpected response (HTTP 500)' })
    expect(world.refresh().status).toBe('active') // the channel itself is fine

    world.connector.inboxError = null
    world.connector.inbox = [item('reply_to_me', { externalId: 't1_later' })]
    const next = await cycle()
    expect(next.newOpportunities).toBe(1)
    expect(inboxCap()?.status).toBe('verified')
  })

  it('does not mark the baseline done, so the first good read is still the baseline', async () => {
    world = makeWorld(APPROVAL)
    world.connector.inboxError = new Error('down')
    await cycle()
    expect(world.store.inboxBaselineDone(world.channel.id)).toBe(false)
    world.connector.inboxError = null
    world.connector.inbox = [item('reply_to_me', { externalId: 't1_backlog' })]
    await cycle()
    expect(opps()).toEqual([]) // baseline
  })

  it('is silent when the owner took the browser: nothing is recorded, nothing is lost', async () => {
    world = makeWorld({ ...APPROVAL, capabilities: world_caps('needs_check') })
    world.connector.inboxError = new TakeoverError()
    const outcome = await cycle()
    expect(outcome.status).toBe('ok')
    expect(inboxCap()?.status).toBe('needs_check')
    expect(inboxCap()?.detail).toBe('Not checked.')
  })

  it('survives a read that returns nothing usable', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.readInbox = async () => undefined as unknown as RemoteInboxItem[]
    const outcome = await cycle()
    expect(outcome.status).toBe('ok')
    expect(inboxCap()?.status).toBe('needs_check')
  })
})

describe('the ingest of the inbox, whoever calls it', () => {
  it('queues nothing while the account identity is unknown, and still stores what it was given', async () => {
    world = makeWorld({ ...APPROVAL, identity: null })
    world.core.db.prepare('UPDATE accounts SET identity = NULL').run()
    const ingestor = (world.core.services.monitor as unknown as { ingestor: Ingestor }).ingestor
    const channel = world.refresh()
    const account = world.core.repos.account(channel.accountId)

    const result = ingestor.ingestInbox(channel, account, [item('reply_to_me', { externalId: 't1_x' })], { baseline: false })

    expect(result).toMatchObject({ stored: 1, newOpportunities: 0 })
    expect(world.store.commentByExternalId(channel.id, 't1_x')).not.toBeNull()
    expect(opps()).toEqual([])
  })
})

describe('the discussion of an item that is not stored yet', () => {
  /** A discussion the discussion read does not return (past its 25 newest) but a thread read finds. */
  function oldThread(externalId = 'old-thread') {
    for (let i = 0; i < 25; i += 1) world.connector.addDiscussion({ externalId: `filler${i}_${externalId}` })
    return world.connector.addDiscussion({ externalId, title: 'An older thread', author: 'op_user', body: 'The original post of an older thread.' })
  }

  it('is read for its post and its comments, so the AI answers with the thread in front of it', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    oldThread()
    world.connector.addComment('old-thread', { externalId: 't1_sibling', author: 'alice', body: 'An earlier remark.' })
    world.connector.addComment('old-thread', { externalId: 't1_mine', author: 'brand_account', body: 'Our earlier comment.' })
    world.connector.addComment('old-thread', { externalId: 't1_reply', parentExternalId: 't1_mine', author: 'curious_user', body: 'Following up on your comment.' })
    world.connector.inbox = [item('reply_to_me', { externalId: 't1_reply', parentExternalId: 't1_mine' }, 'old-thread')]

    const outcome = await cycle()

    expect(outcome.newOpportunities).toBe(1)
    expect(threadCalls()).toContain('fetchThread old-thread')
    const stored = world.store.discussionByExternalId(world.channel.id, 'old-thread')!
    expect(stored).toMatchObject({ title: 'An older thread', author: 'op_user', body: 'The original post of an older thread.' })
    // Only the inbox item is queued; the rest of the thread is background.
    expect(opps().map((o) => world.store.comment(o.commentId as string)?.externalId)).toEqual(['t1_reply'])
    expect(world.store.commentByExternalId(world.channel.id, 't1_sibling')?.baseline).toBe(true)
    expect(world.store.commentByExternalId(world.channel.id, 't1_mine')?.isOwn).toBe(true)
  })

  it('is stored from what the inbox says when the thread cannot be read, and the item is still queued', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.fetchThreadError = new Error('thread read failed')
    world.connector.inbox = [item('mention', { externalId: 't1_m' }, 'unknown-thread')]

    const outcome = await cycle()

    expect(outcome.newOpportunities).toBe(1)
    expect(world.store.discussionByExternalId(world.channel.id, 'unknown-thread')).toMatchObject({ title: 'Post unknown-thread', url: 'https://fake.test/r/test/comments/unknown-thread' })
    expect(opps()[0].source).toBe('mention')
  })

  it('never overwrites a discussion that is already stored', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.addDiscussion({ externalId: 'd1', title: 'The real title', author: 'op_user', body: 'The real body.' })
    await cycle()
    world.connector.inbox = [{ ...item('reply_to_me'), discussionTitle: 'A different title from the inbox' }]
    await cycle()
    expect(world.store.discussionByExternalId(world.channel.id, 'd1')).toMatchObject({ title: 'The real title', author: 'op_user', body: 'The real body.' })
  })

  it('is not read at the baseline, and not for an item that was stored before', async () => {
    world = makeWorld(APPROVAL)
    world.connector.inbox = [item('reply_to_me', { externalId: 't1_a' }, 'never-read')]
    await cycle()
    expect(threadCalls().some((c) => c.includes('never-read'))).toBe(false)
    const before = threadCalls().length
    await cycle()
    expect(threadCalls().length).toBe(before)
  })
})

describe('a cycle is bounded', () => {
  it('takes at most one batch of items from the inbox', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    world.connector.inbox = Array.from({ length: INBOX_ITEM_LIMIT + 15 }, (_, i) => item('reply_to_me', { externalId: `t1_bulk${i}` }))
    const outcome = await cycle()
    expect(outcome.newOpportunities).toBe(INBOX_ITEM_LIMIT)
    expect(opps()).toHaveLength(INBOX_ITEM_LIMIT)
  })

  it('also keeps to the batch when a connector hands back more than it was asked for', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    const many = Array.from({ length: INBOX_ITEM_LIMIT + 10 }, (_, i) => item('reply_to_me', { externalId: `t1_over${i}` }))
    world.connector.readInbox = async () => many
    expect((await cycle()).newOpportunities).toBe(INBOX_ITEM_LIMIT)
  })

  it('reads only a few threads, one request at a time with the pacing between them, and queues the rest from what the inbox says', async () => {
    world = makeWorld(APPROVAL)
    await pastBaseline()
    const slept: number[] = []
    Object.assign(world.core, { sleep: async (ms: number) => void slept.push(ms) })
    for (let i = 0; i < INBOX_THREAD_LIMIT + 3; i += 1) world.connector.addDiscussion({ externalId: `hidden${i}`, title: `Hidden ${i}` })
    world.connector.discussions.reverse() // their order does not matter; the discussion read never lists them (see below)
    world.connector.fetchActivityError = null
    const hiddenIds = world.connector.discussions.map((d) => d.externalId)
    // The discussion read returns nothing here, so every item's discussion is one that is not stored.
    const realFetch = world.connector.fetchActivity.bind(world.connector)
    world.connector.fetchActivity = async (ctx, options) => ({ ...(await realFetch(ctx, options)), discussions: [] })
    world.connector.inbox = hiddenIds.map((id, i) => item('reply_to_me', { externalId: `t1_t${i}` }, id))

    const outcome = await cycle()

    expect(outcome.newOpportunities).toBe(hiddenIds.length)
    expect(threadCalls()).toHaveLength(INBOX_THREAD_LIMIT)
    expect(slept.filter((ms) => ms === INBOX_PACING_MS)).toHaveLength(INBOX_THREAD_LIMIT - 1)
  })
})

function world_caps(status: Capability['status']): Capability[] {
  return ['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send', 'metrics', 'rules', 'membership', 'read_inbox'].map((key) => ({
    key: key as Capability['key'],
    status: key === 'read_posts' || key === 'read_comments' || key === 'detect_changes' ? 'verified' : status,
    detail: 'Not checked.',
    checkedAt: null
  }))
}
