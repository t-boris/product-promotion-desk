// A scripted, in-memory Connector for tests. It models a tiny platform: discussions with comments that tests
// can add to, edit, remove or lock, plus a publish script (confirm / fail / unknown / throw). It behaves like a
// real connector where it matters for the application's guarantees:
//  - it reads and writes through `ctx.session.withAgentControl`, so session serialization and takeover apply;
//  - write actions go through the page with the SendTicket, so a missing or foreign ticket is refused;
//  - a confirmed reply shows up in the thread as the account's own comment, like on a real platform.
// Not imported by production code.

import type { PostNumbers } from '../../shared/post-numbers'
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
  RemoteInboxItem,
  SendTicket,
  PostForm,
  StandingReading
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
  /** When it appeared on the platform; findPublished ignores items older than the attempt being reconciled. */
  createdAt?: string
}

export interface FakeConnectorOptions {
  id?: string
  platform?: string
  /** The platform name the account is known by; used as the author of confirmed replies. */
  identity?: string
}

const ALL_CAPABILITIES: CapabilityKey[] = ['read_posts', 'read_comments', 'detect_changes', 'publish_post', 'publish_reply', 'verify_send', 'metrics', 'membership', 'read_inbox']

export class FakeConnector implements Connector {
  readonly id: string
  readonly platform: string
  readonly version = 'fake-1'
  identity: string

  /** The world: what the platform currently shows. Tests mutate it directly or through the helpers. */
  discussions: RemoteDiscussion[] = []
  readonly lockedDiscussions = new Set<string>()
  /** Threads the fake can only read partially (like a page with unexpanded "load more" parts). */
  readonly incompleteDiscussions = new Set<string>()
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
  /**
   * What `listPosts` shows (DEC-040): the posts of the community, newest first, each without comments. Empty until a test adds posts with `addPost`, so a
   * test that does not care about the triage sees none. Set `listPosts` to undefined for a platform that cannot list posts.
   */
  posts: RemoteDiscussion[] = []
  /** The whole threads of the posts that `addPost` added; `fetchThread` reads them, `fetchActivity` does not show them. */
  readonly postThreads = new Map<string, RemoteDiscussion>()
  /** The error `listPosts` throws; set to null to heal. */
  listPostsError: Error | null = null
  /** The requests `listPosts` received, to check what the triage asks the platform. */
  readonly listPostsRequests: { since: string; max: number }[] = []
  /** What the account's inbox holds (DEC-039), newest first, and the error `readInbox` throws; set `readInbox` to undefined for a platform with no inbox. */
  inbox: RemoteInboxItem[] = []
  inboxError: Error | null = null
  findPublishedError: Error | null = null
  checkLoginError: Error | null = null
  /** Runs while a thread is being read, to change the world "during" the read (races between the gate's checks). */
  onFetchThread: (() => void) | null = null
  /** The requests findPublished received, to check what reconciliation asks the platform. */
  readonly findPublishedRequests: PublishRequest[] = []
  /** Holds every publish call until the promise resolves (concurrency tests). */
  publishGate: Promise<void> | null = null
  /** When false, methods do not use the browser session at all. */
  useSession = true
  /** What `readsChannel` answers: false makes every channel of this connector one for the owner's own posts (DEC-034). */
  canRead = true
  /** What `findsOwnPosts` answers: true lets a send to a channel the connector does not read be looked for in the account's own posts. */
  ownPostsFindable = false

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

  /**
   * A post of the community that `listPosts` shows (without its comments) and `fetchThread` can read (with `comments`), but `fetchActivity` does not
   * return: the monitor's ordinary read stays out of the triage's way. Posts are listed newest first by `postedAt` (one without a time is listed first).
   */
  addPost(d: Partial<RemoteDiscussion> & { externalId: string }): RemoteDiscussion {
    const post: RemoteDiscussion = {
      url: `https://fake.test/r/test/comments/${d.externalId}`,
      title: `Post ${d.externalId}`,
      author: 'op_user',
      body: 'Original post body',
      postedAt: '2026-11-08T10:00:00.000Z',
      comments: [],
      ...d
    }
    this.postThreads.set(post.externalId, post)
    this.posts.push({ ...post, comments: [] })
    this.posts.sort((a, b) => Date.parse(b.postedAt ?? '9999-12-31') - Date.parse(a.postedAt ?? '9999-12-31'))
    return post
  }

  /** Takes a post off the platform: it is no longer listed and its thread cannot be read. */
  removePost(externalId: string): void {
    this.postThreads.delete(externalId)
    this.posts = this.posts.filter((p) => p.externalId !== externalId)
  }

