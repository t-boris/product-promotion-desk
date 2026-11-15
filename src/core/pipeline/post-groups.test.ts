// DEC-032: one post for several channels. A group is a wrapper; every version is an ordinary post of one channel.

import { afterEach, describe, expect, it } from 'vitest'
import type { Channel, Draft, MediaItem, PostGroupCard } from '../../shared/types'
import { adaptInstruction, editedByHand, PostGroupsFlow } from './post-groups'
import type { DraftHelp } from './draft-help'
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
}

/** A world with a Reddit channel (the world's own), then one channel per further platform, each on a login of its own. */
function setup(platforms: string[] = ['reddit', 'threads', 'instagram']) {
  world = makeWorld()
  const channels: Channel[] = [world.channel]
  for (let i = 1; i < platforms.length; i += 1) {
    const account = world.addAccount({ label: `Login ${i}`, identity: `login_${i}` })
    channels.push(world.addChannel({ accountId: account.id, target: `target-${i}` }))
  }
  channels.forEach((c, i) => world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platforms[i], c.id))
  const helper: Helper = { asked: [], fail: new Set() }
  const help = {
    refine: async (args: { opportunityId?: string; instruction?: string; form: { text: string } }) => {
      helper.asked.push({ opportunityId: args.opportunityId, instruction: args.instruction, text: args.form.text })
      if (args.opportunityId && helper.fail.has(args.opportunityId)) throw new Error('The AI is not available.')
      return { text: `${args.form.text} (adapted)` }
    }
  } as unknown as DraftHelp
  const sleeps: number[] = []
  const flow = new PostGroupsFlow(world.core, world.store, world.core.services.pipeline as unknown as ReviewFlow, world.core.services.sending as unknown as SendingFlow, help, {
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
    const { channels, flow } = setup(['reddit', 'threads'])
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
    const { channels, flow } = setup(['reddit', 'threads'])
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

  it('adds to a group that exists, once per channel, and refuses a reply or a deleted post', async () => {
    const { channels, flow } = setup(['reddit', 'threads', 'instagram'])
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
    const { channels, flow } = setup()
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

  it('knows a picture makes Instagram fit, and leaves out a channel that cannot post at all; a paused one is shown with the reason', async () => {
    const { channels, flow } = setup()
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
    expect(helper.asked.map((a) => a.instruction)).toEqual(channels.map((_, i) => adaptInstruction(['reddit', 'threads', 'instagram'][i]!)))
    expect(helper.asked.every((a) => a.text === MASTER.text)).toBe(true)
  })

  it('leaves a version the owner changed by hand, unless asked to start over', async () => {
    const { channels, flow } = setup()
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    const mine = card.versions[1]!.card.opportunity.id
    await call('opportunities.saveDraft', { id: mine, draft: { text: 'My own words for Threads.', markup: 'markdown' } })
    expect(flow.get(card.group.id).versions[1]?.edited).toBe(true)
    const out = await flow.adapt(card.group.id, undefined, false)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'skipped', 'done'])
    expect(out.results[1]?.reason).toMatch(/changed it by hand/)
    expect(out.card.versions[1]?.card.draft?.text).toBe('My own words for Threads.')
    const again = await flow.adapt(card.group.id, [mine], true)
    expect(again.results.map((r) => r.status)).toEqual(['done'])
    expect(again.card.versions[1]?.card.draft?.text).toBe(`${MASTER.text} (adapted)`)
    expect(again.card.versions[1]?.edited).toBe(false)
  })

  it('does not rewrite a version that was sent already', async () => {
    const { channels, flow, helper } = setup(['reddit', 'threads'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER)
    await flow.approve(card.group.id, seenOf(card))
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
    await call('opportunities.approve', { id: card.versions[0]!.card.opportunity.id })
    const out = await flow.adapt(card.group.id, undefined, false)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'failed', 'done'])
    expect(out.results[1]?.reason).toMatch(/not available/)
    expect(out.card.versions[0]?.card.approval).toBeNull()
    expect(out.card.versions[0]?.card.opportunity.state).toBe('draft')
    expect(out.card.versions[1]?.card.draft?.text).toBe(MASTER.text)
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
  })
})

describe('one approval for the group, after reading every version', () => {
  it('approves each version by its own approval, bound to its own account and destination, and sends nothing', async () => {
    const { channels, flow } = setup(['reddit', 'threads'])
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
    const card = await flow.create(world.product.id, channels.map((c) => c.id), MASTER) // Instagram needs a picture
    const out = await flow.approve(card.group.id, seenOf(card))
    expect(out.results.map((r) => r.status)).toEqual(['done', 'done', 'skipped'])
    expect(out.results[2]?.reason).toMatch(/picture/i)
    expect(out.card.versions[2]?.card.approval).toBeNull()
    expect(out.card.versions.slice(0, 2).every((v) => v.card.approval !== null)).toBe(true)
  })

  it('approves only the draft the owner was shown: a version that changed since is left for them to read again', async () => {
    const { channels, flow } = setup(['reddit', 'threads'])
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

  it('does not touch a version that was sent already, and editing one version cancels only its own approval', async () => {
    const { channels, flow } = setup(['reddit', 'threads'])
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
    await flow.approve(card.group.id, seenOf(card)) // Instagram is left out
    const out = await flow.sendAll(card.group.id)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'done', 'skipped'])
    expect(out.results[2]?.reason).toMatch(/not approved/)
    expect(published()).toBe(2)
    expect(sleeps).toEqual([5000]) // between the two sends, not before the first and not for the one that waits
    expect(out.card.versions.map((v) => v.card.opportunity.state)).toEqual(['confirmed', 'confirmed', 'draft'])
    expect(new Set(out.card.versions.slice(0, 2).map((v) => v.card.lastAction?.id)).size).toBe(2)
  })

  it('goes on after a version fails: it stops nothing else, and says what happened to it', async () => {
    const { channels, flow } = setup(['reddit', 'threads'])
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
    const { channels, flow } = setup(['reddit', 'threads'])
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
    const { channels, flow } = setup(['reddit', 'threads'])
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
    const { channels, flow } = setup(['reddit', 'threads'])
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
    const { channels, flow } = setup(['reddit', 'threads'])
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
    expect(card.versions[2]?.problems.join(' ')).toMatch(/picture/i) // Instagram needs one
  })

  it('knows a hand edit: only a draft of the owner that is not the master', () => {
    const master = { title: 'T', text: 'A', link: null, attachments: [], markup: 'markdown' as const }
    const draft = { ...master, author: 'user' } as unknown as Draft
    expect(editedByHand(draft, master)).toBe(false)
    expect(editedByHand({ ...draft, text: 'B' } as Draft, master)).toBe(true)
    expect(editedByHand({ ...draft, text: 'B', author: 'ai' } as Draft, master)).toBe(false)
    expect(editedByHand(null, master)).toBe(false)
  })
})
