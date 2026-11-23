// SQL access for the discussion → draft → approval → sending flow. Everything that touches the
// opportunity/draft/approval/action tables goes through here so the other flow modules stay free of SQL.

import { ApiError } from '../../shared/api'
import { siteLinkFor } from '../../shared/post-format'
import type { PostType, QuickCard } from '../../shared/quick-post'
import type {
  Account,
  Approval,
  Attachment,
  Capability,
  CapabilityKey,
  CapabilityStatus,
  Channel,
  ChannelStatus,
  Comment,
  CommunityNotice,
  CommentCategory,
  Discussion,
  Draft,
  Finding,
  Id,
  Opportunity,
  OpportunityDecision,
  OpportunityKind,
  OpportunitySource,
  OpportunityState,
  PostMarkup,
  SendAction
} from '../../shared/types'
import type { Core } from '../core'
import { newId, toJson, type Db } from '../db/database'
import { mapAccount, mapAction, mapApproval, mapComment, mapDiscussion, mapOpportunity } from '../repos'
import { commentBodyHash } from './hash'
import { isPostTarget, parentOf } from './reply-target'

type Row = Record<string, unknown>
type Bindable = string | number | null

/** An attempt in one of these states blocks every other attempt for the same opportunity. */
export const OPEN_ACTION_STATES = ['sending', 'unknown', 'confirmed'] as const

/** States in which the content is already out or in flight: it can no longer be edited, rejected or re-drafted. */
export const SEND_LOCKED_STATES: OpportunityState[] = ['sending', 'confirmed', 'unknown_result']

/**
 * States in which a login "speaks" in a discussion (DEC-010): it has a draft, an approved item or a message that
 * is out or in flight. Rejected, deferred, failed and not-yet-drafted items do not hold the discussion.
 */
export const SPEAKING_STATES: OpportunityState[] = ['draft', 'awaiting_approval', 'ready', 'sending', 'unknown_result', 'confirmed']

/** Shown wherever a second login of a product is stopped in a discussion another login already speaks in. */
export const OTHER_LOGIN_SPEAKS_REASON = 'Another login of this product already speaks in this discussion'

export interface OpportunityPatch {
  state?: OpportunityState
  reason?: string
  category?: CommentCategory | null
  decision?: OpportunityDecision | null
  destination?: string
  scheduledAt?: string | null
  groupId?: Id | null
  source?: OpportunitySource
}

export interface ChannelPatch {
  status?: ChannelStatus
  statusDetail?: string
  lastRunAt?: string
  lastSuccessAt?: string
  nextCheckAt?: string | null
  baselineDoneAt?: string
  /** When the one-time look-back was made (DEC-040). */
  lookedBackAt?: string
  reads?: boolean
}

export interface DraftContent {
  title: string | null
  text: string
  link: string | null
  attachments: Attachment[]
  /** Left out, the draft is `legacy`: the text is sent as it is written. */
  markup?: PostMarkup
  /** Left out, the draft is an `article` (DEC-046). */
  postType?: PostType
  /** The flair by name; left out or null: none. A replacing draft that leaves it out keeps the earlier draft's (`inheritFlair`). */
  flair?: string | null
  /** The template card of a quick post; left out or null: the picture is not a card. */
  card?: QuickCard | null
}

export interface DraftMeta {
  knowledgeVersionId: Id | null
  usedClaimLineageIds: Id[]
  rationale: string
  author: 'ai' | 'user'
}

export interface OpportunityFilter {
  channelId?: Id
  productId?: Id
  kind?: OpportunityKind
  source?: OpportunitySource
  states?: OpportunityState[]
  /**
   * Leaves out the answers the owner made from a post of the Feed (`finding_id` set). They are decided and sent in the reply window of their post, so they
   * are never a card to decide, a count of what waits, or an item of the Inbox.
   */
  withoutFeedAnswers?: boolean
  limit?: number
}

export class FlowStore {
  constructor(readonly core: Core) {}

  get db(): Db {
    return this.core.db
  }

  now(): string {
    return this.core.clock.now().toISOString()
  }

  /** Tells every connected UI that opportunity-related data (and the attention list built from it) changed. */
  notify(): void {
    this.core.events.changed('opportunities', 'attention')
  }

  // ───────────── lookups ─────────────

