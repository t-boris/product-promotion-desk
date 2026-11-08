// Row mappers and basic lookups shared by all core modules. Modules add their own queries on top.

import type {
  Account,
  Approval,
  Capability,
  Channel,
  ChannelSettings,
  Claim,
  Comment,
  Discussion,
  Draft,
  Opportunity,
  PassportVersion,
  Product,
  Run,
  SendAction
} from '../shared/types'
import { DEFAULT_CHANNEL_SETTINGS } from '../shared/types'
import { parseJson, type Db } from './db/database'

type Row = Record<string, unknown>

export const mapProduct = (r: Row): Product => ({
  id: r.id as string,
  name: r.name as string,
  websiteUrl: (r.website_url as string | null) ?? null,
  description: (r.description as string | null) ?? null,
  goal: parseJson(r.goal_json as string | null, null),
  activePassportVersionId: (r.active_passport_version_id as string | null) ?? null,
  analysisStatus: r.analysis_status as Product['analysisStatus'],
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})

export const mapPassportVersion = (r: Row): PassportVersion => ({
  id: r.id as string,
  productId: r.product_id as string,
  version: r.version as number,
  status: r.status as PassportVersion['status'],
  createdAt: r.created_at as string,
  approvedAt: (r.approved_at as string | null) ?? null
})

export const mapClaim = (r: Row): Claim => ({
  id: r.id as string,
  lineageId: r.lineage_id as string,
  passportVersionId: r.passport_version_id as string,
  section: r.section as Claim['section'],
  text: r.text as string,
  kind: r.kind as Claim['kind'],
  status: r.status as Claim['status'],
  sources: parseJson(r.sources_json as string, []),
  verifiedAt: (r.verified_at as string | null) ?? null,
  unconfirmedAvailability: r.unconfirmed_availability === 1,
  conflictsWith: parseJson(r.conflicts_json as string, []),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})

export const mapAccount = (r: Row): Account => ({
  id: r.id as string,
  platform: r.platform as string,
  label: r.label as string,
  identity: (r.identity as string | null) ?? null,
  partition: r.partition as string,
  status: r.status as Account['status'],
  createdAt: r.created_at as string,
  // accounts.product_id is added by the channels migration (DEC-009); null means unassigned.
  productId: (r.product_id as string | null | undefined) ?? null
})

export const mapChannel = (r: Row): Channel => ({
  id: r.id as string,
  productId: r.product_id as string,
  accountId: r.account_id as string,
  platform: r.platform as string,
  connectorId: r.connector_id as string,
  target: r.target as string,
  url: r.url as string,
  mode: r.mode as Channel['mode'],
  settings: { ...DEFAULT_CHANNEL_SETTINGS, ...parseJson<Partial<ChannelSettings>>(r.settings_json as string, {}) },
  capabilities: parseJson<Capability[]>(r.capabilities_json as string, []),
  status: r.status as Channel['status'],
  statusDetail: r.status_detail as string,
  baselineDoneAt: (r.baseline_done_at as string | null) ?? null,
  lastRunAt: (r.last_run_at as string | null) ?? null,
  lastSuccessAt: (r.last_success_at as string | null) ?? null,
  nextCheckAt: (r.next_check_at as string | null) ?? null,
  createdAt: r.created_at as string
})

export const mapDiscussion = (r: Row): Discussion => ({
  id: r.id as string,
  channelId: r.channel_id as string,
  externalId: r.external_id as string,
  url: r.url as string,
  title: r.title as string,
  author: r.author as string,
  body: r.body as string,
  selectedForProcessing: r.selected === 1,
  firstSeenAt: r.first_seen_at as string,
  lastSeenAt: r.last_seen_at as string
})

export const mapComment = (r: Row): Comment => ({
  id: r.id as string,
  discussionId: r.discussion_id as string,
  channelId: r.channel_id as string,
  externalId: r.external_id as string,
  parentExternalId: (r.parent_external_id as string | null) ?? null,
  author: r.author as string,
  body: r.body as string,
  url: r.url as string,
  postedAt: (r.posted_at as string | null) ?? null,
  baseline: r.baseline === 1,
  isOwn: r.is_own === 1,
  contentHash: r.content_hash as string,
  firstSeenAt: r.first_seen_at as string,
  lastSeenAt: r.last_seen_at as string
})

