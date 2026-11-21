// What happens to the opportunity of a new post after it is found (DEC-039): the AI judges whether it is worth answering, the reply is a
// top-level comment on the post, and every guard of the send path (approval, gate, one voice, reconciliation) holds for it as for a comment.

import { afterEach, describe, expect, it } from 'vitest'
import type { Channel, Opportunity } from '../../shared/types'
import { SendBlockedError, SendGate, type GateBlock } from './gate'
import { contentHash } from './hash'
import { autoEligibility } from './modes'
import { NEW_POST_NEVER_AUTO_REASON, isPostTarget, postHash } from './reply-target'
import type { SendingFlow } from './sending'
import { closeWorld, makeWorld, type World, type WorldOptions } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const ABOUT_CHARTS: WorldOptions = { mode: 'approval', settings: { topics: ['natal chart'] } }
const AUTO_ABOUT_CHARTS: WorldOptions = { mode: 'auto', settings: { topics: ['natal chart'], autoCategories: ['thanks', 'faq'] } }

const sending = (): SendingFlow => world.sending as SendingFlow
const publishCalls = (): number => world.connector.calls.filter((c) => c === 'publish').length
const postOpps = (channel: Channel = world.channel): Opportunity[] => world.store.list({ channelId: channel.id, source: 'new_post' })

const reply = (o: Record<string, unknown> = {}): string =>
  JSON.stringify({
    category: 'product_question',
    decision: 'reply',
    reply: 'It builds a natal chart from your birth date, time and place.',
    rationale: 'Answers what the post asks, from approved claim c1.',
    usedClaimIds: ['c1'],
    ...o
  })

const addPost = (over: Record<string, unknown> = {}) =>
  world.connector.addDiscussion({ externalId: 'np1', title: 'Which natal chart app is best?', body: 'I want to try one this week.', author: 'curious_user', ...over })

/** A new post found by one monitor cycle. */
async function foundPost(over: Record<string, unknown> = {}): Promise<Opportunity> {
  addPost(over)
  const outcome = await world.monitor.runChannel(world.channel.id)
  expect(outcome.status).toBe('ok')
  return postOpps()[0]
}

/** A new post with a draft the owner approved, ready to send. */
async function readyPostReply(text = 'It builds the chart from your birth date, time and place.'): Promise<Opportunity> {
  const opp = await foundPost()
  await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text } })
  await world.core.router.call('opportunities.approve', { id: opp.id })
  return world.opportunity(opp.id)
}

async function sendBlocked(opp: Opportunity, automatic = false): Promise<GateBlock> {
  try {
    await sending().send(opp.id, { automatic })
  } catch (error) {
    if (error instanceof SendBlockedError) return error.block
    throw error
  }
  throw new Error('expected the send to be blocked')
}

