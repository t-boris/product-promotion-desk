// The topic of a Threads post is part of what the owner approves, like the flair: kept when the words are rewritten, taken off only when the owner
// says so, refused where no field would take it, bound by the approval, given to the mission that types it, and proposed by the AI that writes a post.

import { afterEach, describe, expect, it } from 'vitest'
import type { PostMissionOutcome, PostMissionRequest, PostMissionService } from '../browser-agent/post-submit'
import { postChannelView } from './context'
import { PUBLICATION_SYSTEM, UPDATE_SYSTEM, parsePublicationProposal, parseUpdateProposal } from './draft-prompt'
import { contentHash } from './hash'
import type { SendingFlow } from './sending'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const call = (method: string, args: unknown) => (world.core.router.call as (m: string, a: unknown) => Promise<never>)(method, args)
const latest = (id: string) => world.core.repos.latestDraft(id)!
const setPlatform = (platform: string): void => {
  world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platform, world.channel.id)
}

function newPost(platform = 'threads') {
  world = makeWorld({ mode: 'approval' })
  setPlatform(platform)
  return world.store.createStandalone(world.refresh(), 'draft', 'A post of the owner')
}
const save = (id: string, draft: Record<string, unknown>) => call('opportunities.saveDraft', { id, draft: { text: 'body', ...draft } })

describe('the topic of a draft', () => {
  it('is stored clean, and is none when it was not given', async () => {
    const opp = newPost()
    await save(opp.id, {})
    expect(latest(opp.id).topicTag).toBeNull()
    await save(opp.id, { topicTag: '  #Birth   charts ' })
    expect(latest(opp.id).topicTag).toBe('Birth charts')
  })

  it('stays when the words are rewritten by a caller that does not know it, and goes only when the owner takes it off', async () => {
    const opp = newPost()
    await save(opp.id, { topicTag: 'Astrology' })
    await save(opp.id, { text: 'body, rewritten' })
    expect(latest(opp.id)).toMatchObject({ text: 'body, rewritten', topicTag: 'Astrology' })
    await save(opp.id, { topicTag: null })
    expect(latest(opp.id).topicTag).toBeNull()
    await save(opp.id, { topicTag: 'Astrology' })
    await save(opp.id, { topicTag: ' # ' })
    expect(latest(opp.id).topicTag).toBeNull()
  })

  it('refuses a topic the field of the site would not hold as it is typed', async () => {
    const opp = newPost()
    await expect(save(opp.id, { topicTag: 'x'.repeat(51) })).rejects.toThrow(/longer than 50/)
    await expect(save(opp.id, { topicTag: 'Node.js' })).rejects.toThrow(/period or an ampersand/)
    await expect(save(opp.id, { topicTag: 'Arts & crafts' })).rejects.toThrow(/period or an ampersand/)
  })

  it('is refused where the platform has no topic field, in a saved draft and in a new publication, and for a reply', async () => {
    const opp = newPost('reddit')
    await expect(save(opp.id, { title: 'T', topicTag: 'Astrology' })).rejects.toThrow(/Reddit has no topic field/)
    await expect(call('publications.create', { channelId: world.channel.id, draft: { title: 'T', text: 'body', topicTag: 'Astrology' } })).rejects.toThrow(/Reddit has no topic field/)
    // Without a topic the same post is taken.
    await save(opp.id, { title: 'T', topicTag: null })
    setPlatform('threads')
    const reply = await world.newOpportunity()
    await expect(save(reply.id, { topicTag: 'Astrology' })).rejects.toThrow(/A reply has no topic/)
    const made = (await call('publications.create', { channelId: world.channel.id, draft: { text: 'body', topicTag: '#Astrology' } })) as { opportunity: { id: string } }
    expect(latest(made.opportunity.id).topicTag).toBe('Astrology')
  })

  it('withdraws the approval when it changes, like any other part of the post', async () => {
    const opp = newPost()
    await save(opp.id, { topicTag: 'Astrology' })
    await call('opportunities.approve', { id: opp.id })
    expect(world.opportunity(opp.id).state).toBe('ready')
    await save(opp.id, { topicTag: 'Moon phases' })
    expect(world.opportunity(opp.id).state).not.toBe('ready')
  })

  it('is part of the hash only when set: a draft without one hashes exactly as it did before topics existed', () => {
    const base = { title: null, text: 'body', link: null, attachments: [] }
    const account = { id: 'acc', identity: 'brand' }
    const plain = contentHash(base, account, 'https://x/y', 'threads')
    expect(contentHash({ ...base, topicTag: null }, account, 'https://x/y', 'threads')).toBe(plain)
    expect(contentHash({ ...base, topicTag: '' }, account, 'https://x/y', 'threads')).toBe(plain)
    expect(contentHash({ ...base, topicTag: undefined }, account, 'https://x/y', 'threads')).toBe(plain)
    const withTopic = contentHash({ ...base, topicTag: 'Astrology' }, account, 'https://x/y', 'threads')
    expect(withTopic).not.toBe(plain)
    expect(contentHash({ ...base, topicTag: 'Moon phases' }, account, 'https://x/y', 'threads')).not.toBe(withTopic)
  })

  it('reaches the request, and the mission that publishes is given exactly the approved topic to type', async () => {
    const opp = newPost()
    await save(opp.id, { topicTag: 'Astrology' })
    const { buildPublishRequest } = await import('./request')
    const channel = world.refresh()
    expect(buildPublishRequest(world.opportunity(opp.id), latest(opp.id), null, channel.url, channel.platform).topicTag).toBe('Astrology')

    await call('opportunities.approve', { id: opp.id })
    const requests: PostMissionRequest[] = []
    const recorder: PostMissionService = {
      async run(request): Promise<PostMissionOutcome> {
        requests.push(request)
        return { ended: 'finished', committed: request.authority.committed, reported: null, humanCheck: null, warning: null, error: null }
      }
    }
    world.core.services.postMissions = recorder
    world.core.settings.updateApp({ publishWith: 'ai_browser' })
    await (world.sending as SendingFlow).send(opp.id).catch(() => undefined) // nothing is pressed, so the send does not confirm
    expect(requests).toHaveLength(1)
    expect(requests[0].authority.content).toMatchObject({ kind: 'post', text: 'body', topicTag: 'Astrology' })
  })

  it('says in the application\'s own words that the form did not take the topic, and how to publish without it', async () => {
    const opp = newPost()
    await save(opp.id, { topicTag: 'Astrology' })
    await call('opportunities.approve', { id: opp.id })
    world.core.services.postMissions = {
      async run(request): Promise<PostMissionOutcome> {
        return { ended: 'finished', committed: request.authority.committed, reported: { status: 'needs_owner', reason: 'something else' }, humanCheck: null, warning: null, topic: 'the AI found no topic field in the form.', error: null }
      }
    }
    world.core.settings.updateApp({ publishWith: 'ai_browser' })
    await (world.sending as SendingFlow).send(opp.id).catch(() => undefined)
    const row = world.core.db.prepare('SELECT error FROM send_actions WHERE opportunity_id = ?').get(opp.id) as { error: string }
    expect(row.error).toContain('The topic of the post could not be put into the form: the AI found no topic field in the form. Nothing was submitted.')
    expect(row.error).toContain('empty the “Topic” line of the post')
  })
})

