// Saving a picture to a place the owner chooses: the name the dialog proposes, the bytes of a picture drawn on the screen, the original file written byte for byte,
// a cancelled dialog that changes nothing, and refusals that say what is wrong. The dialog itself is the main process's, faked here.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MediaItem } from '../../shared/types'
import type { MediaTools } from '../ports'
import { closeWorld, makeWorld, type World } from '../pipeline/test-fixture'
import { decodePictureDataUrl, pictureExtension, suggestedFileName } from './save-picture'

let world: World
afterEach(async () => {
  if (world) await closeWorld(world)
})

function png(tag = 'a'): Buffer {
  const header = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'latin1')
  header.writeUInt32BE(64, 16)
  header.writeUInt32BE(48, 20)
  return Buffer.concat([header, Buffer.from(tag)])
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

/** A Save dialog that the owner answers with `choice` (a path, or null for Cancel); it records what it was asked and writes like the real one. */
function dialog(choice: (name: string) => string | null): { tools: MediaTools; asked: string[]; revealed: string[] } {
  const asked: string[] = []
  const revealed: string[] = []
  const tools: MediaTools = {
    pick: async () => [],
    choose: async () => [],
    thumbnail: async () => 'data:image/png;base64,AAAA',
    reveal: (path) => void revealed.push(path),
    save: async (source, name) => {
      asked.push(name)
      const to = choice(name)
      if (to === null) return null
      if ('path' in source) writeFileSync(to, readFileSync(source.path))
      else writeFileSync(to, source.bytes)
      return to
    }
  }
  return { tools, asked, revealed }
}
const scratch = (): string => mkdtempSync(join(tmpdir(), 'ppd-save-'))

describe('the name the dialog proposes', () => {
  it('keeps the picture\'s own name and gives it the extension its kind needs', () => {
    expect(suggestedFileName('Codex picture.png', 'image/png', 'picture')).toBe('Codex picture.png')
    expect(suggestedFileName('holiday', 'image/webp', 'picture')).toBe('holiday.webp')
    expect(suggestedFileName('photo.jpeg', 'image/jpeg', 'picture')).toBe('photo.jpeg')
    expect(suggestedFileName('photo.png', 'image/jpeg', 'picture')).toBe('photo.jpg')
    expect(suggestedFileName('post-picture-2', 'image/webp', 'post-picture')).toBe('post-picture-2.webp')
    expect(suggestedFileName('my.chart.v2', 'image/png', 'picture')).toBe('my.chart.v2.png')
  })

  it('uses the fallback for an empty name, and never carries a folder, a slash or a control character into the name', () => {
    expect(suggestedFileName('   ', 'image/png', 'picture')).toBe('picture.png')
    expect(suggestedFileName('../../etc/passwd', 'image/png', 'picture')).toBe('passwd.png')
    expect(suggestedFileName('a\u0000b\nc:d', 'image/gif', 'picture')).toBe('a b c d.gif')
    expect(suggestedFileName('x'.repeat(300), 'image/png', 'picture').length).toBeLessThanOrEqual(120)
    expect(suggestedFileName('x'.repeat(300), 'image/png', 'picture').endsWith('.png')).toBe(true)
  })

  it('names the extension of each kind, and a kind it does not know as a PNG', () => {
    expect([pictureExtension('image/png'), pictureExtension('image/jpeg'), pictureExtension('image/gif'), pictureExtension('image/webp'), pictureExtension('text/html')]).toEqual(['.png', '.jpg', '.gif', '.webp', '.png'])
  })
})

describe('a picture sent as a data address', () => {
  it('is taken when its bytes are a picture, whatever the address claims', () => {
    const decoded = decodePictureDataUrl(`data:image/jpeg;base64,${png('x').toString('base64')}`)
    expect(decoded?.mime).toBe('image/png')
    expect(decoded?.bytes.equals(png('x'))).toBe(true)
  })

  it('is refused when it is not one: text, another kind of file, an empty body, something that is not an address, too many bytes', () => {
    expect(decodePictureDataUrl('data:text/html;base64,PGh0bWw+')).toBeNull()
    expect(decodePictureDataUrl(`data:image/png;base64,${Buffer.from('not a picture at all').toString('base64')}`)).toBeNull()
    expect(decodePictureDataUrl('data:image/png;base64,')).toBeNull()
    expect(decodePictureDataUrl('https://example.org/a.png')).toBeNull()
    expect(decodePictureDataUrl(42)).toBeNull()
    expect(decodePictureDataUrl(`data:image/png;base64,${Buffer.concat([png(), Buffer.alloc(41_000_000)]).toString('base64')}`)).toBeNull()
  })
})

