// Documents and images attached to a product. Text-like documents (text, markdown, html, json) are read for the
// analysis; every other file type, and all images, are attached as materials without being analyzed.

import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { ApiError } from '../../shared/api'
import { redactSecrets, secretFileReason } from './redact'
import { htmlToPageText, truncate } from './text'

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'mdx', 'html', 'htm', 'json', 'csv'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'avif', 'bmp', 'tiff', 'ico'])

export const MAX_DOCUMENT_BYTES = 200 * 1024
export const MAX_DOCUMENT_TEXT = 40_000

const extensionOf = (path: string): string => {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export type DocumentClass = 'text' | 'material'

export function classifyDocument(path: string): DocumentClass {
  return TEXT_EXTENSIONS.has(extensionOf(path)) ? 'text' : 'material'
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path))
}

/**
 * Checks a file path chosen by the user and returns it. The user picked this file on purpose, so a symbolic link is
 * followed, but files that look like secrets (environment files, keys, credentials) are refused under either name.
 */
export function assertReadableFile(path: string): { path: string; size: number } {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new ApiError('invalid_input', 'Choose a file by its full path (it must start with "/").')
  let real: string
  let size: number
  try {
    real = realpathSync(path)
    const fd = openSync(real, constants.O_RDONLY)
    try {
      const st = fstatSync(fd)
      if (!st.isFile()) throw new Error('not a file')
      size = st.size
    } finally {
      closeSync(fd)
    }
  } catch {
    throw new ApiError('invalid_input', `The file does not exist or is not readable: ${path}`)
  }
  const reason = secretFileReason(path) ?? secretFileReason(real)
  if (reason) throw new ApiError('invalid_input', `This file was not added because it looks like a secret (${reason}).`)
  return { path, size }
}

export interface DocumentText {
  text: string
  redactions: number
  truncated: boolean
}

/** Text of a text-like document, with secret-looking strings masked. Null for materials or unreadable files. */
export function readDocumentText(path: string): DocumentText | null {
  if (classifyDocument(path) !== 'text') return null
  let fd: number | null = null
  try {
    const real = realpathSync(path)
    if (secretFileReason(real)) return null
    fd = openSync(real, constants.O_RDONLY)
    const st = fstatSync(fd)
    if (!st.isFile()) return null
    const length = Math.min(st.size, MAX_DOCUMENT_BYTES)
    const buffer = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const read = readSync(fd, buffer, offset, length - offset, offset)
      if (read === 0) break
      offset += read
    }
    let text = buffer.subarray(0, offset).toString('utf8')
    if (text.includes('\u0000')) return null
    const ext = extensionOf(path)
    if (ext === 'html' || ext === 'htm') {
      const page = htmlToPageText(text)
      text = [page.title, page.description, page.text].filter(Boolean).join('\n')
    }
    const redacted = redactSecrets(text)
    const truncated = st.size > MAX_DOCUMENT_BYTES || redacted.text.length > MAX_DOCUMENT_TEXT
    return { text: truncate(redacted.text, MAX_DOCUMENT_TEXT), redactions: redacted.count, truncated }
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
