// Validation and preview of product sources. The preview shows exactly what the AI would be allowed to see and what is
// left out with the reason (REQ-001), before anything is analyzed.

import { basename } from 'node:path'
import { ApiError } from '../../shared/api'
import type { SourcePreview } from '../../shared/api'
import type { SourceKind, SourceScope } from '../../shared/types'
import { normalizeScope, readScannedFile, resolveCodeFolder, scanCodeFolder } from './code-scan'
import { assertReadableFile, classifyDocument, isImagePath, readDocumentText } from './documents'
import { normalizeHttpUrl } from './url-reader'

export const SOURCE_KINDS: SourceKind[] = ['url', 'text', 'document', 'image', 'code_folder']
export const MAX_TEXT_SOURCE_CHARS = 60_000

export interface ValidSource {
  kind: SourceKind
  ref: string
  label: string
  scope: SourceScope | null
}

export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as string[]).includes(value)
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** Validates user input for a new source and returns its normalized form. Throws ApiError('invalid_input'). */
export function validateSource(input: { kind: unknown; ref: unknown; label?: unknown; scope?: SourceScope | null }): ValidSource {
  if (!isSourceKind(input.kind)) throw new ApiError('invalid_input', `Unknown source type: ${String(input.kind)}`)
  if (typeof input.ref !== 'string' || !input.ref.trim()) throw new ApiError('invalid_input', 'The source is empty.')
  const customLabel = typeof input.label === 'string' ? input.label.trim().slice(0, 120) : ''
  const raw = input.ref.trim()
  switch (input.kind) {
    case 'url': {
      const ref = normalizeHttpUrl(raw)
      return { kind: 'url', ref, label: customLabel || hostLabel(ref), scope: null }
    }
    case 'text': {
      if (raw.length > MAX_TEXT_SOURCE_CHARS) throw new ApiError('invalid_input', `The text is too long (limit ${MAX_TEXT_SOURCE_CHARS} characters).`)
      return { kind: 'text', ref: raw, label: customLabel || 'Description', scope: null }
    }
    case 'document': {
      assertReadableFile(raw)
      return { kind: 'document', ref: raw, label: customLabel || basename(raw), scope: null }
    }
    case 'image': {
      assertReadableFile(raw)
      if (!isImagePath(raw)) throw new ApiError('invalid_input', 'This file is not a recognized image type. Add it as a document instead.')
      return { kind: 'image', ref: raw, label: customLabel || basename(raw), scope: null }
    }
    case 'code_folder': {
      // An unreadable, missing or overly broad folder is refused here.
      resolveCodeFolder(raw)
      return { kind: 'code_folder', ref: raw, label: customLabel || basename(raw), scope: normalizeScope(input.scope) }
    }
  }
}

/** What the AI would see for this source. Reads files but never executes anything and never calls the network. */
export function previewSource(input: { kind: unknown; ref: unknown; scope?: SourceScope | null }): SourcePreview {
  const source = validateSource(input)
  switch (source.kind) {
    case 'url':
      return {
        included: [source.ref],
        excluded: [],
        summary: 'The AI will read this page and up to 4 related pages on the same site (pricing, about, features, FAQ). Nothing is sent to the site except ordinary page requests.'
      }
    case 'text':
      return { included: [`Text (${source.ref.length} characters)`], excluded: [], summary: 'The AI will read this text as part of the product description.' }
    case 'document': {
      if (classifyDocument(source.ref) === 'text') {
        const doc = readDocumentText(source.ref)
        const note = doc?.redactions ? ` ${doc.redactions} secret-looking strings will be masked.` : ''
        return { included: [source.ref], excluded: [], summary: `The AI will read this document.${note}` }
      }
      return {
        included: [],
        excluded: [{ path: source.ref, reason: 'attached as a material only; this file type is not analyzed' }],
        summary: 'This file will be attached to the product as a material. The AI will not read it.'
      }
    }
    case 'image':
      return {
        included: [],
        excluded: [{ path: source.ref, reason: 'attached as a material only; images are not analyzed' }],
        summary: 'This image will be attached to the product as a material. The AI will not look at it.'
      }
    case 'code_folder': {
      const scan = scanCodeFolder(source.ref, source.scope)
      let redactions = 0
      let redactedFiles = 0
      for (const file of scan.included) {
        const text = readScannedFile(scan.root, file)
        if (text && text.redactions > 0) {
          redactions += text.redactions
          redactedFiles++
        }
      }
      const parts = [
        `The AI will read ${scan.included.length} file${scan.included.length === 1 ? '' : 's'}; ${scan.excludedCount} item${scan.excludedCount === 1 ? ' is' : 's are'} left out.`,
        'Project code is only read, never run.'
      ]
      if (redactions > 0) parts.push(`${redactions} secret-looking string${redactions === 1 ? '' : 's'} in ${redactedFiles} file${redactedFiles === 1 ? '' : 's'} will be masked.`)
      if (scan.truncated) parts.push('The folder is very large, so only part of it was examined.')
      return { included: scan.included.map((f) => f.path), excluded: scan.excluded, summary: parts.join(' ') }
    }
  }
}