  requireOpportunity(id: Id): Opportunity {
    const row = this.db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new ApiError('not_found', `Opportunity not found: ${id}`)
    return mapOpportunity(row)
  }

  requireChannel(id: Id): Channel {
    try {
      return this.core.repos.channel(id)
    } catch {
      throw new ApiError('not_found', `Channel not found: ${id}`)
    }
  }

  opportunityForComment(commentId: Id): Opportunity | null {
    const row = this.db.prepare('SELECT * FROM opportunities WHERE comment_id = ?').get(commentId) as Row | undefined
    return row ? mapOpportunity(row) : null
  }

  /** The one opportunity a new post has (the database keeps it to one), or null. */
  opportunityForPost(discussionId: Id): Opportunity | null {
    const row = this.db.prepare("SELECT * FROM opportunities WHERE discussion_id = ? AND source = 'new_post'").get(discussionId) as Row | undefined
    return row ? mapOpportunity(row) : null
  }

  discussion(id: Id): Discussion | null {
    const row = this.db.prepare('SELECT * FROM discussions WHERE id = ?').get(id) as Row | undefined
    return row ? mapDiscussion(row) : null
  }

  discussionByExternalId(channelId: Id, externalId: string): Discussion | null {
    const row = this.db.prepare('SELECT * FROM discussions WHERE channel_id = ? AND external_id = ?').get(channelId, externalId) as Row | undefined
    return row ? mapDiscussion(row) : null
  }

  /** The post a reply to a new post answers (it has no comment), or null for any other opportunity or a post that is no longer stored. */
  postOf(opp: Opportunity): Discussion | null {
    if (!isPostTarget(opp) || !opp.discussionId) return null
    return this.discussion(opp.discussionId)
  }

  /** The platform id the reply of `opp` is sent under: its comment's, or its post's own (a top-level comment); null when there is nothing to answer. */
  replyParentOf(opp: Opportunity): { externalId: string } | null {
    return parentOf({ comment: opp.commentId ? this.comment(opp.commentId) : null, post: this.postOf(opp) })
  }

  commentByExternalId(channelId: Id, externalId: string): Comment | null {
    const row = this.db.prepare('SELECT * FROM comments WHERE channel_id = ? AND external_id = ?').get(channelId, externalId) as Row | undefined
    return row ? mapComment(row) : null
  }

  comment(id: Id): Comment | null {
    const row = this.db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as Row | undefined
    return row ? mapComment(row) : null
  }

  /** The account's own comment directly under `parentExternalId`, if one is stored. */
  ownReplyUnder(channelId: Id, parentExternalId: string): Comment | null {
    const row = this.db
      .prepare('SELECT * FROM comments WHERE channel_id = ? AND parent_external_id = ? AND is_own = 1 LIMIT 1')
      .get(channelId, parentExternalId) as Row | undefined
    return row ? mapComment(row) : null
  }

  /** Platform ids of replies this application published and confirmed for the account. */
  confirmedExternalIds(accountId: Id): Set<string> {
    const rows = this.db
      .prepare("SELECT result_external_id AS id FROM send_actions WHERE account_id = ? AND state = 'confirmed' AND result_external_id IS NOT NULL")
      .all(accountId) as { id: string }[]
    return new Set(rows.map((r) => r.id))
  }

  /**
   * Every login the product writes with: the accounts it owns (DEC-009), the accounts its channels use (a login
   * reused on purpose is still one of its voices) and `alsoAccountId`. Used to recognise the product's own
   * comments whichever login wrote them (DEC-010).
   */
  productAccounts(productId: Id, alsoAccountId: Id): Account[] {
    const rows = this.db
      .prepare('SELECT * FROM accounts WHERE product_id = ? OR id = ? OR id IN (SELECT account_id FROM channels WHERE product_id = ?)')
      .all(productId, alsoAccountId, productId) as Row[]
    return rows.map(mapAccount)
  }

