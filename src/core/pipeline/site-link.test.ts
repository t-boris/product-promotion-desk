// DEC-044: the product's site ends a NEW post of the owner's where a link goes in the text or points to the profile (Facebook, Threads, X, LinkedIn,
// Telegram, and Instagram, whose caption then ends with "Link in bio"). It is written into the first draft only, so what is approved is what is
// sent, and a link the owner takes out stays out. A platform with a link field of its own (Reddit), a reply and a product that keeps the switch off
// get nothing.

import { afterEach, describe, expect, it } from 'vitest'
import { renderForPlatform } from '../../shared/post-format'
import type { Channel, Draft } from '../../shared/types'
import type { DraftHelp } from './draft-help'
import { PostGroupsFlow } from './post-groups'
import { PublicationsFlow } from './publications'
import type { ReviewFlow } from './review'
import type { SendingFlow } from './sending'
import { closeWorld, makeWorld, type World } from './test-fixture'

const SITE = 'https://natalmystic.com'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const call = (method: string, args: unknown) => (world.core.router.call as (m: string, a: unknown) => Promise<never>)(method, args)
const latest = (oppId: string): Draft => world.core.repos.latestDraft(oppId) as Draft

/** The world's own channel on `platform`, and the product's switch as given (the fixture keeps it off). */
function on(platform: string, switchOn = true): void {
  world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platform, world.channel.id)
  world.core.db.prepare('UPDATE products SET add_site_link = ? WHERE id = ?').run(switchOn ? 1 : 0, world.product.id)
}

async function write(draft: Record<string, unknown> = {}): Promise<string> {
  const made = (await call('publications.create', { channelId: world.channel.id, draft: { text: 'A short post about transits.', markup: 'legacy', ...draft } })) as { opportunity: { id: string } }
  return made.opportunity.id
}

