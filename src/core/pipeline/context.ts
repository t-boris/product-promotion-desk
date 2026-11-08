// Builds the context an AI draft is prepared from (REQ-003 criterion 2): the original post, the comment, the
// parent chain, the account's earlier replies, the approved product knowledge and the channel rules.

import type { Channel, Claim, Id, Opportunity } from '../../shared/types'
import type { Core } from '../core'
import type { FlowStore } from './store'

export interface ContextComment {
  author: string
  body: string
  own: boolean
  postedAt: string | null
}

/** An approved fact as the AI sees it. `id` is what the AI cites back in usedClaimIds. */
export interface ClaimView {
  id: Id
  lineageId: Id
  text: string
  section: string
  unconfirmedAvailability: boolean
}

export interface ProductView {
  name: string
  website: string | null
  description: string | null
}

export interface ChannelView {
  platform: string
  target: string
  languages: string[]
  style: string
  topics: string[]
  /** Capabilities that are not usable, so the AI does not promise what the channel cannot do. */
  limits: string[]
}

export interface Knowledge {
  versionId: Id | null
  approved: ClaimView[]
  prohibited: string[]
}

export interface ReplyContext {
  channel: ChannelView
  product: ProductView
  discussion: { title: string; author: string; body: string; url: string }
  comment: { id: Id; externalId: string; author: string; body: string; url: string; contentHash: string }
  /** Oldest first, ending with the comment's direct parent. */
  ancestors: ContextComment[]
  /** The account's own earlier comments in this discussion. */
  ownReplies: ContextComment[]
  knowledge: Knowledge
}

const MAX_ANCESTORS = 8
const MAX_OWN_REPLIES = 5
const MAX_BODY_CHARS = 2000

export class ContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextError'
  }
}

const clip = (text: string): string => (text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text)

export function claimView(claim: Claim): ClaimView {
  return {
    id: claim.id,
    lineageId: claim.lineageId,
    text: claim.text,
    section: claim.section,
    unconfirmedAvailability: claim.unconfirmedAvailability
  }
}

/** Approved facts and prohibited statements for the product; empty when the passports module is not available. */
export function loadKnowledge(core: Core, productId: Id): Knowledge {
  const provider = core.services.knowledge
  if (!provider) return { versionId: null, approved: [], prohibited: [] }
  return {
    versionId: provider.activeVersionId(productId),
    // Only approved facts may be stated; assumptions, unknowns and contradictions are never usable as facts.
    approved: provider
      .approvedClaims(productId)
      .filter((c) => c.status === 'approved' && c.kind === 'fact')
      .map(claimView),
    prohibited: provider.prohibitedClaims(productId).map((c) => c.text)
  }
}

export function channelView(channel: Channel): ChannelView {
  return {
    platform: channel.platform,
    target: channel.target,
    languages: channel.settings.languages,
    style: channel.settings.style,
    topics: channel.settings.topics,
    limits: channel.capabilities
      .filter((c) => c.status === 'unavailable' || c.status === 'restricted' || c.status === 'needs_user')
      .map((c) => `${c.key}: ${c.status}${c.detail ? ` (${c.detail})` : ''}`)
  }
}

export function buildReplyContext(core: Core, store: FlowStore, opp: Opportunity): ReplyContext {
  if (!opp.commentId) throw new ContextError('The opportunity has no comment to reply to')
  const comment = store.comment(opp.commentId)
  if (!comment) throw new ContextError('The comment is no longer stored')
  const channel = store.requireChannel(opp.channelId)
  const discussion = core.repos.discussion(comment.discussionId)
  const product = core.repos.product(opp.productId)

  // Walk up the parent links stored from earlier reads; the chain ends at the post itself (not a stored comment).
  const ancestors: ContextComment[] = []
  const seen = new Set<string>([comment.externalId])
  let parentId = comment.parentExternalId
  while (parentId && ancestors.length < MAX_ANCESTORS && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = store.commentByExternalId(channel.id, parentId)
    if (!parent) break
    ancestors.unshift({ author: parent.author, body: clip(parent.body), own: parent.isOwn, postedAt: parent.postedAt })
    parentId = parent.parentExternalId
  }

  const ownRows = core.db
    .prepare('SELECT * FROM comments WHERE discussion_id = ? AND is_own = 1 ORDER BY COALESCE(posted_at, first_seen_at) DESC LIMIT ?')
    .all(comment.discussionId, MAX_OWN_REPLIES) as Record<string, unknown>[]
  const ownReplies: ContextComment[] = ownRows
    .map((r) => ({ author: r.author as string, body: clip(r.body as string), own: true, postedAt: (r.posted_at as string | null) ?? null }))
    .reverse()

  return {
    channel: channelView(channel),
    product: { name: product.name, website: product.websiteUrl, description: product.description },
    discussion: { title: discussion.title, author: discussion.author, body: clip(discussion.body), url: discussion.url },
    comment: { id: comment.id, externalId: comment.externalId, author: comment.author, body: clip(comment.body), url: comment.url, contentHash: comment.contentHash },
    ancestors,
    ownReplies,
    knowledge: loadKnowledge(core, opp.productId)
  }
}
