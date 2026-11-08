// Database fixtures for the pipeline tests. They insert rows directly so the tests do not depend on
// how other work areas create these records. Not imported by production code.

import { newId } from '../db/database'
import type { Core } from '../core'
import type {
  Account,
  AccountStatus,
  Capability,
  Channel,
  ChannelMode,
  ChannelSettings,
  ChannelStatus,
  Id,
  OpportunityKind,
  OpportunityState,
  PromotionGoal,
  SendState
} from '../../shared/types'

const iso = (core: Core): string => core.clock.now().toISOString()

export function seedProduct(core: Core, overrides: { name?: string; goal?: PromotionGoal | null } = {}): Id {
  const id = newId()
  core.db
    .prepare('INSERT INTO products (id, name, goal_json, analysis_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, overrides.name ?? 'Natal Mystic', overrides.goal ? JSON.stringify(overrides.goal) : null, 'idle', iso(core), iso(core))
  return id
}

export function seedAccount(core: Core, overrides: { label?: string; status?: AccountStatus; identity?: string | null; createdAt?: string } = {}): Account {
  const id = newId()
  core.db
    .prepare('INSERT INTO accounts (id, platform, label, identity, partition, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'reddit', overrides.label ?? 'Main', overrides.identity ?? null, `persist:${id}`, overrides.status ?? 'ready', overrides.createdAt ?? iso(core))
  return core.repos.account(id)
}

export interface ChannelSeed {
  productId: Id
  accountId: Id
  target?: string
  status?: ChannelStatus
  mode?: ChannelMode
  nextCheckAt?: string | null
  settings?: Partial<ChannelSettings>
  capabilities?: Capability[]
  connectorId?: string
  statusDetail?: string
  createdAt?: string
}

export function seedChannel(core: Core, seed: ChannelSeed): Channel {
  const id = newId()
  const target = seed.target ?? `r/test-${id.slice(0, 6)}`
  core.db
    .prepare(
      `INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, mode, settings_json,
         capabilities_json, status, status_detail, next_check_at, created_at)
       VALUES (?, ?, ?, 'reddit', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      seed.productId,
      seed.accountId,
      seed.connectorId ?? 'fake',
      target,
      `https://fake.example/${target}`,
      seed.mode ?? 'approval',
      JSON.stringify(seed.settings ?? {}),
      JSON.stringify(seed.capabilities ?? []),
      seed.status ?? 'active',
      seed.statusDetail ?? '',
      seed.nextCheckAt === undefined ? null : seed.nextCheckAt,
      seed.createdAt ?? iso(core)
    )
  return core.repos.channel(id)
}

export function seedOpportunity(
  core: Core,
  channelId: Id,
  overrides: { state?: OpportunityState; kind?: OpportunityKind; reason?: string; updatedAt?: string; destination?: string } = {}
): Id {
  const channel = core.repos.channel(channelId)
  const id = newId()
  const at = overrides.updatedAt ?? iso(core)
  core.db
    .prepare(
      `INSERT INTO opportunities (id, channel_id, product_id, kind, state, destination, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, channelId, channel.productId, overrides.kind ?? 'reply', overrides.state ?? 'discovered', overrides.destination ?? `${channel.url}/comments/abc`, overrides.reason ?? '', at, at)
  return id
}

export function seedDraft(core: Core, opportunityId: Id, text = 'Thanks for asking! Here is how it works.', knowledgeVersionId: Id | null = null): Id {
  const id = newId()
  core.db
    .prepare('INSERT INTO drafts (id, opportunity_id, text, knowledge_version_id, rationale, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, opportunityId, text, knowledgeVersionId, 'test', 'ai', iso(core))
  return id
}

export interface SendSeed {
  opportunityId: Id
  accountId: Id
  state?: SendState
  basis?: string
  attemptedAt?: string
  completedAt?: string | null
  resultUrl?: string | null
  draftText?: string
  knowledgeVersionId?: Id | null
  error?: string | null
}

/** A draft, its approval and one send attempt: everything the action history needs to explain a send. */
export function seedSend(core: Core, seed: SendSeed): { actionId: Id; draftId: Id } {
  const draftId = seedDraft(core, seed.opportunityId, seed.draftText, seed.knowledgeVersionId ?? null)
  const opportunity = core.repos.opportunity(seed.opportunityId)
  const approvalId = newId()
  core.db
    .prepare('INSERT INTO approvals (id, draft_id, content_hash, account_id, destination, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(approvalId, draftId, 'hash', seed.accountId, opportunity.destination, 'user', iso(core))
  const actionId = newId()
  const state = seed.state ?? 'confirmed'
  core.db
    .prepare(
      `INSERT INTO send_actions (id, opportunity_id, draft_id, approval_id, content_hash, account_id, destination, state,
         attempted_at, completed_at, result_url, authorization_basis, knowledge_version_id, error)
       VALUES (?, ?, ?, ?, 'hash', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      actionId,
      seed.opportunityId,
      draftId,
      approvalId,
      seed.accountId,
      opportunity.destination,
      state,
      seed.attemptedAt ?? iso(core),
      seed.completedAt === undefined ? (state === 'sending' ? null : iso(core)) : seed.completedAt,
      seed.resultUrl ?? null,
      seed.basis ?? `user approval ${approvalId}`,
      seed.knowledgeVersionId ?? null,
      seed.error ?? null
    )
  return { actionId, draftId }
}

export function seedComment(core: Core, channelId: Id, overrides: { firstSeenAt?: string; baseline?: boolean; isOwn?: boolean } = {}): Id {
  const discussionId = newId()
  const at = overrides.firstSeenAt ?? iso(core)
  core.db
    .prepare('INSERT INTO discussions (id, channel_id, external_id, url, title, author, body, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(discussionId, channelId, discussionId, 'https://fake.example/d', 'Title', 'someone', 'Body', at, at)
  const id = newId()
  core.db
    .prepare(
      `INSERT INTO comments (id, discussion_id, channel_id, external_id, author, body, url, baseline, is_own, content_hash, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, 'someone', 'text', 'https://fake.example/c', ?, ?, 'h', ?, ?)`
    )
    .run(id, discussionId, channelId, id, overrides.baseline ? 1 : 0, overrides.isOwn ? 1 : 0, at, at)
  return id
}
