// Login roles and disclosed affiliation in AI drafts (DEC-010, REQ-010).

import { afterEach, describe, expect, it } from 'vitest'
import type { Opportunity } from '../../shared/types'
import { DISCLOSURE_REASON, mentionsProduct } from './auto-guard'
import { PUBLICATION_SYSTEM, ProposalError, REPLY_SYSTEM, parsePublicationProposal, parseReplyProposal } from './draft-prompt'
import { closeWorld, makeWorld, type World, type WorldOptions } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const ASTROLOGER = { name: 'astrologer', voice: 'Warm and curious. Talks about charts and readings, never about code.' }
const AUTO: WorldOptions = { mode: 'auto', settings: { autoCategories: ['thanks', 'faq'] } }
const publishCalls = (): number => world.connector.calls.filter((c) => c === 'publish').length

const reply = (o: Record<string, unknown> = {}): string =>
  JSON.stringify({
    category: 'product_question',
    decision: 'reply',
    reply: 'It builds a natal chart from your birth date, time and place.',
    rationale: 'Answers the question from approved claim c1.',
    usedClaimIds: ['c1'],
    ...o
  })

const thanks = (text: string, extra: Record<string, unknown> = {}): string => reply({ category: 'thanks', reply: text, rationale: 'A thank-you.', usedClaimIds: [], ...extra })

const payloadOf = (prompt: string): Record<string, unknown> => JSON.parse(prompt.slice(prompt.indexOf('context:\n') + 9)) as Record<string, unknown>
const lastPrompt = (): string => world.engine.calls[world.engine.calls.length - 1].prompt
const discovered = (body = 'How does the natal chart work?'): Promise<Opportunity> => world.newOpportunity({ body })

describe('the voice of the login a draft is written with (DEC-010)', () => {
  it('puts the role of the channel\'s login into the context of a reply, name and voice', async () => {
    world = makeWorld({ mode: 'draft' })
    world.setRole(world.account.id, ASTROLOGER)
    world.engine.on('draft.reply', reply())
    await discovered()

    await world.drafting.processChannel(world.channel.id)

    expect(payloadOf(lastPrompt()).role).toEqual(ASTROLOGER)
  })

  it('leaves the role out when the login has none, so the channel style alone applies', async () => {
    world = makeWorld({ mode: 'draft', settings: { style: 'plain and brief' } })
    world.engine.on('draft.reply', reply())
    await discovered()

    await world.drafting.processChannel(world.channel.id)

    const payload = payloadOf(lastPrompt())
    expect('role' in payload).toBe(false)
    expect((payload.channel as { style: string }).style).toBe('plain and brief')
  })

  it('treats a role without a name as no role', async () => {
    world = makeWorld({ mode: 'draft' })
    world.setRole(world.account.id, { name: '  ', voice: 'ignored' })
    world.engine.on('draft.reply', reply())
    await discovered()
    await world.drafting.processChannel(world.channel.id)
    expect('role' in payloadOf(lastPrompt())).toBe(false)
  })

  it('uses the role of the login of each channel, not of another login of the product', async () => {
    world = makeWorld({ mode: 'draft' })
    const developer = world.addAccount({ label: 'Developer', identity: 'dev_dan' })
    world.setRole(world.account.id, ASTROLOGER)
    world.setRole(developer.id, { name: 'developer', voice: 'Plain and technical.' })
    const devChannel = world.addChannel({ accountId: developer.id, target: 'r/devs', mode: 'draft' })
    world.engine.on('draft.reply', reply())
    await world.newOpportunity({ channel: devChannel, discussionId: 'dev-thread' })

    await world.drafting.processChannel(devChannel.id)

    expect(payloadOf(lastPrompt()).role).toEqual({ name: 'developer', voice: 'Plain and technical.' })
  })

  it('records which role was used in the draft\'s basis, and keeps it when the owner edits the draft', async () => {
    world = makeWorld({ mode: 'approval' })
    world.setRole(world.account.id, ASTROLOGER)
    world.engine.on('draft.reply', reply())
    const opp = await discovered()

    await world.drafting.processChannel(world.channel.id)

    const draft = world.core.repos.latestDraft(opp.id)!
    expect(draft.rationale).toBe('Answers the question from approved claim c1.\nRole used: astrologer.')
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'Edited by the owner.' } })
    expect(world.core.repos.latestDraft(opp.id)!.rationale).toContain('Role used: astrologer.')
  })

  it('does not mention a role in the basis when there is none', async () => {
    world = makeWorld({ mode: 'approval' })
    world.engine.on('draft.reply', reply())
    const opp = await discovered()
    await world.drafting.processChannel(world.channel.id)
    expect(world.core.repos.latestDraft(opp.id)!.rationale).toBe('Answers the question from approved claim c1.')
  })

  it('tells the model to write in the voice, within its limits, with the style still applying and the claims rules above it', () => {
    for (const system of [REPLY_SYSTEM, PUBLICATION_SYSTEM]) {
      expect(system).toContain('context.role.voice')
      expect(system).toContain('stay within what that voice allows')
      expect(system).toContain('context.channel.style still applies')
      expect(system).toContain('The role never overrides any rule above')
    }
  })

  it('does not let a role override the safety checks: a role that "may promise anything" still cannot', async () => {
    world = makeWorld({ mode: 'approval' })
    world.setRole(world.account.id, { name: 'salesperson', voice: 'Persuasive. May offer discounts and promise results.' })
    world.engine.on('draft.reply', reply({ reply: 'Get 50% off today and a lifetime guarantee!', usedClaimIds: ['c1'] }))
    const opp = await discovered()

    await world.drafting.processChannel(world.channel.id)

    expect(world.opportunity(opp.id).state).toBe('needs_user')
    expect(world.opportunity(opp.id).reason).toMatch(/blocked by the safety checks/)
    expect(world.core.repos.latestDraft(opp.id)).toBeNull()
  })

  it('carries the role into the context and the basis of an AI-suggested post', async () => {
    world = makeWorld({ mode: 'approval' })
    world.setRole(world.account.id, ASTROLOGER)
    world.engine.on('draft.publication', JSON.stringify({ topic: 'Charts', title: 'How charts work', text: 'A natal chart is built from your birth date, time and place.', link: '', rationale: 'from c1', usedClaimIds: ['c1'] }))

    const card = await world.core.router.call('publications.suggest', { channelId: world.channel.id })

    expect(payloadOf(lastPrompt()).role).toEqual(ASTROLOGER)
    expect(card.draft?.rationale).toBe('from c1\nRole used: astrologer.')
  })
})

