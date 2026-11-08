// Test fixture for the discussion → draft → approval → sending flow. Builds products, accounts and channels
// directly in SQL (those modules are owned elsewhere) and wires a fake connector and fake knowledge.
// Not imported by production code.

import type { Account, AccountStatus, Capability, CapabilityKey, Channel, ChannelMode, ChannelSettings, Claim, Id, Opportunity, Product } from '../../shared/types'
import { DEFAULT_CHANNEL_SETTINGS } from '../../shared/types'
import type { Core } from '../core'
import { newId, toJson } from '../db/database'
import type { KnowledgeProvider, DraftingService, MonitorService, SendingService } from '../services'
import { FakeConnector } from '../testing/fake-connector'
import { makeTestCore, type TestCore } from '../testing/fakes'
import { buildCard } from './cards'
import { FlowStore } from './store'

const CAPABILITY_KEYS: CapabilityKey[] = ['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send', 'metrics', 'rules']

export const verifiedCapabilities = (): Capability[] => CAPABILITY_KEYS.map((key) => ({ key, status: 'verified', detail: '', checkedAt: null }))

export function makeClaim(id: string, text: string, overrides: Partial<Claim> = {}): Claim {
  return {
    id,
    lineageId: `lin-${id}`,
    passportVersionId: 'pv-1',
    section: 'offer',
    text,
    kind: 'fact',
    status: 'approved',
    sources: [],
    verifiedAt: null,
    unconfirmedAvailability: false,
    conflictsWith: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides
  }
}

export class FakeKnowledge implements KnowledgeProvider {
  approved: Claim[] = []
  prohibited: Claim[] = []
  version: Id | null = 'pv-1'
  activeVersionId(): Id | null {
    return this.version
  }
  approvedClaims(): Claim[] {
    return this.approved
  }
  prohibitedClaims(): Claim[] {
    return this.prohibited
  }
}

export interface ChannelOptions {
  accountId?: Id
  /** The product the channel belongs to; defaults to the world's product. */
  productId?: Id
  target?: string
  mode?: ChannelMode
  status?: Channel['status']
  settings?: Partial<ChannelSettings>
  capabilities?: Capability[]
  baselineDone?: boolean
  connectorId?: string
}

export interface World extends TestCore {
  connector: FakeConnector
  knowledge: FakeKnowledge
  store: FlowStore
  product: Product
  account: Account
  channel: Channel
  monitor: MonitorService
  drafting: DraftingService
  sending: SendingService
  /** `productId` is the product that owns the login (DEC-009); defaults to the world's product, null for a legacy unassigned one. */
  addAccount(options?: { label?: string; identity?: string | null; status?: AccountStatus; productId?: Id | null }): Account
  /** A second product, for tests where one account serves channels of several products. */
  addProduct(name?: string): Product
  /** Gives the login a role (DEC-010) or removes it with null. */
  setRole(accountId: Id, role: { name: string; voice: string } | null): void
  addChannel(options?: ChannelOptions): Channel
  /** Adds a brand-new comment, runs one monitor cycle and returns the opportunity it created. */
  newOpportunity(options?: { channel?: Channel; discussionId?: string; commentId?: string; body?: string; author?: string }): Promise<Opportunity>
  /** A reply opportunity with a user draft, approved and ready to send. */
  readyReply(options?: { channel?: Channel; text?: string; body?: string; discussionId?: string }): Promise<Opportunity>
  /** Re-reads the channel row (the services keep nothing in memory). */
  refresh(channel?: Channel): Channel
  opportunity(id: Id): Opportunity
  card(id: Id): ReturnType<typeof buildCard>
  setSettings(channelId: Id, patch: Partial<ChannelSettings>): void
  setMode(channelId: Id, mode: ChannelMode): void
}

export interface WorldOptions {
  identity?: string | null
  mode?: ChannelMode
  baselineDone?: boolean
  settings?: Partial<ChannelSettings>
  capabilities?: Capability[]
  claims?: Claim[]
}

let sequence = 0