describe('drafting the reply to a new post', () => {
  it('shows the AI the post as the thing to judge, says it is not a reply to the account, and asks for a top-level comment', async () => {
    world = makeWorld(ABOUT_CHARTS)
    await foundPost()
    world.engine.on('draft.reply', reply())

    await world.drafting.processChannel(world.channel.id)

    const task = world.engine.calls.find((c) => c.label === 'draft.reply')!
    expect(Object.keys(task).sort()).toEqual(['label', 'prompt', 'system', 'timeoutMs']) // text only: no tools
    expect(task.system).toContain('"new_post"')
    expect(task.system).toMatch(/top-level comment on the post/)
    expect(task.system).toMatch(/decision "ignore"/)
    expect(task.prompt).toMatch(/new post by someone else, not a comment addressed to the account/)
    const payload = JSON.parse(task.prompt.slice(task.prompt.indexOf('context:\n') + 9))
    expect(payload.source).toBe('new_post')
    expect(payload.post).toMatchObject({ title: 'Which natal chart app is best?', body: 'I want to try one this week.', author: 'curious_user' })
    expect(payload.comment.author).toBe('curious_user')
    expect(payload.comment.body).toBe('Which natal chart app is best?\n\nI want to try one this week.')
    expect(payload.parentChain).toEqual([])
  })

  it('leaves the prompt of an ordinary comment exactly as it was (no source field)', async () => {
    world = makeWorld(ABOUT_CHARTS)
    world.engine.on('draft.reply', reply())
    await world.newOpportunity()
    await world.drafting.processChannel(world.channel.id)
    const task = world.engine.calls.find((c) => c.label === 'draft.reply')!
    const payload = JSON.parse(task.prompt.slice(task.prompt.indexOf('context:\n') + 9))
    expect('source' in payload).toBe(false)
    expect(task.prompt).not.toMatch(/new post by someone else/)
  })

  it('decides first whether it is worth answering: "ignore" ends it with the AI\'s reason and no draft', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await foundPost()
    world.engine.on('draft.reply', reply({ category: 'irrelevant', decision: 'ignore', reply: '', rationale: 'The post asks about a paid course, not about charts.', usedClaimIds: [] }))

    await world.drafting.processChannel(world.channel.id)

    expect(world.opportunity(opp.id)).toMatchObject({ state: 'no_reply', reason: 'The post asks about a paid course, not about charts.', decision: 'ignore', category: 'irrelevant' })
    expect(world.core.repos.latestDraft(opp.id)).toBeNull()
    expect(publishCalls()).toBe(0)
  })

  it('saves a draft for the owner to approve when the AI says it is worth answering', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await foundPost()
    world.engine.on('draft.reply', reply())

    const summary = await world.drafting.processChannel(world.channel.id)

    expect(summary).toMatchObject({ prepared: 1, autoSent: 0 })
    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
    expect(world.core.repos.latestDraft(opp.id)?.text).toBe('It builds a natal chart from your birth date, time and place.')
  })

  it('does not save a draft made from a post that was edited while the AI worked', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await foundPost()
    world.engine.on('draft.reply', () => {
      world.core.db.prepare('UPDATE discussions SET body = ? WHERE id = ?').run('Edited while the AI was writing.', opp.discussionId)
      return reply()
    })

    await world.drafting.processChannel(world.channel.id)

    expect(world.opportunity(opp.id)).toMatchObject({ state: 'discovered', reason: expect.stringMatching(/The post changed while the draft was being prepared/) })
    expect(world.core.repos.latestDraft(opp.id)).toBeNull()
  })

  it('asks nothing about the connection when the reply names the product, as for any reply', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await foundPost()
    world.engine.on('draft.reply', reply({ reply: 'Natal Mystic builds a natal chart from your birth date, time and place.', usedClaimIds: ['c1'] }))

    await world.drafting.processChannel(world.channel.id)

    expect(world.opportunity(opp.id).reason).not.toMatch(/connect|disclos|work on/i)
    expect((await world.core.router.call('opportunities.approve', { id: opp.id })).opportunity.state).toBe('ready')
  })

  it('shows the owner the post as the card\'s discussion, with no comment', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await foundPost()
    const card = world.card(opp.id)
    expect(card.comment).toBeNull()
    expect(card.discussion?.title).toBe('Which natal chart app is best?')
    expect(card.thread).toEqual([])
    expect(card.opportunity.source).toBe('new_post')
  })

  it('names the item for what it is in the owner\'s attention list', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await foundPost()
    world.engine.on('draft.reply', reply())
    await world.drafting.processChannel(world.channel.id)
    const items = await world.core.router.call('attention.list', undefined)
    expect(items.find((i) => i.refId === opp.id)?.title).toMatch(/^Approve reply to a new post in /)
  })
})

