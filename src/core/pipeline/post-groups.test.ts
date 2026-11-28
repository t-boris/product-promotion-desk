// DEC-032: one post for several channels. A group is a wrapper; every version is an ordinary post of one channel.

import { afterEach, describe, expect, it } from 'vitest'
import type { Channel, Draft, MediaItem, PostGroupCard } from '../../shared/types'
import { adaptInstruction, editedByHand, PostGroupsFlow } from './post-groups'
import { chooseExecutor, flairProblem, sendWays } from './send-ways'
import type { DraftHelp } from './draft-help'
import { PublicationsFlow } from './publications'
import type { ReviewFlow } from './review'
import type { SendingFlow } from './sending'
import { closeWorld, makeWorld, type World } from './test-fixture'
import { verifiedCapabilities } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const call = (method: string, args: unknown) => (world.core.router.call as (m: string, a: unknown) => Promise<never>)(method, args)

interface Helper {
  asked: { opportunityId?: string; instruction?: string; text: string }[]
  fail: Set<string>
  /** Runs while the AI is "writing" (after it was asked, before it answers): the owner doing something in the meantime. */
  during: ((opportunityId: string) => Promise<void>) | null
}

/** A world with a Reddit channel (the world's own), then one channel per further platform, each on a login of its own. */
function setup(platforms: string[] = ['reddit', 'x', 'pinterest']) {
  world = makeWorld()
  const channels: Channel[] = [world.channel]
  for (let i = 1; i < platforms.length; i += 1) {
    const account = world.addAccount({ label: `Login ${i}`, identity: `login_${i}` })
    channels.push(world.addChannel({ accountId: account.id, target: `target-${i}` }))
  }
  channels.forEach((c, i) => world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platforms[i], c.id))
  const helper: Helper = { asked: [], fail: new Set(), during: null }
  const help = {
    refine: async (args: { opportunityId?: string; instruction?: string; form: { text: string } }) => {
      helper.asked.push({ opportunityId: args.opportunityId, instruction: args.instruction, text: args.form.text })
      if (args.opportunityId && helper.fail.has(args.opportunityId)) throw new Error('The AI is not available.')
      if (args.opportunityId && helper.during) await helper.during(args.opportunityId)
      return { text: `${args.form.text} (adapted)` }
    }
  } as unknown as DraftHelp
  const sleeps: number[] = []
  const flow = new PostGroupsFlow(world.core, world.store, world.core.services.pipeline as unknown as ReviewFlow, world.core.services.sending as unknown as SendingFlow, help, new PublicationsFlow(world.core, world.store), {
    sleep: async (ms) => {
      sleeps.push(ms)
    }
  })
  return { channels, flow, helper, sleeps }
}

const MASTER = { title: 'Notes on the transit', text: 'A short post about **transits**.', markup: 'markdown' as const }
const seenOf = (card: PostGroupCard): Record<string, string> => Object.fromEntries(card.versions.map((v) => [v.card.opportunity.id, (v.card.draft as Draft).id]))
async function picture(tag = 'a'): Promise<MediaItem> {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
  return (await call('media.add', { productId: world.product.id, name: `${tag}.png`, base64: Buffer.concat([header, Buffer.from(tag)]).toString('base64'), origin: 'picked' })) as MediaItem
}
const attach = (m: MediaItem) => ({ name: m.name, path: m.path, mime: '', sha256: '', mediaId: m.id })
const published = (): number => world.connector.published.length