export function makeWorld(options: WorldOptions = {}): World {
  const connector = new FakeConnector({ id: 'fake', platform: 'fake', identity: options.identity === null ? 'ghost' : (options.identity ?? 'brand_account') })
  const t = makeTestCore({ connectors: [connector] })
  const core = t.core
  const knowledge = new FakeKnowledge()
  knowledge.approved = options.claims ?? [makeClaim('c1', 'Natal Mystic builds a natal chart from your birth date, time and place.'), makeClaim('c2', 'The app works on iPhone and Android.', { lineageId: 'lin-c2' })]
  core.services.knowledge = knowledge

  const store = new FlowStore(core)
  const productId = newId()
  const now = core.clock.now().toISOString()
  core.db
    .prepare('INSERT INTO products (id, name, website_url, description, goal_json, active_passport_version_id, analysis_status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)')
    .run(productId, 'Natal Mystic', 'https://natalmystic.com', 'Astrology app', 'pv-1', 'complete', now, now)

  const world = {} as World
  Object.assign(world, t, { connector, knowledge, store })
  world.product = core.repos.product(productId)
  world.monitor = core.services.monitor as MonitorService
  world.drafting = core.services.drafting as DraftingService
  world.sending = core.services.sending as SendingService

  world.addProduct = (name) => {
    sequence += 1
    const id = newId()
    core.db
      .prepare('INSERT INTO products (id, name, website_url, description, goal_json, active_passport_version_id, analysis_status, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)')
      .run(id, name ?? `Product ${sequence}`, `https://product-${sequence}.test`, 'Another product', 'pv-1', 'complete', now, now)
    return core.repos.product(id)
  }

  // The account's product column belongs to the channels migration (DEC-009); it is filled in as soon as it exists,
  // so these tests run unchanged before and after that migration.
  const accountsHaveProduct = (core.db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).some((c) => c.name === 'product_id')

  // The role columns come with the channels migration (DEC-010); they are added here only if that migration is not
  // part of this schema yet, with the names the account mapper reads.
  world.setRole = (accountId, role) => {
    const columns = (core.db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).map((c) => c.name)
    if (!columns.includes('role_name')) core.db.exec('ALTER TABLE accounts ADD COLUMN role_name TEXT')
    if (!columns.includes('role_voice')) core.db.exec('ALTER TABLE accounts ADD COLUMN role_voice TEXT')
    core.db.prepare('UPDATE accounts SET role_name = ?, role_voice = ? WHERE id = ?').run(role?.name ?? null, role?.voice ?? null, accountId)
  }

  world.addAccount = (opts = {}) => {
    sequence += 1
    const id = newId()
    const identity = opts.identity === undefined ? 'brand_account' : opts.identity
    core.db
      .prepare('INSERT INTO accounts (id, platform, label, identity, partition, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, 'fake', opts.label ?? `Account ${sequence}`, identity, `part-${sequence}-${id}`, opts.status ?? 'ready', now)
    if (accountsHaveProduct) core.db.prepare('UPDATE accounts SET product_id = ? WHERE id = ?').run(opts.productId === undefined ? productId : opts.productId, id)
    return core.repos.account(id)
  }

  world.addChannel = (opts = {}) => {
    sequence += 1
    const id = newId()
    const accountId = opts.accountId ?? world.account.id
    const baselineDone = opts.baselineDone ?? true
    const settings: ChannelSettings = { ...DEFAULT_CHANNEL_SETTINGS, ...(options.settings ?? {}), ...(opts.settings ?? {}) }
    const target = opts.target ?? `r/test${sequence}`
    core.db
      .prepare(
        `INSERT INTO channels (id, product_id, account_id, platform, connector_id, target, url, mode, settings_json, capabilities_json, status, status_detail, baseline_done_at, last_run_at, last_success_at, next_check_at, created_at)
         VALUES (?, ?, ?, 'fake', ?, ?, ?, ?, ?, ?, ?, '', ?, NULL, NULL, NULL, ?)`
      )
      .run(
        id,
        opts.productId ?? productId,
        accountId,
        opts.connectorId ?? 'fake',
        target,
        `https://fake.test/${target}`,
        opts.mode ?? options.mode ?? 'approval',
        toJson(settings),
        toJson(opts.capabilities ?? options.capabilities ?? verifiedCapabilities()),
        opts.status ?? (baselineDone ? 'active' : 'setup'),
        baselineDone ? now : null,
        now
      )
    return core.repos.channel(id)
  }

  world.account = world.addAccount({ label: 'Main', identity: options.identity === undefined ? 'brand_account' : options.identity })
  world.channel = world.addChannel({ baselineDone: options.baselineDone ?? true })

  world.refresh = (channel) => core.repos.channel((channel ?? world.channel).id)
  world.opportunity = (id) => store.requireOpportunity(id)
  world.card = (id) => buildCard(core, store, store.requireOpportunity(id))
  world.setSettings = (channelId, patch) => {
    const channel = core.repos.channel(channelId)
    core.db.prepare('UPDATE channels SET settings_json = ? WHERE id = ?').run(toJson({ ...channel.settings, ...patch }), channelId)
  }
  world.setMode = (channelId, mode) => {
    core.db.prepare('UPDATE channels SET mode = ? WHERE id = ?').run(mode, channelId)
  }

  world.newOpportunity = async (opts = {}) => {
    const channel = opts.channel ?? world.channel
    const discussionId = opts.discussionId ?? 'd1'
    if (!connector.discussions.some((d) => d.externalId === discussionId)) connector.addDiscussion({ externalId: discussionId })
    sequence += 1
    const commentId = opts.commentId ?? `t1_new${sequence}`
    connector.addComment(discussionId, { externalId: commentId, body: opts.body ?? 'How does the natal chart work?', author: opts.author ?? 'curious_user' })
    const outcome = await world.monitor.runChannel(channel.id)
    if (outcome.status !== 'ok') throw new Error(`monitor cycle failed in fixture: ${outcome.summary}`)
    const row = core.db.prepare('SELECT o.id FROM opportunities o JOIN comments c ON c.id = o.comment_id WHERE c.channel_id = ? AND c.external_id = ?').get(channel.id, commentId) as { id: string } | undefined
    if (!row) throw new Error('fixture: the new comment did not create an opportunity')
    return store.requireOpportunity(row.id)
  }

  world.readyReply = async (opts = {}) => {
    const opp = await world.newOpportunity({ channel: opts.channel, body: opts.body, discussionId: opts.discussionId })
    await core.router.call('opportunities.saveDraft', { id: opp.id, draft: { text: opts.text ?? 'Thanks for asking! It uses your birth date, time and place.' } })
    await core.router.call('opportunities.approve', { id: opp.id })
    return store.requireOpportunity(opp.id)
  }

  return world
}

export async function closeWorld(world: World): Promise<void> {
  await (world.core as Core).shutdown()
}