  /** Platform ids of confirmed sends by any login of the product in the community (platform + target) of `channel`. */
  productConfirmedExternalIds(channel: Channel): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT a.result_external_id AS id
           FROM send_actions a
           JOIN opportunities o ON o.id = a.opportunity_id
           JOIN channels c ON c.id = o.channel_id
          WHERE a.state = 'confirmed' AND a.result_external_id IS NOT NULL
            AND o.product_id = ? AND c.platform = ? AND c.target = ?`
      )
      .all(channel.productId, channel.platform, channel.target) as { id: string }[]
    return new Set(rows.map((r) => r.id))
  }

  /**
   * An opportunity of the same product, on the same platform and in the same discussion (compared by the
   * platform's own discussion id, across channels), written with a DIFFERENT login and in a speaking state.
   * Returns null when nobody else speaks there. Standalone posts are their own discussion and never conflict.
   */
  otherLoginSpeaking(q: { productId: Id; platform: string; discussionExternalId: string; accountId: Id; exceptOpportunityId?: Id }): Opportunity | null {
    const row = this.db
      .prepare(
        `SELECT o.* FROM opportunities o
           JOIN channels c ON c.id = o.channel_id
           JOIN discussions d ON d.id = o.discussion_id
          WHERE o.kind = 'reply' AND o.product_id = ? AND c.platform = ? AND d.external_id = ? AND c.account_id != ?
            AND o.id != ? AND o.state IN (${SPEAKING_STATES.map(() => '?').join(', ')})
          ORDER BY o.updated_at, o.rowid LIMIT 1`
      )
      .get(q.productId, q.platform, q.discussionExternalId, q.accountId, q.exceptOpportunityId ?? '', ...SPEAKING_STATES) as Row | undefined
    return row ? mapOpportunity(row) : null
  }

  /** The same question for an existing opportunity: does another login of its product already speak in its discussion? */
  otherLoginSpeakingFor(opp: Opportunity): Opportunity | null {
    if (opp.kind !== 'reply' || !opp.discussionId) return null
    const channel = this.requireChannel(opp.channelId)
    const discussion = this.db.prepare('SELECT external_id FROM discussions WHERE id = ?').get(opp.discussionId) as { external_id: string } | undefined
    if (!discussion) return null
    return this.otherLoginSpeaking({
      productId: opp.productId,
      platform: channel.platform,
      discussionExternalId: discussion.external_id,
      accountId: channel.accountId,
      exceptOpportunityId: opp.id
    })
  }

  /** Where the content of `opp` is published: the comment's current address for replies, the post's for a reply to a new post, the channel for posts. */
  resolveDestination(opp: Opportunity, channel: Channel): string {
    if (opp.kind === 'reply' && opp.commentId) {
      const comment = this.comment(opp.commentId)
      if (comment?.url) return comment.url
      return opp.destination
    }
    if (isPostTarget(opp)) return this.postOf(opp)?.url || opp.destination
    return channel.url
  }

  list(filter: OpportunityFilter = {}): Opportunity[] {
    const where: string[] = []
    const params: Bindable[] = []
    if (filter.channelId) {
      where.push('channel_id = ?')
      params.push(filter.channelId)
    }
    if (filter.productId) {
      where.push('product_id = ?')
      params.push(filter.productId)
    }
    if (filter.source) {
      where.push('source = ?')
      params.push(filter.source)
    }
    if (filter.kind) {
      where.push('kind = ?')
      params.push(filter.kind)
    }
    if (filter.states && filter.states.length > 0) {
      where.push(`state IN (${filter.states.map(() => '?').join(', ')})`)
      params.push(...filter.states)
    }
    if (filter.withoutFeedAnswers) where.push('finding_id IS NULL')
    const sql = `SELECT * FROM opportunities ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, rowid DESC LIMIT ?`
    return (this.db.prepare(sql).all(...params, filter.limit ?? 300) as Row[]).map(mapOpportunity)
  }

  // ───────────── opportunities ─────────────

  /**
   * Opens the reply opportunity of a comment, unless another login of the product already speaks in its discussion
   * (DEC-010). In that case the opportunity is recorded as cancelled with the reason, so the owner can see why the
   * comment was not worked on and the comment is never picked up again; the log says it too.
   */
  openReplyOpportunity(channel: Channel, comment: Comment, source: OpportunitySource = 'comment'): { opportunity: Opportunity; blocked: boolean } {
    const discussion = this.db.prepare('SELECT external_id FROM discussions WHERE id = ?').get(comment.discussionId) as { external_id: string } | undefined
    const other = discussion
      ? this.otherLoginSpeaking({ productId: channel.productId, platform: channel.platform, discussionExternalId: discussion.external_id, accountId: channel.accountId })
      : null
    if (!other) return { opportunity: this.createReplyOpportunity(channel, comment, 'discovered', '', source), blocked: false }
    this.core.log.info('guard', `${OTHER_LOGIN_SPEAKS_REASON}; no reply opportunity for comment ${comment.externalId} on ${channel.target}`, channel.id)
    return { opportunity: this.createReplyOpportunity(channel, comment, 'cancelled', OTHER_LOGIN_SPEAKS_REASON, source), blocked: true }
  }

  /**
   * Opens the reply opportunity of a new post (source `new_post`), under the same rule as a comment's (DEC-010): when another login of the product already speaks
   * in the discussion, it is recorded as cancelled with the reason, and the post is never picked up again. `why` says what made the post worth a look.
   */
  openPostOpportunity(channel: Channel, post: Discussion, why: string): { opportunity: Opportunity; blocked: boolean } {
    const other = this.otherLoginSpeaking({ productId: channel.productId, platform: channel.platform, discussionExternalId: post.externalId, accountId: channel.accountId })
    if (!other) return { opportunity: this.createPostOpportunity(channel, post, 'discovered', why), blocked: false }
    this.core.log.info('guard', `${OTHER_LOGIN_SPEAKS_REASON}; no reply opportunity for the new post ${post.externalId} on ${channel.target}`, channel.id)
    return { opportunity: this.createPostOpportunity(channel, post, 'cancelled', OTHER_LOGIN_SPEAKS_REASON), blocked: true }
  }

  private createPostOpportunity(channel: Channel, post: Discussion, state: OpportunityState, reason: string): Opportunity {
    return this.insertOpportunity({
      channelId: channel.id,
      productId: channel.productId,
      kind: 'reply',
      source: 'new_post',
      state,
      commentId: null,
      discussionId: post.id,
      destination: post.url,
      reason,
      scheduledAt: null
    })
  }

  createReplyOpportunity(channel: Channel, comment: Comment, state: OpportunityState = 'discovered', reason = '', source: OpportunitySource = 'comment'): Opportunity {
    return this.insertOpportunity({
      channelId: channel.id,
      productId: channel.productId,
      kind: 'reply',
      source,
      state,
      commentId: comment.id,
      discussionId: comment.discussionId,
      destination: comment.url,
      reason,
      scheduledAt: null
    })
  }

  // ───────────── the owner's reply from a post of the Feed ─────────────

  /**
   * The stored record of the post of a finding the owner answers: the gate, the approval and the mission read the post and its comments from these tables, so
   * the owner's own comment goes through exactly the path every reply has. One per finding, made at the first answer; the post's summary is its text.
   */
  findingDiscussion(finding: Finding): Discussion {
    const existing = this.discussionByExternalId(finding.channelId, finding.externalId)
    if (existing) return existing
    const now = this.now()
    this.db
      .prepare(
        `INSERT INTO discussions (id, channel_id, external_id, url, title, author, body, selected, first_seen_at, last_seen_at, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .run(newId(), finding.channelId, finding.externalId, finding.url, finding.title, finding.author, finding.about, now, now, finding.postedAt)
    return this.discussionByExternalId(finding.channelId, finding.externalId) as Discussion
  }