  addComment(discussionId: string, c: Partial<RemoteComment> & { externalId: string }): RemoteComment {
    const discussion = this.postThreads.get(discussionId) ?? this.discussion(discussionId)
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

  markIncomplete(discussionId: string): void {
    this.incompleteDiscussions.add(discussionId)
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
    return this.withBrowser(ctx, 'fake-login', () => {
      if (this.checkLoginError) throw this.checkLoginError
      return this.login
    })
  }

  readsChannel(): boolean {
    return this.canRead
  }

  findsOwnPosts(): boolean {
    return this.ownPostsFindable
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
      this.onFetchThread?.()
      const found = this.discussions.find((d) => d.externalId === discussionExternalId) ?? this.postThreads.get(discussionExternalId)
      if (!found) return null
      const copy: RemoteDiscussion = structuredClone(found)
      if (this.lockedDiscussions.has(discussionExternalId)) copy.locked = true
      if (this.incompleteDiscussions.has(discussionExternalId)) copy.incomplete = true
      return copy
    })
  }

  /** Like the real connector: the posts written since `since` (a post with no time is kept), newest first, at most `max`, without comments. */
  listPosts: Connector['listPosts'] = async (ctx, options) => {
    this.calls.push('listPosts')
    this.listPostsRequests.push({ since: options.since, max: options.max })
    return this.withBrowser(ctx, 'fake-list', () => {
      if (this.listPostsError) throw this.listPostsError
      const since = Date.parse(options.since)
      return structuredClone(this.posts.filter((p) => p.postedAt === null || Date.parse(p.postedAt) >= since).slice(0, options.max))
    })
  }

  readInbox: Connector['readInbox'] = async (ctx, options) => {
    this.calls.push('readInbox')
    return this.withBrowser(ctx, 'fake-inbox', () => {
      if (this.inboxError) throw this.inboxError
      return structuredClone(this.inbox.slice(0, options?.limit ?? this.inbox.length))
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

      const item = this.record(request, ticket, behavior.kind === 'confirm' ? true : (behavior.visible ?? false), ctx.clock.now().toISOString())
      if (behavior.kind === 'throw') throw behavior.error ?? new Error('Connection lost while sending')
      if (behavior.kind === 'unknown') return { status: 'unknown' as const, error: behavior.error ?? 'The page did not show a result' }
      this.showAsOwnComment(request, item.ref)
      return { status: 'confirmed' as const, url: item.ref.url, externalId: item.ref.externalId }
    })
  }

  private record(request: PublishRequest, ticket: SendTicket, visible: boolean, createdAt: string): PublishedItem {
    this.counter += 1
    const ref: PublishedRef = { url: `${request.destination}#published-${this.counter}`, externalId: `fake-pub-${this.counter}` }
    const item: PublishedItem = { request, ticket, visible, ref, createdAt }
    this.published.push(item)
    return item
  }

  private showAsOwnComment(request: PublishRequest, ref: PublishedRef): void {
    if (request.kind !== 'reply' || !request.parentExternalId) return
    // A reply to a comment, or a top-level comment on a post (the parent is then the discussion itself).
    const discussion = this.discussions.find((d) => d.externalId === request.parentExternalId || d.comments.some((c) => c.externalId === request.parentExternalId))
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

  /** What the platform shows under the account's posts, by their platform id. A post not listed is not found. */
  readonly postNumbers = new Map<string, PostNumbers>()
  numbersError: Error | null = null
  /** The posts each `readPostNumbers` call asked about. */
  readonly numbersRequests: string[][] = []

  async readPostNumbers(ctx: ConnectorContext, posts: { externalId: string; url: string | null }[]): Promise<Record<string, PostNumbers>> {
    this.calls.push('readPostNumbers')
    this.numbersRequests.push(posts.map((p) => p.externalId))
    return this.withBrowser(ctx, 'fake-numbers', () => {
      if (this.numbersError) throw this.numbersError
      return Object.fromEntries(posts.filter((p) => this.postNumbers.has(p.externalId)).map((p) => [p.externalId, this.postNumbers.get(p.externalId) as PostNumbers]))
    })
  }

  /** What the platform says about the confirmed posts, by their platform id: still up, removed, or null (cannot tell). A post not listed cannot be told. */
  readonly standings = new Map<string, StandingReading | null>()
  /** The error `readStanding` throws; set to null to heal. */
  standingError: Error | null = null
  /** The posts `readStanding` was asked about, in order. */
  readonly standingRequests: string[] = []

  async readStanding(ctx: ConnectorContext, ref: { externalId: string; url: string | null }): Promise<StandingReading | null> {
    this.calls.push('readStanding')
    this.standingRequests.push(ref.externalId)
    return this.withBrowser(ctx, 'fake-standing', () => {
      if (this.standingError) throw this.standingError
      return this.standings.get(ref.externalId) ?? null
    })
  }

  /** What the platform says a post in the community can carry (flairs, whether one is required); null: the platform did not say. */
  postForm: PostForm | null = { flairs: [], flairRequired: false }
  /** The error `readPostForm` throws; set to null to heal. */
  postFormError: Error | null = null
  /** How many times the form was read from the platform (a reading kept by the application is not one). */
  postFormReads = 0

  async readPostForm(ctx: ConnectorContext): Promise<PostForm | null> {
    this.calls.push('readPostForm')
    this.postFormReads += 1
    return this.withBrowser(ctx, 'fake-form', () => {
      if (this.postFormError) throw this.postFormError
      return this.postForm
    })
  }

  async findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    this.calls.push('findPublished')
    this.findPublishedRequests.push(request)
    return this.withBrowser(ctx, 'fake-find', () => {
      if (this.findPublishedError) throw this.findPublishedError
      // Like a real connector, only match what was created at or after the attempt being reconciled.
      const since = request.attemptedAt ? Date.parse(request.attemptedAt) : null
      const match = this.published.find(
        (p) => p.visible && p.request.destination === request.destination && p.request.text === request.text && (since === null || !p.createdAt || Date.parse(p.createdAt) >= since)
      )
      return match ? match.ref : null
    })
  }
}
