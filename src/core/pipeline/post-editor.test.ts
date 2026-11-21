// DEC-030: a post written in the post editor is sent in the form its platform shows, and approved only when the platform can show it.

import { afterEach, describe, expect, it } from 'vitest'
import type { MediaItem } from '../../shared/types'
import { closeWorld, makeWorld, type World } from './test-fixture'

let world: World
afterEach(async () => {
  await closeWorld(world)
})

const call = (method: string, args: unknown) => (world.core.router.call as (m: string, a: unknown) => Promise<never>)(method, args)
const setPlatform = (platform: string): void => {
  world.core.db.prepare('UPDATE channels SET platform = ? WHERE id = ?').run(platform, world.channel.id)
}
async function picture(tag = 'a'): Promise<MediaItem> {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
  return (await call('media.add', { productId: world.product.id, name: `${tag}.png`, base64: Buffer.concat([header, Buffer.from(tag)]).toString('base64'), origin: 'pasted' })) as MediaItem
}
const attach = (m: MediaItem) => ({ name: m.name, path: m.path, mime: '', sha256: '', mediaId: m.id })
const create = async (draft: Record<string, unknown>) => ((await call('publications.create', { channelId: world.channel.id, draft: { markup: 'markdown', ...draft } })) as { opportunity: { id: string } }).opportunity
const refusal = async (method: string, args: unknown): Promise<{ code: string; message: string } | null> => {
  try {
    await call(method, args)
  } catch (error) {
    return error as { code: string; message: string }
  }
  return null
}
const approve = (id: string) => refusal('opportunities.approve', { id })

describe('approval of a post written in the post editor', () => {
  it('is given when the platform can show the post: Reddit gets Markdown and a title', async () => {
    world = makeWorld()
    setPlatform('reddit')
    const opp = await create({ title: 'My notes', text: '## Notes\n\nWith **weight**.' })
    expect(await approve(opp.id)).toBeNull()
  })

  it('is refused, in words, when the platform has no room for what the post holds', async () => {
    world = makeWorld()
    setPlatform('instagram')
    const noPicture = await create({ text: 'a caption' })
    expect((await approve(noPicture.id))?.code).toBe('post_does_not_fit')
    expect((await approve(noPicture.id))?.message).toMatch(/Instagram needs a picture/)
    setPlatform('threads')
    const long = await create({ text: 'x'.repeat(501) })
    expect((await approve(long.id))?.message).toMatch(/allows 500/)
  })

  it('is refused for a picture that this application cannot send yet, with the way out in the words', async () => {
    world = makeWorld()
    const item = await picture()
    setPlatform('facebook')
    const facebook = await create({ text: 'with a picture', attachments: [attach(item)] })
    expect((await approve(facebook.id))?.message).toMatch(/Pictures go to Facebook only through the AI browser.*Copy post/)
    setPlatform('reddit')
    const textAndPicture = await create({ title: 'T', text: 'words', attachments: [attach(item)] })
    expect((await approve(textAndPicture.id))?.message).toMatch(/only as a post by itself, without text or a link/)
    const pictureAlone = await create({ title: 'T', text: '', attachments: [attach(item)] })
    expect(await approve(pictureAlone.id)).toBeNull()
  })

  it('does not judge a draft that is not markdown: its connector checks it when it sends', async () => {
    world = makeWorld()
    setPlatform('instagram')
    const legacy = ((await call('publications.create', { channelId: world.channel.id, draft: { text: 'no picture, as it always was' } })) as { opportunity: { id: string } }).opportunity
    expect(await approve(legacy.id)).toBeNull()
  })
})

describe('what is sent for a post written in the post editor', () => {
  it('is the Markdown on Reddit and the words on any other platform, exactly what the preview shows', async () => {
    world = makeWorld()
    const text = '## Big news\n\nWe **shipped** [it](https://example.org/new), join us:\n\n- fast\n- free'
    setPlatform('reddit')
    const reddit = await create({ title: 'Shipped', text })
    await call('opportunities.approve', { id: reddit.id })
    await world.sending.send(reddit.id)
    expect(world.connector.published.at(-1)?.request).toMatchObject({ title: 'Shipped', text })
    setPlatform('some-forum')
    const forum = await create({ title: 'Shipped', text: 'We **shipped** [it](https://example.org/new)\n\n- fast\n- free' })
    await call('opportunities.approve', { id: forum.id })
    await world.sending.send(forum.id)
    expect(world.connector.published.at(-1)?.request.text).toBe('We shipped it (https://example.org/new)\n\n• fast\n• free')
  })

  it('is the text exactly as written for a draft that is not markdown', async () => {
    world = makeWorld()
    setPlatform('some-forum')
    const opp = ((await call('publications.create', { channelId: world.channel.id, draft: { title: 'T', text: 'raw **marks** stay' } })) as { opportunity: { id: string } }).opportunity
    await call('opportunities.approve', { id: opp.id })
    await world.sending.send(opp.id)
    expect(world.connector.published.at(-1)?.request).toMatchObject({ title: 'T', text: 'raw **marks** stay' })
  })
})

describe('the send asks the fit question again', () => {
  it('holds a post that fitted when it was approved and does not fit the channel now, and nothing is published', async () => {
    world = makeWorld()
    setPlatform('some-forum')
    const opp = await create({ title: 'T', text: 'words', link: 'https://example.org' })
    expect(await approve(opp.id)).toBeNull()
    setPlatform('reddit') // the channel is a Reddit one now: a link post cannot carry words there
    const failure = await refusal('opportunities.send', { id: opp.id })
    expect(failure?.message).toMatch(/a link or a text, not both/)
    expect(world.connector.published).toEqual([])
  })

  it('does not ask it of a draft that is not markdown: its connector decides, as before', async () => {
    world = makeWorld()
    setPlatform('some-forum')
    const opp = ((await call('publications.create', { channelId: world.channel.id, draft: { title: 'T', text: 'words', link: 'https://example.org' } })) as { opportunity: { id: string } }).opportunity
    await call('opportunities.approve', { id: opp.id })
    setPlatform('reddit')
    await world.sending.send(opp.id)
    expect(world.connector.published).toHaveLength(1)
  })
})
