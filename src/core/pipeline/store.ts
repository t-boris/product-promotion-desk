// SQL access for the discussion → draft → approval → sending flow. Everything that touches the
// opportunity/draft/approval/action tables goes through here so the other flow modules stay free of SQL.

import { ApiError } from '../../shared/api'
import type {
  Approval,
  Attachment,
  Channel,
  ChannelStatus,
  Comment,
  CommentCategory,
  Draft,
  Id,
  Opportunity,
  OpportunityDecision,
  OpportunityKind,
  OpportunityState,
  SendAction
} from '../../shared/types'
import type { Core } from '../core'
import { newId, toJson, type Db } from '../db/database'
import { mapAction, mapApproval, mapComment, mapOpportunity } from '../repos'

type Row = Record<string, unknown>
type Bindable = string | number | null

/** An attempt in one of these states blocks every other attempt for the same opportunity. */
export const OPEN_ACTION_STATES = ['sending', 'unknown', 'confirmed'] as const

/** States in which the content is already out or in flight: it can no longer be edited, rejected or re-drafted. */
export const SEND_LOCKED_STATES: OpportunityState[] = ['sending', 'confirmed', 'unknown_result']

export interface OpportunityPatch {
  state?: OpportunityState
  reason?: string
  category?: CommentCategory | null
  decision?: OpportunityDecision | null
  destination?: string
  scheduledAt?: string | null
}

export interface ChannelPatch {
  status?: ChannelStatus
  statusDetail?: string
  lastRunAt?: string
  lastSuccessAt?: string
  nextCheckAt?: string | null
  baselineDoneAt?: string
}

export interface DraftContent {
  title: string | null
  text: string
  link: string | null
  attachments: Attachment[]
}

export interface DraftMeta {
  knowledgeVersionId: Id | null
  usedClaimLineageIds: Id[]
  rationale: string
  author: 'ai' | 'user'
}

export interface OpportunityFilter {
  channelId?: Id
  kind?: OpportunityKind
  states?: OpportunityState[]
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

  /** Where the content of `opp` is published: the comment's current address for replies, the channel for posts. */
  resolveDestination(opp: Opportunity, channel: Channel): string {
    if (opp.kind === 'reply' && opp.commentId) {
      const comment = this.comment(opp.commentId)
      if (comment?.url) return comment.url
      return opp.destination
    }
    return channel.url
  }

  list(filter: OpportunityFilter = {}): Opportunity[] {
    const where: string[] = []
    const params: Bindable[] = []
    if (filter.channelId) {
      where.push('channel_id = ?')
      params.push(filter.channelId)
    }
    if (filter.kind) {
      where.push('kind = ?')
      params.push(filter.kind)
    }
    if (filter.states && filter.states.length > 0) {
      where.push(`state IN (${filter.states.map(() => '?').join(', ')})`)
      params.push(...filter.states)
    }
    const sql = `SELECT * FROM opportunities ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC, rowid DESC LIMIT ?`
    return (this.db.prepare(sql).all(...params, filter.limit ?? 300) as Row[]).map(mapOpportunity)
  }

  // ───────────── opportunities ─────────────

  createReplyOpportunity(channel: Channel, comment: Comment, state: OpportunityState = 'discovered', reason = ''): Opportunity {
    return this.insertOpportunity({
      channelId: channel.id,
      productId: channel.productId,
      kind: 'reply',
      state,
      commentId: comment.id,
      discussionId: comment.discussionId,
      destination: comment.url,
      reason,
      scheduledAt: null
    })
  }

  createStandalone(channel: Channel, state: OpportunityState, reason: string): Opportunity {
    return this.insertOpportunity({
      channelId: channel.id,
      productId: channel.productId,
      kind: 'standalone',
      state,
      commentId: null,
      discussionId: null,
      destination: channel.url,
      reason,
      scheduledAt: null
    })
  }

  private insertOpportunity(p: {
    channelId: Id
    productId: Id
    kind: OpportunityKind
    state: OpportunityState
    commentId: Id | null
    discussionId: Id | null
    destination: string
    reason: string
    scheduledAt: string | null
  }): Opportunity {
    const id = newId()
    const now = this.now()
    this.db
      .prepare(
        `INSERT INTO opportunities (id, channel_id, product_id, kind, state, comment_id, discussion_id, category, decision, destination, reason, scheduled_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)`
      )
      .run(id, p.channelId, p.productId, p.kind, p.state, p.commentId, p.discussionId, p.destination, p.reason, p.scheduledAt, now, now)
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
    if (sets.length === 0) return
    this.db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    this.core.events.changed('channels')
  }

  // ───────────── drafts and approvals ─────────────

  insertDraft(opportunityId: Id, content: DraftContent, meta: DraftMeta): Draft {
    const id = newId()
    this.db
      .prepare(
        `INSERT INTO drafts (id, opportunity_id, title, text, link, attachments_json, knowledge_version_id, used_claims_json, rationale, author, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        opportunityId,
        content.title,
        content.text,
        content.link,
        toJson(content.attachments),
        meta.knowledgeVersionId,
        toJson(meta.usedClaimLineageIds),
        meta.rationale,
        meta.author,
        this.now()
      )
    return this.core.repos.draft(id)
  }

  /** `identity` is who was signed in to the account when the hash was computed; it is part of what the hash binds. */
  insertApproval(p: { draftId: Id; contentHash: string; accountId: Id; identity: string | null; destination: string; approvedBy: Approval['approvedBy']; ruleId: string | null }): Approval {
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

  /** Attempts of the account (all its channels together) that count against its limits since `sinceIso`. */
  countActions(accountId: Id, sinceIso: string): { count: number; oldest: string | null } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c, MIN(attempted_at) AS oldest FROM send_actions
         WHERE account_id = ? AND state IN (${OPEN_ACTION_STATES.map(() => '?').join(', ')}) AND attempted_at > ?`
      )
      .get(accountId, ...OPEN_ACTION_STATES, sinceIso) as { c: number; oldest: string | null }
    return { count: row.c, oldest: row.oldest }
  }

  unknownActions(): SendAction[] {
    return (this.db.prepare("SELECT * FROM send_actions WHERE state = 'unknown' ORDER BY attempted_at, rowid").all() as Row[]).map(mapAction)
  }

  sendingActions(): SendAction[] {
    return (this.db.prepare("SELECT * FROM send_actions WHERE state = 'sending' ORDER BY attempted_at, rowid").all() as Row[]).map(mapAction)
  }
}
