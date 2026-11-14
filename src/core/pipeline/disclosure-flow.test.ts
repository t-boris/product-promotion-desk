// The disclosure of the author's connection to the product is a hard check in code (DEC-010): approval, automatic approval, the gate and
// the automatic send all refuse a text that mentions the product without saying so, and none of them touches a text that does not.

import { afterEach, describe, expect, it } from 'vitest'
import type { Opportunity } from '../../shared/types'
import { DISCLOSURE_REASON } from './auto-guard'
import { SendBlockedError, type GateBlock } from './gate'
import { contentHash } from './hash'
import type { ReviewFlow } from './review'
import type { SendingFlow } from './sending'
import { closeWorld, makeWorld, type World, type WorldOptions } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const UNDISCLOSED = 'Natal Mystic builds a natal chart from your birth date, time and place.'
const DISCLOSED = 'I work on Natal Mystic: it builds a natal chart from your birth date, time and place.'
const PLAIN = 'A natal chart needs the exact birth time and place.'
const AUTO: WorldOptions = { mode: 'auto', settings: { autoCategories: ['thanks', 'faq'] } }
const publishCalls = (): number => world.connector.calls.filter((c) => c === 'publish').length

const draftOf = async (text: string, kind: 'reply' | 'post' = 'reply', extra: { title?: string; link?: string } = {}): Promise<Opportunity> => {
  if (kind === 'post') return (await world.core.router.call('publications.create', { channelId: world.channel.id, draft: { title: extra.title ?? 'A post', text, link: extra.link } })).opportunity
  const opp = await world.newOpportunity()
  await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text } })
  return opp
}

const approvals = (opp: Opportunity): number => (world.core.db.prepare('SELECT COUNT(*) AS n FROM approvals a JOIN drafts d ON d.id = a.draft_id WHERE d.opportunity_id = ? AND a.invalidated_at IS NULL').get(opp.id) as { n: number }).n

async function blocked(opp: Opportunity): Promise<GateBlock> {
  try {
    await (world.sending as SendingFlow).send(opp.id)
  } catch (error) {
    if (error instanceof SendBlockedError) return error.block
    throw error
  }
  throw new Error('expected the send to be blocked')
}

describe('approving by the owner', () => {
  it('refuses the owner\'s own text when it names the product without saying the author is connected with it', async () => {
    world = makeWorld()
    const opp = await draftOf(UNDISCLOSED)

    await expect(world.core.router.call('opportunities.approve', { id: opp.id })).rejects.toMatchObject({ code: 'disclosure_missing', message: expect.stringContaining('does not say that you are connected') })

    expect(world.opportunity(opp.id).state).toBe('draft')
    expect(approvals(opp)).toBe(0)
  })

  it('approves the same text once the owner adds the statement', async () => {
    world = makeWorld()
    const opp = await draftOf(UNDISCLOSED)
    await expect(world.core.router.call('opportunities.approve', { id: opp.id })).rejects.toMatchObject({ code: 'disclosure_missing' })

    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: DISCLOSED } })

    expect((await world.core.router.call('opportunities.approve', { id: opp.id })).opportunity.state).toBe('ready')
    expect(approvals(opp)).toBe(1)
  })

  it('never blocks a text that does not mention the product', async () => {
    world = makeWorld()
    const opp = await draftOf(PLAIN)
    expect((await world.core.router.call('opportunities.approve', { id: opp.id })).opportunity.state).toBe('ready')
  })

  it('checks a post by its title and its link too: a link to the product\'s own site names the product', async () => {
    world = makeWorld()
    const titled = await draftOf('Charts got faster this month.', 'post', { title: 'Natal Mystic news' })
    await expect(world.core.router.call('opportunities.approve', { id: titled.id })).rejects.toMatchObject({ code: 'disclosure_missing' })

    const linked = await draftOf('Charts got faster this month.', 'post', { link: 'https://natalmystic.com/blog' })
    await expect(world.core.router.call('opportunities.approve', { id: linked.id })).rejects.toMatchObject({ code: 'disclosure_missing' })

    const fine = await draftOf('Charts got faster this month.', 'post', { title: 'Chart news', link: 'https://example.org/blog' })
    expect((await world.core.router.call('opportunities.approve', { id: fine.id })).opportunity.state).toBe('ready')
  })

  it('records the owner as the approver and never anything else', async () => {
    world = makeWorld()
    const opp = await draftOf(DISCLOSED)
    const card = await world.core.router.call('opportunities.approve', { id: opp.id })
    expect(card.approval).toMatchObject({ approvedBy: 'user', ruleId: null })
  })
})

