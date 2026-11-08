// Attachment validation (REQ-003: images only where the connector verifies them). The file must exist, be a
// real image of an allowed type and stay under the size cap. The content hash is computed here and never taken
// from the caller, so an approval bound to it really covers the bytes that will be uploaded.

import { open, readFile, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { ApiError } from '../../shared/api'
import type { Attachment } from '../../shared/types'
import { errorMessage, sha256 } from './util'

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_MAX_COUNT = 10

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

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
    default:
      return false
  }
}

async function readHead(path: string): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buffer, 0, 16, 0)
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
    if (size > ATTACHMENT_MAX_BYTES) throw invalid(name, `the file is larger than ${Math.round(ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB.`)
    const mime = MIME_BY_EXTENSION[extname(item.path).toLowerCase()]
    if (!mime) throw invalid(name, 'only PNG, JPEG, GIF and WebP images are supported.')
    if (item.mime && item.mime !== mime) throw invalid(name, `declared type ${item.mime} does not match a ${mime} file.`)
    if (!looksLike(mime, await readHead(item.path))) throw invalid(name, `the content is not a valid ${mime} image.`)
    result.push({ name, path: item.path, mime, sha256: sha256(await readFile(item.path)) })
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
      const content = await readFile(a.path)
      if (sha256(content) !== a.sha256) return `Attachment "${a.name}" changed on disk after the draft was saved.`
    } catch {
      return `Attachment "${a.name}" can no longer be read from ${a.path}.`
    }
  }
  return null
}
