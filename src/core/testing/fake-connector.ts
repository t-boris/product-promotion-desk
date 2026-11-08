// A scripted, in-memory Connector for tests. It models a tiny platform: discussions with comments that tests
// can add to, edit, remove or lock, plus a publish script (confirm / fail / unknown / throw). It behaves like a
// real connector where it matters for the application's guarantees:
//  - it reads and writes through `ctx.session.withAgentControl`, so session serialization and takeover apply;
//  - write actions go through the page with the SendTicket, so a missing or foreign ticket is refused;
//  - a confirmed reply shows up in the thread as the account's own comment, like on a real platform.
// Not imported by production code.

import type { Capability, CapabilityKey, MetricReading } from '../../shared/types'
import type {
  ActivityBatch,
  BrowserPage,
  Connector,
  ConnectorContext,
  LoginState,
  NormalizedTarget,
  PublishOutcome,
  PublishRequest,
  PublishedRef,
  RemoteComment,
  RemoteDiscussion,
  SendTicket
} from '../ports'

export type PublishBehavior =
  | { kind: 'confirm' }
  /** The platform rejected the publication before anything was submitted. */
  | { kind: 'fail'; error: string }
  /** Submitted, but the result could not be confirmed. `visible` says whether the content is really on the platform. */
  | { kind: 'unknown'; error?: string; visible?: boolean }
  /** The connector crashes mid-send. `visible` says whether the content is really on the platform. */
  | { kind: 'throw'; error?: Error; visible?: boolean }

export interface PublishedItem {
  request: PublishRequest
  ticket: SendTicket
  /** Whether findPublished can see it, i.e. whether it really reached the platform. */
  visible: boolean
  ref: PublishedRef
}

export interface FakeConnectorOptions {
  id?: string
  platform?: string
  /** The platform name the account is known by; used as the author of confirmed replies. */
  identity?: string
}

const ALL_CAPABILITIES: CapabilityKey[] = ['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send', 'metrics', 'rules']

type ThreadFlags = RemoteDiscussion & { locked?: boolean; archived?: boolean }

export class FakeConnector implements Connector {
  readonly id: string
  readonly platform: string
  readonly version = 'fake-1'
  identity: string

  /** The world: what the platform currently shows. Tests mutate it directly or through the helpers. */
  discussions: RemoteDiscussion[] = []
  readonly lockedDiscussions = new Set<string>()
  capabilities: Capability[] = ALL_CAPABILITIES.map((key) => ({ key, status: 'verified', detail: '', checkedAt: null }))
  login: LoginState
  metrics: MetricReading[] = []

  /** Script for the next publish calls (consumed in order; default is confirm). */
  readonly publishScript: PublishBehavior[] = []
  readonly published: PublishedItem[] = []
  readonly calls: string[] = []
  /** Errors thrown by the corresponding method; set to null to heal. */
  fetchActivityError: Error | null = null
  fetchThreadError: Error | null = null
  findPublishedError: Error | null = null
  /** Holds every publish call until the promise resolves (concurrency tests). */
  publishGate: Promise<void> | null = null
  /** When false, methods do not use the browser session at all. */
  useSession = true

  private counter = 0

  constructor(options: FakeConnectorOptions = {}) {
    this.id = options.id ?? 'fake'
    this.platform = options.platform ?? 'fake'
    this.identity = options.identity ?? 'brand_account'
    this.login = { loggedIn: true, identity: this.identity, captcha: false }
  }

  // ───────────── world helpers ─────────────

  addDiscussion(d: Partial<RemoteDiscussion> & { externalId: string }): RemoteDiscussion {
    const discussion: RemoteDiscussion = {
      url: `https://fake.test/r/test/comments/${d.externalId}`,
      title: `Post ${d.externalId}`,
      author: 'op_user',
      body: 'Original post body',
      postedAt: '2026-11-01T10:00:00.000Z',
      comments: [],
      ...d
    }
    this.discussions.push(discussion)
    return discussion
  }

  addComment(discussionId: string, c: Partial<RemoteComment> & { externalId: string }): RemoteComment {
    const discussion = this.discussion(discussionId)
    const comment: RemoteComment = {
      parentExternalId: discussionId,
      author: 'some_user',
      body: `Comment ${c.externalId}`,
      url: `${discussion.url}/${c.externalId}`,
      postedAt: '2026-11-02T10:00:00.000Z',
      ...c
    }
    discussion.comments.push(comment)
    return comment
  }

  editComment(discussionId: string, externalId: string, body: string): void {
    const comment = this.discussion(discussionId).comments.find((c) => c.externalId === externalId)
    if (!comment) throw new Error(`No comment ${externalId}`)
    comment.body = body
  }

  removeComment(discussionId: string, externalId: string): void {
    const discussion = this.discussion(discussionId)
    discussion.comments = discussion.comments.filter((c) => c.externalId !== externalId)
  }

  lock(discussionId: string): void {
    this.lockedDiscussions.add(discussionId)
  }