  /**
   * The stored record of one comment of a finding's thread. The thread of a finding is read again and again and its positions move, so the place is the
   * comment itself (its author and text, `fingerprint`), not its position. Not a baseline comment: nothing is ever made of it but the owner's answer.
   */
  findingComment(finding: Finding, discussion: Discussion, comment: { author: string; text: string; url: string }, fingerprint: string): Comment {
    const externalId = `${finding.externalId}#c:${fingerprint}`
    const now = this.now()
    this.db
      .prepare(
        `INSERT INTO comments (id, discussion_id, channel_id, external_id, parent_external_id, author, body, url, posted_at, baseline, is_own, content_hash, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, 0, 0, ?, ?, ?)
         ON CONFLICT (channel_id, external_id) DO UPDATE SET url = CASE WHEN excluded.url <> '' THEN excluded.url ELSE comments.url END, last_seen_at = excluded.last_seen_at`
      )
      .run(newId(), discussion.id, finding.channelId, externalId, comment.author, comment.text, comment.url, commentBodyHash(comment.text), now, now)
    return this.commentByExternalId(finding.channelId, externalId) as Comment
  }

  /** The opportunity of an answer the owner sends from a post of the Feed: to the post (`comment` null) or under one comment of its thread. It starts as a draft. */
  createFindingReply(channel: Channel, finding: Finding, discussion: Discussion, comment: Comment | null, destination: string): Opportunity {
    return this.insertOpportunity({
      channelId: channel.id,
      productId: channel.productId,
      kind: 'reply',
      source: comment ? 'comment' : 'new_post',
      state: 'draft',
      commentId: comment?.id ?? null,
      discussionId: discussion.id,
      destination,
      reason: '',
      scheduledAt: null,
      findingId: finding.id
    })
  }