describe('making a post for several channels', () => {
  it('writes one ordinary post per channel, from the master, and nothing else', async () => {
    const { channels, flow } = setup()
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    expect(card.versions).toHaveLength(3)
    expect(card.group.master.text).toBe(MASTER.text)
    const ids = new Set(card.versions.map((v) => v.card.opportunity.id))
    expect(ids.size).toBe(3)
    for (const [i, v] of card.versions.entries()) {
      expect(v.card.opportunity.kind).toBe('standalone')
      expect(v.card.opportunity.state).toBe('draft')
      expect(v.card.opportunity.groupId).toBe(card.group.id)
      expect(v.card.opportunity.channelId).toBe(channels[i]?.id)
      expect(v.card.draft?.text).toBe(MASTER.text)
      expect(v.card.draft?.author).toBe('user')
      expect(v.card.approval).toBeNull()
      expect(v.edited).toBe(false)
    }
    expect(published()).toBe(0)
  })

  it('needs two or more channels, of this product, each once, and refuses a channel that cannot publish', async () => {
    const { channels, flow } = setup()
    const product = world.product.id
    await expect(flow.create(product, [channels[0]!.id], MASTER)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(flow.create(product, [channels[0]!.id, channels[0]!.id], MASTER)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(flow.create(product, [channels[0]!.id, channels[1]!.id], { title: '', text: '' })).rejects.toMatchObject({ code: 'invalid_input' })
    const other = world.addProduct('Another')
    const foreign = world.addChannel({ productId: other.id, accountId: world.addAccount({ productId: other.id }).id, target: 'x' })
    await expect(flow.create(product, [channels[0]!.id, foreign.id], MASTER)).rejects.toMatchObject({ code: 'invalid_input' })
    const noPost = world.addChannel({
      accountId: world.addAccount({ label: 'No posting' }).id,
      target: 'closed',
      capabilities: verifiedCapabilities().map((c) => (c.key === 'publish_post' ? { ...c, status: 'unavailable' as const } : c))
    })
    await expect(flow.create(product, [channels[0]!.id, noPost.id], MASTER)).rejects.toMatchObject({ code: 'channel_cannot_publish' })
    // nothing was left half-made
    expect(world.core.db.prepare('SELECT COUNT(*) AS n FROM post_groups').get()).toMatchObject({ n: 0 })
    expect(world.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities').get()).toMatchObject({ n: 0 })
  })

  it('leaves nothing half-made when a version cannot be written', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const real = world.store.insertDraft.bind(world.store)
    let calls = 0
    world.store.insertDraft = (...args: Parameters<typeof real>) => {
      calls += 1
      if (calls === 2) throw new Error('The disk is full.')
      return real(...args)
    }
    await expect(flow.create(world.product.id, channels.map((c) => c.id), MASTER)).rejects.toThrow(/disk is full/)
    expect(world.core.db.prepare('SELECT COUNT(*) AS n FROM post_groups').get()).toMatchObject({ n: 0 })
    expect(world.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities').get()).toMatchObject({ n: 0 })
  })

  it('holds one live version per channel in the database itself, and lets a deleted one be made again', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    expect(() => world.store.createStandalone(channels[0]!, 'draft', 'again', card.group.id)).toThrow(/UNIQUE/)
    world.store.updateOpportunity(card.versions[0]!.card.opportunity.id, { state: 'cancelled' })
    expect(() => world.store.createStandalone(channels[0]!, 'draft', 'again', card.group.id)).not.toThrow()
    // a post of its own (no group) is never held by it
    expect(() => world.store.createStandalone(channels[0]!, 'draft', 'a')).not.toThrow()
    expect(() => world.store.createStandalone(channels[0]!, 'draft', 'b')).not.toThrow()
  })

  it('is not reached by an ordinary post: it has no group, and a group is read from its own table', async () => {
    const { channels } = setup()
    const single = (await call('publications.create', { channelId: channels[0]!.id, draft: { title: 'One', text: 'Alone' } })) as { opportunity: { groupId: string | null } }
    expect(single.opportunity.groupId).toBeNull()
    const groups = (await call('postGroups.list', { productId: world.product.id })) as PostGroupCard[]
    expect(groups).toEqual([])
  })

  it('is lived through the API: create, get, list', async () => {
    const { channels } = setup()
    const card = (await call('postGroups.create', { productId: world.product.id, channelIds: channels.map((c) => c.id), draft: MASTER })) as PostGroupCard
    expect(((await call('postGroups.get', { id: card.group.id })) as PostGroupCard).versions).toHaveLength(3)
    expect(((await call('postGroups.list', { productId: world.product.id })) as PostGroupCard[]).map((g) => g.group.id)).toEqual([card.group.id])
  })
})

describe('"also post to…" for a post that exists', () => {
  it('turns the owner\'s post into the first version of a group, with its text as the master', async () => {
    const { channels, flow } = setup()
    const single = (await call('publications.create', { channelId: channels[0]!.id, draft: { ...MASTER } })) as { opportunity: { id: string } }
    const card = await flow.extend(single.opportunity.id, [channels[1]!.id, channels[2]!.id])
    expect(card.versions).toHaveLength(3)
    expect(card.versions[0]?.card.opportunity.id).toBe(single.opportunity.id)
    expect(card.group.master.text).toBe(MASTER.text)
    expect(card.versions.every((v) => v.card.opportunity.groupId === card.group.id)).toBe(true)
  })

  it('hands the facts a post stands on to every copy, so a withdrawn fact returns all of them to review', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const single = (await call('publications.create', { channelId: channels[0]!.id, draft: { ...MASTER } })) as { opportunity: { id: string } }
    world.core.db.prepare("UPDATE drafts SET used_claims_json = ?, knowledge_version_id = ?, rationale = ?, author = 'ai' WHERE opportunity_id = ?").run(JSON.stringify(['lineage-1']), 'kv-1', 'Because.', single.opportunity.id)
    const card = await flow.extend(single.opportunity.id, [channels[1]!.id])
    for (const v of card.versions) {
      expect(v.card.draft).toMatchObject({ usedClaimLineageIds: ['lineage-1'], knowledgeVersionId: 'kv-1', rationale: 'Because.', author: 'ai' })
    }
    // an AI draft is the AI's: the copy is not "edited by hand"
    expect(card.versions.every((v) => !v.edited)).toBe(true)
    expect(Object.keys(card.group)).not.toContain('provenance')
    expect(Object.keys(card.group.master)).not.toContain('provenance')
  })

  it('adds to a group that exists, once per channel, and refuses a reply or a deleted post', async () => {
    const { channels, flow } = setup(['reddit', 'x', 'linkedin'])
    const first = await flow.create(world.product.id, [channels[0]!.id, channels[1]!.id], MASTER)
    const opp = first.versions[0]!.card.opportunity.id
    const more = await flow.extend(opp, [channels[1]!.id, channels[2]!.id])
    expect(more.versions.map((v) => v.card.opportunity.channelId)).toEqual([channels[0]!.id, channels[1]!.id, channels[2]!.id])
    await expect(flow.extend(opp, [channels[1]!.id])).rejects.toMatchObject({ code: 'invalid_input' })
    const reply = await world.newOpportunity()
    await expect(flow.extend(reply.id, [channels[1]!.id])).rejects.toMatchObject({ code: 'invalid_state' })
    await flow.remove(first.group.id)
    await expect(flow.extend(opp, [channels[2]!.id])).rejects.toMatchObject({ code: 'invalid_state' })
  })
})

describe('which channels the post fits', () => {
  it('says for each channel whether the post fits as it is, and why not; the app suggests what fits and chooses nothing', async () => {
    const { channels, flow } = setup(['reddit', 'threads', 'instagram'])
    const long = { title: 'T', text: 'x'.repeat(900), markup: 'markdown' as const }
    const options = flow.channels(world.product.id, long, [channels[0]!.id])
    const by = (platform: string) => options.find((o) => o.platform === platform)
    expect(by('reddit')).toMatchObject({ fits: true, suggested: false }) // fits, but already chosen
    expect(by('threads')).toMatchObject({ fits: false, suggested: false })
    expect(by('threads')?.reason).toMatch(/500/)
    expect(by('instagram')).toMatchObject({ fits: false })
    expect(by('instagram')?.reason).toMatch(/picture/i)
    const short = flow.channels(world.product.id, { title: 'T', text: 'Short', markup: 'markdown' })
    expect(short.find((o) => o.platform === 'threads')).toMatchObject({ fits: true, suggested: true })
    expect(short.find((o) => o.platform === 'threads')?.reason).toMatch(/5 of 500/)
    expect(short.map((o) => o.fits)).toEqual([...short.map((o) => o.fits)].sort((a, b) => Number(b) - Number(a))) // those that fit come first
    expect(published()).toBe(0)
    expect(world.core.db.prepare('SELECT COUNT(*) AS n FROM opportunities').get()).toMatchObject({ n: 0 })
  })

  it('tells what the approval would refuse for an older post too, and has nothing to say about a post that names the product', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const legacy = flow.channels(world.product.id, { text: 'x'.repeat(300) })
    expect(legacy.find((o) => o.platform === 'x')).toMatchObject({ fits: false })
    expect(legacy.find((o) => o.platform === 'x')?.reason).toMatch(/longer than X takes \(300 of 280/)
    expect(legacy.find((o) => o.platform === 'reddit')?.fits).toBe(true)
    const card = await flow.create(world.product.id, channels.map((c) => c.id), { text: 'x'.repeat(300) })
    expect(card.versions[1]?.problems.join(' ')).toMatch(/longer than X takes/)
    // the product is named and nobody says who is speaking: that is not a reason for any channel to refuse it
    const named = flow.channels(world.product.id, { title: 'T', text: 'Natal Mystic builds your chart.', markup: 'markdown' })
    expect(named.every((o) => o.fits)).toBe(true)
    expect(named.map((o) => o.reason).join(' ')).not.toMatch(/connect/i)
  })

  it('reads a version as its platform shows it, and asks for no statement of who speaks (DEC-036)', async () => {
    const { flow } = setup(['reddit', 'threads', 'instagram'])
    const said = flow.channels(world.product.id, { title: 'T', text: 'I work on it.', link: 'https://natalmystic.com', markup: 'markdown' })
    expect(said.find((o) => o.platform === 'threads')).toMatchObject({ fits: true })
    // with no statement the post fits all the same; Instagram, which leaves the link out, says only that a picture is missing
    const silent = flow.channels(world.product.id, { title: 'T', text: 'Charts are fun.', link: 'https://natalmystic.com', markup: 'markdown' })
    expect(silent.find((o) => o.platform === 'threads')).toMatchObject({ fits: true })
    expect(silent.find((o) => o.platform === 'instagram')).toMatchObject({ fits: false })
    expect(silent.find((o) => o.platform === 'instagram')?.reason).toMatch(/needs a picture/)
  })

  it('knows a picture makes Instagram fit, and leaves out a channel that cannot post at all; a paused one is shown with the reason', async () => {
    const { channels, flow } = setup(['reddit', 'threads', 'instagram'])
    const m = await picture()
    const withPicture = flow.channels(world.product.id, { ...MASTER, attachments: [attach(m)] })
    expect(withPicture.find((o) => o.platform === 'instagram')?.fits).toBe(false) // pictures on Instagram go only through the AI browser
    expect(withPicture.find((o) => o.platform === 'instagram')?.reason).toMatch(/AI browser/)
    world.core.db.prepare('UPDATE channels SET status = ? WHERE id = ?').run('paused', channels[1]!.id)
    world.core.db
      .prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify(verifiedCapabilities().map((c) => (c.key === 'publish_post' ? { ...c, status: 'unavailable' } : c))), channels[2]!.id)
    const options = flow.channels(world.product.id, MASTER)
    expect(options.find((o) => o.platform === 'threads')).toMatchObject({ fits: false, reason: 'The channel is paused.' })
    expect(options.find((o) => o.platform === 'instagram')).toBeUndefined()
  })
})

