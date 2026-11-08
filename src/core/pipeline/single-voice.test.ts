// Several logins of one product: its own comments across logins are never answered, and at most one login speaks
// in a discussion (DEC-010, REQ-010). The rule is enforced when comments arrive, when drafts are made and approved,
// and again by the SendGate at send time.

import { afterEach, describe, expect, it } from 'vitest'
import type { Channel, Id, Opportunity } from '../../shared/types'
import type { DraftingFlow } from './drafting'
import { SendBlockedError } from './gate'
import { OTHER_LOGIN_SPEAKS_REASON } from './store'
import { closeWorld, makeWorld, type World, type WorldOptions } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const REASON = 'Another login of this product already speaks in this discussion'
const publishCalls = (): number => world.connector.calls.filter((c) => c === 'publish').length
const drafting = (): DraftingFlow => world.drafting as DraftingFlow

const reply = (o: Record<string, unknown> = {}): string =>
  JSON.stringify({
    category: 'product_question',
    decision: 'reply',
    reply: 'It builds a natal chart from your birth date, time and place.',
    rationale: 'Answers the question from approved claim c1.',
    usedClaimIds: ['c1'],
    ...o
  })

/** Two logins of one product (an astrologer and a developer) with a channel each in the same community. */
function twoLogins(options: WorldOptions = { mode: 'approval' }) {
  world = makeWorld(options)
  const developer = world.addAccount({ label: 'Developer', identity: 'dev_dan' })
  const channelA = world.channel
  const channelB = world.addChannel({ accountId: developer.id, target: channelA.target, mode: options.mode ?? 'approval' })
  return { channelA, channelB, developer }
}

const oppFor = (channel: Channel, commentExternalId: string): Opportunity => {
  const row = world.core.db
    .prepare('SELECT o.id FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE c.channel_id = ? AND c.external_id = ?')
    .get(channel.id, commentExternalId) as { id: Id } | undefined
  if (!row) throw new Error(`no opportunity for ${commentExternalId} on ${channel.target}`)
  return world.opportunity(row.id)
}

const hasOpportunity = (channel: Channel, commentExternalId: string): boolean => {
  const row = world.core.db.prepare('SELECT 1 FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE c.channel_id = ? AND c.external_id = ?').get(channel.id, commentExternalId)
  return row !== undefined
}

/** Both logins' channels read the same comment: each gets its own discovered opportunity for it. */
async function bothSeeComment(a: Channel, b: Channel, discussionId = 'd1', commentId = 'c1', body = 'How does the natal chart work?') {
  if (!world.connector.discussions.some((d) => d.externalId === discussionId)) world.connector.addDiscussion({ externalId: discussionId })
  world.connector.addComment(discussionId, { externalId: commentId, author: 'curious_user', body })
  await world.monitor.runChannel(a.id)
  await world.monitor.runChannel(b.id)
  return { oppA: oppFor(a, commentId), oppB: oppFor(b, commentId) }
}

const sendBlocked = async (opp: Opportunity) => {
  try {
    await world.sending.send(opp.id)
  } catch (error) {
    if (error instanceof SendBlockedError) return error.block
    throw error
  }
  throw new Error('expected the send to be blocked')
}