  /** `groupId`: the post group this is one version of (DEC-032); a post of one channel has none. */
  createStandalone(channel: Channel, state: OpportunityState, reason: string, groupId: Id | null = null): Opportunity {
    return this.insertOpportunity({
      channelId: channel.id,
      productId: channel.productId,
      kind: 'standalone',
      state,
      commentId: null,
      discussionId: null,
      destination: channel.url,
      reason,
      scheduledAt: null,
      groupId
    })
  }

  private insertOpportunity(p: {
    channelId: Id
    productId: Id
    kind: OpportunityKind
    source?: OpportunitySource
    state: OpportunityState
    commentId: Id | null
    discussionId: Id | null
    destination: string
    reason: string
    scheduledAt: string | null
    groupId?: Id | null
    findingId?: Id | null
  }): Opportunity {
    const id = newId()
    const now = this.now()
    this.db
      .prepare(
        `INSERT INTO opportunities (id, channel_id, product_id, kind, source, state, comment_id, discussion_id, category, decision, destination, reason, scheduled_at, group_id, finding_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, p.channelId, p.productId, p.kind, p.source ?? 'comment', p.state, p.commentId, p.discussionId, p.destination, p.reason, p.scheduledAt, p.groupId ?? null, p.findingId ?? null, now, now)
    return this.requireOpportunity(id)
  }

  updateOpportunity(id: Id, patch: OpportunityPatch): void {
    const sets = ['updated_at = ?']
    const values: Bindable[] = [this.now()]
    const add = (column: string, value: Bindable): void => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.state !== undefined) add('state', patch.state)
    if (patch.reason !== undefined) add('reason', patch.reason)
    if (patch.category !== undefined) add('category', patch.category)
    if (patch.decision !== undefined) add('decision', patch.decision)
    if (patch.destination !== undefined) add('destination', patch.destination)
    if (patch.scheduledAt !== undefined) add('scheduled_at', patch.scheduledAt)
    if (patch.groupId !== undefined) add('group_id', patch.groupId)
    if (patch.source !== undefined) add('source', patch.source)
    this.db.prepare(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  }

  /**
   * Moves an opportunity from one of `from` to `to` in a single statement; returns false when another caller
   * already changed it. This is how two concurrent processors avoid working on the same opportunity.
   */
  transition(id: Id, from: OpportunityState[], to: OpportunityState, reason = ''): boolean {
    const info = this.db
      .prepare(`UPDATE opportunities SET state = ?, reason = ?, updated_at = ? WHERE id = ? AND state IN (${from.map(() => '?').join(', ')})`)
      .run(to, reason, this.now(), id, ...from)
    return info.changes === 1
  }

  /** The state a changed or failed item returns to so the owner looks at it again. */
  reviewState(opp: Opportunity, channel: Channel): OpportunityState {
    if (opp.kind === 'standalone') return 'draft'
    return channel.mode === 'draft' ? 'draft' : 'awaiting_approval'
  }

  updateChannel(id: Id, patch: ChannelPatch): void {
    const sets: string[] = []
    const values: Bindable[] = []
    const add = (column: string, value: Bindable): void => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.status !== undefined) add('status', patch.status)
    if (patch.statusDetail !== undefined) add('status_detail', patch.statusDetail)
    if (patch.lastRunAt !== undefined) add('last_run_at', patch.lastRunAt)
    if (patch.lastSuccessAt !== undefined) add('last_success_at', patch.lastSuccessAt)
    if (patch.nextCheckAt !== undefined) add('next_check_at', patch.nextCheckAt)
    if (patch.baselineDoneAt !== undefined) add('baseline_done_at', patch.baselineDoneAt)
    if (patch.lookedBackAt !== undefined) add('looked_back_at', patch.lookedBackAt)
    if (patch.reads !== undefined) add('reads', patch.reads ? 1 : 0)
    if (sets.length === 0) return
    this.db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    this.core.events.changed('channels')
  }

  // ───────────── the account inbox (DEC-039) ─────────────

  /** Whether the account's inbox was read for this channel before: the first read is the baseline and queues nothing. */
  inboxBaselineDone(channelId: Id): boolean {
    const row = this.db.prepare('SELECT inbox_baseline_done_at AS at FROM channels WHERE id = ?').get(channelId) as { at: string | null } | undefined
    return row?.at != null
  }

  markInboxBaselineDone(channelId: Id): void {
    this.db.prepare('UPDATE channels SET inbox_baseline_done_at = ? WHERE id = ? AND inbox_baseline_done_at IS NULL').run(this.now(), channelId)
  }

  /**
   * Records what the last read of the inbox found out about it in the capability row of the channel, so the Status tab says why replies and mentions are
   * (not) collected. Written only when the answer changed, so a quiet channel does not stir the screen on every check.
   */
  noteCapability(channelId: Id, key: CapabilityKey, status: CapabilityStatus, detail: string): void {
    const row = this.db.prepare('SELECT capabilities_json AS json FROM channels WHERE id = ?').get(channelId) as { json: string } | undefined
    if (!row) return
    let current: Capability[] = []
    try {
      const parsed: unknown = JSON.parse(row.json)
      if (Array.isArray(parsed)) current = parsed as Capability[]
    } catch {
      current = []
    }
    const had = current.find((c) => c.key === key)
    if (had && had.status === status && had.detail === detail) return
    const next: Capability = { key, status, detail, checkedAt: this.now() }
    const rows = had ? current.map((c) => (c.key === key ? next : c)) : [...current, next]
    this.db.prepare('UPDATE channels SET capabilities_json = ? WHERE id = ?').run(toJson(rows), channelId)
    this.core.events.changed('channels')
  }

  // ───────────── drafts and approvals ─────────────

  /**
   * The first draft of a new post of the owner's ends with the product's site (DEC-044), unless it has a link already or the product keeps the
   * setting off. Only the first draft: a later one is the owner's edit (or the AI's rewrite of the words), and a link they took out stays out.
   * A reply never gets it, and neither does a platform with a link field (`siteLinkFor`).
   */
  private withSiteLink(opportunityId: Id, content: DraftContent): DraftContent {
    if (content.link && content.link.trim() !== '') return content
    if (this.db.prepare('SELECT 1 FROM drafts WHERE opportunity_id = ? LIMIT 1').get(opportunityId)) return content
    const opp = this.requireOpportunity(opportunityId)
    if (opp.kind !== 'standalone') return content
    const link = siteLinkFor(this.requireChannel(opp.channelId).platform, this.core.repos.product(opp.productId))
    return link ? { ...content, link } : content
  }

  insertDraft(opportunityId: Id, draftContent: DraftContent, meta: DraftMeta): Draft {
    const content = this.withSiteLink(opportunityId, draftContent)
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO drafts (id, opportunity_id, title, text, link, attachments_json, markup, post_type, card_json, knowledge_version_id, used_claims_json, rationale, author, created_at, flair)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        opportunityId,
        content.title,
        content.text,
        content.link,
        toJson(content.attachments),
        content.markup ?? 'legacy',
        content.postType === 'quick' ? 'quick' : 'article',
        content.postType === 'quick' && content.card ? toJson(content.card) : null,
        meta.knowledgeVersionId,
        toJson(meta.usedClaimLineageIds),
        meta.rationale,
        meta.author,
        this.now(),
        content.flair ? content.flair : null
      )
    return this.core.repos.draft(id)
  }

  /** `identity` is who was signed in to the account when the hash was computed; it is part of what the hash binds. */
  insertApproval(p: {
    draftId: Id
    contentHash: string
    accountId: Id
    identity: string | null
    destination: string
    approvedBy: Approval['approvedBy']
    ruleId: string | null
  }): Approval {
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO approvals (id, draft_id, content_hash, account_id, signed_in_identity, destination, approved_by, rule_id, approved_at, invalidated_at, invalid_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(id, p.draftId, p.contentHash, p.accountId, p.identity, p.destination, p.approvedBy, p.ruleId, this.now())
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row
    return mapApproval(row)
  }

  /** The identity the approval was given under (null when none was known). The shared Approval type does not carry it. */
  approvalIdentity(approvalId: Id): string | null {
    const row = this.db.prepare('SELECT signed_in_identity AS identity FROM approvals WHERE id = ?').get(approvalId) as { identity: string | null } | undefined
    return row?.identity ?? null
  }

  /** Whether another confirmed send of this account already recorded that platform object as its result. */
  externalIdUsed(externalId: string, accountId: Id, exceptActionId: Id): boolean {
    return (
      this.db.prepare("SELECT 1 FROM send_actions WHERE state = 'confirmed' AND result_external_id = ? AND account_id = ? AND id != ? LIMIT 1").get(externalId, accountId, exceptActionId) !== undefined
    )
  }

  /** Invalidates every still-valid approval of any draft of the opportunity. Returns how many were invalidated. */
  invalidateApprovals(opportunityId: Id, reason: string): number {
    return this.db
      .prepare(
        `UPDATE approvals SET invalidated_at = ?, invalid_reason = ?
         WHERE invalidated_at IS NULL AND draft_id IN (SELECT id FROM drafts WHERE opportunity_id = ?)`
      )
      .run(this.now(), reason, opportunityId).changes
  }

  // ───────────── send actions ─────────────

  openAction(opportunityId: Id): SendAction | null {
    const row = this.db
      .prepare(`SELECT * FROM send_actions WHERE opportunity_id = ? AND state IN (${OPEN_ACTION_STATES.map(() => '?').join(', ')}) ORDER BY attempted_at DESC, rowid DESC LIMIT 1`)
      .get(opportunityId, ...OPEN_ACTION_STATES) as Row | undefined
    return row ? mapAction(row) : null
  }

  /**
   * Attempts of the account (all its channels together) that count against its limits since `sinceIso`. `exceptActionId` leaves out the
   * attempt that is asking: a send in progress must not be counted against itself when its ticket is renewed.
   */
  countActions(accountId: Id, sinceIso: string, exceptActionId?: Id): { count: number; oldest: string | null } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c, MIN(attempted_at) AS oldest FROM send_actions
         WHERE account_id = ? AND state IN (${OPEN_ACTION_STATES.map(() => '?').join(', ')}) AND attempted_at > ? AND id != ?`
      )
      .get(accountId, ...OPEN_ACTION_STATES, sinceIso, exceptActionId ?? '') as { c: number; oldest: string | null }
    return { count: row.c, oldest: row.oldest }
  }

