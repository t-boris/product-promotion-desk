// The picture library of a product (DEC-030): pictures come from a file dialog, the clipboard, a drop or the AI's image tool, are checked
// like any attachment, and live in the data folder as files that never change. A draft that uses a picture is bound to its bytes by the
// approval hash, so a picture is only ever added, never edited; removing one is refused while a draft carries it.

import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { ApiError } from '../../shared/api'
import { FILE_PURPOSES, type FilePurpose, type Id, type MediaItem, type MediaOrigin, type MediaShape } from '../../shared/types'
import type { Core } from '../core'
import { found, requireText } from '../channels/errors'
import { EXTENSION_BY_MIME, ATTACHMENT_MAX_BYTES, sniffMime, validateAttachments } from '../pipeline/attachments'
import { imageEngine, isShape, mediaPrompt, withMadeImage } from './make'
import { imageSize } from './image-size'
import { pictureSaverOf } from './save-picture'
import { MediaStore } from './store'

const MAX_NAME = 120
const MAX_DESCRIPTION = 600
/** A picture of more pixels than this is refused: a small file can unpack into gigabytes of memory when it is shown. */
const MAX_PIXELS = 80_000_000
const THUMB_DEFAULT = 240
const THUMB_MIN = 48
/** The most pixels (longest side) of a copy for the screen: the viewer that shows a picture large asks for this much. */
const THUMB_MAX = 2048
/** Without Electron's image support the whole file is shown when it is this small. */
const WHOLE_FILE_THUMB_MAX = 1_500_000
const ORPHAN_DAYS = 30

const cleanName = (name: string, fallback: string): string => {
  // eslint-disable-next-line no-control-regex
  const base = basename(name.replace(/[\u0000-\u001f\u007f]+/g, ' ')).trim()
  return (base || fallback).slice(0, MAX_NAME)
}

const cleanDescription = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION) : '')

export class MediaService {
  readonly store: MediaStore

  constructor(private readonly core: Core) {
    this.store = new MediaStore(core.db, core.dataDir, () => core.clock.now().toISOString())
  }

  async status(args: { checkEngine?: boolean }): Promise<{ canPick: boolean; canReveal: boolean; canMake: boolean | null; makeReason: string | null }> {
    const tools = this.core.mediaTools
    const base = { canPick: tools !== null, canReveal: tools !== null }
    if (!args?.checkEngine) return { ...base, canMake: null, makeReason: null }
    try {
      await imageEngine(this.core)
      return { ...base, canMake: true, makeReason: null }
    } catch (error) {
      return { ...base, canMake: false, makeReason: error instanceof Error ? error.message : String(error) }
    }
  }

  list(args: { productId: Id }): MediaItem[] {
    return this.store.list(this.product(args.productId))
  }

  /** The system's file dialog for a purpose (a source's file, image or folder, a picture): only the paths the owner chose; nothing is read or copied here. */
  async choose(args: { purpose: FilePurpose }): Promise<string[]> {
    if (!FILE_PURPOSES.includes(args?.purpose)) throw new ApiError('invalid_input', 'Say what the file is for.')
    const tools = this.core.mediaTools
    if (!tools) throw new ApiError('no_picker', 'This version cannot open a file dialog here. Type the path instead.')
    return tools.choose(args.purpose)
  }