describe('a comment written by any login of the product is its own (DEC-010)', () => {
  it('is not answered by another login of the product, whichever channel reads it', async () => {
    const { channelA, channelB } = twoLogins()
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'by-dev', author: 'Dev_Dan', body: 'As the developer I can say it uses your birth data.' })
    world.connector.addComment('d1', { externalId: 'by-dev-decorated', author: 'u/dev_dan', body: 'Same login, decorated name.' })

    await world.monitor.runChannel(channelA.id)
    await world.monitor.runChannel(channelB.id)

    for (const channel of [channelA, channelB]) {
      for (const id of ['by-dev', 'by-dev-decorated']) {
        expect(world.store.commentByExternalId(channel.id, id)?.isOwn).toBe(true)
        expect(hasOpportunity(channel, id)).toBe(false)
      }
    }
  })

  it('still answers other people, and the comments of the channel\'s own login as before are own', async () => {
    const { channelA, channelB } = twoLogins()
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'by-me', author: 'brand_account', body: 'My earlier note.' })
    world.connector.addComment('d1', { externalId: 'by-user', author: 'curious_user', body: 'A real question?' })
    await world.monitor.runChannel(channelA.id)
    expect(world.store.commentByExternalId(channelA.id, 'by-me')?.isOwn).toBe(true)
    expect(hasOpportunity(channelA, 'by-user')).toBe(true)
    await world.monitor.runChannel(channelB.id)
    expect(world.store.commentByExternalId(channelB.id, 'by-me')?.isOwn).toBe(true) // the other login's voice, from B's point of view
  })

  it('does not treat the login of another product as its own', async () => {
    const { channelA } = twoLogins()
    const other = world.addProduct('Other product')
    world.addAccount({ label: 'Other product login', identity: 'rival_rita', productId: other.id })
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'by-rival', author: 'rival_rita', body: 'A question from somebody else?' })

    await world.monitor.runChannel(channelA.id)

    expect(world.store.commentByExternalId(channelA.id, 'by-rival')?.isOwn).toBe(false)
    expect(hasOpportunity(channelA, 'by-rival')).toBe(true)
  })

  it('counts a login of another product that this product\'s channel uses on purpose', async () => {
    const { channelA } = twoLogins()
    const other = world.addProduct('Other product')
    const shared = world.addAccount({ label: 'Shared login', identity: 'shared_sam', productId: other.id })
    world.addChannel({ accountId: shared.id, target: 'r/elsewhere' }) // a channel of the world's product reuses it
    world.connector.addDiscussion({ externalId: 'd1' })
    world.connector.addComment('d1', { externalId: 'by-shared', author: 'Shared_Sam', body: 'Written with the reused login.' })

    await world.monitor.runChannel(channelA.id)

    expect(world.store.commentByExternalId(channelA.id, 'by-shared')?.isOwn).toBe(true)
    expect(hasOpportunity(channelA, 'by-shared')).toBe(false)
  })

  it('recognises the result of a confirmed send by another login of the product in the same community', async () => {
    const { channelA, channelB } = twoLogins()
    const sent = await world.readyReply({ channel: channelB })
    const action = await world.sending.send(sent.id)
    expect(action.state).toBe('confirmed')
    const resultId = action.resultExternalId as string
    // The platform shows it under a display name the identity does not match.
    world.connector.removeComment('d1', resultId)
    world.connector.addComment('d1', { externalId: resultId, parentExternalId: 'c-parent', author: 'Dan the Developer', body: 'The developer\'s answer.' })

    await world.monitor.runChannel(channelA.id)

    expect(world.store.commentByExternalId(channelA.id, resultId)?.isOwn).toBe(true)
    expect(hasOpportunity(channelA, resultId)).toBe(false)
  })

  it('does not take a result id for own in a different community', async () => {
    const { channelA, channelB } = twoLogins()
    const elsewhere = world.addChannel({ accountId: channelB.accountId, target: 'r/another_community' })
    const sent = await world.readyReply({ channel: elsewhere, discussionId: 'd9' })
    const action = await world.sending.send(sent.id)
    const resultId = action.resultExternalId as string

    expect(world.store.productConfirmedExternalIds(channelA).has(resultId)).toBe(false)
    expect(world.store.productConfirmedExternalIds(elsewhere).has(resultId)).toBe(true)
  })
})