describe('adapting for each platform with the AI', () => {
  it('stores a draft by the AI for each version and asks in the words of that platform\'s limits; the master stays', async () => {
    const { channels, flow, helper } = setup()
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const out = await flow.adapt(card.group.id, undefined, false)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'done', 'done'])
    for (const v of out.card.versions) {
      expect(v.card.draft?.text).toBe(`${MASTER.text} (adapted)`)
      expect(v.card.draft?.author).toBe('ai')
      expect(v.edited).toBe(false)
    }
    expect(out.card.group.master.text).toBe(MASTER.text)
    expect(helper.asked.map((a) => a.instruction)).toEqual(channels.map((_, i) => adaptInstruction(['reddit', 'x', 'pinterest'][i]!)))
    expect(helper.asked.every((a) => a.text === MASTER.text)).toBe(true)
  })

  it('asks in the words of the limit that is left when the link is added to the end of the text, and only where it is', async () => {
    const { channels, flow, helper } = setup(['threads', 'instagram'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), { ...MASTER, link: 'https://natalmystic.com' })
    await flow.adapt(card.group.id, undefined, false)
    const wishes = Object.fromEntries(helper.asked.map((a, i) => [['threads', 'instagram'][i]!, a.instruction ?? '']))
    expect(wishes.threads).toMatch(/At most 475 characters, because the link is added after the text \(aim for 427\)/)
    expect(wishes.instagram).toMatch(/At most 2200 characters \(aim for 1980\)/)
    expect(adaptInstruction('reddit', 'https://natalmystic.com')).not.toMatch(/At most/)
  })

  it('leaves a version the owner changed by hand, unless asked to start over', async () => {
    const { channels, flow } = setup()
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const mine = card.versions[1]!.card.opportunity.id
    await call('opportunities.saveDraft', { id: mine, draft: { text: 'My own words for X.', markup: 'markdown' } })
    expect(flow.get(card.group.id).versions[1]?.edited).toBe(true)
    const out = await flow.adapt(card.group.id, undefined, false)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped', 'done'])
    expect(out.results[1]?.reason).toMatch(/changed it by hand/)
    expect(out.card.versions[1]?.card.draft?.text).toBe('My own words for X.')
    const again = await flow.adapt(card.group.id, [mine], true)
    expect(again.results.map((r) => r.status)).toEqual(['done'])
    expect(again.card.versions[1]?.card.draft?.text).toBe(`${MASTER.text} (adapted)`)
    expect(again.card.versions[1]?.edited).toBe(false)
  })

  it('does not rewrite a version that was sent already', async () => {
    const { channels, flow, helper } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await call('opportunities.approve', { id: card.versions[0]!.card.opportunity.id })
    await world.sending.send(card.versions[0]!.card.opportunity.id)
    const out = await flow.adapt(card.group.id, undefined, true)
    expect(out.results.map((r) => r.status)).toEqual(['skipped', 'done'])
    expect(out.results[0]?.reason).toMatch(/sent already/)
    expect(helper.asked).toHaveLength(1) // the AI was not even asked about the sent one
    expect(out.card.versions[0]?.card.draft?.text).toBe(MASTER.text)
  })

  it('names the version the AI could not adapt and goes on with the others; an approval of an adapted version no longer applies', async () => {
    const { channels, flow, helper } = setup()
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    helper.fail.add(card.versions[1]!.card.opportunity.id)
    const out = await flow.adapt(card.group.id, undefined, false)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'failed', 'done'])
    expect(out.results[1]?.reason).toMatch(/not available/)
    expect(out.card.versions[1]?.card.draft?.text).toBe(MASTER.text)
  })

  it('leaves what the owner approved or put off alone in a bulk adapt, and adapts it when the owner points at it (which cancels the approval)', async () => {
    const { channels, flow } = setup()
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const [reddit, xCh, pinterest] = card.versions.map((v) => v.card.opportunity.id) as [string, string, string]
    await call('opportunities.approve', { id: reddit })
    await call('opportunities.defer', { id: pinterest })
    const bulk = await flow.adapt(card.group.id, undefined, false)
    expect(bulk.results.map((r) => r.status)).toEqual(['skipped', 'done', 'skipped'])
    expect(bulk.results[0]?.reason).toMatch(/You approved it/)
    expect(bulk.results[2]?.reason).toMatch(/put it off/)
    expect(bulk.card.versions[0]?.card.approval).not.toBeNull()
    const picked = await flow.adapt(card.group.id, [reddit, xCh], false)
    expect(picked.results.map((r) => r.status)).toEqual(['done', 'done'])
    expect(picked.card.versions[0]?.card.approval).toBeNull() // read it again, then approve
    await expect(flow.adapt(card.group.id, ['not-a-version'], false)).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('drops the AI\'s text when the owner changes the version while the AI is writing, and keeps the owner\'s', async () => {
    const { channels, flow, helper } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const mine = card.versions[1]!.card.opportunity.id
    helper.during = async (id) => {
      if (id === mine) await call('opportunities.saveDraft', { id, draft: { text: 'A typo fixed by me.', markup: 'markdown' } })
    }
    const out = await flow.adapt(card.group.id, undefined, false)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped'])
    expect(out.results[1]?.reason).toMatch(/while the AI was writing/)
    expect(out.card.versions[1]?.card.draft?.text).toBe('A typo fixed by me.')
    expect(out.card.versions[1]?.card.draft?.author).toBe('user')
    expect(out.card.versions[1]?.edited).toBe(true)
  })

  it('has nothing to adapt for a post of only a picture, and says so, instead of writing a post from the facts', async () => {
    const { channels, flow, helper } = setup(['reddit', 'x'])
    const m = await picture('only')
    const card = await flow.create(world.product.id, channels.map((c) => c.id), { title: 'T', text: '', attachments: [attach(m)], markup: 'markdown' })
    const out = await flow.adapt(card.group.id, undefined, false)
    expect(out.results.map((r) => r.status)).toEqual(['skipped', 'skipped'])
    expect(out.results[0]?.reason).toMatch(/no words/)
    expect(helper.asked).toEqual([])
  })

  it('says when the adapted text is still too long for the platform, and lets the owner read it', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), { ...MASTER, text: 'x'.repeat(300) })
    const out = await flow.adapt(card.group.id, undefined, false)
    expect(out.results[1]?.status).toBe('done')
    expect(out.results[1]?.reason).toMatch(/^Adapted, but .*280/)
    expect(out.results[0]?.reason).toBe('Adapted. Read it, then approve.')
  })

  it('has a wish short enough for the AI helper, for every platform it knows', () => {
    for (const platform of ['reddit', 'instagram', 'facebook', 'threads', 'x', 'linkedin', 'telegram', 'pinterest', 'tiktok', 'youtube', 'mastodon']) {
      const wish = adaptInstruction(platform)
      expect(wish.length).toBeLessThan(300)
      expect(wish).toMatch(/every fact/)
    }
    expect(adaptInstruction('threads')).toMatch(/At most 500 characters \(aim for 450\)/)
    expect(adaptInstruction('threads')).toMatch(/plain text with no markdown/)
    expect(adaptInstruction('reddit')).toMatch(/Markdown is fine/)
    expect(adaptInstruction('reddit')).not.toMatch(/At most/)
    // where the link is added to the end of the text it takes room of the limit, and the words are asked to leave it
    expect(adaptInstruction('threads', 'https://natalmystic.com')).toMatch(/At most 475 characters, because the link is added after the text \(aim for 427\)/)
    expect(adaptInstruction('instagram', 'https://natalmystic.com')).toMatch(/At most 2200 characters \(aim for 1980\)/)
    expect(adaptInstruction('threads', '   ')).toMatch(/At most 500 characters \(aim for 450\)/)
  })
})

