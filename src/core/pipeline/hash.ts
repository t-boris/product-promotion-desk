// Content hashing for approval binding (REQ-004 criterion 1) and for detecting edited comments.

import type { Attachment, Id } from '../../shared/types'
import { sha256 } from './util'

export interface HashableContent {
  title: string | null
  text: string
  link: string | null
  attachments: Pick<Attachment, 'name' | 'sha256'>[]
}

/**
 * The hash an approval is bound to: title, text, link, attachments (name + content hash), the account that
 * will publish and the destination. Changing any of them yields a different hash, so an approval can never
 * be reused for other content, another account or another place.
 */
export function contentHash(content: HashableContent, accountId: Id, destination: string): string {
  return sha256(
    JSON.stringify({
      v: 1,
      title: content.title ? content.title : null,
      text: content.text,
      link: content.link ? content.link : null,
      attachments: content.attachments.map((a) => ({ name: a.name, sha256: a.sha256 })),
      accountId,
      destination
    })
  )
}

/** Hash of a comment body; line-ending and surrounding-whitespace noise between page views is ignored. */
export function commentBodyHash(body: string): string {
  return sha256(body.replace(/\r\n?/g, '\n').trim())
}
