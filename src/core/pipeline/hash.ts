// Content hashing for approval binding (REQ-004 criterion 1) and for detecting edited comments.

import type { Attachment, Id } from '../../shared/types'
import { normalizeIdentity, sha256 } from './util'

/** The account an approval is bound to: its id AND who is signed in to it right now (null when unknown). */
export interface HashedAccount {
  id: Id
  identity: string | null
}

/** The identity as it enters the hash: decoration-insensitive ("u/Brand" equals "brand"), null when unknown. */
export const hashedIdentity = (identity: string | null | undefined): string | null => {
  const normalized = normalizeIdentity(identity)
  return normalized === '' ? null : normalized
}

export interface HashableContent {
  title: string | null
  text: string
  link: string | null
  attachments: Pick<Attachment, 'name' | 'sha256'>[]
}

/**
 * The hash an approval is bound to: title, text, link, attachments (name + content hash), the account that
 * will publish, who is signed in to it, and the destination. Changing any of them yields a different hash, so
 * an approval can never be reused for other content, another account, another identity behind the same
 * account (a re-login as someone else) or another place.
 */
export function contentHash(content: HashableContent, account: HashedAccount, destination: string): string {
  return sha256(
    JSON.stringify({
      v: 2,
      title: content.title ? content.title : null,
      text: content.text,
      link: content.link ? content.link : null,
      attachments: content.attachments.map((a) => ({ name: a.name, sha256: a.sha256 })),
      accountId: account.id,
      identity: hashedIdentity(account.identity),
      destination
    })
  )
}

/** Hash of a comment body; line-ending and surrounding-whitespace noise between page views is ignored. */
export function commentBodyHash(body: string): string {
  return sha256(body.replace(/\r\n?/g, '\n').trim())
}
