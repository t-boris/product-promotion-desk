// What a platform refuses about the picture of a quick post, read at the approval, at the send and in the group view (REQ-006). The rules are
// the pure table of `shared/post-pictures.ts`; this reads the facts of a draft's picture from the library row the picture IS (its type, bytes and
// pixels were measured when it was added and the file never changes: the gate checks the hash again at every send), so no file is read here.

import { pictureProblems, type PictureFacts } from '../../shared/post-pictures'
import type { Attachment } from '../../shared/types'
import type { Core } from '../core'

/** What is known of an attachment: the library row when there is one, else only the type the draft recorded. */
export function pictureFactsOf(core: Core, attachment: Attachment): PictureFacts {
  const item = attachment.mediaId ? core.services.media?.store.get(attachment.mediaId) : null
  if (item) return { mime: item.mime, bytes: item.bytes, width: item.width, height: item.height }
  return { mime: attachment.mime, bytes: null, width: null, height: null }
}

/** What the platform refuses about the pictures of the post, in words; empty when it takes them all. */
export function pictureFitProblems(core: Core, platform: string, attachments: Attachment[]): string[] {
  return attachments.flatMap((attachment) => pictureProblems(platform, pictureFactsOf(core, attachment)))
}
