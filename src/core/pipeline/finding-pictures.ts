// The pictures of the posts the AI read: fetched from the addresses it listed, kept in the application's own folder of post pictures and shown on the card
// of the post. They are strangers' pictures, shown to the owner as part of what the AI read, and they are never added to the owner's picture library (which is
// material for the owner's own posts) and never sent anywhere.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError } from '../../shared/api'
import type { Id } from '../../shared/types'
import type { Core } from '../core'
import { imageSize } from '../media/image-size'
import { pictureSaverOf } from '../media/save-picture'
import { EXTENSION_BY_MIME } from './attachments'
import type { FindingStore } from './findings'
import { defaultDownloadDeps, downloadPicture } from './picture-download'

export const PICTURE_FOLDER = 'post-pictures'
/** How many pictures one pass fetches: a look can name dozens, and they are fetched a few at a time so the site is not hammered. */
const BATCH = 12
const THUMB_DEFAULT = 480
const THUMB_MIN = 96
/** The most pixels (longest side) of a copy for the screen: the viewer that shows a picture large asks for this much. */
const THUMB_MAX = 2048
/** A picture of more pixels than this is not kept: a small file can unpack into gigabytes of memory when it is shown. */
const MAX_PIXELS = 80_000_000
/** The largest file shown whole, as it is: the screen's own image tools cannot read every kind of picture (a webp), and the page can. */
const WHOLE_FILE_MAX = 4_000_000

export class FindingPictures {
  private running: Promise<number> | null = null
  private again = false

  constructor(
    private readonly core: Core,
    private readonly findings: FindingStore
  ) {}

  folder(): string {
    return join(this.core.dataDir, PICTURE_FOLDER)
  }

  /**
   * Fetches the pictures that wait, a few at a time, until none waits. A call while one is running asks it to go round once more and shares its end. Returns
   * how many pictures were kept. Never throws: a picture that cannot be had is marked with why.
   */
  fetchWaiting(): Promise<number> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.pass().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async pass(): Promise<number> {
    let kept = 0
    let changed = false
    try {
      do {
        this.again = false
        for (;;) {
          const waiting = this.findings.waitingPictures(BATCH)
          if (waiting.length === 0) break
          await mkdir(this.folder(), { recursive: true })
          for (const picture of waiting) {
            const got = await downloadPicture(picture.url, this.core.services.pictureDeps ?? defaultDownloadDeps)
            changed = true
            if (!got.ok) {
              this.findings.failPicture(picture.id, got.reason)
              continue
            }
            const size = imageSize(got.bytes, got.mime)
            if (size && size.width * size.height > MAX_PIXELS) {
              this.findings.failPicture(picture.id, 'The picture has too many pixels to keep.')
              continue
            }
            const file = `${picture.id}${EXTENSION_BY_MIME[got.mime]}`
            try {
              await writeFile(join(this.folder(), file), got.bytes)
            } catch {
              this.findings.failPicture(picture.id, 'The picture could not be saved on this computer.')
              continue
            }
            this.findings.setPictureFile(picture.id, { file, mime: got.mime, bytes: got.bytes.length, width: size?.width ?? null, height: size?.height ?? null })
            kept += 1
          }
        }
      } while (this.again)
    } catch (error) {
      this.core.log.error('pipeline', `Pictures of posts could not be fetched: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (changed) this.findings.notify()
    return kept
  }

  /** Saves the stored file of a picture of a post where the owner chooses (the Save dialog), named by its place in the post ("post-picture-2.webp"); null when the dialog was closed. */
  async save(id: Id): Promise<{ path: string } | null> {
    const stored = this.findings.pictureFile(typeof id === 'string' ? id : '')
    if (!stored) throw new ApiError('not_found', 'This picture is not saved on this computer, so it cannot be saved from here.')
    return pictureSaverOf(this.core).saveFile(join(this.folder(), stored.file), `post-picture-${stored.position + 1}`, stored.mime, 'post-picture')
  }

  /** A picture as a data address for the screen, its longest side at most `side` pixels; null when the file is not there. */
  async dataUrl(id: Id, side?: number): Promise<{ dataUrl: string } | null> {
    const stored = this.findings.pictureFile(typeof id === 'string' ? id : '')
    if (!stored) return null
    const path = join(this.folder(), stored.file)
    const wanted = Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(typeof side === 'number' && Number.isFinite(side) ? side : THUMB_DEFAULT)))
    // A smaller copy first; a kind of picture the image tools of the system cannot read (a webp, which is what Reddit serves) is shown as the file itself.
    if (this.core.mediaTools) {
      try {
        return { dataUrl: await this.core.mediaTools.thumbnail(path, wanted) }
      } catch {
        // falls through to the whole file
      }
    }
    try {
      const bytes = await readFile(path)
      return bytes.length > WHOLE_FILE_MAX ? null : { dataUrl: `data:${stored.mime};base64,${bytes.toString('base64')}` }
    } catch {
      return null
    }
  }
}