  /** The file dialog; every file the owner chose is added, the others are named in one refusal. */
  async pick(args: { productId: Id }): Promise<MediaItem[]> {
    const productId = this.product(args.productId)
    const tools = this.core.mediaTools
    if (!tools) throw new ApiError('no_picker', 'This version cannot open a file dialog here. Paste the picture (Command-V) or drop it on the editor.')
    const chosen = await tools.pick()
    const added: MediaItem[] = []
    const refused: string[] = []
    for (const path of chosen) {
      try {
        added.push(await this.addFile(productId, path, cleanName(path, 'picture'), 'picked', ''))
      } catch (error) {
        refused.push(error instanceof ApiError ? error.message : `${basename(path)}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (added.length === 0 && refused.length > 0) throw new ApiError('invalid_attachment', refused.join(' '))
    return added
  }

  /** A picture from bytes (the clipboard, a drop): the file is written, checked and kept, or refused with nothing left behind. */
  async add(args: { productId: Id; name: string; base64: string; origin: Exclude<MediaOrigin, 'generated'>; description?: string }): Promise<MediaItem> {
    const productId = this.product(args.productId)
    if (typeof args.base64 !== 'string' || args.base64 === '') throw new ApiError('invalid_attachment', 'The picture is empty.')
    if (args.base64.length > Math.ceil((ATTACHMENT_MAX_BYTES * 4) / 3) + 8) throw new ApiError('invalid_attachment', `The picture is larger than ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`)
    if (args.origin !== 'pasted' && args.origin !== 'dropped' && args.origin !== 'picked' && args.origin !== 'card') throw new ApiError('invalid_input', 'Say where the picture came from.')
    const bytes = Buffer.from(args.base64, 'base64')
    const mime = sniffMime(bytes.subarray(0, 16))
    if (!mime) throw new ApiError('invalid_attachment', 'This is not a PNG, JPEG, GIF or WebP picture.')
    const folder = this.store.folder()
    await mkdir(folder, { recursive: true })
    const incoming = join(folder, `incoming-${this.store.newId()}${EXTENSION_BY_MIME[mime]}`)
    await writeFile(incoming, bytes)
    try {
      return await this.keepFile(productId, incoming, cleanName(args.name, 'pasted picture'), args.origin, cleanDescription(args.description), true)
    } finally {
      await rm(incoming, { force: true })
    }
  }

  /** A picture from a file on this computer: copied into the library, the original is not touched. */
  async addFile(productId: Id, path: string, name: string, origin: MediaOrigin, description: string): Promise<MediaItem> {
    const folder = this.store.folder()
    await mkdir(folder, { recursive: true })
    const [checked] = await validateAttachments([{ name, path, mime: '', sha256: '' }])
    const incoming = join(folder, `incoming-${this.store.newId()}${EXTENSION_BY_MIME[checked.mime]}`)
    await copyFile(path, incoming)
    try {
      return await this.keepFile(productId, incoming, name, origin, description, false)
    } finally {
      await rm(incoming, { force: true })
    }
  }

  /** Validates the incoming file as it is now and keeps it as a picture of the library (or returns the same picture that is there already). */
  private async keepFile(productId: Id, incoming: string, name: string, origin: MediaOrigin, description: string, moveIn: boolean): Promise<MediaItem> {
    const [checked] = await validateAttachments([{ name, path: incoming, mime: '', sha256: '' }])
    const first = this.store.byHash(productId, checked.sha256)
    if (first) return this.withItsFile(first, incoming)
    const id = this.store.newId()
    const file = `${id}${EXTENSION_BY_MIME[checked.mime]}`
    const target = join(this.store.folder(), file)
    if (moveIn) await rename(incoming, target)
    else await copyFile(incoming, target)
    try {
      const bytes = await readFile(target)
      const size = imageSize(bytes, checked.mime)
      if (size && size.width * size.height > MAX_PIXELS) {
        throw new ApiError('invalid_attachment', `The picture is ${size.width} × ${size.height} pixels; the most this application keeps is ${MAX_PIXELS / 1_000_000} million pixels.`)
      }
      // The same picture may have been added by another paste while this file was being put in place (the library holds one of each, by
      // content): the check and the insert follow each other with nothing awaited between them, so the second one finds the first and keeps that.
      const raced = this.store.byHash(productId, checked.sha256)
      if (raced) {
        await rm(target, { force: true })
        return raced
      }
      const item = this.store.insert(id, {
        productId,
        name,
        file,
        mime: checked.mime,
        sha256: checked.sha256,
        bytes: bytes.length,
        width: size?.width ?? null,
        height: size?.height ?? null,
        origin,
        description
      })
      this.core.log.info('pipeline', `A picture was added to the library (${origin}): ${name}.`)
      this.core.events.changed('media')
      return item
    } catch (error) {
      // Whatever went wrong, no file of this attempt stays in the library folder.
      await rm(target, { force: true })
      throw error
    }
  }

  /**
   * A picture the library knows already. If its file went missing (something outside the application removed it), the bytes that came
   * in now are put back, so pasting the picture again repairs it instead of returning a picture that cannot be shown or sent.
   */
  private async withItsFile(item: MediaItem, incoming: string): Promise<MediaItem> {
    try {
      await access(item.path)
    } catch {
      await copyFile(incoming, item.path)
      this.core.log.info('pipeline', `The file of a picture of the library was missing and has been put back: ${item.name}.`)
    }
    return item
  }

  item(id: unknown): MediaItem {
    return found(() => {
      const item = this.store.get(requireText(id, 'The picture'))
      if (!item) throw new Error('not found')
      return item
    }, 'The picture')
  }

  async thumb(args: { id: Id; side?: number }): Promise<{ dataUrl: string } | null> {
    const item = this.store.get(typeof args.id === 'string' ? args.id : '')
    if (!item) return null
    const side = Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(typeof args.side === 'number' && Number.isFinite(args.side) ? args.side : THUMB_DEFAULT)))
    try {
      if (this.core.mediaTools) return { dataUrl: await this.core.mediaTools.thumbnail(item.path, side) }
      if (item.bytes > WHOLE_FILE_THUMB_MAX) return null
      return { dataUrl: `data:${item.mime};base64,${(await readFile(item.path)).toString('base64')}` }
    } catch {
      return null
    }
  }

  describe(args: { id: Id; description: string }): MediaItem {
    const item = this.item(args.id)
    this.store.describe(item.id, cleanDescription(args.description))
    this.core.events.changed('media')
    return this.item(item.id)
  }

  /** Taking a picture out of the library never changes a draft: it is refused while a draft carries the picture. */
  async remove(args: { id: Id }): Promise<void> {
    const item = this.item(args.id)
    if (this.store.usedByDraft(item)) throw new ApiError('in_use', 'A draft uses this picture, so it stays in the library. Take it out of the draft first, or leave it.')
    this.store.delete(item.id)
    await rm(item.path, { force: true })
    this.core.events.changed('media')
  }

  /** Saves the stored file of a picture of the library where the owner chooses (the Save dialog); null when the dialog was closed. */
  async save(args: { id: Id }): Promise<{ path: string } | null> {
    const item = this.item(args.id)
    return pictureSaverOf(this.core).saveFile(item.path, item.name, item.mime, 'picture')
  }

  reveal(args: { id: Id }): void {
    const item = this.item(args.id)
    if (!this.core.mediaTools) throw new ApiError('no_picker', 'This version cannot open the file manager here.')
    this.core.mediaTools.reveal(item.path)
  }

  /** The AI makes a picture from the owner's description; every press makes a new picture, none replaces another. */
  async make(args: { productId: Id; description: string; shape: MediaShape }): Promise<MediaItem> {
    const productId = this.product(args.productId)
    const description = cleanDescription(args.description)
    if (!description) throw new ApiError('invalid_input', 'Describe the picture first: what it shows and how it looks.')
    if (!isShape(args.shape)) throw new ApiError('invalid_input', 'Choose a shape: square, wide or tall.')
    const item = await withMadeImage(
      this.core,
      { label: 'media.make', subject: productId, prompt: mediaPrompt(description, args.shape), folder: join(this.store.folder(), 'work') },
      (file, engineLabel) => this.addFile(productId, file, `${engineLabel} picture.png`, 'generated', description)
    )
    return item
  }

  /** Pictures nobody uses and nobody added lately go; a picture a draft carries never does. */
  /** Files of an add that never finished (a crash between the copy and the end): they are not pictures, and nothing refers to them. */
  private async clearStrayFiles(): Promise<void> {
    const folder = this.store.folder()
    let names: string[]
    try {
      names = await readdir(folder)
    } catch {
      return
    }
    const hourAgo = this.core.clock.now().getTime() - 60 * 60 * 1000
    for (const name of names.filter((n) => n.startsWith('incoming-'))) {
      try {
        if ((await stat(join(folder, name))).mtimeMs < hourAgo) await rm(join(folder, name), { force: true })
      } catch {
        // gone already
      }
    }
  }

  async cleanOrphans(days = ORPHAN_DAYS): Promise<number> {
    const before = new Date(this.core.clock.now().getTime() - days * 24 * 60 * 60 * 1000).toISOString()
    let removed = 0
    for (const item of this.store.unusedOlderThan(before)) {
      this.store.delete(item.id)
      await rm(item.path, { force: true })
      removed += 1
    }
    await this.clearStrayFiles()
    return removed
  }

  private product(id: unknown): Id {
    const productId = requireText(id, 'The product')
    found(() => this.core.repos.product(productId), 'The product')
    return productId
  }
}

export const extensionOf = (path: string): string => extname(path).toLowerCase()
