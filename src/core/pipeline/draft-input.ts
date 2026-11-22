// Validation and normalization of user-supplied draft content. What is stored here is exactly what the
// approval hash covers, so it is normalized once (surrounding whitespace trimmed) and never again.
//
// Pictures (DEC-030): every attachment of a draft is a picture of the product's library, a file in the data folder that never changes. A file
// given by its path (an API call, an older client) is added to the library first, so what is approved cannot be moved, edited or deleted behind
// the approval. A text written in the post editor (`markdown`) may place pictures in it, `![alt](media:<id>)`; each must be one the draft carries.

import { ApiError } from '../../shared/api'
import type { DraftInput } from '../../shared/api'
import { kindsOf, pictureIdsIn } from '../../shared/post-format'
import { parseQuickCard, type PostType, type QuickCard } from '../../shared/quick-post'
import type { Attachment, Id } from '../../shared/types'
import type { MediaService } from '../media/service'
import { ATTACHMENT_MAX_COUNT, validateAttachments } from './attachments'
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

/** The ids of the pictures placed in a markdown text, in the order of their first appearance. */
export function inlineMediaIds(text: string): Id[] {
  return pictureIdsIn(text)
}

/** The pictures placed in the text come first, in the order they appear; the others keep the order they were given in. */
function orderAttachments(text: string, attachments: Attachment[]): Attachment[] {
  const placed = inlineMediaIds(text)
  const first = placed.map((id) => attachments.find((a) => a.mediaId === id)).filter((a): a is Attachment => a !== undefined)
  return [...first, ...attachments.filter((a) => !first.includes(a))]
}

export interface DraftInputContext {
  /** The product the draft is for: its library holds the draft's pictures. */
  productId: Id
  media: MediaService
}

export async function normalizeDraftInput(input: DraftInput, ctx: DraftInputContext): Promise<DraftContent> {
  const text = (input.text ?? '').trim()
  const title = (input.title ?? '').trim() || null
  const link = (input.link ?? '').trim() || null
  if (input.postType !== undefined && input.postType !== 'article' && input.postType !== 'quick') throw new ApiError('invalid_input', 'The post type must be "article" or "quick".')
  const postType: PostType | undefined = input.postType
  // A quick post is a caption and one picture, with no title and no marks of its own: the caption is sent as it is written (DEC-046).
  const markup = postType === 'quick' ? 'legacy' : input.markup === 'markdown' ? 'markdown' : 'legacy'
  if (postType === 'quick' && title) throw new ApiError('invalid_input', 'A quick post has no title: the caption is the text.')
  if (input.card !== undefined && input.card !== null && postType !== 'quick') throw new ApiError('invalid_input', 'Card parameters belong to a quick post.')
  let card: QuickCard | null | undefined
  if (input.card === undefined) card = undefined
  else if (input.card === null) card = null
  else {
    card = parseQuickCard(input.card)
    if (!card) throw new ApiError('invalid_input', 'The card parameters are not valid (style, colour, shape and a headline of at most 140 characters).')
  }
  if (text.length > MAX_TEXT_LENGTH) throw new ApiError('invalid_input', `The text is longer than ${MAX_TEXT_LENGTH} characters.`)
  if (title && title.length > MAX_TITLE_LENGTH) throw new ApiError('invalid_input', `The title is longer than ${MAX_TITLE_LENGTH} characters.`)
  if (link && !isHttpUrl(link)) throw new ApiError('invalid_input', 'The link must be a full http(s) address.')
  if ((input.attachments?.length ?? 0) > ATTACHMENT_MAX_COUNT) throw new ApiError('invalid_attachment', `At most ${ATTACHMENT_MAX_COUNT} attachments are allowed.`)

  const kept: Attachment[] = []
  for (const attachment of input.attachments ?? []) {
    const item = attachment.mediaId ? ctx.media.store.get(attachment.mediaId) : null
    if (attachment.mediaId && (!item || item.productId !== ctx.productId)) throw new ApiError('invalid_attachment', `Attachment "${attachment.name || attachment.mediaId}": the picture is not in this product's library.`)
    const picture = item ?? (await ctx.media.addFile(ctx.productId, attachment.path, attachment.name || attachment.path.split('/').pop() || 'picture', 'picked', ''))
    if (attachment.mime && attachment.mime !== picture.mime) throw new ApiError('invalid_attachment', `Attachment "${attachment.name || picture.name}": declared type ${attachment.mime} does not match a ${picture.mime} file.`)
    if (kept.some((a) => a.mediaId === picture.id)) continue
    kept.push({ name: picture.name, path: picture.path, mime: picture.mime, sha256: picture.sha256, mediaId: picture.id })
  }
  // The file is read again here, so a picture that vanished or changed since it was added is refused now, not at the send.
  const checked = await validateAttachments(kept.map(({ mediaId: _id, ...rest }) => rest))
  const attachments = checked.map((a, i) => ({ ...a, mediaId: kept[i].mediaId }))

  if (!text && !title && !link && attachments.length === 0) throw new ApiError('invalid_input', 'The draft is empty: write some text or add a picture or a video.')
  if (markup === 'markdown') {
    for (const id of inlineMediaIds(text)) {
      if (!attachments.some((a) => a.mediaId === id)) throw new ApiError('invalid_input', 'A picture in the text is not one of the draft\'s pictures. Add it again from the library, or take it out of the text.')
    }
  }
  const content: DraftContent = { title, text, link, attachments: markup === 'markdown' ? orderAttachments(text, attachments) : attachments, markup }
  if (postType !== undefined) content.postType = postType
  if (card !== undefined) content.card = card
  if (postType === 'quick') assertQuickPost(content)
  return content
}

/**
 * What makes a draft a quick post (DEC-046): exactly one picture, no title, and no marks of its own. Stated once, so the first save, an edit that
 * keeps the type and a group's versions all hold to it.
 */
export function assertQuickPost(content: DraftContent): void {
  if (content.title) throw new ApiError('invalid_input', 'A quick post has no title: the caption is the text.')
  if (content.attachments.length !== 1 || kindsOf(content.attachments).videos > 0) throw new ApiError('invalid_input', 'A quick post is one picture and a caption: it needs exactly one picture, and a video cannot be one.')
}

/**
 * A draft that replaces another keeps its post type and card unless the caller says otherwise (editing never changes the type, DEC-046). The type
 * stored is always explicit; this only chooses it when the input did not.
 */
export function inheritPostType(content: DraftContent, previous: { postType: PostType; card: QuickCard | null } | null): DraftContent {
  const postType = content.postType ?? previous?.postType ?? 'article'
  const next: DraftContent = { ...content, postType }
  if (postType === 'quick') {
    next.markup = 'legacy'
    if (content.card === undefined) next.card = previous?.postType === 'quick' ? previous.card : null
    assertQuickPost(next)
  } else next.card = null
  return next
}