export const mapOpportunity = (r: Row): Opportunity => ({
  id: r.id as string,
  channelId: r.channel_id as string,
  productId: r.product_id as string,
  kind: r.kind as Opportunity['kind'],
  state: r.state as Opportunity['state'],
  commentId: (r.comment_id as string | null) ?? null,
  discussionId: (r.discussion_id as string | null) ?? null,
  category: (r.category as Opportunity['category']) ?? null,
  decision: (r.decision as Opportunity['decision']) ?? null,
  destination: r.destination as string,
  reason: r.reason as string,
  scheduledAt: (r.scheduled_at as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
})

export const mapDraft = (r: Row): Draft => ({
  id: r.id as string,
  opportunityId: r.opportunity_id as string,
  title: (r.title as string | null) ?? null,
  text: r.text as string,
  link: (r.link as string | null) ?? null,
  attachments: parseJson(r.attachments_json as string, []),
  knowledgeVersionId: (r.knowledge_version_id as string | null) ?? null,
  usedClaimLineageIds: parseJson(r.used_claims_json as string, []),
  rationale: r.rationale as string,
  author: r.author as Draft['author'],
  createdAt: r.created_at as string
})

export const mapApproval = (r: Row): Approval => ({
  id: r.id as string,
  draftId: r.draft_id as string,
  contentHash: r.content_hash as string,
  accountId: r.account_id as string,
  destination: r.destination as string,
  approvedBy: r.approved_by as Approval['approvedBy'],
  ruleId: (r.rule_id as string | null) ?? null,
  approvedAt: r.approved_at as string,
  invalidatedAt: (r.invalidated_at as string | null) ?? null,
  invalidReason: (r.invalid_reason as string | null) ?? null
})

export const mapAction = (r: Row): SendAction => ({
  id: r.id as string,
  opportunityId: r.opportunity_id as string,
  draftId: r.draft_id as string,
  approvalId: r.approval_id as string,
  contentHash: r.content_hash as string,
  accountId: r.account_id as string,
  destination: r.destination as string,
  state: r.state as SendAction['state'],
  attemptedAt: r.attempted_at as string,
  completedAt: (r.completed_at as string | null) ?? null,
  resultUrl: (r.result_url as string | null) ?? null,
  resultExternalId: (r.result_external_id as string | null) ?? null,
  authorizationBasis: r.authorization_basis as string,
  knowledgeVersionId: (r.knowledge_version_id as string | null) ?? null,
  error: (r.error as string | null) ?? null
})

export const mapRun = (r: Row): Run => ({
  id: r.id as string,
  kind: r.kind as Run['kind'],
  channelId: (r.channel_id as string | null) ?? null,
  productId: (r.product_id as string | null) ?? null,
  status: r.status as Run['status'],
  startedAt: r.started_at as string,
  finishedAt: (r.finished_at as string | null) ?? null,
  summary: r.summary as string
})

/** Thin typed lookups. Throws a readable error when a record is missing. */
export class Repos {
  constructor(private readonly db: Db) {}

  private one<T>(table: string, id: string, map: (r: Row) => T, label: string): T {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined
    if (!row) throw new Error(`${label} not found: ${id}`)
    return map(row)
  }

  product(id: string): Product {
    return this.one('products', id, mapProduct, 'Product')
  }
  account(id: string): Account {
    return this.one('accounts', id, mapAccount, 'Account')
  }
  channel(id: string): Channel {
    return this.one('channels', id, mapChannel, 'Channel')
  }
  discussion(id: string): Discussion {
    return this.one('discussions', id, mapDiscussion, 'Discussion')
  }
  comment(id: string): Comment {
    return this.one('comments', id, mapComment, 'Comment')
  }
  opportunity(id: string): Opportunity {
    return this.one('opportunities', id, mapOpportunity, 'Opportunity')
  }
  draft(id: string): Draft {
    return this.one('drafts', id, mapDraft, 'Draft')
  }
  action(id: string): SendAction {
    return this.one('send_actions', id, mapAction, 'Action')
  }

  listProducts(): Product[] {
    return (this.db.prepare('SELECT * FROM products ORDER BY created_at').all() as Row[]).map(mapProduct)
  }
  listAccounts(): Account[] {
    return (this.db.prepare('SELECT * FROM accounts ORDER BY created_at').all() as Row[]).map(mapAccount)
  }
  listChannels(): Channel[] {
    return (this.db.prepare('SELECT * FROM channels ORDER BY created_at').all() as Row[]).map(mapChannel)
  }

  latestDraft(opportunityId: string): Draft | null {
    const row = this.db
      .prepare('SELECT * FROM drafts WHERE opportunity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(opportunityId) as Row | undefined
    return row ? mapDraft(row) : null
  }

  /** The valid (not invalidated) approval of a draft, if any. */
  activeApproval(draftId: string): Approval | null {
    const row = this.db
      .prepare('SELECT * FROM approvals WHERE draft_id = ? AND invalidated_at IS NULL ORDER BY approved_at DESC LIMIT 1')
      .get(draftId) as Row | undefined
    return row ? mapApproval(row) : null
  }

  lastAction(opportunityId: string): SendAction | null {
    const row = this.db
      .prepare('SELECT * FROM send_actions WHERE opportunity_id = ? ORDER BY attempted_at DESC, rowid DESC LIMIT 1')
      .get(opportunityId) as Row | undefined
    return row ? mapAction(row) : null
  }
}