describe('the site at the end of a new post', () => {
  it.each(['facebook', 'threads', 'x', 'linkedin', 'telegram'])('%s: the first draft holds the site, and the post ends with it', async (platform) => {
    world = makeWorld()
    on(platform)
    const draft = latest(await write())
    expect(draft.link).toBe(SITE)
    expect(renderForPlatform(draft, platform).text).toBe(`A short post about transits.\n\n${SITE}`)
  })

  it('instagram: the draft holds the site, and the caption sent ends with "Link in bio", never with the address', async () => {
    world = makeWorld()
    on('instagram')
    const draft = latest(await write())
    expect(draft.link).toBe(SITE)
    const rendered = renderForPlatform(draft, 'instagram')
    expect(rendered.text).toBe('A short post about transits.\n\nLink in bio')
    expect(rendered.text).not.toContain('natalmystic')
    expect(rendered.link).toBeNull()
  })

  it('a quick post of the composer gets it too, and keeps it when the owner saves the post again', async () => {
    world = makeWorld()
    on('threads')
    const item = (await call('media.add', { productId: world.product.id, name: 'q.png', base64: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16), Buffer.from('q')]).toString('base64'), origin: 'card' })) as { id: string; name: string; path: string }
    const attachments = [{ name: item.name, path: item.path, mime: '', sha256: '', mediaId: item.id }]
    const id = await write({ postType: 'quick', text: 'Launch day', attachments })
    expect(latest(id).link).toBe(SITE)
    await call('opportunities.saveDraft', { id, draft: { text: 'Launch day, again', markup: 'legacy', link: latest(id).link, postType: 'quick', attachments } })
    expect(latest(id)).toMatchObject({ text: 'Launch day, again', link: SITE })
  })

  it('leaves a link the owner wrote', async () => {
    world = makeWorld()
    on('facebook')
    expect(latest(await write({ link: 'https://example.org/launch' })).link).toBe('https://example.org/launch')
  })

  it('does nothing while the product keeps the switch off, and with no site to put', async () => {
    world = makeWorld()
    on('facebook', false)
    expect(latest(await write()).link).toBeNull()
    on('facebook', true)
    world.core.db.prepare('UPDATE products SET website_url = NULL WHERE id = ?').run(world.product.id)
    expect(latest(await write()).link).toBeNull()
  })

  it('never puts it into a platform\'s link field: a Reddit post stays the kind of post it was written as', async () => {
    world = makeWorld()
    on('reddit')
    expect(latest(await write({ title: 'A title', markup: 'markdown' })).link).toBeNull()
  })

  it('writes it into the first draft only: the owner takes it out and it stays out', async () => {
    world = makeWorld()
    on('facebook')
    const id = await write()
    expect(latest(id).link).toBe(SITE)
    await call('opportunities.saveDraft', { id, draft: { text: 'A short post about transits.', markup: 'legacy', link: null } })
    expect(latest(id).link).toBeNull()
  })

  it('never ends a reply with it', async () => {
    world = makeWorld()
    on('facebook')
    const opp = await world.readyReply()
    expect(latest(opp.id).link).toBeNull()
  })

  it('is on for a product that is created, and the switch is one call', async () => {
    world = makeWorld()
    expect(world.core.repos.product(world.product.id).addSiteLink).toBe(false) // the fixture's own product is pinned off
    const created = (await call('products.create', { name: 'Another', websiteUrl: 'https://another.example/' })) as { id: string; addSiteLink: boolean }
    expect(created.addSiteLink).toBe(true)
    const off = (await call('products.update', { id: created.id, addSiteLink: false })) as { addSiteLink: boolean; websiteUrl: string | null; name: string }
    expect(off).toMatchObject({ addSiteLink: false, websiteUrl: 'https://another.example/', name: 'Another' })
    expect(((await call('products.update', { id: created.id, addSiteLink: true })) as { addSiteLink: boolean }).addSiteLink).toBe(true)
    await expect(call('products.update', { id: created.id, addSiteLink: 'yes' })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('a post for several channels', () => {
  function group(platforms: string[]) {
    world = makeWorld()
    world.core.db.prepare('UPDATE products SET add_site_link = 1 WHERE id = ?').run(world.product.id)
    const channels: Channel[] = [world.channel]
    for (let i = 1; i < platforms.length; i += 1) {
      const account = world.addAccount({ label: `Login ${i}`, identity: `login_${i}` })
      channels.push(world.addChannel({ accountId: account.id, target: `target-${i}` }))
    }
    channels.forEach((c, i) => world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platforms[i], c.id))
    const help = { refine: async (args: { form: { text: string } }) => ({ text: `${args.form.text} (adapted)` }) } as unknown as DraftHelp
    const flow = new PostGroupsFlow(world.core, world.store, world.core.services.pipeline as unknown as ReviewFlow, world.core.services.sending as unknown as SendingFlow, help, new PublicationsFlow(world.core, world.store), { sleep: async () => undefined })
    return { channels, flow }
  }
  const MASTER = { title: null, text: 'A short post about transits.', markup: 'legacy' as const }

  it('gives each version the site where its platform takes it, and a Reddit version none; none of them counts as changed by hand', async () => {
    const { channels, flow } = group(['reddit', 'x', 'linkedin'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), { ...MASTER })
    const byPlatform = Object.fromEntries(card.versions.map((v) => [world.store.requireChannel(v.card.opportunity.channelId).platform, v]))
    expect((byPlatform.reddit!.card.draft as Draft).link).toBeNull()
    expect((byPlatform.x!.card.draft as Draft).link).toBe(SITE)
    expect((byPlatform.linkedin!.card.draft as Draft).link).toBe(SITE)
    expect(card.versions.map((v) => v.edited)).toEqual([false, false, false])

    const quickGroup = group(['threads', 'instagram'])
    const qCard = await quickGroup.flow.create(world.product.id, quickGroup.channels.map((c) => c.id), { ...MASTER })
    const qBy = Object.fromEntries(qCard.versions.map((v) => [world.store.requireChannel(v.card.opportunity.channelId).platform, v]))
    expect((qBy.threads!.card.draft as Draft).link).toBe(SITE)
    expect((qBy.instagram!.card.draft as Draft).link).toBe(SITE)
    expect(qCard.versions.map((v) => v.edited)).toEqual([false, false])
  })

  it('keeps the site when the AI adapts a version, and says nothing was changed by hand', async () => {
    const { channels, flow } = group(['threads', 'facebook'])
    const card = await flow.create(world.product.id, channels.map((c) => c.id), { ...MASTER })
    const out = await flow.adapt(card.group.id, undefined, false)
    expect(out.results.map((r) => r.status)).toEqual(['done', 'done'])
    for (const v of out.card.versions) {
      expect(latest(v.card.opportunity.id)).toMatchObject({ text: 'A short post about transits. (adapted)', link: SITE })
      expect(v.edited).toBe(false)
    }
  })
})