  unknownActions(): SendAction[] {
    return (this.db.prepare("SELECT * FROM send_actions WHERE state = 'unknown' ORDER BY attempted_at, rowid").all() as Row[]).map(mapAction)
  }

  /** Confirmed sends that carry the platform's own id and were completed at or after `sinceIso`: the posts that may still be looked at again. */
  standingCandidates(sinceIso: string): SendAction[] {
    return (this.db.prepare("SELECT * FROM send_actions WHERE state = 'confirmed' AND result_external_id IS NOT NULL AND completed_at >= ? ORDER BY completed_at, rowid").all(sinceIso) as Row[]).map(mapAction)
  }

  /**
   * What the platform said when the post was looked at again, and when, with the community's own words under a removed post. A look that could not
   * tell keeps the standing it had and moves only the time.
   */
  saveStanding(actionId: Id, standing: SendAction['standing'], note: string | null, notice: CommunityNotice | null, checkedAt: string): void {
    this.db
      .prepare('UPDATE send_actions SET standing = ?, standing_note = ?, standing_notice = ?, standing_notice_by = ?, standing_checked_at = ? WHERE id = ?')
      .run(standing, note, notice?.text ?? null, notice?.by ?? null, checkedAt, actionId)
  }

  sendingActions(): SendAction[] {
    return (this.db.prepare("SELECT * FROM send_actions WHERE state = 'sending' ORDER BY attempted_at, rowid").all() as Row[]).map(mapAction)
  }
}