describe('one approval for the group, after reading every version', () => {
  it('approves each version by its own approval, bound to its own account and destination, and sends nothing', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const out = await flow.approve(card.group.id, seenOf(card))
    expect(out.results.map((r) => r.status)).toEqual(['done', 'done'])
    const approvals = out.card.versions.map((v) => v.card.approval)
    expect(approvals.every((a) => a !== null && a.approvedBy === 'user')).toBe(true)
    expect(new Set(approvals.map((a) => a?.contentHash)).size).toBe(2) // each bound to its own account and destination
    expect(approvals.map((a) => a?.accountId)).toEqual(channels.map((c) => c.accountId))
    expect(out.card.versions.map((v) => v.card.opportunity.state)).toEqual(['ready', 'ready'])
    expect(published()).toBe(0)
  })

  it('names a version that cannot be approved, with its reason, leaves it out, and approves the rest', async () => {
    const { channels, flow } = setup()
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER) // Pinterest needs a picture
    const out = await flow.approve(card.group.id, seenOf(card))
    expect(out.results.map((r) => r.status)).toEqual(['done', 'done', 'skipped'])
    expect(out.results[2]?.reason).toMatch(/picture/i)
    expect(out.card.versions[2]?.card.approval).toBeNull()
    expect(out.card.versions.slice(0, 2).every((v) => v.card.approval !== null)).toBe(true)
  })

  it('approves only the draft the owner was shown: a version that changed since is left for them to read again', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const seen = seenOf(card)
    await call('opportunities.saveDraft', { id: card.versions[1]!.card.opportunity.id, draft: { text: 'Changed after you looked.', markup: 'markdown' } })
    const out = await flow.approve(card.group.id, seen)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped'])
    expect(out.results[1]?.reason).toMatch(/changed after you looked/)
    expect(out.card.versions[1]?.card.approval).toBeNull()
    const none = await flow.approve(card.group.id, {})
    expect(none.results.every((r) => r.status === 'skipped')).toBe(true)
  })

  it('refuses a malformed list of what was shown, and says a version it was not shown is not shown', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await expect(flow.approve(card.group.id, null as never)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(flow.approve(card.group.id, [] as never)).rejects.toMatchObject({ code: 'invalid_input' })
    const [first] = card.versions
    const out = await flow.approve(card.group.id, { [first!.card.opportunity.id]: first!.card.draft!.id, 'foreign-id': 'x' })
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped'])
    expect(out.results[1]?.reason).toMatch(/not shown to you/)
  })

  it('does not approve while the AI is adapting, nor while the group is being sent', async () => {
    const { channels, flow, helper } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    let pressed: Promise<unknown> | null = null
    helper.during = async () => {
      pressed ??= flow.approve(card.group.id, seenOf(card)).catch((error: unknown) => error)
      expect(await pressed).toMatchObject({ code: 'busy' })
    }
    await flow.adapt(card.group.id, undefined, false)
    expect(flow.get(card.group.id).versions.every((v) => v.card.approval === null)).toBe(true)
  })

  it('does not touch a version that was sent already, and editing one version cancels only its own approval', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await flow.approve(card.group.id, seenOf(card))
    await call('opportunities.saveDraft', { id: card.versions[1]!.card.opportunity.id, draft: { text: 'Edited.', markup: 'markdown' } })
    const after = flow.get(card.group.id)
    expect(after.versions[0]?.card.approval).not.toBeNull()
    expect(after.versions[1]?.card.approval).toBeNull()
    await world.sending.send(card.versions[0]!.card.opportunity.id)
    const again = await flow.approve(card.group.id, seenOf(after))
    expect(again.results.map((r) => r.status)).toEqual(['skipped', 'done'])
    expect(again.results[0]?.reason).toMatch(/sent already/)
  })
})

