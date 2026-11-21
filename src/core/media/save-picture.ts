// Saving a picture the application shows to a place the owner chooses: the system's Save dialog opens with a proposed name, and the ORIGINAL stored file (not the
// copy the screen shows) is written where the owner points. The renderer never names a path: a stored picture is asked for by its id and a picture drawn on the
// screen (a page capture, the card of a quick post) by its bytes, which are checked to be a picture before the dialog opens. Cancelling the dialog changes nothing.

import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { ApiError } from '../../shared/api'
import type { Core } from '../core'
import { EXTENSION_BY_MIME, sniffMime } from '../pipeline/attachments'

/** The most bytes of a picture drawn on the screen that is saved: the screen's own copies are far smaller, and a message to the core stays bounded. */
const MAX_DRAWN_BYTES = 40_000_000
const MAX_NAME = 120
/** How many saved paths are remembered for "Show in Finder": the last few saves of this session. */
const REMEMBERED = 20

/** The file extension (with its dot) for a kind of picture; a kind that is not known is a PNG, which the screen's own captures are. */
export function pictureExtension(mime: string): string {
  return EXTENSION_BY_MIME[mime] ?? '.png'
}

/**
 * The name the Save dialog proposes: the picture's own name when it has one, with the extension its kind needs (a name that ends in another extension gets the
 * right one added, so a "Codex picture.png" stays itself and a webp named "photo" becomes "photo.webp"); `fallback` when the name is empty.
 */
export function suggestedFileName(name: string, mime: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const base = basename(name.replace(/[\u0000-\u001f\u007f]+/g, ' ')).replace(/[\\:]+/g, ' ').replace(/\s+/g, ' ').trim() || fallback
  const wanted = pictureExtension(mime)
  const own = extname(base).toLowerCase()
  const sameKind = own === wanted || (wanted === '.jpg' && own === '.jpeg')
  const stem = own !== '' && Object.values(EXTENSION_BY_MIME).concat('.jpeg').includes(own) ? base.slice(0, base.length - own.length) : base
  const named = sameKind ? base : `${stem}${wanted}`
  return named.length > MAX_NAME ? `${named.slice(0, MAX_NAME - wanted.length)}${wanted}` : named
}

/** The bytes and the kind of a picture sent as a data address, or null when it is not a PNG, JPEG, GIF or WebP picture (the bytes decide, not what the address claims). */
export function decodePictureDataUrl(dataUrl: unknown): { bytes: Buffer; mime: string } | null {
  if (typeof dataUrl !== 'string') return null
  const match = /^data:[a-z]+\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.slice(0, MAX_DRAWN_BYTES * 2))
  if (!match) return null
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.length === 0 || bytes.length > MAX_DRAWN_BYTES) return null
  const mime = sniffMime(bytes.subarray(0, 16))
  return mime ? { bytes, mime } : null
}

export interface SavedPicture {
  path: string
}

export class PictureSaver {
  private readonly saved: string[] = []

  constructor(private readonly core: Core) {}

  /** A stored file: the dialog, then a copy of the file as it is. Null when the owner cancelled. */
  async saveFile(path: string, name: string, mime: string, fallback: string): Promise<SavedPicture | null> {
    try {
      if (!(await stat(path)).isFile()) throw new Error('not a file')
    } catch {
      throw new ApiError('not_found', 'The file of this picture is not on this computer any more, so it cannot be saved.')
    }
    return this.ask({ path }, suggestedFileName(name, mime, fallback))
  }

  /** A picture drawn on the screen: the bytes are checked to be a picture, then the dialog. Null when the owner cancelled. */
  async saveDrawn(dataUrl: unknown, name: unknown): Promise<SavedPicture | null> {
    const picture = decodePictureDataUrl(dataUrl)
    if (!picture) throw new ApiError('invalid_picture', 'This is not a picture that can be saved: only PNG, JPEG, GIF and WebP pictures are.')
    return this.ask({ bytes: picture.bytes }, suggestedFileName(typeof name === 'string' ? name : '', picture.mime, 'picture'))
  }

  /** Shows a file this session saved in the system's file manager; a path that was not saved here is refused (the renderer cannot point the file manager anywhere). */
  reveal(path: unknown): void {
    if (typeof path !== 'string' || !this.saved.includes(path)) throw new ApiError('not_found', 'Only a picture saved just now can be shown here.')
    if (!this.core.mediaTools) throw new ApiError('no_picker', 'This version cannot open the file manager here.')
    this.core.mediaTools.reveal(path)
  }

  private async ask(source: { path: string } | { bytes: Buffer }, proposed: string): Promise<SavedPicture | null> {
    const tools = this.core.mediaTools
    if (!tools) throw new ApiError('no_picker', 'This version cannot open a save dialog here.')
    const path = await tools.save(source, proposed)
    if (path === null) return null
    this.saved.push(path)
    if (this.saved.length > REMEMBERED) this.saved.shift()
    this.core.log.info('pipeline', `A picture was saved: ${basename(path)}.`)
    return { path }
  }
}

const savers = new WeakMap<Core, PictureSaver>()

/** The one saver of a core, so every kind of picture shares what was saved (for "Show in Finder"). */
export function pictureSaverOf(core: Core): PictureSaver {
  let saver = savers.get(core)
  if (!saver) {
    saver = new PictureSaver(core)
    savers.set(core, saver)
  }
  return saver
}