  setCapability(key: CapabilityKey, status: Capability['status'], detail = ''): void {
    this.capabilities = this.capabilities.map((c) => (c.key === key ? { ...c, status, detail } : c))
  }

  private discussion(id: string): RemoteDiscussion {
    const found = this.discussions.find((d) => d.externalId === id)
    if (!found) throw new Error(`No discussion ${id}`)
    return found
  }

  // ───────────── Connector ─────────────

  matches(input: string): boolean {
    return /fake\.test/.test(input) || /^r\//.test(input)
  }

  normalizeTarget(input: string): NormalizedTarget {
    const name = input.replace(/^https?:\/\/fake\.test\//, '').replace(/^r\//, '').replace(/\/+$/, '')
    return { target: `r/${name}`, url: `https://fake.test/r/${name}` }
  }

  loginUrl(): string {
    return 'https://fake.test/login'
  }

  /** Runs `work` with exclusive browser control like a real connector (page is null when sessions are disabled). */
  private async withBrowser<T>(ctx: ConnectorContext, owner: string, work: (page: BrowserPage | null) => Promise<T> | T): Promise<T> {
    if (!this.useSession) return work(null)
    return ctx.session.withAgentControl(owner, async (page) => work(page))
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    this.calls.push('checkLogin')
    return this.withBrowser(ctx, 'fake-login', () => this.login)
  }

  async assess(ctx: ConnectorContext): Promise<Capability[]> {
    this.calls.push('assess')
    return this.withBrowser(ctx, 'fake-assess', () => this.capabilities)
  }

  async fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch> {
    this.calls.push('fetchActivity')
    return this.withBrowser(ctx, 'fake-read', () => {
      if (this.fetchActivityError) throw this.fetchActivityError
      return {
        discussions: structuredClone(this.discussions.slice(0, options.limit)),
        fetchedAt: ctx.clock.now().toISOString()
      }
    })
  }

  async fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null> {
    this.calls.push(`fetchThread ${discussionExternalId}`)
    return this.withBrowser(ctx, 'fake-thread', () => {
      if (this.fetchThreadError) throw this.fetchThreadError
      const found = this.discussions.find((d) => d.externalId === discussionExternalId)
      if (!found) return null
      const copy: ThreadFlags = structuredClone(found)
      if (this.lockedDiscussions.has(discussionExternalId)) copy.locked = true
      return copy
    })
  }

  async fetchMetrics(): Promise<MetricReading[]> {
    this.calls.push('fetchMetrics')
    return this.metrics
  }

  async publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    this.calls.push('publish')
    // A real connector can only act with a ticket issued for exactly this account and destination.
    ctx.tickets.assertValid(ticket, { accountId: ctx.account.id, destination: request.destination })
    return this.withBrowser(ctx, 'fake-send', async (page) => {
      if (this.publishGate) await this.publishGate
      const behavior = this.publishScript.shift() ?? { kind: 'confirm' as const }
      if (behavior.kind === 'fail') return { status: 'failed' as const, error: behavior.error }

      // Typing into the page is a write action: it needs the ticket, enforced by the session guard.
      if (page) {
        await page.fill('#fake-text', request.text, ticket)
        await page.click('#fake-submit', ticket)
      }

      const item = this.record(request, ticket, behavior.kind === 'confirm' ? true : (behavior.visible ?? false))
      if (behavior.kind === 'throw') throw behavior.error ?? new Error('Connection lost while sending')
      if (behavior.kind === 'unknown') return { status: 'unknown' as const, error: behavior.error ?? 'The page did not show a result' }
      this.showAsOwnComment(request, item.ref)
      return { status: 'confirmed' as const, url: item.ref.url, externalId: item.ref.externalId }
    })
  }

  private record(request: PublishRequest, ticket: SendTicket, visible: boolean): PublishedItem {
    this.counter += 1
    const ref: PublishedRef = { url: `${request.destination}#published-${this.counter}`, externalId: `fake-pub-${this.counter}` }
    const item: PublishedItem = { request, ticket, visible, ref }
    this.published.push(item)
    return item
  }

  private showAsOwnComment(request: PublishRequest, ref: PublishedRef): void {
    if (request.kind !== 'reply' || !request.parentExternalId) return
    const discussion = this.discussions.find((d) => d.comments.some((c) => c.externalId === request.parentExternalId))
    if (!discussion) return
    discussion.comments.push({
      externalId: ref.externalId,
      parentExternalId: request.parentExternalId,
      author: this.identity,
      body: request.text,
      url: ref.url,
      postedAt: new Date().toISOString()
    })
  }

  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    this.calls.push('findPublished')
    return this.withBrowser(ctx, 'fake-find', () => {
      if (this.findPublishedError) throw this.findPublishedError
      const match = this.published.find((p) => p.visible && p.request.destination === request.destination && p.request.text === request.text)
      return match ? match.ref : null
    })
  }
}
