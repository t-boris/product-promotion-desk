// Login roles in AI drafts (DEC-010, REQ-010). The rule that a text naming the product must say the author is connected with it was removed (owner, 2026-11-21).

import { afterEach, describe, expect, it } from 'vitest'
import type { Opportunity } from '../../shared/types'
import { channelView, postChannelView } from './context'
import { PUBLICATION_SYSTEM, REPLY_SYSTEM, UPDATE_SYSTEM, parsePublicationProposal, parseReplyProposal } from './draft-prompt'
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

describe('the link of a post where the platform has no field for it (DEC-036): the AI is told what the platform does with it', () => {
  const ask = async (platform: string) => {
    world = makeWorld({ mode: 'approval' })
    world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platform, world.channel.id)
    world.engine.on('draft.publication', JSON.stringify({ topic: 'Charts', title: 'How charts work', text: 'A natal chart is built from your birth date, time and place.', link: '', rationale: 'from c1', usedClaimIds: ['c1'] }))
    await world.core.router.call('publications.suggest', { channelId: world.channel.id })
    return (payloadOf(lastPrompt()) as { channel: { linkRule?: string } }).channel.linkRule
  }

  it('tells it, for Instagram, to leave the link empty; for Facebook, that it is added at the end of the text; and nothing where the form has a field', async () => {
    expect(await ask('instagram')).toMatch(/leave "link" empty/)
    expect(await ask('facebook')).toMatch(/added at the end of the text/)
    expect(await ask('reddit')).toBeUndefined()
    expect(await ask('fake')).toBeUndefined()
  })

  it('shows the rule to the drafting of a post only: a reply and a refinement see the channel as before', () => {
    world = makeWorld({ mode: 'approval' })
    const instagram = { ...world.channel, platform: 'instagram' }
    expect(postChannelView(instagram).linkRule).toMatch(/leave "link" empty/)
    expect(postChannelView({ ...world.channel, platform: 'reddit' })).not.toHaveProperty('linkRule')
    expect(channelView(instagram)).not.toHaveProperty('linkRule')
  })

  it('has the rule in the system prompt of a product post and of the owner\'s own update: it is followed when it is present', () => {
    expect(PUBLICATION_SYSTEM).toContain('When context.channel.linkRule is present, follow it.')
    expect(UPDATE_SYSTEM).toContain('When context.channel.linkRule is present, it comes first: follow it.')
  })
})

describe('no statement of the author\'s connection to the product is asked for (owner, 2026-11-21)', () => {
  it('tells the model neither to claim independence nor to deny the connection, and has no disclosure flag in its answer', () => {
    for (const system of [REPLY_SYSTEM, PUBLICATION_SYSTEM, UPDATE_SYSTEM]) {
      expect(system).toContain('Do not claim to be an independent user and do not deny a connection with the product')
      expect(system).not.toContain('disclosesConnection')
      expect(system).not.toContain('I work on it')
    }
  })

  it('reads an answer with or without the old flag: it is no longer part of a proposal', () => {
    const base = { category: 'thanks', decision: 'reply', reply: 'Thanks!', rationale: 'r', usedClaimIds: [] }
    expect(parseReplyProposal(JSON.stringify(base))).toEqual(base)
    expect(parseReplyProposal(JSON.stringify({ ...base }))).toEqual(base)
    const post = { topic: 't', title: 'T', text: 'x', link: null, rationale: 'r', usedClaimIds: [] }
    expect(parsePublicationProposal(JSON.stringify({ ...post, link: '' }))).toEqual(post)
  })

  it('sends a reply that names the product automatically, with nothing said about the connection', async () => {
    world = makeWorld(AUTO)
    world.engine.on('draft.reply', thanks('Glad you like NATAL MYSTIC, enjoy!'))
    const opp = await discovered('Thanks, great app!')

    await world.drafting.processChannel(world.channel.id)

    expect(world.opportunity(opp.id).state).toBe('confirmed')
    expect(publishCalls()).toBe(1)
  })

  it('does not hold a factual answer that names the product either', async () => {
    world = makeWorld(AUTO)
    world.engine.on('draft.reply', reply({ reply: 'Natal Mystic works on iPhone and Android.', usedClaimIds: ['c2'] }))
    const opp = await discovered('Does it work on Android?')
    await world.drafting.processChannel(world.channel.id)
    expect(world.opportunity(opp.id).state).toBe('confirmed')
    expect(world.opportunity(opp.id).reason).toBe('')
  })

  it('adds no reminder in the approval queue, and the owner approves the text as it is', async () => {
    world = makeWorld({ mode: 'approval' })
    world.engine.on('draft.reply', reply({ reply: 'Natal Mystic builds a natal chart from your birth date, time and place.' }))
    const opp = await discovered()

    await world.drafting.processChannel(world.channel.id)

    expect(world.opportunity(opp.id).state).toBe('awaiting_approval')
    expect(world.opportunity(opp.id).reason).toBe('')
    expect((await world.core.router.call('opportunities.approve', { id: opp.id })).opportunity.state).toBe('ready')
  })

  it('adds no reminder to a suggested post that names the product', async () => {
    world = makeWorld({ mode: 'approval' })
    const post = { topic: 'Charts', title: 'Natal Mystic charts', text: 'Natal Mystic builds a natal chart from your birth date, time and place.', link: '', rationale: 'from c1', usedClaimIds: ['c1'] }
    world.engine.on('draft.publication', JSON.stringify(post))
    const suggested = await world.core.router.call('publications.suggest', { channelId: world.channel.id })
    expect(suggested.opportunity.reason).toBe('Suggested topic: Charts')
  })
})
