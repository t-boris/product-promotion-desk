// DEC-046: a quick post is an ordinary draft with an explicit post type and its card parameters; the caption is the text, the title is empty,
// and editing a draft never changes its type. Nothing here changes the approval flow.

import { afterEach, describe, expect, it } from 'vitest'
import type { Channel, Draft, MediaItem, PostGroupCard } from '../../shared/types'
import type { QuickCard } from '../../shared/quick-post'
import { PostGroupsFlow } from './post-groups'
import { PublicationsFlow } from './publications'
import type { DraftHelp } from './draft-help'
import type { ReviewFlow } from './review'
import type { SendingFlow } from './sending'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const call = (method: string, args: unknown) => (world.core.router.call as (m: string, a: unknown) => Promise<never>)(method, args)
const refusal = async (method: string, args: unknown): Promise<{ code: string; message: string } | null> => {
  try {
    await call(method, args)
  } catch (error) {
    return error as { code: string; message: string }
  }
  return null
}
async function picture(tag = 'a'): Promise<MediaItem> {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
  return (await call('media.add', { productId: world.product.id, name: `${tag}.png`, base64: Buffer.concat([header, Buffer.from(tag)]).toString('base64'), origin: 'card' })) as MediaItem
}
const attach = (m: MediaItem) => ({ name: m.name, path: m.path, mime: '', sha256: '', mediaId: m.id })
const CARD: QuickCard = { style: 'bold', colour: 'sunset', shape: 'portrait', headline: 'Launch day', headlineEdited: false }
const latest = (oppId: string): Draft => world.core.repos.latestDraft(oppId) as Draft
const quick = async (draft: Record<string, unknown> = {}) => {
  const item = await picture('q')
  return ((await call('publications.create', { channelId: world.channel.id, draft: { postType: 'quick', text: 'Launch day\nWe are live.', attachments: [attach(item)], card: CARD, ...draft } })) as { opportunity: { id: string } }).opportunity
}

describe('a quick post is saved with its type, its caption and its card', () => {
  it('stores the caption as the text, no title, plain markup, the card and the one picture', async () => {
    world = makeWorld()
    const opp = await quick()
    const draft = latest(opp.id)
    expect(draft).toMatchObject({ postType: 'quick', title: null, text: 'Launch day\nWe are live.', markup: 'legacy', card: CARD })
    expect(draft.attachments).toHaveLength(1)
  })

  it('does not need a title, and an empty caption with a picture is a post', async () => {
    world = makeWorld()
    const opp = await quick({ text: '', card: null })
    expect(latest(opp.id)).toMatchObject({ postType: 'quick', title: null, text: '', card: null })
  })

  it('keeps `legacy` even if the caller asks for Markdown: the caption is sent as it is written', async () => {
    world = makeWorld()
    const opp = await quick({ markup: 'markdown', text: '#launch **now**' })
    expect(latest(opp.id).markup).toBe('legacy')
    expect(latest(opp.id).text).toBe('#launch **now**')
  })

  it('refuses a title, no picture, two pictures, a bad card and a card on an article', async () => {
    world = makeWorld()
    const a = await picture('a')
    const b = await picture('b')
    expect((await refusal('publications.create', { channelId: world.channel.id, draft: { postType: 'quick', title: 'No', text: 'x', attachments: [attach(a)] } }))?.message).toMatch(/no title/)
    expect((await refusal('publications.create', { channelId: world.channel.id, draft: { postType: 'quick', text: 'x', attachments: [] } }))?.message).toMatch(/exactly one picture/)
    expect((await refusal('publications.create', { channelId: world.channel.id, draft: { postType: 'quick', text: 'x', attachments: [attach(a), attach(b)] } }))?.message).toMatch(/exactly one picture/)
    expect((await refusal('publications.create', { channelId: world.channel.id, draft: { postType: 'quick', text: 'x', attachments: [attach(a)], card: { ...CARD, style: 'neon' } } }))?.message).toMatch(/card parameters/)
    // A video is not a quick post's picture: it is said in words, and an article may carry it.
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const clip = join(mkdtempSync(join(tmpdir(), 'ppd-quick-video-')), 'clip.mp4')
    writeFileSync(clip, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(40)]))
    const video = (await call('media.addPath', { productId: world.product.id, path: clip, origin: 'dropped' })) as MediaItem
    expect((await refusal('publications.create', { channelId: world.channel.id, draft: { postType: 'quick', text: 'x', attachments: [attach(video)] } }))?.message).toMatch(/a video cannot be one/)
    expect((await refusal('publications.create', { channelId: world.channel.id, draft: { title: 'T', text: 'x', card: CARD } }))?.message).toMatch(/belong to a quick post/)
    expect((await refusal('publications.create', { channelId: world.channel.id, draft: { postType: 'story', text: 'x' } }))?.message).toMatch(/"article" or "quick"/)
  })

  it('makes a draft that is not said to be quick an article, whatever its title', async () => {
    world = makeWorld()
    const noTitle = ((await call('publications.create', { channelId: world.channel.id, draft: { text: 'no title, still an article' } })) as { opportunity: { id: string } }).opportunity
    expect(latest(noTitle.id)).toMatchObject({ postType: 'article', title: null, card: null })
    const titled = ((await call('publications.create', { channelId: world.channel.id, draft: { title: 'T', text: 'x', markup: 'markdown' } })) as { opportunity: { id: string } }).opportunity
    expect(latest(titled.id)).toMatchObject({ postType: 'article', card: null })
  })
})

