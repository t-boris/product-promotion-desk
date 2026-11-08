// Validation and normalization of user-supplied draft content. What is stored here is exactly what the
// approval hash covers, so it is normalized once (surrounding whitespace trimmed) and never again.

import { ApiError } from '../../shared/api'
import type { DraftInput } from '../../shared/api'
import { validateAttachments } from './attachments'
import type { DraftContent } from './store'

export const MAX_TEXT_LENGTH = 40_000
export const MAX_TITLE_LENGTH = 300

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function normalizeDraftInput(input: DraftInput): Promise<DraftContent> {
  const text = (input.text ?? '').trim()
  const title = (input.title ?? '').trim() || null
  const link = (input.link ?? '').trim() || null
  if (!text && !title && !link) throw new ApiError('invalid_input', 'The draft is empty: write some text.')
  if (text.length > MAX_TEXT_LENGTH) throw new ApiError('invalid_input', `The text is longer than ${MAX_TEXT_LENGTH} characters.`)
  if (title && title.length > MAX_TITLE_LENGTH) throw new ApiError('invalid_input', `The title is longer than ${MAX_TITLE_LENGTH} characters.`)
  if (link && !isHttpUrl(link)) throw new ApiError('invalid_input', 'The link must be a full http(s) address.')
  const attachments = await validateAttachments(input.attachments)
  return { title, text, link, attachments }
}