describe('approving and sending the reply to a new post', () => {
  it('sends a top-level comment: the request answers the post (t3), the destination is the post, the draft is bound to both', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()

    const action = await sending().send(opp.id)

    expect(action.state).toBe('confirmed')
    const [published] = world.connector.published
    expect(published.request).toMatchObject({ kind: 'reply', parentExternalId: 'np1', destination: 'https://fake.test/r/test/comments/np1' })
    const draft = world.core.repos.latestDraft(opp.id)!
    expect(action.contentHash).toBe(contentHash(draft, world.account, 'https://fake.test/r/test/comments/np1', 'fake'))
    expect(action.destination).toBe('https://fake.test/r/test/comments/np1')
    // It shows up as the account's own top-level comment, and the app recognises it as its own next time.
    await world.monitor.runChannel(world.channel.id)
    expect(world.store.ownReplyUnder(world.channel.id, 'np1')).not.toBeNull()
  })

  it('still sends a reply to a comment under the comment (t1), not under the post', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await world.readyReply()
    await sending().send(opp.id)
    expect(world.connector.published[0].request.parentExternalId).toBe(world.core.repos.comment(opp.commentId as string).externalId)
  })

  it('binds the approval to the post address: a changed address needs a new approval', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.core.db.prepare('UPDATE discussions SET url = ? WHERE id = ?').run('https://fake.test/r/test/comments/np1-moved', opp.discussionId)

    const block = await sendBlocked(world.opportunity(opp.id))

    expect(block.code).toBe('approval_stale')
    expect(publishCalls()).toBe(0)
  })

  it('cancels when the post is no longer stored', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.core.db.pragma('foreign_keys = OFF')
    world.core.db.prepare('DELETE FROM discussions WHERE id = ?').run(opp.discussionId)

    const block = await sendBlocked(world.opportunity(opp.id))

    expect(block.code).toBe('post_gone')
    expect(block.effect).toBe('cancel')
    expect(publishCalls()).toBe(0)
  })

  it('cancels when the discussion was locked meanwhile', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.connector.lock('np1')
    const block = await sendBlocked(world.opportunity(opp.id))
    expect(block).toMatchObject({ code: 'thread_locked', effect: 'cancel' })
    expect(world.opportunity(opp.id).state).toBe('cancelled')
    expect(publishCalls()).toBe(0)
  })

  it('cancels when the discussion is gone from the platform', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.connector.discussions.length = 0
    const block = await sendBlocked(world.opportunity(opp.id))
    expect(block.code).toBe('thread_unavailable')
    expect(publishCalls()).toBe(0)
  })

  it('cancels when the account already commented on the post (found under it on the platform)', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.connector.addComment('np1', { externalId: 't1_by-hand', parentExternalId: 'np1', author: 'Brand_Account', body: 'I answered by hand.' })

    const block = await sendBlocked(world.opportunity(opp.id))

    expect(block).toMatchObject({ code: 'already_replied', effect: 'cancel' })
    expect(block.reasons.join(' ')).toMatch(/already replied to this post/)
    expect(publishCalls()).toBe(0)
  })

  it('cancels when an own top-level comment on the post is already stored', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.core.db
      .prepare(
        `INSERT INTO comments (id, discussion_id, channel_id, external_id, parent_external_id, author, body, url, baseline, is_own, content_hash, first_seen_at, last_seen_at)
         VALUES ('own1', ?, ?, 't1_own1', 'np1', 'brand_account', 'earlier', 'u', 0, 1, 'h', 'then', 'then')`
      )
      .run(opp.discussionId, world.channel.id)
    const block = await sendBlocked(world.opportunity(opp.id))
    expect(block.code).toBe('already_replied')
  })

  it('does not count somebody else\'s comment on the post as an answer', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.connector.addComment('np1', { externalId: 't1_other', parentExternalId: 'np1', author: 'someone_else', body: 'Try the free ones.' })
    expect((await sending().send(opp.id)).state).toBe('confirmed')
  })

  it('returns the reply to review when the post was edited after the draft, and stores the new text', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.connector.discussions[0].body = 'Edited: now I only need something for iPhone.'

    const block = await sendBlocked(world.opportunity(opp.id))

    expect(block).toMatchObject({ code: 'post_changed', effect: 'review' })
    expect(publishCalls()).toBe(0)
    const after = world.opportunity(opp.id)
    expect(after.state).not.toBe('ready')
    expect(world.store.postOf(after)?.body).toBe('Edited: now I only need something for iPhone.')
    expect(world.core.repos.activeApproval(world.core.repos.latestDraft(opp.id)!.id)).toBeNull()
  })

  it('holds the send when the thread is too large to check for an existing answer', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.connector.markIncomplete('np1')
    expect((await sendBlocked(world.opportunity(opp.id))).code).toBe('thread_incomplete')
  })

  it('holds the send when the thread cannot be read', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    world.connector.fetchThreadError = new Error('network down')
    const block = await sendBlocked(world.opportunity(opp.id))
    expect(block).toMatchObject({ code: 'thread_unreadable', effect: 'hold' })
  })

  it('does not let another login in: the approval is withdrawn when another login speaks in the discussion', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    const developer = world.addAccount({ label: 'Developer', identity: 'dev_dan' })
    const channelB = world.addChannel({ accountId: developer.id, target: world.channel.target, mode: 'approval' })
    // The developer's login holds the same discussion with a reply of its own.
    const dev = world.store.discussionByExternalId(world.channel.id, 'np1')!
    world.core.db.prepare('INSERT INTO discussions (id, channel_id, external_id, url, title, author, body, selected, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)').run('dev-d', channelB.id, 'np1', dev.url, dev.title, dev.author, dev.body, 'then', 'then')
    world.core.db
      .prepare(`INSERT INTO opportunities (id, channel_id, product_id, kind, source, state, discussion_id, destination, created_at, updated_at) VALUES ('dev-opp', ?, ?, 'reply', 'new_post', 'awaiting_approval', 'dev-d', ?, 'then', 'then')`)
      .run(channelB.id, world.product.id, dev.url)

    const block = await sendBlocked(world.opportunity(opp.id))

    expect(block).toMatchObject({ code: 'other_login_speaks', effect: 'review' })
    expect(publishCalls()).toBe(0)
  })

  it('reconciles an unknown result by looking for a comment under the post', async () => {
    world = makeWorld(ABOUT_CHARTS)
    world.connector.publishScript.push({ kind: 'unknown', visible: true })
    const opp = await readyPostReply()
    await sending().send(opp.id)

    const action = await sending().reconcile(opp.id)

    expect(action?.state).toBe('confirmed')
    expect(world.connector.findPublishedRequests[0]).toMatchObject({ kind: 'reply', parentExternalId: 'np1' })
    expect(publishCalls()).toBe(1)
  })
})

