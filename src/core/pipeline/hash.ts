// Content hashing for approval binding (REQ-004 criterion 1) and for detecting edited comments.

import { RENDER_VERSION, linkPlacementOf } from '../../shared/post-format'
import type { Attachment, Id, PostMarkup } from '../../shared/types'
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
  /** Only `markdown` enters the hash: every approval given before the post editor keeps its hash (the version is raised when a rule changes what a platform receives). */
  markup?: PostMarkup
  /** The flair by name; part of the hash only when set, so every approval given before flairs keeps its hash. */
  flair?: string | null
  /** The topic of the post (Threads); part of the hash only when set, so every approval given before topics keeps its hash. */
  topicTag?: string | null
  /** The form the post's video goes out in (a Reel); part of the hash only when set, so every approval given before the choice keeps its hash. */
  videoAs?: string | null
}

/**
 * The hash an approval is bound to: title, text, link, attachments (name + content hash), the account that
 * will publish, who is signed in to it, and the destination. Changing any of them yields a different hash, so
 * an approval can never be reused for other content, another account, another identity behind the same
 * account (a re-login as someone else) or another place. `platform` is the platform of the channel: where a link goes on it (in the text, or
 * left out, DEC-036) is bound too, so a draft approved before that rule is approved again; for a platform with a link field it adds nothing.
 */
export function contentHash(content: HashableContent, account: HashedAccount, destination: string, platform: string): string {
  return sha256(
    JSON.stringify({
      v: 2,
      title: content.title ? content.title : null,
      text: content.text,
      link: content.link ? content.link : null,
      attachments: content.attachments.map((a) => ({ name: a.name, sha256: a.sha256 })),
      // A key that is not set is left out by JSON.stringify, so a legacy draft hashes exactly as it did before markup existed (DEC-030).
      markup: content.markup === 'markdown' ? `markdown:${RENDER_VERSION}` : undefined,
      // Left out of the hash (as `markup` is) unless the link is placed by a rule, so every hash given before stays as it was.
      linkPlacement: linkPlacementOf(platform, content.link) ?? undefined,
      flair: content.flair ? content.flair : undefined,
      topicTag: content.topicTag ? content.topicTag : undefined,
      videoAs: content.videoAs ? content.videoAs : undefined,
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