describe('saving a picture of the library', () => {
  async function add(): Promise<MediaItem> {
    return (await call('media.add', { productId: world.product.id, name: 'shot.png', base64: png('lib').toString('base64'), origin: 'pasted' })) as MediaItem
  }

  it('writes the original file where the owner chose, byte for byte, and proposes the picture\'s own name', async () => {
    world = makeWorld()
    const item = await add()
    const target = join(scratch(), 'chosen.png')
    const d = dialog(() => target)
    Object.assign(world.core, { mediaTools: d.tools })
    expect(await call('media.save', { id: item.id })).toEqual({ path: target })
    expect(d.asked).toEqual(['shot.png'])
    expect(readFileSync(target).equals(readFileSync(item.path))).toBe(true)
  })

  it('writes nothing and answers null when the dialog is closed', async () => {
    world = makeWorld()
    const item = await add()
    const target = join(scratch(), 'never.png')
    Object.assign(world.core, { mediaTools: dialog(() => null).tools })
    expect(await call('media.save', { id: item.id })).toBeNull()
    expect(existsSync(target)).toBe(false)
  })

  it('refuses a picture that is not in the library, and says there is no dialog when the application has none', async () => {
    world = makeWorld()
    const item = await add()
    expect(await refusal('media.save', { id: item.id })).toBe('no_picker')
    Object.assign(world.core, { mediaTools: dialog(() => null).tools })
    expect(await refusal('media.save', { id: 'no-such-picture' })).toBe('not_found')
    expect(await refusal('media.save', { id: '../../etc/passwd' })).toBe('not_found')
  })

  it('refuses a picture whose file is gone from the computer, in words, and opens no dialog', async () => {
    world = makeWorld()
    const item = await add()
    const d = dialog(() => null)
    Object.assign(world.core, { mediaTools: d.tools })
    writeFileSync(item.path, '')
    const { rmSync } = await import('node:fs')
    rmSync(item.path)
    await expect(call('media.save', { id: item.id })).rejects.toMatchObject({ code: 'not_found', message: expect.stringMatching(/not on this computer/) })
    expect(d.asked).toEqual([])
  })
})

describe('saving a picture drawn on the screen', () => {
  it('writes its bytes where the owner chose, named from what the screen calls it', async () => {
    world = makeWorld()
    const target = join(scratch(), 'page.png')
    const d = dialog(() => target)
    Object.assign(world.core, { mediaTools: d.tools })
    const bytes = png('shot')
    expect(await call('pictures.saveDataUrl', { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, name: 'Screenshot of reddit.com' })).toEqual({ path: target })
    expect(d.asked).toEqual(['Screenshot of reddit.com.png'])
    expect(readFileSync(target).equals(bytes)).toBe(true)
  })

  it('refuses what is not a picture before any dialog opens, and answers null when the dialog is closed', async () => {
    world = makeWorld()
    const d = dialog(() => null)
    Object.assign(world.core, { mediaTools: d.tools })
    expect(await refusal('pictures.saveDataUrl', { dataUrl: 'data:text/html;base64,PGh0bWw+', name: 'x' })).toBe('invalid_picture')
    expect(d.asked).toEqual([])
    expect(await call('pictures.saveDataUrl', { dataUrl: `data:image/png;base64,${png().toString('base64')}`, name: 'x' })).toBeNull()
    expect(d.asked).toEqual(['x.png'])
  })
})

describe('showing a saved picture in the file manager', () => {
  it('takes only a path that was saved just now; the renderer cannot point the file manager anywhere else', async () => {
    world = makeWorld()
    const target = join(scratch(), 'a.png')
    const d = dialog(() => target)
    Object.assign(world.core, { mediaTools: d.tools })
    await call('pictures.saveDataUrl', { dataUrl: `data:image/png;base64,${png().toString('base64')}`, name: 'a' })
    await call('pictures.revealSaved', { path: target })
    expect(d.revealed).toEqual([target])
    expect(await refusal('pictures.revealSaved', { path: '/etc/passwd' })).toBe('not_found')
    expect(await refusal('pictures.revealSaved', { path: 42 })).toBe('not_found')
    expect(d.revealed).toEqual([target])
  })
})