describe('sending the group with one press', () => {
  it('sends the approved versions one after another with a pause, each its own send; the unapproved one waits', async () => {
    const { channels, flow, sleeps } = setup()
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await flow.approve(card.group.id, seenOf(card)) // Pinterest is left out
    const out = await flow.sendAll(card.group.id)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'done', 'skipped'])
    expect(out.results[2]?.reason).toMatch(/not approved when you pressed/)
    expect(published()).toBe(2)
    expect(sleeps).toEqual([5000]) // between the two sends, not before the first and not for the one that waits
    expect(out.card.versions.map((v) => v.card.opportunity.state)).toEqual(['confirmed', 'confirmed', 'draft'])
    expect(new Set(out.card.versions.slice(0, 2).map((v) => v.card.lastAction?.id)).size).toBe(2)
  })

  it('sends only what was approved at the press: a version approved, or changed and approved again, while it runs is not sent by it', async () => {
    const { channels, flow } = setup(['reddit', 'x', 'linkedin'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const [v0, v1, v2] = card.versions.map((v) => v.card.opportunity.id) as [string, string, string]
    await call('opportunities.approve', { id: v0 })
    await call('opportunities.approve', { id: v1 })
    let release: () => void = () => undefined
    world.connector.publishGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sending = flow.sendAll(card.group.id) // holds at the first send
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
    // while it runs: the third version is approved ("for later"), the second is changed and approved again
    await call('opportunities.approve', { id: v2 })
    await call('opportunities.saveDraft', { id: v1, draft: { text: 'Changed after the press.', markup: 'markdown' } })
    await call('opportunities.approve', { id: v1 })
    release()
    const out = await sending
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped', 'skipped'])
    expect(out.results[1]?.reason).toMatch(/changed after you pressed Send all/)
    expect(out.results[2]?.reason).toMatch(/not approved when you pressed/)
    expect(published()).toBe(1)
    expect(world.opportunity(v1).state).toBe('ready') // still approved, waiting for its own press
    expect(world.opportunity(v2).state).toBe('ready')
  })

  it('does not send a version whose approval was given again after the press, though its text is the same', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const [v0, v1] = card.versions.map((v) => v.card.opportunity.id) as [string, string]
    await call('opportunities.approve', { id: v0 })
    await call('opportunities.approve', { id: v1 })
    let release: () => void = () => undefined
    world.connector.publishGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sending = flow.sendAll(card.group.id)
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
    // the approval of the second is withdrawn (its facts changed) and given again: a new approval of the same text
    world.store.invalidateApprovals(v1, 'The facts changed.')
    world.store.updateOpportunity(v1, { state: 'draft' })
    await call('opportunities.approve', { id: v1 })
    release()
    const out = await sending
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped'])
    expect(out.results[1]?.reason).toMatch(/changed after you pressed Send all/)
    expect(published()).toBe(1)
  })

  it('does not send a version the owner put off while the group was being sent', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const [v0, v1] = card.versions.map((v) => v.card.opportunity.id) as [string, string]
    await call('opportunities.approve', { id: v0 })
    await call('opportunities.approve', { id: v1 })
    let release: () => void = () => undefined
    world.connector.publishGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sending = flow.sendAll(card.group.id)
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve))
    await call('opportunities.defer', { id: v1 })
    release()
    const out = await sending
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped'])
    expect(published()).toBe(1)
    expect(world.opportunity(v1).state).toBe('deferred')
  })

  it('leaves a version the owner scheduled for later to its time', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const later = new Date(world.clock.now().getTime() + 86_400_000).toISOString()
    await call('publications.schedule', { id: card.versions[1]!.card.opportunity.id, at: later })
    await flow.approve(card.group.id, seenOf(card))
    const out = await flow.sendAll(card.group.id)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped'])
    expect(out.results[1]?.reason).toMatch(/scheduled for/)
    expect(world.opportunity(card.versions[1]!.card.opportunity.id).state).toBe('ready')
  })

  it('goes on after a version fails: it stops nothing else, and says what happened to it', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await flow.approve(card.group.id, seenOf(card))
    world.connector.publishScript.push({ kind: 'fail', error: 'The site refused the post.' })
    const out = await flow.sendAll(card.group.id)
    expect(out.results.map((r) => r.status)).toEqual(['failed', 'done'])
    expect(out.results[0]?.reason).toMatch(/refused/)
    expect(published()).toBe(1)
    expect(out.card.versions[1]?.card.opportunity.state).toBe('confirmed')
    expect(out.card.versions[0]?.card.opportunity.state).not.toBe('confirmed')
  })

  it('keeps the limits of an account: a send the gate holds is named and the others go on', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    // the second channel is on the first one's login: one budget
    world.core.db.prepare('UPDATE channels SET account_id = ? WHERE id = ?').run(channels[0]!.accountId, channels[1]!.id)
    for (const c of channels) world.setSettings(c.id, { limits: { perHour: 1, perDay: 10 } })
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await flow.approve(card.group.id, seenOf(card))
    const out = await flow.sendAll(card.group.id)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped'])
    expect(published()).toBe(1)
  })

  it('refuses a second press while the first is running', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await flow.approve(card.group.id, seenOf(card))
    let release: () => void = () => undefined
    world.connector.publishGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = flow.sendAll(card.group.id)
    await expect(flow.sendAll(card.group.id)).rejects.toMatchObject({ code: 'busy' })
    release()
    await first
    expect(published()).toBe(2)
    // and the group is free again
    expect((await flow.sendAll(card.group.id)).results.every((r) => r.status === 'skipped')).toBe(true)
  })
})