describe('automatic approval', () => {
  it('refuses to create an approval for a text that names the product without disclosing it, even when called directly', async () => {
    world = makeWorld(AUTO)
    const opp = await draftOf(UNDISCLOSED)
    const draft = world.core.repos.latestDraft(opp.id)!
    const review = world.core.services.pipeline as unknown as ReviewFlow

    expect(() => review.createAutoApproval(opp.id, draft, 'auto:faq:v1')).toThrow(/does not say that you are connected/)
    expect(approvals(opp)).toBe(0)
  })

  it('does not send a reply automatically when the model vouches for the disclosure but the text itself does not say it', async () => {
    world = makeWorld(AUTO)
    world.engine.on('draft.reply', JSON.stringify({ category: 'thanks', decision: 'reply', reply: 'Glad you like Natal Mystic, enjoy!', rationale: 'A thank-you.', usedClaimIds: [], disclosesConnection: true }))
    const opp = await world.newOpportunity({ body: 'Thanks, great app!' })

    await world.drafting.processChannel(world.channel.id)

    expect(publishCalls()).toBe(0)
    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
    expect(world.opportunity(opp.id).reason).toBe(DISCLOSURE_REASON)
    expect(approvals(opp)).toBe(0)
  })

  it('still sends a reply automatically when the text says it, and one that never names the product', async () => {
    world = makeWorld(AUTO)
    world.engine.on('draft.reply', JSON.stringify({ category: 'thanks', decision: 'reply', reply: 'Glad you like Natal Mystic, I work on it!', rationale: 'A thank-you.', usedClaimIds: [], disclosesConnection: true }))
    const said = await world.newOpportunity({ body: 'Thanks, great app!' })
    await world.drafting.processChannel(world.channel.id)
    expect(world.opportunity(said.id).state).toBe('confirmed')

    world.engine.on('draft.reply', JSON.stringify({ category: 'thanks', decision: 'reply', reply: 'Glad you like it, enjoy!', rationale: 'A thank-you.', usedClaimIds: [] }))
    const plain = await world.newOpportunity({ body: 'Thanks again!', commentId: 'other' })
    await world.drafting.processChannel(world.channel.id)
    expect(world.opportunity(plain.id).state).toBe('confirmed')
  })
})

describe('the gate', () => {
  /** An approval that slipped past the check (given before it existed, or written straight into the records). */
  const approveBypassingTheCheck = (opp: Opportunity): void => {
    const draft = world.core.repos.latestDraft(opp.id)!
    const channel = world.core.repos.channel(opp.channelId)
    const destination = world.store.resolveDestination(opp, channel)
    world.store.insertApproval({ draftId: draft.id, contentHash: contentHash(draft, world.account, destination), accountId: world.account.id, identity: null, destination, approvedBy: 'user', ruleId: null })
    world.store.updateOpportunity(opp.id, { state: 'ready', reason: '' })
  }

  it('refuses to send an approved text that names the product without disclosing it, and returns it to the owner', async () => {
    world = makeWorld()
    const opp = await draftOf(UNDISCLOSED)
    approveBypassingTheCheck(opp)

    const block = await blocked(opp)

    expect(block).toMatchObject({ allowed: false, effect: 'review', code: 'disclosure_missing' })
    expect(publishCalls()).toBe(0)
    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
    expect(approvals(opp)).toBe(0)
  })

  it('sends an approved text that does not mention the product, and one that discloses it', async () => {
    world = makeWorld()
    const plain = await draftOf(PLAIN)
    await world.core.router.call('opportunities.approve', { id: plain.id })
    expect((await (world.sending as SendingFlow).send(plain.id)).state).toBe('confirmed')

    const disclosed = await world.newOpportunity({ commentId: 'second' })
    await world.core.router.call('opportunities.saveDraft', { id: disclosed.id, draft: { text: DISCLOSED } })
    await world.core.router.call('opportunities.approve', { id: disclosed.id })
    expect((await (world.sending as SendingFlow).send(disclosed.id)).state).toBe('confirmed')
  })
})