describe('one login speaks per discussion (DEC-010, REQ-010)', () => {
  it('lets the first login draft and holds the second at drafting, with the reason shown', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA, oppB } = await bothSeeComment(channelA, channelB)
    world.engine.on('draft.reply', reply())

    await world.drafting.processChannel(channelA.id)
    expect(world.opportunity(oppA.id).state).toBe('awaiting_approval')
    const callsAfterFirst = world.engine.calls.length

    const summary = await world.drafting.processChannel(channelB.id)

    expect(summary).toEqual({ prepared: 0, autoSent: 0, needsUser: 0 })
    expect(world.engine.calls.length).toBe(callsAfterFirst) // the model was not even asked
    const held = world.opportunity(oppB.id)
    expect(held.state).toBe('discovered')
    expect(held.reason).toBe(REASON)
    expect(world.core.repos.latestDraft(oppB.id)).toBeNull()

    // Asking explicitly, or writing the reply by hand, is refused the same way.
    await expect(drafting().prepareOne(oppB.id, { explicit: true })).rejects.toMatchObject({ code: 'invalid_state', message: REASON })
    await expect(world.core.router.call('opportunities.saveDraft', { id: oppB.id, draft: { text: 'My own reply.' } })).rejects.toMatchObject({ message: REASON })
    expect(world.opportunity(oppB.id).state).toBe('discovered')
  })

  it('does not run the second analysis again and again: the reason is written once', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppB } = await bothSeeComment(channelA, channelB)
    world.engine.on('draft.reply', reply())
    await world.drafting.processChannel(channelA.id)
    await world.drafting.processChannel(channelB.id)
    const stamp = world.opportunity(oppB.id).updatedAt
    world.clock.advance(60_000)
    await world.drafting.processChannel(channelB.id)
    expect(world.opportunity(oppB.id).updatedAt).toBe(stamp)
  })

  it('refuses to approve the later login\'s item while the other login speaks', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA, oppB } = await bothSeeComment(channelA, channelB)
    world.engine.on('draft.reply', reply())
    await world.drafting.processChannel(channelA.id)
    await world.core.router.call('opportunities.defer', { id: oppA.id })
    await world.drafting.processChannel(channelB.id) // the first is deferred, so the second drafts
    expect(world.opportunity(oppB.id).state).toBe('awaiting_approval')

    // Now the deferred one comes back: it is the later one and cannot be approved over the speaking login.
    await expect(world.core.router.call('opportunities.approve', { id: oppA.id })).rejects.toMatchObject({ code: 'invalid_state', message: REASON })
    expect(world.opportunity(oppA.id).state).toBe('deferred')
    expect(world.card(oppA.id).approval).toBeNull()

    // The speaking login is unaffected.
    expect((await world.core.router.call('opportunities.approve', { id: oppB.id })).opportunity.state).toBe('ready')
  })

  it('denies the send at the gate with the same reason, even with an approval given earlier', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA, oppB } = await bothSeeComment(channelA, channelB)
    // The second login's reply was approved while nobody else spoke here ...
    await world.core.router.call('opportunities.saveDraft', { id: oppB.id, draft: { text: 'Thanks for asking! It uses your birth date, time and place.' } })
    await world.core.router.call('opportunities.approve', { id: oppB.id })
    expect(world.opportunity(oppB.id).state).toBe('ready')
    // ... and then the other login took the discussion (simulated: a race, or data from before the guard existed).
    world.core.db.prepare("UPDATE opportunities SET state = 'awaiting_approval' WHERE id = ?").run(oppA.id)

    const block = await sendBlocked(oppB)

    expect(block.code).toBe('other_login_speaks')
    expect(block.effect).toBe('review')
    expect(block.reasons).toEqual([REASON])
    expect(publishCalls()).toBe(0)
    expect(world.connector.calls.some((c) => c.startsWith('fetchThread'))).toBe(false) // decided locally, before the network
    const after = world.opportunity(oppB.id)
    expect(after.state).toBe('awaiting_approval')
    expect(after.reason).toBe(REASON)
    expect(world.card(oppB.id).approval).toBeNull() // the old approval no longer carries it
  })

  it('checks again after reading the live thread, because the other login may take the discussion meanwhile', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA, oppB } = await bothSeeComment(channelA, channelB)
    await world.core.router.call('opportunities.saveDraft', { id: oppB.id, draft: { text: 'Thanks for asking! It uses your birth date, time and place.' } })
    await world.core.router.call('opportunities.approve', { id: oppB.id })
    world.connector.onFetchThread = () => {
      world.core.db.prepare("UPDATE opportunities SET state = 'awaiting_approval' WHERE id = ?").run(oppA.id)
    }

    const block = await sendBlocked(oppB)

    expect(block.code).toBe('other_login_speaks')
    expect(publishCalls()).toBe(0)
    expect(world.opportunity(oppB.id).state).toBe('awaiting_approval')
  })

  it('also stops an automatic reply of the second login that was approved before the other login spoke', async () => {
    const { channelA, channelB } = twoLogins({ mode: 'auto', settings: { autoCategories: ['thanks', 'faq'] } })
    const { oppA, oppB } = await bothSeeComment(channelA, channelB, 'd1', 'c1', 'Thanks, great app!')
    world.engine.on('draft.reply', reply({ category: 'thanks', reply: 'Glad you like it, enjoy!', usedClaimIds: [] }))
    world.core.settings.setRaw('automation.paused', true)
    await world.drafting.processChannel(channelB.id)
    expect(world.opportunity(oppB.id).state).toBe('ready') // auto-approved, waiting for the pause to end
    world.core.db.prepare("UPDATE opportunities SET state = 'awaiting_approval' WHERE id = ?").run(oppA.id)

    world.core.settings.setRaw('automation.paused', false)
    await world.drafting.processChannel(channelB.id)

    expect(publishCalls()).toBe(0)
    expect(world.opportunity(oppB.id).state).toBe('awaiting_approval')
    expect(world.opportunity(oppB.id).reason).toBe(REASON)
  })

  it('lets the second login proceed once the first is rejected', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA, oppB } = await bothSeeComment(channelA, channelB)
    world.engine.on('draft.reply', reply())
    await world.drafting.processChannel(channelA.id)
    await world.drafting.processChannel(channelB.id)
    expect(world.opportunity(oppB.id).reason).toBe(REASON)

    await world.core.router.call('opportunities.reject', { id: oppA.id })
    await world.drafting.processChannel(channelB.id)

    expect(world.opportunity(oppB.id).state).toBe('awaiting_approval')
    expect(world.opportunity(oppB.id).reason).toBe('')
    await world.core.router.call('opportunities.approve', { id: oppB.id })
    expect((await world.sending.send(oppB.id)).state).toBe('confirmed')
    expect(publishCalls()).toBe(1)
  })

  it('lets the second login proceed once the first is deferred', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA, oppB } = await bothSeeComment(channelA, channelB)
    world.engine.on('draft.reply', reply())
    await world.drafting.processChannel(channelA.id)
    await world.core.router.call('opportunities.defer', { id: oppA.id })

    await world.drafting.processChannel(channelB.id)
    await world.core.router.call('opportunities.approve', { id: oppB.id })

    expect((await world.sending.send(oppB.id)).state).toBe('confirmed')
  })

  it('keeps the second login out once the first has actually spoken', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA, oppB } = await bothSeeComment(channelA, channelB)
    world.engine.on('draft.reply', reply())
    await world.drafting.processChannel(channelA.id)
    await world.core.router.call('opportunities.approve', { id: oppA.id })
    expect((await world.sending.send(oppA.id)).state).toBe('confirmed')

    await world.drafting.processChannel(channelB.id)

    expect(world.opportunity(oppB.id).state).toBe('discovered')
    expect(world.opportunity(oppB.id).reason).toBe(REASON)
    expect(publishCalls()).toBe(1)
  })

  it('does not let two analyses that run side by side both end up speaking', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA, oppB } = await bothSeeComment(channelA, channelB)
    // The other login's draft appears while this one's analysis waits for the model; it must notice when it saves.
    let saved = false
    world.engine.on('draft.reply', () => {
      if (!saved) {
        saved = true
        world.core.db.prepare("UPDATE opportunities SET state = 'awaiting_approval' WHERE id = ?").run(oppA.id)
      }
      return reply()
    })

    await drafting().prepareOne(oppB.id, { explicit: false })

    const after = world.opportunity(oppB.id)
    expect(after.state).toBe('discovered')
    expect(after.reason).toBe(REASON)
    expect(world.core.repos.latestDraft(oppB.id)).toBeNull()
  })

  it('gives a comment no opportunity at all when the other login already speaks in its discussion', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA } = await bothSeeComment(channelA, channelB)
    world.engine.on('draft.reply', reply())
    await world.drafting.processChannel(channelA.id)
    expect(world.opportunity(oppA.id).state).toBe('awaiting_approval')

    world.connector.addComment('d1', { externalId: 'c2', author: 'another_user', body: 'And does it work offline?' })
    await world.monitor.runChannel(channelB.id)
    await world.monitor.runChannel(channelA.id)

    const blocked = oppFor(channelB, 'c2')
    expect(blocked.state).toBe('cancelled')
    expect(blocked.reason).toBe(REASON)
    expect(world.core.log.list(100).some((l) => l.message.includes(REASON) && l.channelId === channelB.id)).toBe(true)
    // The same login keeps working in its own discussion as before.
    expect(oppFor(channelA, 'c2').state).toBe('discovered')

    const callsBefore = world.engine.calls.length
    await world.drafting.processChannel(channelB.id)
    expect(world.engine.calls.length).toBe(callsBefore)
  })

  it('also applies to the older discussions the owner selects for the second login', async () => {
    world = makeWorld({ mode: 'approval', baselineDone: false })
    const developer = world.addAccount({ label: 'Developer', identity: 'dev_dan' })
    const channelA = world.channel
    const channelB = world.addChannel({ accountId: developer.id, target: channelA.target, baselineDone: false, mode: 'approval' })
    world.connector.addDiscussion({ externalId: 'old' })
    world.connector.addComment('old', { externalId: 'q1', author: 'curious_user', body: 'An old question?' })
    await world.monitor.runChannel(channelA.id) // baseline
    await world.monitor.runChannel(channelB.id)
    world.engine.on('draft.reply', reply())
    const discussionA = world.core.db.prepare('SELECT id FROM discussions WHERE channel_id = ?').get(channelA.id) as { id: Id }
    const discussionB = world.core.db.prepare('SELECT id FROM discussions WHERE channel_id = ?').get(channelB.id) as { id: Id }
    await world.core.router.call('channels.selectOlder', { channelId: channelA.id, discussionIds: [discussionA.id], selected: true })
    await world.drafting.processChannel(channelA.id)

    await world.core.router.call('channels.selectOlder', { channelId: channelB.id, discussionIds: [discussionB.id], selected: true })

    const blocked = oppFor(channelB, 'q1')
    expect(blocked.state).toBe('cancelled')
    expect(blocked.reason).toBe(REASON)
  })

  it('allows a second login in a different discussion of the same community', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppA, oppB } = await bothSeeComment(channelA, channelB, 'd1', 'c1')
    const { oppB: oppB2 } = await bothSeeComment(channelA, channelB, 'd2', 'c-other')
    world.engine.on('draft.reply', reply())
    await drafting().prepareOne(oppA.id, { explicit: false }) // the first login speaks in d1 only
    expect(world.opportunity(oppA.id).state).toBe('awaiting_approval')

    await world.drafting.processChannel(channelB.id)

    expect(world.opportunity(oppB.id).reason).toBe(REASON) // d1 is taken ...
    expect(world.opportunity(oppB2.id).state).toBe('awaiting_approval') // ... d2 is free
  })

  it('does not hold back the same login: it may answer several comments in one discussion', async () => {
    const { channelA, channelB } = twoLogins()
    const first = await bothSeeComment(channelA, channelB, 'd1', 'c1')
    world.connector.addComment('d1', { externalId: 'c3', author: 'third_user', body: 'One more question?' })
    await world.monitor.runChannel(channelA.id)
    const second = oppFor(channelA, 'c3')
    world.engine.on('draft.reply', reply())

    await world.drafting.processChannel(channelA.id)

    expect(world.opportunity(first.oppA.id).state).toBe('awaiting_approval')
    expect(world.opportunity(second.id).state).toBe('awaiting_approval')
  })

  it('leaves two products alone: their logins in one thread do not block each other', async () => {
    const { channelA } = twoLogins()
    const other = world.addProduct('Other product')
    const otherLogin = world.addAccount({ label: 'Other product login', identity: 'other_olga', productId: other.id })
    const otherChannel = world.addChannel({ productId: other.id, accountId: otherLogin.id, target: channelA.target, mode: 'approval' })
    const { oppA, oppB: oppOther } = await bothSeeComment(channelA, otherChannel)
    world.engine.on('draft.reply', reply())

    await world.drafting.processChannel(channelA.id)
    await world.drafting.processChannel(otherChannel.id)

    expect(world.opportunity(oppA.id).state).toBe('awaiting_approval')
    expect(world.opportunity(oppOther.id).state).toBe('awaiting_approval')
    await world.core.router.call('opportunities.approve', { id: oppA.id })
    await world.core.router.call('opportunities.approve', { id: oppOther.id })
    expect((await world.sending.send(oppA.id)).state).toBe('confirmed')
    expect((await world.sending.send(oppOther.id)).state).toBe('confirmed')
    expect(publishCalls()).toBe(2)
  })

  it('treats standalone posts as their own discussion: they neither block nor are blocked', async () => {
    const { channelA, channelB } = twoLogins()
    const { oppB } = await bothSeeComment(channelA, channelB)
    const post = await world.core.router.call('publications.create', { channelId: channelA.id, draft: { title: 'A post', text: 'Hello from the astrologer' } })
    await world.core.router.call('opportunities.approve', { id: post.opportunity.id })
    expect(world.opportunity(post.opportunity.id).state).toBe('ready')
    world.engine.on('draft.reply', reply())

    // The astrologer's post does not hold the developer's reply ...
    await world.drafting.processChannel(channelB.id)
    expect(world.opportunity(oppB.id).state).toBe('awaiting_approval')

    // ... and a reply by one login does not stop the other login's post.
    await world.core.router.call('opportunities.approve', { id: oppB.id })
    expect((await world.sending.send(oppB.id)).state).toBe('confirmed')
    const devPost = await world.core.router.call('publications.create', { channelId: channelB.id, draft: { title: 'Dev post', text: 'Hello from the developer' } })
    await world.core.router.call('opportunities.approve', { id: devPost.opportunity.id })
    expect((await world.sending.send(devPost.opportunity.id)).state).toBe('confirmed')
    expect((await world.sending.send(post.opportunity.id)).state).toBe('confirmed')
  })

  it('cannot be switched off by the channel settings', async () => {
    const { channelA, channelB } = twoLogins()
    world.setSettings(channelB.id, { autoCategories: ['thanks', 'faq'], limits: { perHour: 100, perDay: 100 } })
    const { oppA, oppB } = await bothSeeComment(channelA, channelB)
    world.engine.on('draft.reply', reply())
    await world.drafting.processChannel(channelA.id)
    await world.drafting.processChannel(channelB.id)
    expect(world.opportunity(oppA.id).state).toBe('awaiting_approval')
    expect(world.opportunity(oppB.id).reason).toBe(OTHER_LOGIN_SPEAKS_REASON)
  })
})