describe('deleting a post for several channels', () => {
  it('deletes the versions that were not sent and keeps the one that was, as an ordinary post', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await flow.approve(card.group.id, seenOf(card))
    await world.sending.send(card.versions[0]!.card.opportunity.id)
    const after = flow.remove(card.group.id)
    expect(after.versions.map((v) => v.card.opportunity.state)).toEqual(['confirmed'])
    expect(world.opportunity(card.versions[1]!.card.opportunity.id).state).toBe('cancelled')
    expect(flow.list(world.product.id)).toHaveLength(1)
    // the same channel may be used again in the group after a version was deleted
    const again = await flow.extend(card.versions[0]!.card.opportunity.id, [channels[1]!.id])
    expect(again.versions).toHaveLength(2)
  })

  it('drops a group with no version left from the list', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    expect(flow.remove(card.group.id).versions).toEqual([])
    expect(flow.list(world.product.id)).toEqual([])
  })
})

describe('what a version says about how it goes out', () => {
  it('goes by the connector unless the owner chose the AI browser, and tells a problem that the platform will refuse', async () => {
    const { channels, flow } = setup()
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    expect(card.versions.map((v) => v.way)).toEqual(['connector', 'connector', 'connector'])
    expect(card.versions[0]?.problems).toEqual([])
    expect(card.versions[2]?.problems.join(' ')).toMatch(/picture/i) // Pinterest needs one
  })

  it('goes by the AI browser when the owner chose it, for what the connector cannot carry, and by the connector for what it can', async () => {
    const { channels, flow } = setup(['reddit', 'x', 'pinterest'])
    world.core.settings.updateApp({ publishWith: 'ai_browser' })
    world.core.services.postMissions = {} as never
    const m = await picture('w')
    const card = await flow.create(world.product.id, channels.map((c) => c.id), { ...MASTER, attachments: [attach(m)] })
    expect(card.versions.map((v) => v.way)).toEqual(['ai_browser', 'ai_browser', 'ai_browser']) // Reddit takes a picture beside words only through the AI browser
    expect(card.versions[2]?.problems).toEqual([])
    // Reddit's one picture by itself is what the connector carries, so it stays there
    const alone = await flow.create(world.product.id, [channels[0]!.id, channels[1]!.id], { title: 'T', text: '', attachments: [attach(m)], markup: 'markdown' })
    expect(alone.versions.map((v) => v.way)).toEqual(['connector', 'ai_browser'])
    const unattended = { aiBrowser: false, unattended: true }
    expect(chooseExecutor(unattended, { attachments: [], markup: 'markdown', title: null, text: 'x', link: null }, 'threads')).toBe('connector')
    expect(chooseExecutor({ aiBrowser: true }, { attachments: [], markup: 'markdown', title: null, text: 'x', link: null }, 'threads')).toBe('ai_browser')
    // A video is never carried by a connector: with the AI browser it goes there, whatever else the post holds.
    const clip = { name: 'clip.mp4', path: '/data/media/clip.mp4', mime: 'video/mp4', sha256: 'c'.repeat(64) }
    expect(chooseExecutor({ aiBrowser: true }, { attachments: [clip], markup: 'markdown', title: 'T', text: '', link: null }, 'reddit')).toBe('ai_browser')
    expect(chooseExecutor({ aiBrowser: true }, { attachments: [clip], markup: 'legacy', title: 'T', text: '', link: null }, 'reddit')).toBe('ai_browser')
    expect(chooseExecutor({ aiBrowser: true }, { attachments: [attach(m) as never], markup: 'legacy', title: 'T', text: '', link: null }, 'reddit')).toBe('connector')
    // a channel no connector can post to goes by the AI browser whatever the draft holds, when it may; when it may not, there is no other way and the connector says so
    const none = { attachments: [attach(m) as never], markup: 'legacy' as const, title: null, text: 'x', link: null }
    expect(chooseExecutor({ aiBrowser: true, noConnector: true }, none, 'instagram')).toBe('ai_browser')
    // A flair is set on the site's own form: no connector sets one, so the browser carries the post, and without the browser the approval says so.
    const flaired = { attachments: [], markup: 'markdown' as const, title: 'T', text: 'x', link: null, flair: 'Discussion' }
    expect(chooseExecutor({ aiBrowser: true }, flaired, 'reddit')).toBe('ai_browser')
    // One picture the connector could carry goes by the connector, and by the browser once the post has a flair.
    expect(chooseExecutor({ aiBrowser: true }, { attachments: [attach(m) as never], markup: 'legacy', title: 'T', text: '', link: null, flair: 'Discussion' } as never, 'reddit')).toBe('ai_browser')
    expect(chooseExecutor({ aiBrowser: false }, flaired, 'reddit')).toBe('connector')
    expect(flairProblem(flaired, { aiBrowser: true })).toBeNull()
    expect(flairProblem({ ...flaired, flair: null }, { aiBrowser: false })).toBeNull()
    expect(flairProblem(flaired, { aiBrowser: false })).toMatch(/flair “Discussion” is set in the account's browser.*Settings/)
    expect(flairProblem(flaired, { aiBrowser: false, unattended: true })).toMatch(/automatic send.*give it a time/)
    expect(chooseExecutor({ aiBrowser: false, noConnector: true, unattended: true }, none, 'instagram')).toBe('connector')
  })

  it('puts Instagram, Facebook and Threads on the AI browser by themselves when the app does not read them: no switch, and a picture fits (DEC-035)', async () => {
    const { channels, flow } = setup(['reddit', 'facebook', 'instagram'])
    expect(world.core.settings.app().publishWith).toBe('connector')
    world.core.services.postMissions = {} as never
    // the two that no connector can post to are not read; Reddit is
    for (const channel of channels.slice(1)) world.core.db.prepare('UPDATE channels SET reads = 0 WHERE id = ?').run(channel.id)
    const m = await picture('x')
    const options = flow.channels(world.product.id, { ...MASTER, attachments: [attach(m)] })
    expect(options.find((o) => o.platform === 'instagram')).toMatchObject({ fits: true })
    expect(options.find((o) => o.platform === 'facebook')).toMatchObject({ fits: true })
    // Reddit takes a picture beside words only through the AI browser, which is still the owner's switch there
    expect(options.find((o) => o.platform === 'reddit')?.fits).toBe(false)
    const card = await flow.create(world.product.id, [channels[1]!.id, channels[2]!.id], { ...MASTER, attachments: [attach(m)] })
    expect(card.versions.map((v) => v.way)).toEqual(['ai_browser', 'ai_browser'])
    expect(card.versions[0]?.problems).toEqual([])
    expect(card.versions[1]?.problems).toEqual([])
  })

  it('names the AI browser as the way of a version for a channel the app does not read, even when the engine cannot carry it now (it cannot work the browser), and says what stops it; one that cannot be held to the tools carries it', async () => {
    const { channels, flow } = setup(['facebook', 'threads'])
    world.core.services.postMissions = {} as never
    for (const channel of channels) world.core.db.prepare('UPDATE channels SET reads = 0 WHERE id = ?').run(channel.id)
    const card = await flow.create(world.product.id, channels.map((c) => c.id), { ...MASTER })
    expect(card.versions[0]).toMatchObject({ way: 'ai_browser', problems: [] })
    ;(world.engine as { confinesAgent: boolean }).confinesAgent = false
    expect(flow.get(card.group.id).versions[0]).toMatchObject({ way: 'ai_browser', problems: [] })
    ;(world.engine as { supportsAgent: boolean }).supportsAgent = false
    const stopped = flow.get(card.group.id).versions[0]!
    expect(stopped.way).toBe('ai_browser')
    expect(stopped.problems.join(' ')).toMatch(/choose Claude Code or Codex in Settings/)
  })

  it('does not let the AI browser carry a send that a scheduled or automatic send would make, for a channel the app does not read', async () => {
    const { channels } = setup(['instagram'])
    world.core.services.postMissions = {} as never
    world.core.db.prepare('UPDATE channels SET reads = 0 WHERE id = ?').run(channels[0]!.id)
    const channel = world.store.requireChannel(channels[0]!.id)
    expect(sendWays(world.core, undefined, channel)).toMatchObject({ aiBrowser: true, noConnector: true })
    expect(sendWays(world.core, { automatic: true, approvedBy: 'user' }, channel)).toMatchObject({ aiBrowser: false, unattended: true, noConnector: true })
  })

  it('knows a hand edit: only a draft of the owner that is not the master', () => {
    const master = { title: 'T', text: 'A', link: null, attachments: [], markup: 'markdown' as const }
    const draft = { ...master, postType: 'article', author: 'user' } as unknown as Draft
    expect(editedByHand(draft, master)).toBe(false)
    expect(editedByHand({ ...draft, text: 'B' } as Draft, master)).toBe(true)
    // The type is part of what the master is (DEC-046): a version turned into a quick post by hand is an edit, and a master of a group made before the type existed is an article.
    expect(editedByHand({ ...draft, postType: 'quick' } as Draft, master)).toBe(true)
    expect(editedByHand({ ...draft, postType: 'quick' } as Draft, { ...master, postType: 'quick' })).toBe(false)
    expect(editedByHand({ ...draft, text: 'B', author: 'ai' } as Draft, master)).toBe(false)
    expect(editedByHand(null, master)).toBe(false)
  })
})

describe('scheduling a group of versions at once (DEC-093)', () => {
  it('sets one planned time on every approved version shown to the owner, sends nothing, and lets them go out at that time', async () => {
    const { channels } = setup(['reddit', 'x'])
    const card = (await call('postGroups.create', { productId: world.product.id, channelIds: channels.map((c) => c.id), draft: MASTER })) as PostGroupCard
    await call('postGroups.approve', { id: card.group.id, seen: seenOf(card) })
    const at = new Date(world.clock.now().getTime() + 2 * 3_600_000).toISOString()

    const out = (await call('postGroups.schedule', { id: card.group.id, at, seen: seenOf(card) })) as { card: PostGroupCard; results: { status: string; reason: string; scheduledAt?: string }[] }
    expect(out.results.map((r) => r.status)).toEqual(['done', 'done'])
    expect(out.results.every((r) => r.scheduledAt === at && r.reason.includes(at))).toBe(true)
    expect(out.card.versions.map((v) => v.card.opportunity.scheduledAt)).toEqual([at, at])
    expect(published()).toBe(0)

    // Send all keeps its snapshot rule and skips future-scheduled versions.
    const sentNow = (await call('postGroups.sendAll', { id: card.group.id })) as { results: { status: string; reason: string }[] }
    expect(sentNow.results.map((r) => r.status)).toEqual(['skipped', 'skipped'])
    expect(sentNow.results.every((r) => /scheduled for/.test(r.reason))).toBe(true)
    expect(published()).toBe(0)

    // When the time comes, both go out automatically.
    world.clock.advance(2 * 3_600_000 + 60_000)
    expect(await world.sending.sendDuePublications()).toBe(2)
    expect(published()).toBe(2)
  })

  it('gives a time only to an approved version matching what the owner saw, and names every other with its reason', async () => {
    const { channels, flow } = setup(['reddit', 'x', 'linkedin', 'telegram'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const [v0, _v1, v2, v3] = card.versions.map((v) => v.card.opportunity.id) as [string, string, string, string]
    // v0: approved and unchanged; v1: not approved; v2: edited and re-approved after seen; v3: approved then already sent
    await call('opportunities.approve', { id: v0 })
    await call('opportunities.approve', { id: v2 })
    await call('opportunities.approve', { id: v3 })
    await world.sending.send(v3)
    const seen = seenOf(flow.get(card.group.id))
    await call('opportunities.saveDraft', { id: v2, draft: { title: 'Changed', text: 'Changed after you looked.', markup: 'markdown' } })
    await call('opportunities.approve', { id: v2 })

    const at = new Date(world.clock.now().getTime() + 3_600_000).toISOString()
    const out = flow.scheduleAll(card.group.id, at, seen)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped', 'skipped', 'skipped'])
    expect(out.results[1]?.reason).toMatch(/not approved yet/)
    expect(out.results[2]?.reason).toMatch(/changed after you looked/)
    expect(out.results[3]?.reason).toMatch(/sent already/)
    expect(out.card.versions.map((v) => v.card.opportunity.scheduledAt)).toEqual([at, null, null, null])

    // Unseen version and stale approval are skipped too.
    const unseen = flow.scheduleAll(card.group.id, at, {})
    expect(unseen.results[0]).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/not shown to you/) })
    world.core.db.prepare('UPDATE accounts SET identity = ? WHERE id = ?').run('someone_else', channels[0]!.accountId)
    const stale = flow.scheduleAll(card.group.id, at, seenOf(flow.get(card.group.id)))
    expect(stale.results[0]).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/approval no longer applies/) })
  })

  it('refuses an invalid date or malformed seen without changing any version', async () => {
    const { channels, flow } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await flow.approve(card.group.id, seenOf(card))
    expect(() => flow.scheduleAll(card.group.id, 'not-a-date', seenOf(card))).toThrow(/not a valid date/)
    expect(() => flow.scheduleAll(card.group.id, '2026-12-05T10:00:00.000Z', null as never)).toThrow(/which text of each version/)
    expect(() => flow.enqueueAll(card.group.id, [] as never)).toThrow(/which text of each version/)
    expect(flow.get(card.group.id).versions.every((v) => v.card.opportunity.scheduledAt === null)).toBe(true)
  })

  it('spreads approved versions onto the next free posting time of each channel, skips channels without posting times with their reason, and respects taken slots', async () => {
    const { channels } = setup(['reddit', 'x', 'linkedin'])
    // Channel 0: Mon 10:00 UTC; Channel 1: no posting times; Channel 2: Tue 14:00 UTC (with the first Tue slot already taken by another post).
    const mon = { weekday: 1, hour: 10, minute: 0 }
    const tue = { weekday: 2, hour: 14, minute: 0 }
    world.setSettings(channels[0]!.id, { postingSlots: [mon] })
    world.setSettings(channels[1]!.id, { postingSlots: [] })
    world.setSettings(channels[2]!.id, { postingSlots: [tue] })
    // Take channel 2's very next slot with another post so the group version must land on the week after.
    const blocker = (await call('publications.create', { channelId: channels[2]!.id, draft: { title: 'Earlier', text: 'Earlier post' } })) as { opportunity: { id: string } }
    const firstTue = ((await call('publications.enqueue', { id: blocker.opportunity.id })) as { opportunity: { scheduledAt: string } }).opportunity.scheduledAt

    const card = (await call('postGroups.create', { productId: world.product.id, channelIds: channels.map((c) => c.id), draft: MASTER })) as PostGroupCard
    await call('postGroups.approve', { id: card.group.id, seen: seenOf(card) })
    const out = (await call('postGroups.enqueue', { id: card.group.id, seen: seenOf(card) })) as { card: PostGroupCard; results: { channelLabel: string; status: string; reason: string; scheduledAt?: string }[] }

    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped', 'done'])
    expect(out.results[1]?.channelLabel).toContain('target-1')
    expect(out.results[1]?.reason).toMatch(/has no posting times yet/)
    expect(out.card.versions[1]?.card.opportunity.scheduledAt).toBeNull()
    expect(out.card.versions[0]?.card.opportunity.scheduledAt).not.toBeNull()
    expect(out.card.versions[2]?.card.opportunity.scheduledAt).not.toBeNull()
    expect(out.card.versions[2]?.card.opportunity.scheduledAt).not.toBe(firstTue)
    expect(Date.parse(out.card.versions[2]!.card.opportunity.scheduledAt!)).toBeGreaterThan(Date.parse(firstTue))
    expect(out.card.versions[0]?.card.opportunity.scheduledAt).not.toBe(out.card.versions[2]?.card.opportunity.scheduledAt)
    expect(published()).toBe(0)

    // Send all leaves the two scheduled versions alone and still sends the one unscheduled approved version (channel 1).
    const sent = (await call('postGroups.sendAll', { id: card.group.id })) as { results: { status: string; reason: string }[] }
    expect(sent.results.map((r) => r.status)).toEqual(['skipped', 'done', 'skipped'])
    expect(published()).toBe(1)
  })

  it('refuses to schedule a group while another group step is running', async () => {
    const { channels, flow, helper } = setup(['reddit', 'x'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    helper.during = async () => {
      expect(() => flow.scheduleAll(card.group.id, '2026-12-05T10:00:00.000Z', seenOf(card))).toThrow(/being worked on right now/)
      expect(() => flow.enqueueAll(card.group.id, seenOf(card))).toThrow(/being worked on right now/)
    }
    await flow.adapt(card.group.id, undefined, false)
  })
})