describe('the topic of a post written for several channels', () => {
  it('goes to the versions of the platforms that have a topic field, and to no other', async () => {
    world = makeWorld({ mode: 'approval' })
    setPlatform('threads')
    const reddit = world.addChannel({ target: 'r/other' })
    world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run('reddit', reddit.id)
    const group = (await call('postGroups.create', { productId: world.product.id, channelIds: [world.channel.id, reddit.id], draft: { title: 'T', text: 'body', topicTag: 'Astrology' } })) as { versions: { card: { opportunity: { id: string; channelId: string } } }[] }
    const topicOf = (channelId: string) => latest(group.versions.find((v) => v.card.opportunity.channelId === channelId)!.card.opportunity.id).topicTag
    expect(topicOf(world.channel.id)).toBe('Astrology')
    expect(topicOf(reddit.id)).toBeNull()
  })
})

describe('the topic of a post the AI writes', () => {
  const PROPOSAL = { topic: 'Charts', title: 'How charts work', text: 'A natal chart is built from your birth date, time and place.', link: '', rationale: 'from c1', usedClaimIds: ['c1'] }
  const suggest = async (platform: string, answer: Record<string, unknown>) => {
    world = makeWorld({ mode: 'approval' })
    setPlatform(platform)
    world.engine.on('draft.publication', JSON.stringify(answer))
    const card = (await call('publications.suggest', { channelId: world.channel.id })) as { opportunity: { id: string } }
    const prompt = world.engine.calls.at(-1)!.prompt
    const asked = (JSON.parse(prompt.slice(prompt.indexOf('{'))) as { channel: { topicRule?: string } }).channel.topicRule
    return { asked, draft: latest(card.opportunity.id) }
  }

  it('is asked for and kept on a Threads channel: the owner sees it with the post', async () => {
    const { asked, draft } = await suggest('threads', { ...PROPOSAL, topicTag: '#Astrology' })
    expect(asked).toMatch(/files a post under ONE topic/)
    expect(draft.topicTag).toBe('Astrology')
  })

  it('is not asked for and not kept where the platform has no topic field', async () => {
    const { asked, draft } = await suggest('reddit', { ...PROPOSAL, topicTag: 'Astrology' })
    expect(asked).toBeUndefined()
    expect(draft.topicTag).toBeNull()
  })

  it('is left out when the AI gives one the field cannot hold: the post stands without it', async () => {
    expect((await suggest('threads', { ...PROPOSAL, topicTag: 'Node.js & friends' })).draft.topicTag).toBeNull()
    await closeWorld(world)
    expect((await suggest('threads', PROPOSAL)).draft.topicTag).toBeNull()
  })

  it('is read from a product post and from an own update alike, and both system prompts say when to give it', () => {
    expect(parsePublicationProposal(JSON.stringify({ ...PROPOSAL, topicTag: ' Moon   phases ' })).topicTag).toBe('Moon phases')
    expect(parsePublicationProposal(JSON.stringify(PROPOSAL)).topicTag).toBeNull()
    expect(parseUpdateProposal(JSON.stringify({ title: 'A fix', text: 'I fixed a bug.', link: '', rationale: 'the note', addsFactsBeyondNote: false, topicTag: 'Building in public' })).topicTag).toBe('Building in public')
    expect(parseUpdateProposal(JSON.stringify({ title: 'A fix', text: 'I fixed a bug.', link: '', rationale: 'the note', addsFactsBeyondNote: false, topicTag: 7 })).topicTag).toBeNull()
    expect(PUBLICATION_SYSTEM).toContain('When context.channel.topicRule is present, follow it and add "topicTag"')
    expect(UPDATE_SYSTEM).toContain('When context.channel.topicRule is present, follow it and add "topicTag"')
  })

  it('shows the rule to the drafting of a post only', () => {
    world = makeWorld({ mode: 'approval' })
    expect(postChannelView({ ...world.channel, platform: 'threads' }).topicRule).toMatch(/"topicTag"/)
    expect(postChannelView({ ...world.channel, platform: 'instagram' })).not.toHaveProperty('topicRule')
  })
})