describe('editing a saved draft never changes its type (DEC-046)', () => {
  it('keeps the type and the card when the edit does not say them', async () => {
    world = makeWorld()
    const opp = await quick()
    await call('opportunities.saveDraft', { id: opp.id, draft: { text: 'Edited caption', attachments: latest(opp.id).attachments } })
    expect(latest(opp.id)).toMatchObject({ postType: 'quick', text: 'Edited caption', card: CARD, title: null, markup: 'legacy' })
  })

  it('takes a new card when the edit gives one, and drops the card when the edit says the picture is not a card', async () => {
    world = makeWorld()
    const opp = await quick()
    const next: QuickCard = { ...CARD, colour: 'ocean', headline: 'Edited', headlineEdited: true }
    await call('opportunities.saveDraft', { id: opp.id, draft: { postType: 'quick', text: 'c', attachments: latest(opp.id).attachments, card: next } })
    expect(latest(opp.id).card).toEqual(next)
    await call('opportunities.saveDraft', { id: opp.id, draft: { text: 'c', attachments: latest(opp.id).attachments, card: null } })
    expect(latest(opp.id)).toMatchObject({ postType: 'quick', card: null })
  })

  it('holds a saved quick post to its rules: a second picture or a title is refused', async () => {
    world = makeWorld()
    const opp = await quick()
    const extra = await picture('extra')
    const twice = await refusal('opportunities.saveDraft', { id: opp.id, draft: { text: 'c', attachments: [...latest(opp.id).attachments, attach(extra)] } })
    expect(twice?.message).toMatch(/exactly one picture/)
    const titled = await refusal('opportunities.saveDraft', { id: opp.id, draft: { title: 'T', text: 'c', attachments: latest(opp.id).attachments } })
    expect(titled?.message).toMatch(/no title/)
    expect(latest(opp.id)).toMatchObject({ postType: 'quick', title: null })
  })

  it('keeps an article an article', async () => {
    world = makeWorld()
    const article = ((await call('publications.create', { channelId: world.channel.id, draft: { title: 'T', text: 'x', markup: 'markdown' } })) as { opportunity: { id: string } }).opportunity
    await call('opportunities.saveDraft', { id: article.id, draft: { title: 'T2', text: 'y', markup: 'markdown' } })
    expect(latest(article.id)).toMatchObject({ postType: 'article', card: null, title: 'T2' })
  })

  it('can be told to change the type explicitly', async () => {
    world = makeWorld()
    const opp = await quick()
    await call('opportunities.saveDraft', { id: opp.id, draft: { postType: 'article', title: 'Now an article', text: 'x', attachments: latest(opp.id).attachments } })
    expect(latest(opp.id)).toMatchObject({ postType: 'article', card: null, title: 'Now an article' })
  })
})

describe('a quick post for several channels is a group of quick posts with the same picture', () => {
  function groupFlow() {
    const channels: Channel[] = [world.channel]
    for (const [i, platform] of ['threads', 'facebook'].entries()) {
      const account = world.addAccount({ label: `Login ${i}`, identity: `login_${i}` })
      channels.push(world.addChannel({ accountId: account.id, target: `target-${i}` }))
      world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platform, channels[i + 1].id)
    }
    world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run('instagram', world.channel.id)
    const help = { refine: async (args: { form: { text: string } }) => ({ text: `${args.form.text} (adapted)` }) } as unknown as DraftHelp
    const flow = new PostGroupsFlow(world.core, world.store, world.core.services.pipeline as unknown as ReviewFlow, world.core.services.sending as unknown as SendingFlow, help, new PublicationsFlow(world.core, world.store), { sleep: async () => {} })
    return { channels, flow }
  }

  it('gives every version the type, the caption, the card and the picture of the master', async () => {
    world = makeWorld()
    const { channels, flow } = groupFlow()
    const item = await picture('g')
    const card: PostGroupCard = await flow.create(world.product.id, channels.map((c) => c.id), { postType: 'quick', text: 'Group caption', attachments: [attach(item)], card: CARD })
    expect(card.group.master).toMatchObject({ postType: 'quick', card: CARD, title: null })
    expect(card.versions).toHaveLength(3)
    for (const v of card.versions) {
      const draft = v.card.draft as Draft
      expect(draft).toMatchObject({ postType: 'quick', title: null, text: 'Group caption', card: CARD, markup: 'legacy' })
      expect(draft.attachments.map((a) => a.mediaId)).toEqual([item.id])
      expect(v.edited).toBe(false)
    }
  })

  it('keeps the type when the AI adapts a version, and says a hand edit is an edit', async () => {
    world = makeWorld()
    const { channels, flow } = groupFlow()
    const item = await picture('h')
    const made = await flow.create(world.product.id, channels.map((c) => c.id), { postType: 'quick', text: 'Group caption', attachments: [attach(item)], card: CARD })
    const outcome = await flow.adapt(made.group.id, undefined, false)
    expect(outcome.results.every((r) => r.status === 'done')).toBe(true)
    for (const v of outcome.card.versions) expect(v.card.draft).toMatchObject({ postType: 'quick', text: 'Group caption (adapted)', card: CARD, title: null })
    const one = made.versions[0].card.opportunity.id
    await call('opportunities.saveDraft', { id: one, draft: { text: 'by hand', attachments: latest(one).attachments } })
    expect(latest(one)).toMatchObject({ postType: 'quick', text: 'by hand' })
    expect((await flow.get(made.group.id)).versions.find((v) => v.card.opportunity.id === one)?.edited).toBe(true)
  })

  it('"Also post to…" on a quick post makes the new versions quick posts', async () => {
    world = makeWorld()
    const { channels, flow } = groupFlow()
    world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run('instagram', channels[0].id)
    const opp = await quick()
    const extended = await flow.extend(opp.id, [channels[1].id])
    expect(extended.group.master).toMatchObject({ postType: 'quick', card: CARD })
    for (const v of extended.versions) expect(v.card.draft).toMatchObject({ postType: 'quick', title: null, card: CARD })
  })
})