describe('automatic mode never answers a new post (DEC-039)', () => {
  it('keeps the reply a draft for approval even when the same reply to a comment would have gone out by itself', async () => {
    world = makeWorld(AUTO_ABOUT_CHARTS)
    const opp = await foundPost({ title: 'Natal chart question', body: 'Does a natal chart app work on Android?' })
    world.engine.on('draft.reply', reply({ category: 'thanks', reply: 'Glad you asked, enjoy!', usedClaimIds: [] }))

    const summary = await world.drafting.processChannel(world.channel.id)

    expect(summary).toEqual({ prepared: 1, autoSent: 0, needsUser: 0 })
    expect(publishCalls()).toBe(0)
    expect(world.opportunity(opp.id)).toMatchObject({ state: 'awaiting_approval', reason: NEW_POST_NEVER_AUTO_REASON })
    const approvals = world.core.db.prepare('SELECT COUNT(*) AS n FROM approvals').get() as { n: number }
    expect(approvals.n).toBe(0)
  })

  it('does the opposite for a comment on the same channel: the control that proves the rule is about the source', async () => {
    world = makeWorld(AUTO_ABOUT_CHARTS)
    world.engine.on('draft.reply', reply({ category: 'thanks', reply: 'Glad you like it, enjoy!', usedClaimIds: [] }))
    const opp = await world.newOpportunity({ body: 'Thanks, this is great!' })
    await world.drafting.processChannel(world.channel.id)
    expect(world.opportunity(opp.id).state).toBe('confirmed')
  })

  it('is a rule of the eligibility check itself', async () => {
    world = makeWorld(AUTO_ABOUT_CHARTS)
    const base = {
      channel: world.channel,
      category: 'thanks' as const,
      decision: 'reply' as const,
      commentBody: 'Thanks!',
      reply: 'Glad you like it!',
      usedClaimIds: [],
      approved: [],
      engineToolFree: true
    }
    expect(autoEligibility({ ...base, source: 'comment' })).toMatchObject({ eligible: true })
    expect(autoEligibility({ ...base, source: 'new_post' })).toEqual({ eligible: false, why: NEW_POST_NEVER_AUTO_REASON })
    expect(autoEligibility({ ...base, source: 'reply_to_me' })).toMatchObject({ eligible: true })
  })

  it('is refused by the send gate too, if an automatic approval of such a reply ever existed', async () => {
    world = makeWorld(AUTO_ABOUT_CHARTS)
    const opp = await foundPost()
    world.core.db.prepare("UPDATE opportunities SET category = 'thanks' WHERE id = ?").run(opp.id)
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'Thank you!' } })
    const draft = world.core.repos.latestDraft(opp.id)!
    const destination = world.store.resolveDestination(world.opportunity(opp.id), world.channel)
    world.store.insertApproval({
      draftId: draft.id,
      contentHash: contentHash(draft, world.account, destination, 'fake'),
      accountId: world.account.id,
      identity: world.account.identity,
      destination,
      approvedBy: 'auto_rule',
      ruleId: 'auto:thanks:v1'
    })
    world.store.updateOpportunity(opp.id, { state: 'ready' })

    const block = await sendBlocked(world.opportunity(opp.id), true)

    expect(block).toMatchObject({ code: 'auto_rule_refused', effect: 'review' })
    expect(block.reasons).toEqual([NEW_POST_NEVER_AUTO_REASON])
    expect(publishCalls()).toBe(0)
  })

  it('does not send a reply the owner approved when the scheduler asks for an automatic send', async () => {
    world = makeWorld(AUTO_ABOUT_CHARTS)
    const opp = await readyPostReply()
    const block = await sendBlocked(world.opportunity(opp.id), true)
    expect(block.code).toBe('not_automatic')
    expect(publishCalls()).toBe(0)
  })
})