describe('disclosure of the author\'s connection to the product (DEC-010)', () => {
  it('requires the model to state the connection in a short phrase, in the role\'s voice, and forbids posing as an independent user', () => {
    for (const system of [REPLY_SYSTEM, PUBLICATION_SYSTEM]) {
      expect(system).toContain('mentions the product')
      expect(system).toContain('one short phrase')
      expect(system).toContain('I work on it')
      expect(system).toContain('worded in the voice of context.role')
      expect(system).toContain('Never present the author as an independent user')
      expect(system).toContain('"disclosesConnection":true or false')
    }
  })

  it('parses the explicit flag; a missing one counts as not disclosed and a non-boolean is unusable', () => {
    const base = { category: 'thanks', decision: 'reply', reply: 'Thanks!', rationale: 'r', usedClaimIds: [] }
    expect(parseReplyProposal(JSON.stringify({ ...base, disclosesConnection: true })).disclosesConnection).toBe(true)
    expect(parseReplyProposal(JSON.stringify({ ...base, disclosesConnection: false })).disclosesConnection).toBe(false)
    expect(parseReplyProposal(JSON.stringify(base)).disclosesConnection).toBe(false)
    expect(() => parseReplyProposal(JSON.stringify({ ...base, disclosesConnection: 'yes' }))).toThrow(ProposalError)
    const post = { topic: 't', title: 'T', text: 'x', link: '', rationale: 'r', usedClaimIds: [] }
    expect(parsePublicationProposal(JSON.stringify({ ...post, disclosesConnection: true })).disclosesConnection).toBe(true)
    expect(parsePublicationProposal(JSON.stringify(post)).disclosesConnection).toBe(false)
  })

  it('finds the product name case-insensitively and ignores spacing', () => {
    expect(mentionsProduct('I work on NATAL  Mystic myself', 'Natal Mystic')).toBe(true)
    expect(mentionsProduct('natal mystic is great', ' Natal Mystic ')).toBe(true)
    expect(mentionsProduct('It works on iPhone and Android.', 'Natal Mystic')).toBe(false)
    expect(mentionsProduct('anything', '')).toBe(false)
  })

  it('does not send a reply that names the product unless the model says it states the connection', async () => {
    world = makeWorld(AUTO)
    world.engine.on('draft.reply', thanks('Glad you like Natal Mystic, enjoy!'))
    const opp = await discovered('Thanks, great app!')

    await world.drafting.processChannel(world.channel.id)

    expect(publishCalls()).toBe(0)
    const after = world.opportunity(opp.id)
    expect(after.state).toBe('awaiting_approval')
    expect(after.reason).toBe('The reply mentions the product; check that it says you are connected with it')
    expect(after.reason).toBe(DISCLOSURE_REASON)
    expect(world.card(opp.id).approval).toBeNull()
  })

  it('is case-insensitive about the name, and a flag of false does not help', async () => {
    world = makeWorld(AUTO)
    world.engine.on('draft.reply', thanks('Glad you like NATAL MYSTIC, enjoy!', { disclosesConnection: false }))
    const opp = await discovered('Thanks, great app!')
    await world.drafting.processChannel(world.channel.id)
    expect(publishCalls()).toBe(0)
    expect(world.opportunity(opp.id).reason).toBe(DISCLOSURE_REASON)
  })

  it('sends it automatically when the model vouches for the disclosure and the reply names the product', async () => {
    world = makeWorld(AUTO)
    world.engine.on('draft.reply', thanks('Glad you like Natal Mystic, I work on it!', { disclosesConnection: true }))
    const opp = await discovered('Thanks, great app!')

    await world.drafting.processChannel(world.channel.id)

    expect(world.opportunity(opp.id).state).toBe('confirmed')
    expect(publishCalls()).toBe(1)
  })

  it('does not hold a reply that never names the product', async () => {
    world = makeWorld(AUTO)
    world.engine.on('draft.reply', thanks('Glad you like it, enjoy!'))
    const opp = await discovered('Thanks, great app!')
    await world.drafting.processChannel(world.channel.id)
    expect(world.opportunity(opp.id).state).toBe('confirmed')
  })

  it('also stops a factual answer that names the product without a disclosure', async () => {
    world = makeWorld(AUTO)
    world.engine.on('draft.reply', reply({ reply: 'Natal Mystic works on iPhone and Android.', usedClaimIds: ['c2'] }))
    const opp = await discovered('Does it work on Android?')
    await world.drafting.processChannel(world.channel.id)
    expect(publishCalls()).toBe(0)
    expect(world.opportunity(opp.id).reason).toBe(DISCLOSURE_REASON)
  })

  it('reminds the owner in the approval queue as well, and the owner can still edit and approve', async () => {
    world = makeWorld({ mode: 'approval' })
    world.engine.on('draft.reply', reply({ reply: 'Natal Mystic builds a natal chart from your birth date, time and place.' }))
    const opp = await discovered()

    await world.drafting.processChannel(world.channel.id)

    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
    expect(world.opportunity(opp.id).reason).toBe(DISCLOSURE_REASON)
    await world.core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: 'I work on Natal Mystic: it builds a natal chart from your birth date, time and place.' } })
    expect((await world.core.router.call('opportunities.approve', { id: opp.id })).opportunity.state).toBe('ready')
  })

  it('adds no reminder to a reply that does not name the product, or one that is disclosed', async () => {
    world = makeWorld({ mode: 'approval' })
    world.engine.on('draft.reply', reply({ reply: 'I work on Natal Mystic; it builds a natal chart from your birth data.', disclosesConnection: true }))
    const disclosed = await discovered()
    await world.drafting.processChannel(world.channel.id)
    expect(world.opportunity(disclosed.id).reason).toBe('')

    world.engine.on('draft.reply', reply())
    const plain = await world.newOpportunity({ body: 'Another question?', commentId: 'other' })
    await world.drafting.processChannel(world.channel.id)
    expect(world.opportunity(plain.id).reason).toBe('')
  })

  it('reminds the owner when a suggested post names the product without a disclosure', async () => {
    world = makeWorld({ mode: 'approval' })
    const post = { topic: 'Charts', title: 'Natal Mystic charts', text: 'Natal Mystic builds a natal chart from your birth date, time and place.', link: '', rationale: 'from c1', usedClaimIds: ['c1'] }
    world.engine.on('draft.publication', JSON.stringify(post))
    const undisclosed = await world.core.router.call('publications.suggest', { channelId: world.channel.id })
    expect(undisclosed.opportunity.reason).toBe('Suggested topic: Charts. The post mentions the product; check that it says you are connected with it')

    world.engine.on('draft.publication', JSON.stringify({ ...post, title: 'Why I built charts', text: 'I work on Natal Mystic. It builds a natal chart from your birth date, time and place.', disclosesConnection: true }))
    const disclosed = await world.core.router.call('publications.suggest', { channelId: world.channel.id })
    expect(disclosed.opportunity.reason).toBe('Suggested topic: Charts')
  })
})
