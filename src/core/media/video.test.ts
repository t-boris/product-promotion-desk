// Videos next to pictures: what a video file must be to be taken, how it is kept in the library (hashed in pieces, copied once, never measured in pixels), and how it is shown.

import { existsSync, mkdtempSync, readdirSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isVideoMime, type MediaItem } from '../../shared/types'
import { ATTACHMENT_MAX_BYTES, VIDEO_MAX_BYTES, attachmentLimit, attachmentProblem, sniffMime, validateAttachments } from '../pipeline/attachments'
import { closeWorld, makeWorld, type World } from '../pipeline/test-fixture'
import { sha256, sha256OfFile } from '../pipeline/util'
import type { MediaTools } from '../ports'

let world: World
afterEach(async () => {
  if (world) await closeWorld(world)
})

/** The first bytes of an MPEG-4 file: a box of 24 bytes whose type is `ftyp`, then bytes that tell two videos apart. */
function mp4(tag = 'a'): Buffer {
  const head = Buffer.alloc(24)
  head.writeUInt32BE(24, 0)
  head.write('ftyp', 4, 'latin1')
  head.write('isom', 8, 'latin1')
  return Buffer.concat([head, Buffer.from(tag.repeat(40))])
}
function quicktime(first = 'ftyp', tag = 'a'): Buffer {
  const head = Buffer.alloc(16)
  head.writeUInt32BE(16, 0)
  head.write(first, 4, 'latin1')
  head.write('qt  ', 8, 'latin1')
  return Buffer.concat([head, Buffer.from(tag.repeat(40))])
}
function webm(docType = 'webm', tag = 'a'): Buffer {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]), Buffer.from(docType, 'latin1'), Buffer.from(tag.repeat(40))])
}
function png(tag = 'a'): Buffer {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'latin1')
  header.writeUInt32BE(64, 16)
  header.writeUInt32BE(48, 20)
  return Buffer.concat([header, Buffer.from(tag)])
}
const dir = (): string => mkdtempSync(join(tmpdir(), 'ppd-video-'))
const file = (name: string, bytes: Buffer): string => {
  const path = join(dir(), name)
  writeFileSync(path, bytes)
  return path
}
const call = (method: string, args: unknown) => (world.core.router.call as (m: string, a: unknown) => Promise<never>)(method, args)
const refusal = async (method: string, args: unknown): Promise<string> => {
  try {
    await call(method, args)
  } catch (error) {
    return (error as { code: string }).code
  }
  return 'accepted'
}
const folder = (w: World): string => join(w.core.dataDir, 'media')