describe('what is a post target', () => {
  it('is a reply whose source is new_post, whether or not it has a comment', async () => {
    expect(isPostTarget({ kind: 'reply', source: 'new_post' })).toBe(true)
    expect(isPostTarget({ kind: 'reply', source: 'comment' })).toBe(false)
    expect(isPostTarget({ kind: 'reply', source: 'reply_to_me' })).toBe(false)
    expect(isPostTarget({ kind: 'standalone', source: 'new_post' })).toBe(false)
  })

  it('hashes the title and the text, and ignores the spacing around them', () => {
    expect(postHash({ title: ' A ', body: ' B ' })).toBe(postHash({ title: 'A', body: 'B' }))
    expect(postHash({ title: 'A', body: 'B' })).not.toBe(postHash({ title: 'A', body: 'C' }))
    expect(postHash({ title: 'A', body: 'B' })).not.toBe(postHash({ title: 'B', body: 'A' }))
  })

  it('keeps the old cancel for a comment reply whose comment is gone (the post rule does not swallow it)', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await world.readyReply()
    world.core.db.prepare('UPDATE opportunities SET comment_id = NULL WHERE id = ?').run(opp.id)
    const block = await sendBlocked(world.opportunity(opp.id))
    expect(block.code).toBe('comment_gone')
  })

  it('is built by the gate for the grant too: the ticket is bound to the post address', async () => {
    world = makeWorld(ABOUT_CHARTS)
    const opp = await readyPostReply()
    const decision = await new SendGate(world.core, world.store).authorize({ opportunityId: opp.id, automatic: false })
    expect(decision.allowed).toBe(true)
    if (!decision.allowed) return
    expect(decision.ticket.destination).toBe('https://fake.test/r/test/comments/np1')
    expect(decision.request.parentExternalId).toBe('np1')
  })
})
