import type {
  ActivityBatch,
  BrowserPage,
  Connector,
  ConnectorContext,
  LoginState,
  NormalizedTarget,
  PublishedRef,
  PublishOutcome,
  PublishRequest,
  RemoteComment,
  RemoteDiscussion,
  SendTicket
} from '../../core/ports'
import type { Capability, MetricReading } from '../../shared/types'
import { gateProbeScript, type GateProbe } from '../page-scripts'
import { ensureRedditOrigin, RedditApi } from './api'
import { refusalError } from './auth'
import { assessSubreddit } from './assess'
import { toDiscussion, REDDIT_ORIGIN, type RedditPost } from './mapping'
import { collectMetrics } from './metrics'
import { DEFAULT_RUNTIME, findOwnPublication, publishToReddit, type RedditRuntime } from './publish'
import { isRedditAddress, normalizeRedditTarget, parseSubreddit } from './target'

export const REDDIT_CONNECTOR_VERSION = '1'

/** Pause between consecutive thread reads, to stay well below Reddit's request limits. */
const DEFAULT_PACING_MS = 400

export interface RedditConnectorOptions extends Partial<RedditRuntime> {
  /** Pause between thread reads while collecting activity. */
  pacingMs?: number
}

/**
 * Prepared connector for Reddit. Reading uses the site's JSON endpoints from inside the account's logged-in
 * page; writing drives the real forms. All network access goes through the controlled browser session.
 */
export class RedditConnector implements Connector {
  readonly id = 'reddit'
  readonly platform = 'reddit'
  readonly version = REDDIT_CONNECTOR_VERSION
  readonly label = 'Reddit'

  private readonly runtime: RedditRuntime
  private readonly pacingMs: number

  constructor(options: RedditConnectorOptions = {}) {
    const { pacingMs, ...runtime } = options
    this.runtime = { ...DEFAULT_RUNTIME, ...runtime }
    this.pacingMs = pacingMs ?? DEFAULT_PACING_MS
  }

  matches(input: string): boolean {
    return isRedditAddress(input)
  }

  normalizeTarget(input: string): NormalizedTarget {
    return normalizeRedditTarget(input)
  }

  loginUrl(): string {
    return `${REDDIT_ORIGIN}/login/`
  }

  async checkLogin(ctx: ConnectorContext): Promise<LoginState> {
    return ctx.session.withAgentControl(`login:${ctx.account.id}`, async (page) => {
      await page.goto(`${REDDIT_ORIGIN}/`, { timeoutMs: 30_000 })
      const gate = await page.read<GateProbe>(gateProbeScript())
      if (gate.captcha) return { loggedIn: false, identity: null, captcha: true }
      const identity = await new RedditApi(page).me()
      return { loggedIn: identity !== null, identity, captcha: false }
    })
  }

  assess(ctx: ConnectorContext): Promise<Capability[]> {
    return assessSubreddit(ctx)
  }

  async fetchActivity(ctx: ConnectorContext, options: { limit: number }): Promise<ActivityBatch> {
    const sub = this.subreddit(ctx)
    return ctx.session.withAgentControl(`monitor:${ctx.channel.id}`, async (page) => {
      await ensureRedditOrigin(page, ctx.channel.url)
      const api = new RedditApi(page)
      const listing = await api.listing(sub, options.limit)
      if (!listing.ok) throw await refusalError(page, api, listing, `Could not read the r/${sub} listing: ${listing.reason}`)

      const discussions: RemoteDiscussion[] = []
      for (const post of listing.value.filter((p) => !p.removed).slice(0, options.limit)) {
        // Partial results would make a later cycle look like "new" activity for old comments (REQ-003),
        // so any failure to read a thread fails the whole batch instead of dropping it silently.
        const read = await this.readComments(page, api, sub, post, discussions.length > 0)
        discussions.push(toDiscussion(post, read.comments, read.incomplete))
      }
      return { discussions, fetchedAt: ctx.clock.now().toISOString() }
    })
  }

  /** The comments of a post and whether the read is partial (stubs left unexpanded, nesting cut off, a call failed). */
  private async readComments(page: BrowserPage, api: RedditApi, sub: string, post: RedditPost, paced: boolean): Promise<{ comments: RemoteComment[]; incomplete: boolean }> {
    if ((post.numComments ?? 0) === 0) return { comments: [], incomplete: false }
    if (paced && this.pacingMs > 0) await this.runtime.sleep(this.pacingMs)
    const thread = await api.thread(sub, post.fullname)
    if (!thread.ok) throw await refusalError(page, api, thread, `Could not read comments of ${post.fullname}: ${thread.reason}`)
    const { mapped } = thread.value
    const comments = [...mapped.comments]
    let incomplete = mapped.incomplete
    if (mapped.moreIds.length > 0) {
      const more = await api.expandMore(post.fullname, mapped.moreIds, post.permalink)
      const seen = new Set(comments.map((c) => c.externalId))
      for (const comment of more.comments) if (!seen.has(comment.externalId)) comments.push(comment)
      incomplete = incomplete || more.incomplete
    }
    return { comments, incomplete }
  }

  async fetchThread(ctx: ConnectorContext, discussionExternalId: string): Promise<RemoteDiscussion | null> {
    const sub = this.subreddit(ctx)
    return ctx.session.withAgentControl(`thread:${ctx.channel.id}`, async (page) => {
      await ensureRedditOrigin(page, ctx.channel.url)
      const api = new RedditApi(page)
      const thread = await api.thread(sub, discussionExternalId)
      if (!thread.ok) {
        if (thread.status === 404) return null
        throw await refusalError(page, api, thread, `Could not read the thread ${discussionExternalId}: ${thread.reason}`)
      }
      const { post } = thread.value
      if (post.removed) return null
      const read = await this.readComments(page, api, sub, post, false)
      return toDiscussion(post, read.comments, read.incomplete)
    })
  }

  async fetchMetrics(ctx: ConnectorContext): Promise<MetricReading[]> {
    const sub = this.subreddit(ctx)
    return ctx.session.withAgentControl(`metrics:${ctx.channel.id}`, async (page) => {
      await ensureRedditOrigin(page, ctx.channel.url)
      return collectMetrics(new RedditApi(page), sub, ctx.account.identity)
    })
  }

  publish(ctx: ConnectorContext, ticket: SendTicket, request: PublishRequest): Promise<PublishOutcome> {
    return publishToReddit(ctx, ticket, request, this.runtime)
  }

  findPublished(ctx: ConnectorContext, request: PublishRequest): Promise<PublishedRef | null> {
    return findOwnPublication(ctx, request)
  }

  private subreddit(ctx: ConnectorContext): string {
    const sub = parseSubreddit(ctx.channel.target)
    if (!sub) throw new Error(`Channel target is not a subreddit: ${ctx.channel.target}`)
    return sub
  }
}

