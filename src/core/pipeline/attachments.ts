// Attachment validation (REQ-003: pictures and videos only, as far as the application can verify them). The file must exist, be a
// real picture or video of an allowed type and stay under the size cap of its kind. The content hash is computed here and never taken
// from the caller, so an approval bound to it really covers the bytes that will be uploaded. The hash is read in pieces, so a video of
// hundreds of megabytes is never held in memory (the digest is the same as for a whole read).

import { open, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { ApiError } from '../../shared/api'
import { isVideoMime, type Attachment } from '../../shared/types'
import { errorMessage, sha256OfFile } from './util'

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_MAX_COUNT = 10
/** The most a video of a post may be. The platforms' own limits are judged apart (`VIDEO_RULES`). */
export const VIDEO_MAX_BYTES = 512 * 1024 * 1024
/** The most a file of this kind may be: a picture ten megabytes, a video 512. */
export const attachmentLimit = (mime: string): number => (isVideoMime(mime) ? VIDEO_MAX_BYTES : ATTACHMENT_MAX_BYTES)

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
}

/** The boxes a QuickTime file may begin with when it has no `ftyp` (older cameras and editors). */
const QUICKTIME_FIRST_BOXES = ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot']

function looksLike(mime: string, head: Buffer): boolean {
  switch (mime) {
    case 'image/png':
      return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    case 'image/jpeg':
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    case 'image/gif':
      return head.length >= 6 && ['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString('latin1'))
    case 'image/webp':
      return head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
    case 'video/mp4':
      // An MPEG-4 file begins with a box whose type is `ftyp`, after four bytes of its size.
      return head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp'
    case 'video/quicktime':
      return head.length >= 12 && QUICKTIME_FIRST_BOXES.includes(head.subarray(4, 8).toString('latin1'))
    case 'video/webm':
      // The EBML header of Matroska, whose document type says `webm` (a `.mkv` says `matroska`, and is not taken).
      return head.length >= 16 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3 && head.toString('latin1').includes('webm')
    default:
      return false
  }
}

/** The type of an image by its first bytes, or null when they are not one of the supported images. */
export function sniffMime(head: Buffer): string | null {
  for (const mime of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) if (looksLike(mime, head)) return mime
  return null
}

export const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm'
}

const HEAD_BYTES = 64

async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function invalid(name: string, why: string): ApiError {
  return new ApiError('invalid_attachment', `Attachment "${name}": ${why}`)
}

/** Validates the attachments and returns them with server-computed mime type and sha256. */
export async function validateAttachments(input: Attachment[] | undefined): Promise<Attachment[]> {
  const list = input ?? []
  if (list.length > ATTACHMENT_MAX_COUNT) throw new ApiError('invalid_attachment', `At most ${ATTACHMENT_MAX_COUNT} attachments are allowed.`)
  const result: Attachment[] = []
  for (const item of list) {
    const name = (item.name || basename(item.path || '')).trim() || 'attachment'
    if (!item.path || !isAbsolute(item.path)) throw invalid(name, 'give the absolute path of the file.')
    let size: number
    try {
      const info = await stat(item.path)
      if (!info.isFile()) throw invalid(name, 'the path is not a file.')
      size = info.size
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw invalid(name, `the file cannot be read (${errorMessage(error)}).`)
    }
    if (size === 0) throw invalid(name, 'the file is empty.')
    const mime = MIME_BY_EXTENSION[extname(item.path).toLowerCase()]
    // A file of a kind that is not taken is said so whatever its size.
    if (!mime) {
      if (size > ATTACHMENT_MAX_BYTES) throw invalid(name, `the file is larger than ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`)
      throw invalid(name, 'only PNG, JPEG, GIF and WebP pictures and MP4, MOV, M4V and WebM videos are supported.')
    }
    const limit = attachmentLimit(mime)
    if (size > limit) throw invalid(name, `the ${isVideoMime(mime) ? 'video' : 'file'} is larger than ${Math.round(limit / 1024 / 1024)} MB.`)
    if (item.mime && item.mime !== mime) throw invalid(name, `declared type ${item.mime} does not match a ${mime} file.`)
    if (!looksLike(mime, await readHead(item.path))) throw invalid(name, `the content is not a valid ${mime} ${isVideoMime(mime) ? 'video' : 'image'}.`)
    result.push({ name, path: item.path, mime, sha256: await sha256OfFile(item.path) })
  }
  return result
}

/**
 * Re-reads the files before sending: an approval is bound to the bytes seen at approval time, so a file that
 * changed or vanished since then must send the item back to review. Returns a reason, or null when all match.
 */
export async function attachmentProblem(attachments: Attachment[]): Promise<string | null> {
  for (const a of attachments) {
    try {
      if ((await sha256OfFile(a.path)) !== a.sha256) return `Attachment "${a.name}" changed on disk after the draft was saved.`
    } catch {
      return `Attachment "${a.name}" can no longer be read from ${a.path}.`
    }
  }
  return null
}