describe('a video is a kind of attachment', () => {
  it('says which mime types are videos', () => {
    expect(isVideoMime('video/mp4')).toBe(true)
    expect(isVideoMime('video/quicktime')).toBe(true)
    expect(isVideoMime('image/png')).toBe(false)
    expect(isVideoMime(undefined)).toBe(false)
  })

  it('takes MP4, M4V, MOV and WebM by their first bytes, and gives the type the extension stands for', async () => {
    const [a, b, c, d] = await validateAttachments([
      { name: 'a', path: file('a.mp4', mp4()), mime: '', sha256: '' },
      { name: 'b', path: file('b.m4v', mp4('b')), mime: '', sha256: '' },
      { name: 'c', path: file('c.mov', quicktime()), mime: '', sha256: '' },
      { name: 'd', path: file('d.webm', webm()), mime: '', sha256: '' }
    ])
    expect([a.mime, b.mime, c.mime, d.mime]).toEqual(['video/mp4', 'video/mp4', 'video/quicktime', 'video/webm'])
    for (const item of [a, b, c, d]) expect(item.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashes in pieces to the same digest as a whole read, so an approval bound to a picture stays valid', async () => {
    const bytes = png('same')
    const path = file('p.png', bytes)
    expect(await sha256OfFile(path)).toBe(sha256(bytes))
    const [checked] = await validateAttachments([{ name: 'p', path, mime: '', sha256: '' }])
    expect(checked.sha256).toBe(sha256(bytes))
  })

  it('takes an older QuickTime file that does not begin with ftyp, and refuses a file that is not a video of its extension', async () => {
    const [old] = await validateAttachments([{ name: 'old', path: file('old.mov', quicktime('moov')), mime: '', sha256: '' }])
    expect(old.mime).toBe('video/quicktime')
    const refused = async (name: string, bytes: Buffer): Promise<string> => {
      try {
        await validateAttachments([{ name, path: file(name, bytes), mime: '', sha256: '' }])
      } catch (error) {
        return (error as Error).message
      }
      return 'accepted'
    }
    expect(await refused('fake.mp4', Buffer.from('just some text, not a video at all'))).toMatch(/not a valid video\/mp4 video/)
    // A Matroska file named .webm says `matroska`, not `webm`.
    expect(await refused('movie.webm', webm('matroska'))).toMatch(/not a valid video\/webm video/)
    // A picture renamed to .mp4 is not a video.
    expect(await refused('renamed.mp4', png())).toMatch(/not a valid video\/mp4 video/)
    // A video renamed to .png is not a picture.
    expect(await refused('renamed.png', mp4())).toMatch(/not a valid image\/png image/)
    expect(await refused('clip.avi', mp4())).toMatch(/only PNG, JPEG, GIF and WebP pictures and MP4, MOV, M4V and WebM videos are supported/)
  })

  it('lets a video be larger than a picture, each with its own limit', async () => {
    expect(attachmentLimit('image/png')).toBe(ATTACHMENT_MAX_BYTES)
    expect(attachmentLimit('video/mp4')).toBe(VIDEO_MAX_BYTES)
    expect(VIDEO_MAX_BYTES).toBeGreaterThan(ATTACHMENT_MAX_BYTES)
    // Sparse files: the size is what is checked first, so nothing large is ever written or read.
    const bigVideo = file('big.mp4', mp4())
    truncateSync(bigVideo, VIDEO_MAX_BYTES + 1)
    await expect(validateAttachments([{ name: 'big', path: bigVideo, mime: '', sha256: '' }])).rejects.toThrow(/video is larger than 512 MB/)
    const bigPicture = file('big.png', png())
    truncateSync(bigPicture, ATTACHMENT_MAX_BYTES + 1)
    await expect(validateAttachments([{ name: 'big', path: bigPicture, mime: '', sha256: '' }])).rejects.toThrow(/larger than 10 MB/)
    const mediumVideo = file('medium.mp4', mp4())
    truncateSync(mediumVideo, ATTACHMENT_MAX_BYTES * 3)
    const [taken] = await validateAttachments([{ name: 'medium', path: mediumVideo, mime: '', sha256: '' }])
    expect(taken.mime).toBe('video/mp4')
  })

  it('never takes a video for a picture: only pictures are sniffed by their bytes alone', () => {
    expect(sniffMime(mp4().subarray(0, 16))).toBeNull()
    expect(sniffMime(webm().subarray(0, 16))).toBeNull()
    expect(sniffMime(png().subarray(0, 16))).toBe('image/png')
  })

  it('notices a video that changed or went missing after it was approved', async () => {
    const path = file('v.mp4', mp4('x'))
    const [checked] = await validateAttachments([{ name: 'v', path, mime: '', sha256: '' }])
    expect(await attachmentProblem([checked])).toBeNull()
    writeFileSync(path, mp4('y'))
    expect(await attachmentProblem([checked])).toMatch(/changed on disk/)
    expect(await attachmentProblem([{ ...checked, path: join(dir(), 'gone.mp4') }])).toMatch(/can no longer be read/)
  })
})

describe('a video in the library', () => {
  it('is copied once into the library under its id, with no size in pixels, and the original is left alone', async () => {
    world = makeWorld()
    const original = file('story.mp4', mp4('story'))
    const item = (await call('media.addPath', { productId: world.product.id, path: original, origin: 'dropped' })) as MediaItem
    expect(item).toMatchObject({ name: 'story.mp4', mime: 'video/mp4', origin: 'dropped', width: null, height: null })
    expect(item.bytes).toBe(mp4('story').length)
    expect(item.path).toBe(join(folder(world), `${item.id}.mp4`))
    expect(item.sha256).toBe(sha256(mp4('story')))
    expect(existsSync(original)).toBe(true)
    // Nothing but the video itself is left in the library folder.
    expect(readdirSync(folder(world))).toEqual([`${item.id}.mp4`])
    expect(((await call('media.list', { productId: world.product.id })) as MediaItem[]).map((i) => i.id)).toEqual([item.id])
  })

  it('keeps one copy of the same video, and puts it back when its file went missing', async () => {
    world = makeWorld()
    const original = file('story.mov', quicktime('ftyp', 'story'))
    const first = (await call('media.addPath', { productId: world.product.id, path: original, origin: 'picked' })) as MediaItem
    const again = (await call('media.addPath', { productId: world.product.id, path: file('copy.mov', quicktime('ftyp', 'story')), origin: 'picked' })) as MediaItem
    expect(again.id).toBe(first.id)
    expect(readdirSync(folder(world))).toHaveLength(1)
    // The file went missing outside the application; adding it again repairs the library.
    const { rmSync } = await import('node:fs')
    rmSync(first.path)
    const repaired = (await call('media.addPath', { productId: world.product.id, path: original, origin: 'picked' })) as MediaItem
    expect(repaired.id).toBe(first.id)
    expect(existsSync(first.path)).toBe(true)
  })

  it('refuses what is not a video or a picture, and what is not a file, leaving nothing behind', async () => {
    world = makeWorld()
    expect(await refusal('media.addPath', { productId: world.product.id, path: file('notes.txt', Buffer.from('words')), origin: 'dropped' })).toBe('invalid_attachment')
    expect(await refusal('media.addPath', { productId: world.product.id, path: file('fake.mp4', Buffer.from('not a video')), origin: 'dropped' })).toBe('invalid_attachment')
    expect(await refusal('media.addPath', { productId: world.product.id, path: dir(), origin: 'dropped' })).toBe('invalid_attachment')
    expect(await refusal('media.addPath', { productId: world.product.id, path: '', origin: 'dropped' })).toBe('invalid_attachment')
    expect(await refusal('media.addPath', { productId: world.product.id, path: file('ok.mp4', mp4()), origin: 'generated' })).toBe('invalid_input')
    expect(existsSync(folder(world)) ? readdirSync(folder(world)).filter((n) => !n.startsWith('incoming-')) : []).toEqual([])
  })

  it('also takes a picture by its path, as the dialog does', async () => {
    world = makeWorld()
    const item = (await call('media.addPath', { productId: world.product.id, path: file('shot.png', png('p')), origin: 'dropped' })) as MediaItem
    expect(item).toMatchObject({ mime: 'image/png', width: 64, height: 48 })
  })

  it('shows a video by a frame the system makes, and by none where it cannot (a WebM, or a build with no frame maker)', async () => {
    world = makeWorld()
    const asked: string[] = []
    const base: MediaTools = { pick: async () => [], choose: async () => [], thumbnail: async () => 'data:image/png;base64,PICTURE', reveal: () => undefined, save: async () => null }
    Object.assign(world.core, {
      mediaTools: { ...base, poster: async (_p: string, mime: string, side: number) => (asked.push(`${mime}@${side}`), mime === 'video/webm' ? null : 'data:image/png;base64,FRAME') } satisfies MediaTools
    })
    const clip = (await call('media.addPath', { productId: world.product.id, path: file('clip.mp4', mp4('t')), origin: 'dropped' })) as MediaItem
    const web = (await call('media.addPath', { productId: world.product.id, path: file('clip.webm', webm('webm', 't')), origin: 'dropped' })) as MediaItem
    expect(await call('media.thumb', { id: clip.id, side: 128 })).toEqual({ dataUrl: 'data:image/png;base64,FRAME' })
    expect(await call('media.thumb', { id: web.id, side: 128 })).toBeNull()
    expect(asked).toEqual(['video/mp4@128', 'video/webm@128'])
    // A picture still goes through the picture path.
    const pic = (await call('media.addPath', { productId: world.product.id, path: file('p.png', png('q')), origin: 'dropped' })) as MediaItem
    expect(await call('media.thumb', { id: pic.id })).toEqual({ dataUrl: 'data:image/png;base64,PICTURE' })
    // A tool with no way to make a frame gives none, and a build with no tools never hands the whole video to the screen.
    Object.assign(world.core, { mediaTools: base })
    expect(await call('media.thumb', { id: clip.id })).toBeNull()
    Object.assign(world.core, { mediaTools: null })
    expect(await call('media.thumb', { id: clip.id })).toBeNull()
  })

  it('names a video in its log line and is saved like a picture, with its own extension', async () => {
    world = makeWorld()
    const item = (await call('media.addPath', { productId: world.product.id, path: file('trip.mov', quicktime('ftyp', 'trip')), origin: 'picked' })) as MediaItem
    expect(item.path.endsWith('.mov')).toBe(true)
  })
})
